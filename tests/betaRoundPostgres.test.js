// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { createSupabaseDb } from '../functions/_lib/dbBridge.js'
import { betaRoundPayload } from '../functions/_lib/betaRound.js'
import { mutationFingerprint } from '../functions/_lib/atomicMutation.js'
import { onRequestGet as info, onRequestPost as save } from '../functions/api/applications/[id]/beta.js'
import { onRequest } from '../functions/api/_middleware.js'
import { tally } from '../shared/tally.js'

const pg = new PGlite(), base = 'https://beta-round-local.supabase.co', issuer = 'https://beta-round-local.cloudflareaccess.com'
const DB = createSupabaseDb(base, 'memory-only'), builder = 'builder@local.invalid', reader = 'reader@local.invalid', other = 'other@local.invalid'
const actors = { [builder]: ['product', ['재무']], [reader]: ['reviewer', ['재무']], [other]: ['product', ['영업']] }
let queue = Promise.resolve(), sequence = 0, lastError = '', pair, jwk
const environment = (db = DB.forActor(builder)) => ({ DB: db, AUTH_ACTOR: db.actorEmail ? { email: db.actorEmail, label: db.actorEmail, role: actors[db.actorEmail][0], departments: actors[db.actorEmail][1], mode: 'access' } : null })
const request = (body, key = crypto.randomUUID()) => new Request('https://local.invalid/api/applications/test/beta', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': key }, body: JSON.stringify(body) })
const post = (id, body, db = DB.forActor(builder), key) => save({ env: environment(db), params: { id }, request: request(body, key) })
const get = (id, db = DB.forActor(builder)) => info({ env: environment(db), params: { id } })

beforeAll(async () => {
  await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;')
  const dir = new URL('../supabase/migrations/', import.meta.url)
  for (const file of readdirSync(dir).filter(file => /^\d+.*\.sql$/.test(file)).sort()) {
    if (file.startsWith('0012_')) {
      await pg.exec("INSERT INTO public.application(id,ticket_no,dept,applicant_label,title,bottleneck,problem) VALUES('legacy-beta','legacy-beta','재무','이전 작성자','기존 신청','취합','반복'); INSERT INTO public.beta_round(id,application_id,seq,overall,total,passed) VALUES('legacy-round','legacy-beta',1,'통과',1,1); INSERT INTO public.beta_result(id,round_id,body,verdict) VALUES('legacy-result','legacy-round','기존 판정','통과');")
      await pg.query("SELECT public.ilson_workspace_open($1,'[]')", ['c'.repeat(64)])
    }
    await pg.exec(readFileSync(new URL(file, dir), 'utf8'))
  }
  pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])
  jwk = { ...await crypto.subtle.exportKey('jwk', pair.publicKey), kid: 'beta-local', alg: 'RS256', use: 'sig' }
  vi.stubGlobal('fetch', (url, options) => {
    if (String(url) === issuer + '/cdn-cgi/access/certs') return Promise.resolve(Response.json({ keys: [jwk] }))
    if (!String(url).startsWith(base + '/rest/v1/rpc/')) throw Error('External network blocked')
    const pending = queue.then(async () => {
      try {
        await pg.exec('SET ROLE service_role')
        const name = new URL(url).pathname.split('/').at(-1), args = Object.values(JSON.parse(options.body))
        return Response.json((await pg.query(`SELECT public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) data`, args)).rows[0].data)
      } catch (error) { lastError = `${error.code}: ${error.message}`; return Response.json({ code: error.code }, { status: 400 }) }
      finally { await pg.exec('RESET ROLE') }
    })
    queue = pending.catch(() => {})
    return pending
  })
  for (const [email, [role, departments]] of Object.entries(actors)) await DB.prepare('INSERT INTO override_actor(email,display_name,role,departments_json) VALUES(?,?,?,?)').bind(email, email, role, JSON.stringify(departments)).run()
}, 60000)
afterAll(async () => { vi.unstubAllGlobals(); await pg.close() })

async function fixture(db = DB, { owner = reader, status = '수용' } = {}) {
  const id = 'beta-app-' + (++sequence)
  await db.prepare("INSERT INTO application(id,ticket_no,dept,applicant_label,title,bottleneck,problem,owner_email,status) VALUES(?,?,'재무','작성자','검증','취합','반복',?,?)").bind(id, id, db.workspace ? null : owner, status).run()
  for (const [ord, check, safety] of [[1, 'currency_converted', 1], [2, 'idempotent', 0]]) await db.prepare("INSERT INTO acceptance_criterion(id,application_id,ord,body,check_key,is_required_safety,confirmed_at) VALUES(?,?,?,?,?,?,datetime('now'))").bind(id + '-c' + ord, id, ord, '확정 기준 ' + ord, check, safety).run()
  return id
}
async function payload(id, db = DB.forActor(builder)) {
  const response = await get(id, db)
  expect(response.status, lastError).toBe(200)
  const data = await response.json()
  return { kind: 'round', run_id: crypto.randomUUID(), run_scope: data.runScope, criteria_revision: data.criteriaRevision,
    graded: data.criteria.map(c => ({ id: c.id, ord: c.ord, body: c.body, check_key: c.check_key,
      is_required_safety: c.is_required_safety, kind: c.check_kind === 'rule' && c.check_key ? 'rule' : 'human',
      verdict: c.check_kind === 'rule' && c.check_key ? '통과' : '사람확인', evidence: '로컬 확인', samples: [] })), summary: { overall: '통과', durationMs: 51 } }
}
async function counts(id, db = DB) {
  return db.prepare(`SELECT (SELECT count(*) FROM beta_round WHERE application_id=?) rounds,
    (SELECT count(*) FROM beta_result WHERE round_id IN (SELECT id FROM beta_round WHERE application_id=?)) results,
    (SELECT count(*) FROM decision_log WHERE application_id=?) decisions`).bind(id, id, id).first()
}
async function direct(db, id, body) {
  const normalized = betaRoundPayload(body)
  return db.recordBetaRound(id, body.run_id, await mutationFingerprint({ kind: 'beta-round', application: id, payload: normalized }), normalized)
}

describe.sequential('current beta criteria and one atomic round', () => {
  it('saves the complete current criteria, round and forward-only application status', async () => {
    const id = await fixture(), body = await payload(id)
    expect(body.criteria_revision).toBe(2)
    expect(body.run_scope).toMatch(/^[a-f0-9]{64}$/)
    const response = await post(id, body)
    expect(response.status, lastError).toBe(201)
    expect(await response.json()).toMatchObject({ seq: 1, overall: '통과', summary: { total: 2, passed: 2, safetyFailed: 0 } })
    expect(await counts(id)).toEqual({ rounds: 1, results: 2, decisions: 0 })
    expect(await DB.prepare('SELECT status FROM application WHERE id=?').bind(id).first('status')).toBe('진행중')
  })
  it('rejects omissions, duplicate IDs, invented IDs and another application criterion', async () => {
    const id = await fixture(), second = await fixture(), body = await payload(id)
    const cases = [
      [{ ...body, graded: body.graded.slice(1) }, 409],
      [{ ...body, graded: [body.graded[0], body.graded[0]] }, 400],
      [{ ...body, graded: [{ ...body.graded[0], id: 'invented' }, body.graded[1]] }, 409],
      [{ ...body, graded: [{ ...body.graded[0], id: second + '-c1' }, body.graded[1]] }, 409],
    ]
    for (const [input, status] of cases) {
      const response = await post(id, input)
      expect(response.status, lastError).toBe(status)
      if (status === 409) expect(await response.json()).toMatchObject({ code: 'BETA_CRITERIA_CHANGED', notSaved: true })
    }
    expect(await counts(id)).toEqual({ rounds: 0, results: 0, decisions: 0 })
  })
  it('does not accept client changes to the safety flag, kind, body, order or check key', async () => {
    const id = await fixture(), body = await payload(id)
    for (const change of [{ is_required_safety: false }, { kind: 'human', verdict: '사람확인' }, { body: '다른 기준' }, { ord: 99 }, { check_key: 'idempotent' }]) {
      const response = await post(id, { ...body, graded: [{ ...body.graded[0], ...change }, body.graded[1]] })
      expect(response.status, lastError).toBe(409)
    }
    // The RPC must reject the same forgery even if the HTTP validator is bypassed.
    await expect(direct(DB.forActor(builder), id, { ...body, graded: [{ ...body.graded[0], is_required_safety: false }, body.graded[1]] })).rejects.toThrow('/PBT01')
    expect((await counts(id)).rounds).toBe(0)
  })
  it('recalculates safety failures and preserves the blocked and overruled decision records', async () => {
    const id = await fixture(), body = await payload(id)
    body.graded[0].verdict = '실패'
    body.summary.passed = 999
    const response = await post(id, body), data = await response.json()
    expect(response.status, lastError).toBe(201)
    expect(data).toMatchObject({ overall: '차단', overruled: '통과', summary: { total: 2, passed: 1, failed: 1, safetyFailed: 1 } })
    expect(data.summary).toMatchObject(tally(body.graded))
    expect(await counts(id)).toEqual({ rounds: 1, results: 2, decisions: 2 })
    expect(await DB.prepare('SELECT status FROM application WHERE id=?').bind(id).first('status')).toBe('수용')
  })
  it('retains unjudged and human checks without manufacturing a machine pass', async () => {
    const id = await fixture()
    await DB.prepare("UPDATE acceptance_criterion SET check_kind='human',check_key=NULL WHERE id=?").bind(id + '-c2').run()
    const body = await payload(id)
    body.graded[0].verdict = '판정불가'
    const response = await post(id, body), data = await response.json()
    expect(response.status, lastError).toBe(201)
    expect(data.summary).toMatchObject(tally(body.graded))
    expect(data).toMatchObject({ overall: '조건부', summary: { passed: 0, humanNeeded: 1, unjudged: 1 } })
  })
  it('replays the same run independently of a changing request header and later criteria edits', async () => {
    const id = await fixture(), body = await payload(id)
    const first = await post(id, body), saved = await first.json()
    await DB.prepare('UPDATE acceptance_criterion SET body=? WHERE id=?').bind('새 기준', id + '-c1').run()
    const repeated = await post(id, body), replay = await repeated.json()
    expect(repeated.status, lastError).toBe(201)
    expect(repeated.headers.get('X-Idempotency-Replayed')).toBe('1')
    expect(replay).toEqual(saved)
    expect((await counts(id)).rounds).toBe(1)
    expect((await post(id, { ...body, summary: { ...body.summary, durationMs: 52 } })).status).toBe(409)
  })
  it('reconciles a committed round after response loss without regrading or adding another round', async () => {
    const id = await fixture(), body = await payload(id), scoped = DB.forActor(builder)
    const lost = { ...scoped, recordBetaRound: async (...args) => { await scoped.recordBetaRound(...args); throw Error('Local simulated response loss') } }
    expect((await post(id, body, lost)).status).toBe(503)
    expect((await counts(id)).rounds).toBe(1)
    const retry = await post(id, body)
    expect(retry.status, lastError).toBe(201)
    expect(retry.headers.get('X-Idempotency-Replayed')).toBe('1')
    expect((await counts(id)).rounds).toBe(1)
  })
  it('serializes simultaneous same-run submissions and gives fresh rounds distinct sequences', async () => {
    const id = await fixture(), body = await payload(id)
    const responses = await Promise.all([post(id, body), post(id, body)])
    expect(responses.map(response => response.status), lastError).toEqual([201, 201])
    const saved = await Promise.all(responses.map(response => response.json()))
    expect(saved[0].round_id).toBe(saved[1].round_id)
    expect((await counts(id)).rounds).toBe(1)
    const next = await Promise.all([post(id, { ...body, run_id: crypto.randomUUID() }), post(id, { ...body, run_id: crypto.randomUUID() })])
    const sequences = await Promise.all(next.map(async response => { expect(response.status, lastError).toBe(201); return (await response.json()).seq }))
    expect(sequences.sort()).toEqual([2, 3])
    expect((await counts(id)).rounds).toBe(3)
  })
  it('rejects an edited or ABA-reconfirmed criteria snapshot with no new round', async () => {
    const id = await fixture(), body = await payload(id)
    await DB.prepare('UPDATE acceptance_criterion SET confirmed_at=NULL WHERE id=?').bind(id + '-c1').run()
    await DB.prepare("UPDATE acceptance_criterion SET confirmed_at=datetime('now') WHERE id=?").bind(id + '-c1').run()
    const response = await post(id, body)
    expect(response.status, lastError).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'BETA_CRITERIA_CHANGED', notSaved: true })
    expect((await counts(id)).rounds).toBe(0)
  })
  it('rechecks criteria changed after the HTTP application lookup but before the RPC commit', async () => {
    const id = await fixture(), body = await payload(id), scoped = DB.forActor(builder)
    const racing = { ...scoped, recordBetaRound: async (...args) => {
      await DB.prepare("INSERT INTO acceptance_criterion(id,application_id,ord,body,check_key,confirmed_at) VALUES(?,?,3,'추가된 기준','idempotent',datetime('now'))").bind(id + '-new', id).run()
      return scoped.recordBetaRound(...args)
    } }
    const response = await post(id, body, racing)
    expect(response.status, lastError).toBe(409)
    expect((await counts(id)).rounds).toBe(0)
  })
  it('rolls back the round, results, status and receipt on an intermediate result INSERT failure', async () => {
    const id = await fixture(), body = await payload(id)
    await pg.exec("CREATE FUNCTION public.test_beta_result_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.ord=2 THEN RAISE EXCEPTION 'Local result failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER test_beta_result_failure BEFORE INSERT ON public.beta_result FOR EACH ROW EXECUTE FUNCTION public.test_beta_result_failure();")
    try {
      expect((await post(id, body)).status).toBe(503)
      expect(await counts(id)).toEqual({ rounds: 0, results: 0, decisions: 0 })
      expect(await DB.prepare('SELECT status FROM application WHERE id=?').bind(id).first('status')).toBe('수용')
    } finally { await pg.exec('DROP TRIGGER test_beta_result_failure ON public.beta_result;DROP FUNCTION public.test_beta_result_failure();') }
    expect((await post(id, body)).status).toBe(201)
    expect((await counts(id)).rounds).toBe(1)
  })
  it('rolls back the whole blocked round if its decision audit cannot be written', async () => {
    const id = await fixture(), body = await payload(id)
    body.graded[0].verdict = '실패'
    await pg.exec("CREATE FUNCTION public.test_beta_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.link_kind='beta_round' THEN RAISE EXCEPTION 'Local audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER test_beta_audit_failure BEFORE INSERT ON public.decision_log FOR EACH ROW EXECUTE FUNCTION public.test_beta_audit_failure();")
    try {
      expect((await post(id, body)).status).toBe(503)
      expect(await counts(id)).toEqual({ rounds: 0, results: 0, decisions: 0 })
    } finally { await pg.exec('DROP TRIGGER test_beta_audit_failure ON public.decision_log;DROP FUNCTION public.test_beta_audit_failure();') }
    expect((await post(id, body)).status).toBe(201)
  })
  it('rejects another application build and does not downgrade completed application status', async () => {
    const id = await fixture(DB, { status: '완료' }), foreign = await fixture(), body = await payload(id)
    await DB.prepare("INSERT INTO build_run(id,application_id,seq,files_json) VALUES(?,?,1,'[]')").bind('foreign-build', foreign).run()
    expect((await post(id, { ...body, build_run_id: 'foreign-build' })).status).toBe(400)
    expect((await post(id, body)).status).toBe(201)
    expect(await DB.prepare('SELECT status FROM application WHERE id=?').bind(id).first('status')).toBe('완료')
  })
  it('rechecks application scope, builder role and active account, including receipt retries', async () => {
    const id = await fixture(), body = await payload(id)
    expect((await post(id, body, DB.forActor(other))).status).toBe(404)
    await expect(direct(DB.forActor(reader), id, body)).rejects.toThrow('/42501')
    expect((await post(id, body)).status).toBe(201)
    await DB.prepare('UPDATE override_actor SET active=0 WHERE email=?').bind(builder).run()
    await expect(direct(DB.forActor(builder), id, body)).rejects.toThrow('/28000')
    await DB.prepare("UPDATE override_actor SET active=1,role='reviewer' WHERE email=?").bind(builder).run()
    await expect(direct(DB.forActor(builder), id, body)).rejects.toThrow('/42501')
    await DB.prepare("UPDATE override_actor SET role='product' WHERE email=?").bind(builder).run()
    expect((await counts(id)).rounds).toBe(1)
  })
  it('denies the same saved payload after a browser account scope change', async () => {
    const id = await fixture(), body = await payload(id)
    expect((await post(id, body)).status).toBe(201)
    await DB.prepare("UPDATE override_actor SET departments_json='[\"재무\"]' WHERE email=?").bind(other).run()
    const response = await post(id, body, DB.forActor(other))
    expect(response.status).toBe(409)
    expect(await response.json()).not.toHaveProperty('notSaved')
    expect((await counts(id)).rounds).toBe(1)
    await DB.prepare("UPDATE override_actor SET departments_json='[\"영업\"]' WHERE email=?").bind(other).run()
  })
  it('uses the actual signed middleware action gate and verified actor for beta saving', async () => {
    const id = await fixture()
    const enc = value => Buffer.from(JSON.stringify(value)).toString('base64url')
    for (const [email, expected] of [[reader, 403], [builder, 201]]) {
      const body = await payload(id, DB.forActor(email)), now = Math.floor(Date.now() / 1000)
      const unsigned = enc({ alg: 'RS256', kid: 'beta-local' }) + '.' + enc({ iss: issuer, aud: ['beta-local'], iat: now, exp: now + 300, email })
      const jwt = unsigned + '.' + Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(unsigned))).toString('base64url')
      const env = { DB, DBBridgeApplied: true, SUPABASE_URL: base, SUPABASE_SERVICE_ROLE_KEY: 'memory-only', ACCESS_TEAM_DOMAIN: issuer, ACCESS_AUD: 'beta-local', DEMO_WORKSPACES: 'false', OVERRIDE_DEMO_MODE: 'false' }
      const req = new Request('https://local.invalid/api/applications/' + id + '/beta', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://local.invalid', 'X-Ilson-Request': '1', 'X-Ilson-Scope': await DB.forActor(email).toolRunScope(), 'Cf-Access-Jwt-Assertion': jwt }, body: JSON.stringify(body) })
      const ctx = { env, request: req, data: {}, next: forwarded => save({ env, data: ctx.data, params: { id }, request: forwarded }) }
      expect((await onRequest(ctx)).status, lastError).toBe(expected)
    }
  })
  it('installs revision guards in new isolated demo schemas and isolates receipt scope', async () => {
    const token = 'b'.repeat(64)
    await DB.workspaceOpen(token, [])
    const demo = createSupabaseDb(base, 'memory-only', token), id = await fixture(demo), body = await payload(id, demo)
    expect(body.criteria_revision).toBe(2)
    expect((await post(id, body, demo)).status, lastError).toBe(201)
    expect((await post(id, body, demo)).headers.get('X-Idempotency-Replayed')).toBe('1')
    expect((await counts(id, demo)).rounds).toBe(1)
    expect((await counts(id)).rounds).toBe(0)
    expect(await demo.readiness()).toMatchObject({ schemaReady: true })
  })
  it('keeps pre-migration history and rejects direct public or scoped-role execution', async () => {
    expect(await counts('legacy-beta')).toEqual({ rounds: 1, results: 1, decisions: 0 })
    expect(await DB.prepare("SELECT body FROM beta_result WHERE id='legacy-result'").first('body')).toBe('기존 판정')
    const existingDemo = createSupabaseDb(base, 'memory-only', 'c'.repeat(64)), id = await fixture(existingDemo)
    expect((await payload(id, existingDemo)).criteria_revision).toBe(2)
    expect(await existingDemo.readiness()).toMatchObject({ schemaReady: true })
    const privileges = (await pg.query("SELECT has_function_privilege('anon','public.ilson_record_beta_round(text,text,text,text,text,jsonb)','EXECUTE') a,has_function_privilege('ilson_scoped_executor','public.ilson_record_beta_round(text,text,text,text,text,jsonb)','EXECUTE') s")).rows[0]
    expect(privileges).toEqual({ a: false, s: false })
    await expect(pg.query("SELECT public.ilson_record_beta_round($1,$2,'app','request-1234567890',repeat('a',64),'{}')", ['b'.repeat(64), builder])).rejects.toMatchObject({ code: '22023' })
  })
})
