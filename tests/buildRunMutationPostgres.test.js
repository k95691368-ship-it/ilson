// @vitest-environment node
// Actual signed middleware + current SQL functions in disposable memory PG.
// The RPC queue models interleaved HTTP requests on ONE database connection;
// it is not a multi-session PostgreSQL concurrency or production load test.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { createSupabaseDb } from '../functions/_lib/dbBridge.ts'
import { onRequest } from '../functions/api/_middleware.js'
import { onRequestPost as build, onRequestGet as loadBuild } from '../functions/api/applications/[id]/build.js'
import { buildRunPayload } from '../shared/buildPayload.js'
import { runPipeline } from '../shared/pipeline.js'

const pg = new PGlite(), base = 'https://build-run-memory.supabase.co'
const issuer = 'https://build-run-memory.cloudflareaccess.com'
const DB = createSupabaseDb(base, 'synthetic-only'), email = 'run-operator@local.invalid', label = '검증된 담당자'
const env = { DB, DBBridgeApplied: true, SUPABASE_URL: base, SUPABASE_SERVICE_ROLE_KEY: 'synthetic-only',
  ACCESS_TEAM_DOMAIN: issuer, ACCESS_AUD: 'build-run-memory', DEMO_WORKSPACES: 'false', OVERRIDE_DEMO_MODE: 'false' }
let pair, jwk, queue = Promise.resolve(), sequence = 0, beforeCommit = null, beforeActorRead = null, beforeReceipt = null, dropCommitResponse = false, barrier = null
const failures = [], commitCalls = [], directWrites = []

beforeAll(async () => {
  await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;')
  const directory = new URL('../supabase/migrations/', import.meta.url)
  for (const file of readdirSync(directory).filter(name => /^\d+.*\.sql$/.test(name)).sort()) await pg.exec(readFileSync(new URL(file, directory), 'utf8'))
  pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])
  jwk = { ...await crypto.subtle.exportKey('jwk', pair.publicKey), kid: env.ACCESS_AUD, alg: 'RS256', use: 'sig' }
  await pg.query(`INSERT INTO override_actor(email,display_name,role,departments_json) VALUES
    ($1,$2,'product','["Finance"]'),('run-reviewer@local.invalid','일반 사원','reviewer','["Finance"]'),
    ('run-other@local.invalid','타 부서 담당','product','["Other"]')`, [email, label])
  vi.stubGlobal('fetch', (url, options) => {
    if (String(url) === issuer + '/cdn-cgi/access/certs') return Promise.resolve(Response.json({ keys: [jwk] }))
    if (!String(url).startsWith(base + '/rest/v1/rpc/')) throw Error('External network prohibited')
    const name = new URL(url).pathname.split('/').at(-1), args = JSON.parse(options.body)
    const sql = args.p_sql ?? args.p_query ?? ''
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
      if (barrier && name === 'ilson_actor_query' && /^SELECT MAX\(seq\)/.test(sql)) {
        const current = barrier
        if (++current.reads === 2) current.release()
        await current.ready
      }
      return response
    })
  })
}, 60000)

afterEach(async () => {
  beforeCommit = null; beforeActorRead = null; beforeReceipt = null; dropCommitResponse = false; barrier = null; failures.length = 0; commitCalls.length = 0; directWrites.length = 0
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
const row = changes => ({ date: '2026-06-01', iso_week: '2026-W23', sku: 'legacy-SKU', channel: 'legacy-channel', qty: 1, gross_krw: 1000, ...changes })
const payload = (_app, changes) => ({ kind: 'run', rows: [row()], quarantine: [{ reason: 'unknown_sku', source: { file: 'legacy.csv', rowNo: 3 }, raw: ['RAW_SECRET'] }], duration_ms: 7, ...changes })
async function invoke(app, body = payload(app), options = {}) {
  const key = options.key === undefined ? crypto.randomUUID() : options.key
  const identity = options.email ?? email, database = options.token ? createSupabaseDb(base, 'synthetic-only', options.token) : DB.forActor(identity)
  const headers = { 'Content-Type': 'application/json', Origin: options.origin ?? 'https://local.invalid', 'X-Ilson-Request': '1',
    'X-Ilson-Scope': await database.toolRunScope(), 'CF-Connecting-IP': key ?? 'missing' }
  if (key !== null) headers['X-Idempotency-Key'] = key
  if (options.token) headers.Cookie = 'ilson_workspace=' + options.token
  else headers['Cf-Access-Jwt-Assertion'] = await jwt(identity)
  const method = options.method ?? 'POST', routeId = options.routeId ?? app.id
  const path = '/api/applications/' + routeId + '/build?rows=1'
  const context = { env: options.token ? { ...env, DEMO_WORKSPACES: 'true', OVERRIDE_DEMO_MODE: 'true' } : env,
    request: new Request('https://local.invalid' + path, { method, headers, ...(method === 'GET' ? {} : { body: options.raw ?? JSON.stringify(body) }) }), data: {} }
  context.next = forwarded => {
    if (options.adapter) context.data.requestEnv = { ...context.data.requestEnv, DB: options.adapter }
    return (method === 'GET' ? loadBuild : build)({ env: context.env, data: context.data, params: { id: routeId }, request: forwarded ?? context.request })
  }
  const response = await onRequest(context)
  return { status: response.status, body: await response.json(), replayed: response.headers.get('X-Idempotency-Replayed') }
}
async function state(app, key) {
  return {
    runs: (await pg.query('SELECT * FROM build_run WHERE application_id=$1 ORDER BY seq', [app.id])).rows,
    rows: (await pg.query('SELECT r.* FROM build_row r JOIN build_run b ON r.run_id=b.id WHERE b.application_id=$1 ORDER BY b.seq,r.row_no', [app.id])).rows,
    quarantine: (await pg.query('SELECT q.* FROM build_quarantine q JOIN build_run b ON q.run_id=b.id WHERE b.application_id=$1 ORDER BY b.seq,q.id', [app.id])).rows,
    logs: (await pg.query('SELECT * FROM decision_log WHERE application_id=$1 ORDER BY id', [app.id])).rows,
    status: (await pg.query('SELECT status FROM application WHERE id=$1', [app.id])).rows[0].status,
    receipts: Number((await pg.query('SELECT count(*) AS n FROM ilson_private.mutation_receipts WHERE request_id=$1', [key])).rows[0].n),
  }
}
const empty = { runs: [], rows: [], quarantine: [], logs: [], status: '수용', receipts: 0 }
function rendezvous() {
  let release
  const ready = new Promise(resolve => { release = resolve })
  barrier = { reads: 0, ready, release }
}



describe.sequential('atomic build run persistence through signed middleware and real scoped PostgreSQL', () => {
  it('commits header, lines, quarantine, initial audit, status and receipt together', async () => {
    const app = await fixture(), key = crypto.randomUUID()
    directWrites.length = 0
    const saved = await invoke(app, payload(app), { key })
    expect(saved).toMatchObject({ status: 201, body: { ok: true, seq: 1 }, replayed: '0' })
    expect(saved.body.run_id).toMatch(/^run_[a-f0-9]{20}$/)
    const result = await state(app, key)
    expect(result.runs).toHaveLength(1); expect(result.rows).toHaveLength(1); expect(result.quarantine).toHaveLength(1)
    expect(result.logs).toHaveLength(1); expect(result.status).toBe('진행중'); expect(result.receipts).toBe(1)
    expect(result.logs[0]).toMatchObject({ title: '첫 제작 결과를 기록했습니다', link_id: saved.body.run_id })
    expect(JSON.stringify(commitCalls)).not.toContain('RAW_SECRET')
    expect(directWrites).toEqual([])
  })

  it('replays a body intent despite different transport keys without reexecuting a calculation or write', async () => {
    const app = await fixture(), intent = crypto.randomUUID(), body = payload(app, { run_id: intent, run_scope: await DB.forActor(email).toolRunScope() })
    const saved = await invoke(app, body)
    const repeated = await invoke(app, body)
    expect(repeated).toEqual({ ...saved, replayed: '1' })
    expect(saved.body.run_id).not.toBe(intent)
    expect((await state(app, intent)).receipts).toBe(1)
    expect(commitCalls).toHaveLength(1)
    const changed = await invoke(app, { ...body, duration_ms: 8 })
    expect(changed).toMatchObject({ status: 409, body: { code: 'BUILD_RUN_CONFLICT' } })
    expect((await state(app, intent)).runs).toHaveLength(1)
  })

  it('recovers a lost successful transaction response by the original receipt', async () => {
    const app = await fixture(), key = crypto.randomUUID()
    dropCommitResponse = true
    expect((await invoke(app, payload(app), { key })).status).toBe(503)
    const committed = await state(app, key)
    expect(committed.runs).toHaveLength(1); expect(committed.receipts).toBe(1)
    const repeated = await invoke(app, payload(app), { key })
    expect(repeated).toMatchObject({ status: 201, replayed: '1', body: { run_id: committed.runs[0].id, seq: 1 } })
    expect((await state(app, key))).toEqual(committed)
  })

  it('supports header-only older callers, same application ticket replay, and explicit new intent', async () => {
    const app = await fixture(), key = crypto.randomUUID()
    await pg.query('UPDATE application SET ticket_no=$2 WHERE id=$1', [app.id, 'AX-TICKET-' + sequence])
    const saved = await invoke(app, payload(app), { key })
    expect(await invoke(app, payload(app), { key, routeId: 'AX-TICKET-' + sequence })).toEqual({ ...saved, replayed: '1' })
    expect((await invoke(app, payload(app))).body.seq).toBe(2)
    const result = await state(app, key)
    expect(result.runs).toHaveLength(2); expect(result.logs).toHaveLength(1)
  })

  it('never treats another application as the same intent', async () => {
    const app = await fixture(), other = await fixture(), key = crypto.randomUUID()
    expect((await invoke(app, payload(app), { key })).status).toBe(201)
    expect((await invoke(other, payload(other), { key })).status).toBe(409)
    expect(await state(other, 'not-a-receipt')).toEqual(empty)
  })

  it.each([
    ['audit', "CREATE TRIGGER c18_fail BEFORE INSERT ON decision_log FOR EACH ROW EXECUTE FUNCTION public.c18_reject()"],
    ['status', "CREATE TRIGGER c18_fail BEFORE UPDATE ON application FOR EACH ROW EXECUTE FUNCTION public.c18_reject()"],
    ['second line chunk', "CREATE TRIGGER c18_fail BEFORE INSERT ON build_row FOR EACH ROW WHEN (NEW.row_no = 501) EXECUTE FUNCTION public.c18_reject()"],
  ])('rolls back every record when the %s write fails inside the actual commit', async (name, trigger) => {
    const app = await fixture(), key = crypto.randomUUID(), table = name === 'audit' ? 'decision_log' : name === 'status' ? 'application' : 'build_row'
    await pg.exec("CREATE OR REPLACE FUNCTION public.c18_reject() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic commit failure' USING ERRCODE='23514'; END $$")
    await pg.exec(trigger)
    try {
      const rows = name === 'second line chunk' ? Array.from({ length: 501 }, () => row()) : [row()]
      expect((await invoke(app, payload(app, { rows }), { key })).status).toBe(503)
      expect(await state(app, key)).toEqual(empty)
      expect(failures).toContainEqual({ name: 'ilson_actor_commit', code: '23514' })
    } finally { await pg.exec('DROP TRIGGER c18_fail ON ' + table + '; DROP FUNCTION public.c18_reject()') }
  })

  it('brands a scoped database permission failure and leaves no compensating writes', async () => {
    const app = await fixture(), key = crypto.randomUUID()
    await pg.exec("CREATE FUNCTION public.c18_deny() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic forbidden' USING ERRCODE='42501'; END $$; CREATE TRIGGER c18_deny BEFORE INSERT ON build_quarantine FOR EACH ROW EXECUTE FUNCTION public.c18_deny()")
    try {
      expect((await invoke(app, payload(app), { key })).status).toBe(403)
      expect(await state(app, key)).toEqual(empty)
    } finally { await pg.exec('DROP TRIGGER c18_deny ON build_quarantine; DROP FUNCTION public.c18_deny()') }
  })

  it.each([
    ['display name', "display_name='새 이름'"],
    ['allowed role', "role='engineer'"],
    ['departments', "departments_json='[\"Finance\",\"Other\"]'"],
    ['product assignment', "product_ids_json='[\"product-2\"]'"],
    ['updated revision', "updated_at='2099-01-01 00:00:00'"],
  ])('rejects a changed actor %s after its CAS read without partial writes', async (_name, change) => {
    const app = await fixture(), key = crypto.randomUUID()
    beforeCommit = () => pg.query('UPDATE override_actor SET ' + change + ' WHERE email=$1', [email])
    expect((await invoke(app, payload(app), { key })).status).toBe(409)
    expect(await state(app, key)).toEqual(empty)
  })

  it('blocks revocation at commit with 501 lines and does not retain the first chunk', async () => {
    const app = await fixture(), key = crypto.randomUUID()
    beforeCommit = () => pg.query('UPDATE override_actor SET active=0 WHERE email=$1', [email])
    expect((await invoke(app, payload(app, { rows: Array.from({ length: 501 }, () => row()) }), { key })).status).toBe(401)
    expect(await state(app, key)).toEqual(empty)
    expect(commitCalls[0].p_writes.filter(sql => /^INSERT INTO build_row/.test(sql))).toHaveLength(2)
  })

  it('rolls back the first 500 staged lines if scope is revoked inside the transaction before the next chunk', async () => {
    const app = await fixture(), key = crypto.randomUUID()
    // A synthetic SECURITY DEFINER trigger simulates an in-transaction authority
    // change. This tests statement-boundary scope checks, not multi-DB concurrency.
    await pg.exec("CREATE FUNCTION public.c18_revoke() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN UPDATE public.override_actor SET active=0 WHERE email='run-operator@local.invalid'; RETURN NEW; END $$; CREATE TRIGGER c18_revoke AFTER INSERT ON build_row FOR EACH ROW WHEN (NEW.row_no=500) EXECUTE FUNCTION public.c18_revoke()")
    try {
      expect((await invoke(app, payload(app, { rows: Array.from({ length: 501 }, () => row()) }), { key })).status).toBe(401)
      expect(await state(app, key)).toEqual(empty)
      expect((await pg.query('SELECT active FROM override_actor WHERE email=$1', [email])).rows[0].active).toBe(1)
      expect(failures).toContainEqual({ name: 'ilson_actor_commit', code: '28000' })
    } finally { await pg.exec('DROP TRIGGER c18_revoke ON build_row; DROP FUNCTION public.c18_revoke()') }
  })

  it('reads currently permitted roles rather than trusting a stale middleware display name', async () => {
    const app = await fixture()
    beforeActorRead = () => pg.query("UPDATE override_actor SET role='engineer',display_name='현재 이름' WHERE email=$1", [email])
    expect((await invoke(app)).status).toBe(201)
  })

  it.each([['inactive', 'active=0', 401], ['forbidden role', "role='reviewer'", 403]])('rejects an actor becoming %s before the first CAS read', async (_name, change, status) => {
    const app = await fixture(), key = crypto.randomUUID()
    beforeActorRead = () => pg.query('UPDATE override_actor SET ' + change + ' WHERE email=$1', [email])
    expect((await invoke(app, payload(app), { key })).status).toBe(status)
    expect(await state(app, key)).toEqual(empty)
  })

  it('protects the current full actor snapshot even for an administrator', async () => {
    const app = await fixture('run-other@local.invalid'), key = crypto.randomUUID()
    await pg.query("UPDATE application SET dept='Other' WHERE id=$1", [app.id])
    await pg.query("UPDATE override_actor SET role='audit' WHERE email=$1", [email])
    beforeCommit = () => pg.query("UPDATE override_actor SET display_name='Changed administrator' WHERE email=$1", [email])
    expect((await invoke(app, payload(app), { key })).status).toBe(409)
    expect(await state(app, key)).toEqual(empty)
    expect((await invoke(app, payload(app), { key: crypto.randomUUID() })).status).toBe(201)
  })

  it.each([
    ['owner', "owner_email='run-other@local.invalid'"],
    ['department', "dept='Other'"],
    ['status', "status='보류'"],
    ['updated revision', "updated_at='2099-02-02 00:00:00'"],
  ])('does not overwrite an application whose %s changed after reading', async (_name, change) => {
    const app = await fixture(), key = crypto.randomUUID()
    beforeCommit = () => pg.query('UPDATE application SET ' + change + ' WHERE id=$1', [app.id])
    expect((await invoke(app, payload(app), { key })).status).toBe(409)
    const result = await state(app, key)
    expect(result.runs).toEqual([]); expect(result.rows).toEqual([]); expect(result.quarantine).toEqual([]); expect(result.logs).toEqual([]); expect(result.receipts).toBe(0)
  })

  it('does not expose an old receipt after actor scope changes between middleware and lookup', async () => {
    const app = await fixture(), key = crypto.randomUUID()
    expect((await invoke(app, payload(app), { key })).status).toBe(201)
    beforeReceipt = () => pg.query("UPDATE override_actor SET product_ids_json='[\"changed\"]' WHERE email=$1", [email])
    const result = await invoke(app, payload(app), { key })
    expect(result.status).toBe(409); expect(result.body.run_id).toBeUndefined()
  })

  it('does not expose an old receipt after actor revocation', async () => {
    const app = await fixture(), key = crypto.randomUUID()
    expect((await invoke(app, payload(app), { key })).status).toBe(201)
    beforeReceipt = () => pg.query('UPDATE override_actor SET active=0 WHERE email=$1', [email])
    expect((await invoke(app, payload(app), { key })).status).toBe(401)
  })

  it('fails closed for hidden applications, insufficient role and unsupported atomic adapters', async () => {
    const hidden = await fixture('run-other@local.invalid')
    await pg.query("UPDATE application SET dept='Other' WHERE id=$1", [hidden.id])
    expect((await invoke(hidden)).status).toBe(404)
    const app = await fixture()
    expect((await invoke(app, payload(app), { email: 'run-reviewer@local.invalid' })).status).toBe(403)
    const scoped = DB.forActor(email)
    expect((await invoke(app, payload(app), { adapter: { ...scoped, commitMutation: undefined } })).status).toBe(503)
    expect((await invoke(app, payload(app), { adapter: { ...scoped, actorEmail: 'wrong@local.invalid' } })).status).toBe(401)
    expect((await state(app, 'none')).runs).toEqual([])
  })

  it('does not expand participant read access into decision-log write authority', async () => {
    const app = await fixture('run-other@local.invalid'), key = crypto.randomUUID()
    await pg.query("UPDATE application SET dept='Other' WHERE id=$1", [app.id])
    const admin = 'run-admin@local.invalid', participation = 'run-participation-' + sequence
    await pg.query("INSERT INTO override_actor(email,display_name,role,departments_json) VALUES($1,'검토 관리자','audit','[]')", [admin])
    await pg.query("UPDATE override_actor SET departments_json='[\"Finance\",\"재무\"]' WHERE email=$1", [email])
    await pg.exec('BEGIN')
    try {
      await pg.query("SELECT set_config('ilson.actor_email',$1,true)", [admin])
      await pg.query("INSERT INTO decision_log(id,application_id,stage,actor,title,what,why,link_kind,link_id) VALUES($1,$2,'협의안','human','검토 관리자','협의 참여','가상 참여 근거','같은건손듦','재무')", [participation, app.id])
      await pg.query("INSERT INTO application_participation(id,application_id,department_id,granted_by_email) VALUES($1,$2,'재무',$3)", [participation, app.id, admin])
      await pg.exec('COMMIT')
    } catch (error) { await pg.exec('ROLLBACK'); throw error }
    const before = await state(app, key)
    expect((await invoke(app, payload(app), { key })).status).toBe(403)
    expect(await state(app, key)).toEqual(before)
  })

  it('makes interleaved same intents one commit and different intents a CAS conflict until retry', async () => {
    const app = await fixture(), key = crypto.randomUUID()
    rendezvous()
    const same = await Promise.all([invoke(app, payload(app), { key }), invoke(app, payload(app), { key })])
    barrier = null
    expect(same.map(value => value.status)).toEqual([201,201])
    expect(same[0].body).toEqual(same[1].body)
    expect((await state(app, key)).runs).toHaveLength(1)
    const second = await fixture(), keys = [crypto.randomUUID(), crypto.randomUUID()]
    rendezvous()
    const different = await Promise.all(keys.map(key => invoke(second, payload(second), { key })))
    barrier = null
    expect(different.map(value => value.status).sort()).toEqual([201,409])
    const loser = different.findIndex(value => value.status === 409)
    expect((await invoke(second, payload(second), { key: keys[loser] })).body.seq).toBe(2)
    expect((await state(second, keys[loser])).runs).toHaveLength(2)
  })

  it('preserves existing fractional quantity-to-BIGINT conversion without altering stored totals', async () => {
    const app = await fixture()
    const body = payload(app, { rows: [row({ qty: 1.5, return_qty: 0.5, gross_krw: '12.25' })], totals: { all: { rows: '1', qty: '1.5', gross_krw: '-12.25' } } })
    expect((await invoke(app, body)).status).toBe(201)
    const result = await state(app, 'none')
    expect(result.rows[0]).toMatchObject({ qty: 2, return_qty: 1, gross_krw: 12.25 })
    // Totals are a validated browser claim, not recalculated or certified from
    // original files. Preserve valid legacy numeric strings exactly.
    expect(JSON.parse(result.runs[0].totals_json).all).toEqual({ rows: '1', qty: '1.5', gross_krw: '-12.25' })
  })

  it('persists only projected calculation/provenance metadata from a real pipeline and supports zero output lines', async () => {
    const app = await fixture(), secret = 'ORIGINAL_LOCAL_ONLY'
    const result = await runPipeline({ files: [{ name: 'sample.csv', buffer: new TextEncoder().encode('주문일자,상품코드,상품명,수량,판매가,할인액,메모\n2026-06-01,NR-CM-100,상품,1,10000,0,' + secret) }] })
    result.rows[0].raw = [secret]
    const body = { ...result, kind: 'run' }
    expect((await invoke(app, body)).status).toBe(201)
    expect(JSON.stringify(commitCalls)).not.toContain(secret)
    const loaded = await invoke(app, null, { method: 'GET' })
    expect(loaded.status).toBe(200)
    expect(loaded.body.rows[0].trace).toEqual(result.rows[0].trace)
    expect(loaded.body.rows[0].source_sha256).toBe(result.files[0].sha256)
    const emptyResult = await runPipeline({ files: [{ name: 'empty.csv', buffer: new Uint8Array() }] })
    expect((await invoke(app, buildRunPayload(emptyResult))).status).toBe(201)
    const again = await invoke(app, null, { method: 'GET' })
    expect(again.body.rows).toEqual([])
    expect(again.body.quarantine[0]).toMatchObject({ source_row_no: 0, raw: [], source_sha256: emptyResult.files[0].sha256 })
  })

  it.each([2,6.5])('rejects %s MiB of backslashes whose SQL/RPC escaping exceeds the transaction budget before commit', async size => {
    const app = await fixture(), key = crypto.randomUUID()
    const body = payload(app, { rows: [row({ trace: [{ step: 'quoted', value: '\\'.repeat(size * 1024 * 1024) }] })] })
    const bytes = Buffer.byteLength(JSON.stringify(body))
    expect(bytes).toBeGreaterThan(size * 2 * 1024 * 1024)
    expect(bytes).toBeLessThan(16 * 1024 * 1024)
    const result = await invoke(app, body, { key })
    expect(result).toMatchObject({ status: 413, body: { code: 'BUILD_RUN_TOO_LARGE' } })
    expect(commitCalls).toEqual([])
    expect(await state(app, key)).toEqual(empty)
  })

  it('rejects bad intent, stale calculation scope and unsafe fields before any staged mutation', async () => {
    const app = await fixture()
    expect((await invoke(app, payload(app), { key: null })).status).toBe(400)
    expect((await invoke(app, payload(app, { run_id: 'bad' }))).status).toBe(400)
    expect((await invoke(app, payload(app, { run_scope: 'another-account' }))).status).toBe(409)
    expect((await invoke(app, payload(app, { rows: [row({ qty: true })] }))).status).toBe(400)
    expect((await invoke(app, payload(app, { quarantine: [{ reason: 'bad\0reason' }] }))).status).toBe(400)
    expect(commitCalls).toEqual([])
  })

  it.each([
    { totals: { all: { gross_krw: 'not a number' } } }, { totals: { all: { qty: {} } } },
    { totals: { byChannel: [{ channel: true, qty: 1 }] } }, { rows: [row({ trace: [{ step: 'calculation', value: {} }] })] },
    { files: [{ name: 'legacy.csv', rowsIn: true }] },
  ])('rejects malformed known evidence metadata before any commit: %j', changes => {
    return fixture().then(async app => {
      const key = crypto.randomUUID()
      expect((await invoke(app, payload(app, changes), { key })).status).toBe(400)
      expect(commitCalls).toEqual([])
      expect(await state(app, key)).toEqual(empty)
    })
  })
})
