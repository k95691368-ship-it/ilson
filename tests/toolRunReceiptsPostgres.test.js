// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { createSupabaseDb } from '../functions/_lib/dbBridge.ts'
import { onRequestGet, onRequestPost } from '../functions/api/tools/[slug].js'

const pg = new PGlite(), base = 'https://tool-runs-local.supabase.co'
const DB = createSupabaseDb(base, 'local-test-only')
const owner = 'employee@local.invalid', unrelated = 'other@local.invalid'
const scoped = DB.forActor(owner)
let queue = Promise.resolve(), sequence = 0, lastDatabaseError = ''
beforeAll(async () => {
  await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;')
  const dir = new URL('../supabase/migrations/', import.meta.url)
  for (const file of readdirSync(dir).filter(file => /^\d+.*\.sql$/.test(file)).sort()) await pg.exec(readFileSync(new URL(file, dir), 'utf8'))
  vi.stubGlobal('fetch', (url, options) => {
    if (!String(url).startsWith(base + '/rest/v1/rpc/')) throw Error('External network blocked')
    const pending = queue.then(async () => {
      try {
        await pg.exec('SET ROLE service_role')
        const name = new URL(url).pathname.split('/').at(-1), args = Object.values(JSON.parse(options.body))
        return Response.json((await pg.query(`SELECT public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) data`, args)).rows[0].data)
      } catch (error) { lastDatabaseError = `${error.code}: ${error.message}`; return Response.json({ code: error.code }, { status: 400 }) }
      finally { await pg.exec('RESET ROLE') }
    })
    queue = pending.catch(() => {})
    return pending
  })
  await DB.prepare("INSERT INTO override_actor(email,display_name,role,departments_json) VALUES(?,?,'reviewer','[\"재무\"]'),(?,?,'reviewer','[\"영업\"]')").bind(owner,'검증 직원',unrelated,'다른 직원').run()
}, 60000)
afterAll(async () => { vi.unstubAllGlobals(); await pg.close() })

async function fixture(db = DB) {
  const id = 'tool-run-' + (++sequence)
  await db.prepare("INSERT INTO application(id,ticket_no,dept,applicant_label,title,bottleneck,problem,owner_email) VALUES(?,?,'재무','직원','검증 도구','취합','반복',?)").bind(id,id,db.workspace ? null : owner).run()
  await db.prepare("INSERT INTO handover(application_id,slug,title,handed_to_dept,handed_to_person,daily_limit) VALUES(?,?,'검증 도구','재무','직원',1)").bind(id,id).run()
  return id
}
const env = (db = scoped) => ({ DB: db, AUTH_ACTOR: db.actorEmail ? { email: db.actorEmail, label: '검증 직원', role: 'reviewer', mode: 'access' } : null })
const request = body => new Request('https://local.invalid/api/tools/test', { method: 'POST', headers: { 'Content-Type':'application/json','CF-Connecting-IP':'127.0.0.1' }, body: JSON.stringify(body) })
const save = async (slug, body, db = scoped) => onRequestPost({ env: env(db), params:{slug}, request:request({run_scope:await db.toolRunScope(),...body}) })
const get = (slug, db = scoped) => onRequestGet({ env:env(db), params:{slug}, request:new Request('https://local.invalid/api/tools/test',{headers:{'CF-Connecting-IP':'127.0.0.1'}}) })
const count = async (slug, db = DB) => Number(await db.prepare('SELECT count(*) n FROM tool_use WHERE application_id=?').bind(slug).first('n'))
const body = changes => ({ run_id: crypto.randomUUID(), ok:true, rows_out:1, duration_ms:100, actor_label:'입력 이름', ...changes })

describe.sequential('tool run, quota and receipt transaction', () => {
  it('records one success and one charge when the same run is saved again at exhausted quota', async () => {
    const slug = await fixture(), payload = body()
    const first = await save(slug,payload), saved = await first.json()
    expect(first.status,lastDatabaseError).toBe(201)
    expect(saved.remainingToday).toBe(0)
    const retry = await save(slug,payload)
    expect(retry.status,await retry.clone().text()).toBe(201)
    expect(retry.headers.get('X-Idempotency-Replayed')).toBe('1')
    expect(await retry.json()).toEqual(saved)
    expect(await count(slug)).toBe(1)
    expect((await (await get(slug)).json()).limits.remainingToday).toBe(0)
    expect(await DB.prepare('SELECT actor_label FROM tool_use WHERE id=?').bind(saved.id).first('actor_label')).toBe('검증 직원')
    expect((await save(slug,body())).status).toBe(429)
  })
  it('records a real calculation failure without a success quota charge', async () => {
    const slug = await fixture(), failed = body({ok:false,fail_reason:'읽기 실패',duration_ms:91})
    expect((await save(slug,failed)).status).toBe(201)
    expect((await (await get(slug)).json()).limits.remainingToday).toBe(1)
    expect((await save(slug,failed)).headers.get('X-Idempotency-Replayed')).toBe('1')
    expect(await count(slug)).toBe(1)
    const row = await DB.prepare('SELECT ok,duration_ms,fail_reason FROM tool_use WHERE application_id=?').bind(slug).first()
    expect(row).toEqual({ok:0,duration_ms:91,fail_reason:'읽기 실패'})
    expect((await save(slug,body())).status).toBe(201)
    expect(await count(slug)).toBe(2)
  })
  it('reconciles a committed run whose network response was lost without a second charge', async () => {
    const slug = await fixture(), payload = body()
    const disconnected = {...scoped, recordToolRun: async (...args) => { await scoped.recordToolRun(...args); throw Error('Simulated response loss') }}
    expect((await save(slug,payload,disconnected)).status).toBe(503)
    expect(await count(slug)).toBe(1)
    const retry = await save(slug,payload)
    expect(retry.status).toBe(201)
    expect(retry.headers.get('X-Idempotency-Replayed')).toBe('1')
    expect(await count(slug)).toBe(1)
  })
  it('rolls back both quota and receipt when the insert fails after quota reservation', async () => {
    const slug = await fixture(), payload = body()
    await pg.exec(`CREATE FUNCTION public.test_reject_tool_run() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Injected local failure'; END $$;
      CREATE TRIGGER test_reject_tool_run BEFORE INSERT ON public.tool_use FOR EACH ROW EXECUTE FUNCTION public.test_reject_tool_run();`)
    try {
      expect((await save(slug,payload)).status).toBe(503)
      expect(await count(slug)).toBe(0)
      expect((await (await get(slug)).json()).limits.remainingToday).toBe(1)
    } finally { await pg.exec('DROP TRIGGER test_reject_tool_run ON public.tool_use; DROP FUNCTION public.test_reject_tool_run();') }
    expect((await save(slug,payload)).status).toBe(201)
    expect(await count(slug)).toBe(1)
  })
  it('confirms an already committed receipt after a tool is stopped but rejects a new run', async () => {
    const slug = await fixture(), payload = body()
    const disconnected = {...scoped, recordToolRun: async (...args) => { await scoped.recordToolRun(...args); throw Error('Simulated response loss') }}
    expect((await save(slug,payload,disconnected)).status).toBe(503)
    await DB.prepare("UPDATE handover SET rolled_back_at=datetime('now'),rollback_reason='점검 중' WHERE slug=?").bind(slug).run()
    const retry = await save(slug,payload)
    expect(retry.status).toBe(201)
    expect(retry.headers.get('X-Idempotency-Replayed')).toBe('1')
    expect((await save(slug,body())).status).toBe(409)
    expect(await count(slug)).toBe(1)
  })
  it('rejects changes to an existing identity and rechecks actor scope on retries', async () => {
    const slug = await fixture(), payload = body()
    expect((await save(slug,payload)).status).toBe(201)
    expect((await save(slug,{...payload,rows_out:2})).status).toBe(409)
    expect((await save(slug,payload,DB.forActor(unrelated))).status).toBe(404)
    await DB.prepare("UPDATE override_actor SET departments_json='[]',updated_at=datetime('now','+1 second') WHERE email=?").bind(owner).run()
    expect((await save(slug,payload)).status).toBe(409)
    await DB.prepare("UPDATE override_actor SET departments_json='[\"재무\"]',updated_at=datetime('now','+2 seconds') WHERE email=?").bind(owner).run()
    expect(await count(slug)).toBe(1)
  })
  it('isolates receipts and quotas in individual demonstration workspaces', async () => {
    const token='d'.repeat(64)
    await DB.workspaceOpen(token,[])
    const demo = createSupabaseDb(base,'local-test-only',token), slug = await fixture(demo), payload = body()
    expect((await save(slug,payload,demo)).status).toBe(201)
    expect((await save(slug,payload,demo)).headers.get('X-Idempotency-Replayed')).toBe('1')
    expect(await count(slug,demo)).toBe(1)
    expect(await count(slug)).toBe(0)
    expect((await (await get(slug,demo)).json()).limits.remainingToday).toBe(0)
  })
  it('rejects retries from a stale tab after account or demo workspace identity changes', async () => {
    const slug = await fixture(), payload = body({run_scope:await scoped.toolRunScope()})
    const disconnected = {...scoped, recordToolRun: async (...args) => { await scoped.recordToolRun(...args); throw Error('Simulated response loss') }}
    expect((await save(slug,payload,disconnected)).status).toBe(503)
    await DB.prepare("UPDATE override_actor SET role='product',departments_json='[\"재무\"]' WHERE email=?").bind(unrelated).run()
    expect((await save(slug,payload,DB.forActor(unrelated))).status).toBe(409)
    expect(await count(slug)).toBe(1)
    const token='e'.repeat(64)
    await DB.workspaceOpen(token,[])
    const demo = createSupabaseDb(base,'local-test-only',token), demoSlug = await fixture(demo)
    expect((await save(demoSlug,payload,demo)).status).toBe(409)
    expect(await count(demoSlug,demo)).toBe(0)
    expect((await onRequestPost({env:env(),params:{slug},request:request(body())})).status).toBe(409)
  })
  it('denies direct public RPC access and prevents actor/workspace identity mixing', async () => {
    const privilege = (await pg.query("SELECT has_function_privilege('anon','public.ilson_record_tool_run(text,text,text,text,text,text,jsonb)','EXECUTE') a,has_function_privilege('ilson_scoped_executor','public.ilson_record_tool_run(text,text,text,text,text,text,jsonb)','EXECUTE') s")).rows[0]
    expect(privilege).toEqual({a:false,s:false})
    await expect(pg.query("SELECT public.ilson_record_tool_run($1,$2,'x','tool:x:ip','request-1234567890',repeat('a',64),'{}')",['d'.repeat(64),owner])).rejects.toMatchObject({code:'22023'})
  })
})
