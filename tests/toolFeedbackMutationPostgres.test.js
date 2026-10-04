// @vitest-environment node
// Actual signed middleware + current SQL functions in disposable memory PG.
// The RPC queue models interleaved HTTP requests on ONE database connection;
// it is not a multi-session PostgreSQL concurrency or production load test.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { createSupabaseDb } from '../functions/_lib/dbBridge.ts'
import { onRequest } from '../functions/api/_middleware.js'
import { onRequestPost as report } from '../functions/api/tools/[slug]/report.js'
import { onRequestPost as unclear } from '../functions/api/tools/[slug]/unclear.js'
import { unclearBoard, boardLine, sectionNote } from '../shared/unclear.js'
import { loadUnclear } from '../functions/_lib/unclear.js'

const pg = new PGlite(), base = 'https://feedback-memory.supabase.co'
const issuer = 'https://feedback-memory.cloudflareaccess.com'
const DB = createSupabaseDb(base, 'synthetic-only'), email = 'feedback-operator@local.invalid', label = '검증된 담당자'
const env = { DB, DBBridgeApplied: true, SUPABASE_URL: base, SUPABASE_SERVICE_ROLE_KEY: 'synthetic-only',
  ACCESS_TEAM_DOMAIN: issuer, ACCESS_AUD: 'feedback-memory', DEMO_WORKSPACES: 'false', OVERRIDE_DEMO_MODE: 'false' }
let pair, jwk, queue = Promise.resolve(), sequence = 0, beforeCommit = null, beforeActorRead = null, beforeReceipt = null, dropCommitResponse = false, barrier = null, summaryQueries = 0, failSummary = false
const failures = [], commitCalls = [], directWrites = []

beforeAll(async () => {
  await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;')
  const directory = new URL('../supabase/migrations/', import.meta.url)
  for (const file of readdirSync(directory).filter(name => /^\d+.*\.sql$/.test(name)).sort()) await pg.exec(readFileSync(new URL(file, directory), 'utf8'))
  pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])
  jwk = { ...await crypto.subtle.exportKey('jwk', pair.publicKey), kid: env.ACCESS_AUD, alg: 'RS256', use: 'sig' }
  await pg.query(`INSERT INTO override_actor(email,display_name,role,departments_json) VALUES
    ($1,$2,'product','["Finance"]'),('feedback-reviewer@local.invalid','일반 사원','reviewer','["Finance"]'),
    ('feedback-other@local.invalid','타 부서 담당','product','["Other"]')`, [email, label])
  vi.stubGlobal('fetch', (url, options) => {
    if (String(url) === issuer + '/cdn-cgi/access/certs') return Promise.resolve(Response.json({ keys: [jwk] }))
    if (!String(url).startsWith(base + '/rest/v1/rpc/')) throw Error('External network prohibited')
    const name = new URL(url).pathname.split('/').at(-1), args = JSON.parse(options.body)
    const sql = args.p_sql ?? args.p_query ?? ''
    if (/SELECT id, title, what/.test(sql)) { summaryQueries++; if (failSummary) return Promise.resolve(Response.json({ code: 'XX000' }, { status: 400 })) }
    if (name === 'ilson_actor_commit') commitCalls.push(args)
    if (/^(INSERT|UPDATE|DELETE)/.test(sql)) directWrites.push(sql)
    const task = queue.then(async () => {
      let response
      try {
        if (name === 'ilson_actor_receipt' && beforeReceipt) { const hook = beforeReceipt; beforeReceipt = null; await hook() }
        if (name === 'ilson_actor_commit' && beforeCommit) {
          const hook = beforeCommit; beforeCommit = null; await hook()
        }
        if (name === 'ilson_actor_query' && /^SELECT email,display_name,role,active/.test(sql) && beforeActorRead) {
          const hook = beforeActorRead; beforeActorRead = null; await hook()
        }
        await pg.exec('SET ROLE service_role')
        const values = Object.values(args)
        response = Response.json((await pg.query(`SELECT public.${name}(${values.map((_, index) => '$' + (index + 1)).join(',')}) AS data`, values)).rows[0].data)
      } catch (error) {
        failures.push({ name, code: error.code })
        response = Response.json({ code: error.code }, { status: 400 })
      } finally { await pg.exec('RESET ROLE') }
      if (name === 'ilson_actor_commit' && dropCommitResponse && response.ok) {
        dropCommitResponse = false
        throw new TypeError('Synthetic response lost after transaction committed')
      }
      return response
    })
    queue = task.catch(() => {})
    return task.then(async response => {
      if (barrier && name === 'ilson_actor_query' && /^SELECT id,owner_email/.test(sql)) {
        const current = barrier
        if (++current.reads === 2) current.release()
        await current.ready
      }
      return response
    })
  })
}, 60000)

afterEach(async () => {
  beforeCommit = null; beforeActorRead = null; beforeReceipt = null; dropCommitResponse = false; barrier = null; failures.length = 0; commitCalls.length = 0; directWrites.length = 0; summaryQueries = 0; failSummary = false
  await queue
  // Each case starts an independent synthetic request window. Quotas are
  // still charged per request within a case (including receipt retries).
  await pg.exec('DELETE FROM public.rate_limit_hits; DELETE FROM ilson_private.actor_rate_tickets;')
  await pg.query(`UPDATE override_actor SET active=1,display_name=$2,role='product',departments_json='["Finance"]',product_ids_json='[]' WHERE email=$1`, [email, label])
})
afterAll(async () => { await queue; vi.unstubAllGlobals(); await pg.close() })

async function jwt(identity) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url'), now = Math.floor(Date.now() / 1000)
  const text = encode({ alg: 'RS256', kid: jwk.kid }) + '.' + encode({ iss: issuer, aud: [jwk.kid], email: identity, iat: now, exp: now + 600 })
  return text + '.' + Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(text))).toString('base64url')
}
async function fixture(owner = email, database = DB) {
  const app = { id: 'build-app-' + (++sequence), slug: 'build-tool-' + sequence, code: 'build-code-' + sequence }
  await database.prepare(`INSERT INTO application(id,ticket_no,dept,applicant_label,title,bottleneck,problem,status,owner_email)
    VALUES(?,?,'Finance','가상 신청자','검증 신청','취합','반복 업무','수용',?)`).bind(app.id, app.id, owner).run()
  await database.prepare(`INSERT INTO handover(application_id,slug,title,handed_to_dept,handed_to_person)
    VALUES(?,?,'검증 도구','Finance','가상 신청자')`).bind(app.id, app.slug).run()
  return app
}
const reportBody = (changes = {}) => ({ code: 'wrong_number', body: '정산 금액이 실제 확인한 값과 다릅니다.', reporter: '재무팀 대리 제보', ...changes })
const unclearBody = (changes = {}) => ({ section: 'upload', body: '어느 자료를 먼저 넣는지 모르겠습니다.', ...changes })
async function invoke(app, body = reportBody(), options = {}) {
  const key = options.key === undefined ? crypto.randomUUID() : options.key
  const identity = options.email ?? email, database = options.token ? createSupabaseDb(base, 'synthetic-only', options.token) : DB.forActor(identity)
  const headers = { 'Content-Type': 'application/json', Origin: options.origin ?? 'https://local.invalid', 'X-Ilson-Request': '1',
    'X-Ilson-Scope': await database.toolRunScope(), 'CF-Connecting-IP': 'local-synthetic' }
  if (key !== null) headers['X-Idempotency-Key'] = key
  if (options.token) headers.Cookie = 'ilson_workspace=' + options.token
  else headers['Cf-Access-Jwt-Assertion'] = await jwt(identity)
  const kind = options.kind ?? 'report', slug = options.slug ?? app.slug
  const context = { env: options.token ? { ...env, DEMO_WORKSPACES: 'true', OVERRIDE_DEMO_MODE: 'true' } : env,
    request: new Request('https://local.invalid/api/tools/' + slug + '/' + kind, { method: 'POST', headers, body: options.raw ?? JSON.stringify(body) }), data: {} }
  context.next = forwarded => {
    if (options.adapter) context.data.requestEnv = { ...context.data.requestEnv, DB: options.adapter }
    return (kind === 'report' ? report : unclear)({ env: context.env, data: context.data, params: { slug }, request: forwarded ?? context.request })
  }
  const response = await onRequest(context)
  return { status: response.status, body: await response.json(), replayed: response.headers.get('X-Idempotency-Replayed') }
}
async function logs(app) { return (await pg.query('SELECT * FROM decision_log WHERE application_id=$1 ORDER BY id', [app.id])).rows }
async function receipts(key) { return Number((await pg.query('SELECT count(*) AS n FROM ilson_private.mutation_receipts WHERE request_id=$1', [key])).rows[0].n) }
function rendezvous() {
  let release
  const ready = new Promise(resolve => { release = resolve })
  barrier = { reads: 0, ready, release }
}

describe.sequential('atomic tool feedback through signed middleware and real scoped PostgreSQL', () => {
  it.each(['report','unclear'])('commits one %s record and receipt despite a lost transaction response', async kind => {
    const app = await fixture(), key = crypto.randomUUID(), body = kind === 'report' ? reportBody() : unclearBody()
    dropCommitResponse = true
    expect((await invoke(app, body, { key, kind })).status).toBe(503)
    const first = await logs(app)
    expect(first).toHaveLength(1); expect(await receipts(key)).toBe(1)
    expect(first[0].link_kind).toBe(kind==='report'?'신고':'사용법모름')
    expect(first[0].link_id).toBe(kind==='report'?'wrong_number':'upload')
    const retry = await invoke(app, body, { key, kind })
    expect(retry).toMatchObject({ status: 200, replayed: '1', body: { ok: true, id: first[0].id } })
    expect(retry.body.id).toMatch(/^dec_[a-f0-9]{20}$/)
    expect(await logs(app)).toEqual(first)
    // Separate request limits count both requests, including the replay.
    expect((await DB.forActor(email).rateLimitState(kind + ':local-synthetic',20,kind==='report'?600:3600)).remaining).toBe(18)
  })

  it('does not depend on a post-save summary read to return a committed unclear receipt', async () => {
    const app = await fixture(), key = crypto.randomUUID()
    failSummary = true
    const result = await invoke(app, unclearBody(), { key, kind: 'unclear' })
    expect(result).toMatchObject({ status: 200, body: { ok: true, message: expect.any(String) } })
    expect(result.body).not.toHaveProperty('note')
    expect(summaryQueries).toBe(0); expect(await logs(app)).toHaveLength(1); expect(await receipts(key)).toBe(1)
  })

  it('keeps client intent distinct from record ID and transport keys', async () => {
    const app = await fixture(), intent = crypto.randomUUID()
    const body = reportBody({ feedback_id: intent, feedback_scope: await DB.forActor(email).toolRunScope() })
    const first = await invoke(app, body), retry = await invoke(app, body)
    expect(retry).toEqual({ ...first, replayed: '1' })
    expect(first.body.id).not.toBe(intent); expect(await logs(app)).toHaveLength(1)
    expect(await receipts(intent)).toBe(1)
  })

  it('conflicts on changed content but allows a genuinely new intent with the same content', async () => {
    const app = await fixture(), key = crypto.randomUUID()
    expect((await invoke(app, reportBody(), { key })).status).toBe(200)
    expect(await invoke(app, reportBody({ body: '다른 정산 금액에 대한 새로운 내용입니다.' }), { key })).toMatchObject({ status: 409, body: { code: 'FEEDBACK_CONFLICT' } })
    expect((await invoke(app, reportBody())).status).toBe(200)
    expect(await logs(app)).toHaveLength(2)
  })

  it('preserves server-owned real attribution and ignores forged reporter/unknown data in the fingerprint', async () => {
    const app = await fixture(), key = crypto.randomUUID()
    const saved = await invoke(app, reportBody({ reporter: '다른 계정', raw: 'RAW_LOCAL_ONLY' }), { key })
    expect(saved.status).toBe(200)
    expect((await logs(app))[0].title).toBe(label)
    expect(await invoke(app, reportBody({ reporter: { forged: 'actor' } }), { key })).toEqual({ ...saved, replayed: '1' })
    expect(JSON.stringify(commitCalls)).not.toContain('RAW_LOCAL_ONLY')
    expect(saved.body.next).toContain('검토가 필요')
  })

  it.each([
    ['display name', "display_name='새 이름'"], ['role', "role='engineer'"],
    ['departments', "departments_json='[\"Finance\",\"Other\"]'"], ['products', "product_ids_json='[\"product-2\"]'"],
    ['authority revision', "updated_at='2099-01-01 00:00:00'"],
  ])('rejects changed actor %s at commit without a new decision/receipt', async (_name, update) => {
    const app = await fixture(), key = crypto.randomUUID()
    beforeCommit = () => pg.query('UPDATE override_actor SET ' + update + ' WHERE email=$1', [email])
    expect((await invoke(app, reportBody(), { key })).status).toBe(409)
    expect(await logs(app)).toEqual([]); expect(await receipts(key)).toBe(0)
  })

  it('reads current attribution when the display name changes before the first staged actor read', async () => {
    const app = await fixture()
    beforeActorRead = () => pg.query("UPDATE override_actor SET display_name='현재 이름' WHERE email=$1", [email])
    expect((await invoke(app)).status).toBe(200)
    expect((await logs(app))[0].title).toBe('현재 이름')
  })

  it.each(['report','unclear'])('rejects actor revocation at %s commit with no decision/receipt', async kind => {
    const app = await fixture(), key = crypto.randomUUID()
    beforeCommit = () => pg.query('UPDATE override_actor SET active=0 WHERE email=$1', [email])
    expect((await invoke(app, kind==='report'?reportBody():unclearBody(), { key, kind })).status).toBe(401)
    expect(await logs(app)).toEqual([]); expect(await receipts(key)).toBe(0)
  })

  it.each([
    ['stop', "rolled_back_at='2026-10-04 00:00:00'"], ['title', "title='변경된 도구'"], ['department', "handed_to_dept='Other'"],
  ])('rejects handover %s changes after reading', async (_name, update) => {
    const app = await fixture(), key = crypto.randomUUID()
    beforeCommit = () => pg.query('UPDATE handover SET ' + update + ' WHERE application_id=$1', [app.id])
    expect((await invoke(app, reportBody(), { key })).status).toBe(409)
    expect(await logs(app)).toEqual([]); expect(await receipts(key)).toBe(0)
  })

  it.each([
    ['owner', "owner_email='feedback-other@local.invalid'"], ['department', "dept='Other'"],
    ['status', "status='보류'"], ['revision', "updated_at='2099-02-02 00:00:00'"],
  ])('rejects application %s changes at commit', async (_name, update) => {
    const app = await fixture(), key = crypto.randomUUID()
    beforeCommit = () => pg.query('UPDATE application SET ' + update + ' WHERE id=$1', [app.id])
    expect((await invoke(app, unclearBody(), { key, kind: 'unclear' })).status).toBe(409)
    expect(await logs(app)).toEqual([]); expect(await receipts(key)).toBe(0)
  })

  it('does not replay a former application receipt after the slug is reassigned or hidden', async () => {
    const app = await fixture(), other = await fixture(), key = crypto.randomUUID()
    expect((await invoke(app, reportBody(), { key })).status).toBe(200)
    await pg.query('DELETE FROM handover WHERE application_id=$1', [other.id])
    await pg.query('UPDATE handover SET application_id=$2 WHERE slug=$1', [app.slug,other.id])
    expect(await invoke(app, reportBody(), { key })).toMatchObject({ status: 409, body: { code: 'FEEDBACK_CONFLICT' } })
    await pg.query("UPDATE application SET owner_email='feedback-other@local.invalid',dept='Other' WHERE id=$1", [other.id])
    const hidden = await invoke(app, reportBody(), { key })
    expect(hidden.status).toBe(404); expect(hidden.body.id).toBeUndefined()
  })

  it('replays a previously confirmed receipt after tool stop without making a new report', async () => {
    const app = await fixture(), key = crypto.randomUUID(), first = await invoke(app, reportBody(), { key })
    await pg.query("UPDATE handover SET rolled_back_at='2026-10-04 00:00:00' WHERE application_id=$1", [app.id])
    expect(await invoke(app, reportBody(), { key })).toEqual({ ...first, replayed: '1' })
    expect((await invoke(app)).status).toBe(409)
    expect(await logs(app)).toHaveLength(1)
  })

  it.each([['unchanged',200],['hidden',404],['reassigned',409]])('rechecks current resource after a prior receipt: %s', async (change,status) => {
    const app=await fixture(), other=await fixture(), key=crypto.randomUUID()
    const first=await invoke(app,reportBody(),{key}), original=await logs(app)
    beforeReceipt=async()=>{
      if(change==='hidden') await pg.query("UPDATE application SET owner_email='feedback-other@local.invalid',dept='Other' WHERE id=$1",[app.id])
      if(change==='reassigned') {
        await pg.query('DELETE FROM handover WHERE application_id=$1',[other.id])
        await pg.query('UPDATE handover SET application_id=$2 WHERE slug=$1',[app.slug,other.id])
      }
    }
    const retry=await invoke(app,reportBody(),{key})
    expect(retry.status).toBe(status)
    if(change==='unchanged') expect(retry).toEqual({...first,replayed:'1'})
    else {
      for(const field of ['id','urgent','next','what','body']) expect(retry.body).not.toHaveProperty(field)
      if(change==='reassigned') expect(retry.body.code).toBe('FEEDBACK_CONFLICT')
    }
    expect(await logs(app)).toEqual(original)
    expect(await logs(other)).toEqual([])
    expect(await receipts(key)).toBe(1)
  })

  it.each([['unchanged',200],['hidden',404],['reassigned',409]])('rechecks current resource after an interleaved commit receipt: %s', async (change,status) => {
    const app=await fixture(), other=await fixture(), key=crypto.randomUUID()
    // Both requests stage the old application before either commits. The second
    // commit can replay the first receipt without executing its old CAS reads.
    rendezvous()
    beforeCommit=async()=>{
      beforeCommit=async()=>{
        if(change==='hidden') await pg.query("UPDATE application SET owner_email='feedback-other@local.invalid',dept='Other' WHERE id=$1",[app.id])
        if(change==='reassigned') {
          await pg.query('DELETE FROM handover WHERE application_id=$1',[other.id])
          await pg.query('UPDATE handover SET application_id=$2 WHERE slug=$1',[app.slug,other.id])
        }
      }
    }
    const results=await Promise.all([invoke(app,unclearBody(),{key,kind:'unclear'}),invoke(app,unclearBody(),{key,kind:'unclear'})])
    barrier=null
    expect(commitCalls.filter(call=>call.p_request_id===key)).toHaveLength(2)
    const first=results.find(reply=>reply.replayed==='0'), second=results.find(reply=>reply!==first)
    expect(first).toMatchObject({status:200,body:{ok:true}})
    expect(second.status).toBe(status)
    if(change==='unchanged') expect(second).toEqual({...first,replayed:'1'})
    else {
      for(const field of ['id','message','what','body']) expect(second.body).not.toHaveProperty(field)
      if(change==='reassigned') expect(second.body.code).toBe('FEEDBACK_CONFLICT')
    }
    expect(await logs(app)).toHaveLength(1)
    expect((await logs(app))[0].id).toBe(first.body.id)
    expect(await logs(other)).toEqual([])
    expect(await receipts(key)).toBe(1)
  })

  it.each([['scope', "product_ids_json='[\"changed\"]'",409],['revocation','active=0',401]])('does not disclose old receipts after actor %s changes', async (_name, update, status) => {
    const app = await fixture(), key = crypto.randomUUID()
    expect((await invoke(app, reportBody(), { key })).status).toBe(200)
    beforeReceipt = () => pg.query('UPDATE override_actor SET ' + update + ' WHERE email=$1', [email])
    const reply = await invoke(app, reportBody(), { key })
    expect(reply.status).toBe(status); expect(reply.body.id).toBeUndefined()
  })

  it.each(['23514','42501'])('rolls back required decision write failure %s and preserves real error classification', async code => {
    const app = await fixture(), key = crypto.randomUUID()
    await pg.exec("CREATE FUNCTION public.c21_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic insert failure' USING ERRCODE='"+code+"'; END $$; CREATE TRIGGER c21_fail BEFORE INSERT ON decision_log FOR EACH ROW EXECUTE FUNCTION public.c21_fail()")
    try {
      expect((await invoke(app, reportBody(), { key })).status).toBe(code==='42501'?403:503)
      expect(await logs(app)).toEqual([]); expect(await receipts(key)).toBe(0)
    } finally { await pg.exec('DROP TRIGGER c21_fail ON decision_log;DROP FUNCTION public.c21_fail()') }
  })

  it('does not expand application participant read access into tool or feedback write authority', async () => {
    const app = await fixture('feedback-other@local.invalid'), key = crypto.randomUUID(), admin = 'feedback-admin@local.invalid'
    await pg.query("INSERT INTO override_actor(email,display_name,role,departments_json) VALUES($1,'가상 관리자','audit','[]')", [admin])
    await pg.query("UPDATE application SET dept='Other' WHERE id=$1", [app.id])
    await pg.query("UPDATE override_actor SET departments_json='[\"Finance\",\"재무\"]' WHERE email=$1", [email])
    const participation = 'feedback-participation-' + sequence
    await pg.exec('BEGIN')
    try {
      await pg.query("SELECT set_config('ilson.actor_email',$1,true)", [admin])
      await pg.query("INSERT INTO decision_log(id,application_id,stage,actor,title,what,why,link_kind,link_id) VALUES($1,$2,'협의안','human','관리자','참여','가상 근거','같은건손듦','재무')", [participation,app.id])
      await pg.query("INSERT INTO application_participation(id,application_id,department_id,granted_by_email) VALUES($1,$2,'재무',$3)", [participation,app.id,admin])
      await pg.exec('COMMIT')
    } catch (error) { await pg.exec('ROLLBACK'); throw error }
    const before = await logs(app)
    expect(await scopedDb().prepare('SELECT id FROM application WHERE id=?').bind(app.id).first()).toMatchObject({id:app.id})
    expect(await scopedDb().prepare('SELECT application_id FROM handover WHERE slug=?').bind(app.slug).first()).toBeNull()
    expect((await invoke(app, reportBody(), { key })).status).toBe(404)
    expect(await logs(app)).toEqual(before); expect(await receipts(key)).toBe(0)
  })

  it('fails closed for unsupported adapters, mismatched scope and invisible tools', async () => {
    const app = await fixture(), scoped = DB.forActor(email)
    expect((await invoke(app, reportBody(), { adapter: { ...scoped, commitMutation: undefined } })).status).toBe(503)
    expect((await invoke(app, reportBody(), { adapter: { ...scoped, actorEmail: 'someone-else@local.invalid' } })).status).toBe(401)
    expect((await invoke(app, reportBody({ feedback_scope: 'old-scope' }))).status).toBe(409)
    expect((await invoke(app, reportBody(), { slug: 'missing-tool' })).status).toBe(404)
    expect(await logs(app)).toEqual([])
  })

  it('makes same-key interleaved submissions one decision and allows separate intentions', async () => {
    const app = await fixture(), key = crypto.randomUUID()
    rendezvous()
    const same = await Promise.all([invoke(app, unclearBody(), {key,kind:'unclear'}),invoke(app, unclearBody(), {key,kind:'unclear'})])
    barrier = null
    expect(same.map(result=>result.status)).toEqual([200,200])
    expect(same[0].body).toEqual(same[1].body); expect(await logs(app)).toHaveLength(1)
    expect((await invoke(app, unclearBody(), {kind:'unclear'})).status).toBe(200)
    const board = unclearBoard(await loadUnclear({ DB: scopedDb() },app.id))
    expect(board.summary).toMatchObject({openTotal:2,mustFix:1})
    expect(sectionNote(board.sections[0]).text).toContain('2건')
    expect(boardLine(board.summary)).not.toMatch(/두 사람|잘못 쓰인|쓰는 중/)
  })

  it('rejects malformed text/intent before the operation quota and retains normal request frequency limits', async () => {
    const app = await fixture()
    expect((await invoke(app, reportBody({body:{bad:true}}))).body).toMatchObject({notSaved:true,fields:{body:expect.any(String)}})
    expect((await invoke(app, reportBody(), {key:null})).status).toBe(400)
    expect((await scopedDb().rateLimitState('report:x',20,600)).remaining).toBe(20)
    for (let i=0;i<20;i++) await scopedDb().claimRateLimit('report:x',20,600)
    expect((await invoke(app)).status).toBe(429)
    expect(await logs(app)).toEqual([])
  })

  it('preserves isolated demo labels and includes them in replay fingerprints', async () => {
    const token = 'e'.repeat(64)
    await DB.workspaceOpen(token,[])
    const demoDb = createSupabaseDb(base,'synthetic-only',token), app = await fixture(null,demoDb), key=crypto.randomUUID()
    const first = await invoke(app,reportBody({reporter:'가상 부서'}),{token,key})
    expect(first.status).toBe(200)
    expect((await demoDb.prepare('SELECT title FROM decision_log WHERE application_id=?').bind(app.id).first()).title).toBe('가상 부서')
    expect(await invoke(app,reportBody({reporter:'가상 부서'}),{token,key})).toEqual({...first,replayed:'1'})
    expect((await invoke(app,reportBody({reporter:'다른 가상 부서'}),{token,key})).status).toBe(409)
    expect(await logs(app)).toEqual([])
  })
})
function scopedDb() { return DB.forActor(email) }
