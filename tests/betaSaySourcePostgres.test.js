// @vitest-environment node
// Signed middleware and all current migrations in disposable memory PostgreSQL.
// Controlled hooks use one queued connection, not real multi-session load.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { createSupabaseDb } from '../functions/_lib/dbBridge.ts'
import { onRequest } from '../functions/api/_middleware.js'
import { onRequestGet, onRequestPost } from '../functions/api/track/[ticket]/beta.js'

const pg = new PGlite(), base = 'https://beta-say-source-memory.supabase.co'
const issuer = 'https://beta-say-source-memory.cloudflareaccess.com'
const email = 'beta-say-owner@local.invalid', other = 'beta-say-other@local.invalid'
const DB = createSupabaseDb(base, 'synthetic-only')
const env = { DB, DBBridgeApplied: true, SUPABASE_URL: base, SUPABASE_SERVICE_ROLE_KEY: 'synthetic-only',
  ACCESS_TEAM_DOMAIN: issuer, ACCESS_AUD: 'beta-say-source-memory', OVERRIDE_DEMO_MODE: 'false', DEMO_WORKSPACES: 'false' }
let queue = Promise.resolve(), pair, jwk, sequence = 0, beforeCommit, dropResponse
const directWrites = [], commits = []
beforeAll(async () => {
  await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;')
  const directory = new URL('../supabase/migrations/', import.meta.url)
  for (const file of readdirSync(directory).filter(name => /^\d+.*\.sql$/.test(name)).sort()) await pg.exec(readFileSync(new URL(file, directory), 'utf8'))
  await pg.query("INSERT INTO override_actor(email,display_name,role,departments_json) VALUES($1,'현재 담당자','operations','[\"Finance\"]'),($2,'다른 담당자','operations','[\"Other\"]')", [email, other])
  await pg.exec(`CREATE FUNCTION public.reject_beta_say_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.what='감사 실패를 재현합니다.' THEN RAISE EXCEPTION 'Synthetic audit failure' USING ERRCODE='23514'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER reject_beta_say_audit BEFORE INSERT ON public.decision_log FOR EACH ROW EXECUTE FUNCTION public.reject_beta_say_audit();`)
  pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])
  jwk = { ...await crypto.subtle.exportKey('jwk', pair.publicKey), kid: env.ACCESS_AUD, alg: 'RS256', use: 'sig' }
  vi.stubGlobal('fetch', (url, options) => {
    if (String(url) === issuer + '/cdn-cgi/access/certs') return Promise.resolve(Response.json({ keys: [jwk] }))
    if (!String(url).startsWith(base + '/rest/v1/rpc/')) throw Error('External network prohibited')
    const name = new URL(url).pathname.split('/').at(-1), args = JSON.parse(options.body)
    const commit = name === 'ilson_actor_commit'
    if (commit) commits.push(args)
    if (/^(INSERT|UPDATE|DELETE)/.test(args.p_sql ?? '')) directWrites.push(args.p_sql)
    const task = queue.then(async () => {
      let response
      try {
        if (commit && beforeCommit) { const hook = beforeCommit; beforeCommit = null; await hook() }
        await pg.exec('SET ROLE service_role')
        const values = Object.values(args)
        response = Response.json((await pg.query(`SELECT public.${name}(${values.map((_, i) => '$' + (i + 1)).join(',')}) data`, values)).rows[0].data)
      } catch (error) { response = Response.json({ code: error.code }, { status: 400 }) }
      finally { await pg.exec('RESET ROLE') }
      if (commit && dropResponse && response.ok) { dropResponse = false; throw new TypeError('Synthetic committed response loss') }
      return response
    })
    queue = task.catch(() => {})
    return task
  })
}, 60000)
afterEach(async () => {
  await queue
  beforeCommit = null; dropResponse = false; directWrites.length = 0; commits.length = 0
  await pg.exec('TRUNCATE public.application CASCADE; DELETE FROM public.rate_limit_hits; DELETE FROM ilson_private.actor_rate_tickets;')
  await pg.query("UPDATE override_actor SET active=1,role='operations',departments_json='[\"Finance\"]',display_name='현재 담당자' WHERE email=$1", [email])
})
afterAll(async () => { await queue; vi.unstubAllGlobals(); await pg.close() })
async function token(identity) {
  const enc = value => Buffer.from(JSON.stringify(value)).toString('base64url'), now = Math.floor(Date.now() / 1000)
  const unsigned = enc({ alg: 'RS256', kid: jwk.kid }) + '.' + enc({ iss: issuer, aud: [jwk.kid], email: identity, iat: now, exp: now + 600 })
  return unsigned + '.' + Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(unsigned))).toString('base64url')
}
async function invoke(app, body, { key = crypto.randomUUID(), identity = email } = {}) {
  const headers = { 'Cf-Access-Jwt-Assertion': await token(identity), 'CF-Connecting-IP': 'synthetic-beta-say',
    'Content-Type': 'application/json', Origin: 'https://local.invalid', 'X-Ilson-Request': '1',
    'X-Ilson-Scope': await DB.forActor(identity).toolRunScope(), 'X-Idempotency-Key': key }
  const request = new Request('https://local.invalid/api/track/' + app.ticket + '/beta',
    body === undefined ? { headers } : { method: 'POST', headers, body: JSON.stringify(body) })
  const context = { env, request, data: {} }
  context.next = forwarded => (body === undefined ? onRequestGet : onRequestPost)({ env, data: context.data, request: forwarded ?? request, params: { ticket: app.ticket } })
  const response = await onRequest(context)
  return { status: response.status, body: await response.json(), replayed: response.headers.get('X-Idempotency-Replayed') }
}
async function fixture(roundId) {
  const n = ++sequence, app = { id: 'source-app-' + n, ticket: 'AX-SOURCE-' + n, round: roundId ?? 'legacy-round-' + n }
  await pg.query("INSERT INTO application(id,ticket_no,dept,applicant_label,title,bottleneck,problem,status,owner_email) VALUES($1,$2,'Finance','신청자','합성 시험','병목','문제','진행중',$3)", [app.id, app.ticket, email])
  await round(app, app.round, 1)
  return app
}
async function round(app, id, seq) { await pg.query("INSERT INTO beta_round(id,application_id,seq,overall) VALUES($1,$2,$3,'통과')", [id, app.id, seq]) }
async function command(app) {
  const seen = await invoke(app)
  expect(seen.status).toBe(200)
  expect(seen.body.state.round.id).toBe(app.round)
  return { by: '현장 사원', kind: '의견', body: '1차에서 확인한 현장 의견입니다.', expectedRoundId: seen.body.state.round.id }
}
async function stored(app, key) {
  return {
    feedback: (await pg.query('SELECT round_id,body FROM beta_feedback WHERE application_id=$1 ORDER BY id', [app.id])).rows,
    decisions: (await pg.query("SELECT link_id,what FROM decision_log WHERE application_id=$1 AND link_kind='시험판의견' ORDER BY id", [app.id])).rows,
    receipts: Number((await pg.query('SELECT count(*) n FROM ilson_private.mutation_receipts WHERE request_id=$1', [key])).rows[0].n),
  }
}
const empty = { feedback: [], decisions: [], receipts: 0 }

describe.sequential('beta feedback is bound to the round actually viewed', () => {
  it('returns the exact source ID and atomically preserves the same feedback/audit round', async () => {
    const app = await fixture(), body = await command(app), key = crypto.randomUUID()
    const saved = await invoke(app, body, { key })
    expect(saved).toMatchObject({ status: 200, replayed: '0', body: { ok: true, savedRound: { id: app.round, seq: 1 } } })
    expect(await stored(app, key)).toEqual({ feedback: [{ round_id: app.round, body: body.body }], decisions: [{ link_id: app.round, what: body.body }], receipts: 1 })
    expect(directWrites).toEqual([])
    expect(commits).toHaveLength(1)
  })
  it('rejects a first-round draft after a second round already exists without any write', async () => {
    const app = await fixture(), body = await command(app), key = crypto.randomUUID()
    await round(app, 'next-round', 2)
    expect(await invoke(app, body, { key })).toMatchObject({ status: 409, body: { code: 'BETA_ROUND_CHANGED', notSaved: true } })
    expect(await stored(app, key)).toEqual(empty)
    const current = await invoke(app)
    expect(current.body.state.round).toMatchObject({ id: 'next-round', seq: 2 })
    expect(await invoke(app, { ...body, expectedRoundId: current.body.state.round.id }, { key: crypto.randomUUID() })).toMatchObject({ status: 200, body: { savedRound: { id: 'next-round', seq: 2 } } })
  })
  it('retains the existing CAS when another round appears after staging and before commit', async () => {
    const app = await fixture(), body = await command(app), key = crypto.randomUUID()
    beforeCommit = () => round(app, 'race-round', 2)
    expect((await invoke(app, body, { key })).status).toBe(409)
    expect(beforeCommit).toBeNull(); expect(await stored(app, key)).toEqual(empty)
  })
  it('replays an originally saved first round after response loss and a newer round, without relabelling it', async () => {
    const app = await fixture(), body = await command(app), key = crypto.randomUUID()
    dropResponse = true
    expect((await invoke(app, body, { key })).status).toBe(503)
    const before = await stored(app, key)
    expect(before.feedback).toHaveLength(1); expect(before.decisions).toHaveLength(1); expect(before.receipts).toBe(1)
    await round(app, 'later-round', 2)
    expect(await invoke(app, body, { key })).toMatchObject({ status: 200, replayed: '1', body: { savedRound: { id: app.round, seq: 1 }, state: { round: { id: 'later-round', seq: 2 } } } })
    expect(await stored(app, key)).toEqual(before)
    expect((await invoke(app, { ...body, expectedRoundId: 'later-round' }, { key })).status).toBe(409)
    expect(await stored(app, key)).toEqual(before)
  })
  it('does not relabel a legacy receipt missing savedRound with today’s latest round', async () => {
    const app = await fixture(), body = await command(app), key = crypto.randomUUID()
    expect((await invoke(app, body, { key })).status).toBe(200)
    await pg.query("UPDATE ilson_private.mutation_receipts SET response=jsonb_set(response,'{body}',(response->'body')-'savedRound') WHERE request_id=$1", [key])
    await round(app, 'latest-after-legacy', 2)
    const before = await stored(app, key), result = await invoke(app, body, { key })
    expect(result).toMatchObject({ status: 200, replayed: '1', body: { savedRound: null, state: { round: { id: 'latest-after-legacy', seq: 2 } } } })
    expect(await stored(app, key)).toEqual(before)
  })
  it.each([undefined, null, 1, true, {}, [], '', '   ', 'bad\0id', 'bad\ud800id'])('rejects an invalid viewed round %j before any write', async expectedRoundId => {
    const app = await fixture(), body = await command(app), key = crypto.randomUUID()
    expect(await invoke(app, { ...body, expectedRoundId }, { key })).toMatchObject({ status: 400, body: { notSaved: true } })
    expect(await stored(app, key)).toEqual(empty)
  })
  it.each(['LEGACY / 회차😀', '  legacy round  ', 'x'.repeat(100), 'x'.repeat(301)])('preserves legacy opaque source identity without trimming: %s', async id => {
    const app = await fixture(id), body = await command(app), key = crypto.randomUUID()
    expect(await invoke(app, body, { key })).toMatchObject({ status: 200, body: { savedRound: { id, seq: 1 } } })
    expect((await stored(app, key)).feedback[0].round_id).toBe(id)
  })
  it('cannot attach a different application’s visible round', async () => {
    const app = await fixture(), second = await fixture(), body = await command(app), key = crypto.randomUUID()
    expect((await invoke(app, { ...body, expectedRoundId: second.round }, { key })).status).toBe(409)
    expect(await stored(app, key)).toEqual(empty)
  })
  it('keeps department authorization independent of application ownership', async () => {
    const app = await fixture(), body = await command(app), key = crypto.randomUUID()
    await pg.query("UPDATE override_actor SET departments_json='[]' WHERE email=$1", [email])
    expect((await invoke(app, body, { key })).status).toBe(403)
    expect(await stored(app, key)).toEqual(empty)
  })
  it.each(['department', 'active'])('refuses %s revocation at commit without partial records', async change => {
    const app = await fixture(), body = await command(app), key = crypto.randomUUID()
    beforeCommit = () => pg.query(change === 'active' ? 'UPDATE override_actor SET active=0 WHERE email=$1' : "UPDATE override_actor SET departments_json='[]' WHERE email=$1", [email])
    expect((await invoke(app, body, { key })).status).toBe(change === 'active' ? 401 : 409)
    expect(await stored(app, key)).toEqual(empty)
  })
  it('does not reveal an inaccessible application or accept its source ID', async () => {
    const app = await fixture(), body = await command(app), key = crypto.randomUUID()
    expect((await invoke(app, body, { key, identity: other })).status).toBe(404)
    expect(await stored(app, key)).toEqual(empty)
  })
  it('rolls feedback back when the following decision audit fails in PG', async () => {
    const app = await fixture(), body = await command(app), key = crypto.randomUUID()
    expect((await invoke(app, { ...body, body: '감사 실패를 재현합니다.' }, { key })).status).toBe(503)
    expect(await stored(app, key)).toEqual(empty)
  })
})
