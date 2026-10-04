// @vitest-environment node
// Actual signed middleware + current SQL functions in disposable memory PG.
// The RPC queue models interleaved HTTP requests on ONE database connection;
// it is not a multi-session PostgreSQL concurrency or production load test.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { createSupabaseDb } from '../functions/_lib/dbBridge.ts'
import { onRequest } from '../functions/api/_middleware.js'
import { onRequestPost as build } from '../functions/api/applications/[id]/build.js'
import { onRequestGet as getCodes, onRequestPost as postCodes } from '../functions/api/codes.js'
import { SKU_BY_CODE } from '../shared/master.js'
import { BUILD_ALIAS_KIND } from '../shared/codes.js'
import { sideOf, sideTally } from '../shared/side.js'

const pg = new PGlite(), base = 'https://build-alias-memory.supabase.co'
const issuer = 'https://build-alias-memory.cloudflareaccess.com'
const DB = createSupabaseDb(base, 'synthetic-only'), email = 'build-operator@local.invalid', label = '검증된 담당자'
const canonical = 'NR-CM-100'
const env = { DB, DBBridgeApplied: true, SUPABASE_URL: base, SUPABASE_SERVICE_ROLE_KEY: 'synthetic-only',
  ACCESS_TEAM_DOMAIN: issuer, ACCESS_AUD: 'build-alias-memory', DEMO_WORKSPACES: 'false', OVERRIDE_DEMO_MODE: 'false' }
let pair, jwk, queue = Promise.resolve(), sequence = 0, beforeCommit = null, beforeActorRead = null, beforeReceipt = null, dropCommitResponse = false, barrier = null
const failures = []

beforeAll(async () => {
  await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;')
  const directory = new URL('../supabase/migrations/', import.meta.url)
  for (const file of readdirSync(directory).filter(name => /^\d+.*\.sql$/.test(name)).sort()) await pg.exec(readFileSync(new URL(file, directory), 'utf8'))
  pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])
  jwk = { ...await crypto.subtle.exportKey('jwk', pair.publicKey), kid: env.ACCESS_AUD, alg: 'RS256', use: 'sig' }
  await pg.query(`INSERT INTO override_actor(email,display_name,role,departments_json) VALUES
    ($1,$2,'product','["Finance"]'),('build-reviewer@local.invalid','일반 사원','reviewer','["Finance"]'),
    ('build-other@local.invalid','타 부서 담당','product','["Other"]')`, [email, label])
  vi.stubGlobal('fetch', (url, options) => {
    if (String(url) === issuer + '/cdn-cgi/access/certs') return Promise.resolve(Response.json({ keys: [jwk] }))
    if (!String(url).startsWith(base + '/rest/v1/rpc/')) throw Error('External network prohibited')
    const name = new URL(url).pathname.split('/').at(-1), args = JSON.parse(options.body)
    const sql = args.p_sql ?? args.p_query ?? ''
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
      if (barrier && name === 'ilson_actor_query' && /^SELECT \* FROM sku_alias WHERE external_code =/.test(sql)) {
        const current = barrier
        if (++current.reads === 2) current.release()
        await current.ready
      }
      return response
    })
  })
}, 60000)

afterEach(async () => {
  beforeCommit = null; beforeActorRead = null; beforeReceipt = null; dropCommitResponse = false; barrier = null; failures.length = 0
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
const payload = (app, changes) => ({ kind: 'alias', external_code: app.code, canonical_code: canonical, taught_by: '사칭 작성자', product_name: '요청의 잘못된 상품명', ...changes })
async function invoke(app, body = payload(app), options = {}) {
  const key = options.key === undefined ? crypto.randomUUID() : options.key
  const identity = options.email ?? email, database = options.token ? createSupabaseDb(base, 'synthetic-only', options.token) : DB.forActor(identity)
  const headers = { 'Content-Type': 'application/json', Origin: options.origin ?? 'https://local.invalid', 'X-Ilson-Request': '1',
    'X-Ilson-Scope': await database.toolRunScope(), 'CF-Connecting-IP': key ?? 'missing' }
  if (key !== null) headers['X-Idempotency-Key'] = key
  if (options.token) headers.Cookie = 'ilson_workspace=' + options.token
  else headers['Cf-Access-Jwt-Assertion'] = await jwt(identity)
  const method = options.method ?? 'POST', routeId = options.routeId ?? app.id
  const path = options.codes ? '/api/codes' : '/api/applications/' + routeId + '/build'
  const context = { env: options.token ? { ...env, DEMO_WORKSPACES: 'true', OVERRIDE_DEMO_MODE: 'true' } : env,
    request: new Request('https://local.invalid' + path, { method, headers, ...(method === 'GET' ? {} : { body: options.raw ?? JSON.stringify(body) }) }), data: {} }
  context.next = forwarded => {
    if (options.adapter) context.data.requestEnv = { ...context.data.requestEnv, DB: options.adapter }
    return (options.codes ? (method === 'GET' ? getCodes : postCodes) : build)({ env: context.env, data: context.data, params: { id: routeId }, request: forwarded ?? context.request })
  }
  const response = await onRequest(context)
  return { status: response.status, body: await response.json(), replayed: response.headers.get('X-Idempotency-Replayed') }
}
async function state(app, key, database = DB) {
  return { aliases: (await database.prepare('SELECT external_code,canonical_code,taught_by,owner_email FROM sku_alias WHERE external_code=?').bind(app.code).all()).results,
    logs: (await database.prepare('SELECT title,what,why,link_id,link_kind FROM decision_log WHERE application_id=? ORDER BY id').bind(app.id).all()).results,
    receipts: Number((await pg.query('SELECT count(*) AS n FROM ilson_private.mutation_receipts WHERE request_id=$1', [key])).rows[0].n) }
}
const empty = { aliases: [], logs: [], receipts: 0 }
function rendezvous() {
  let release
  const ready = new Promise(resolve => { release = resolve })
  barrier = { reads: 0, ready, release }
}


async function aliasRow(app, database = DB) {
  return database.prepare('SELECT * FROM sku_alias WHERE external_code=?').bind(app.code).first()
}
async function observed(app) {
  const response = await invoke(app, null, { codes: true, method: 'GET' })
  expect(response.status).toBe(200)
  return response.body.codes.find(row => row.external_code === app.code)
}
describe.sequential('atomic create-only build alias commands', () => {
  it('uses server catalog/current account and a real app origin with stable normalized receipts', async () => {
    const app = await fixture(), key = crypto.randomUUID()
    const first = await invoke(app, payload(app, { taught_by: {}, channel: 'shop', note: 'original' }), { key })
    expect(first.status).toBe(201)
    expect(first.body).toEqual({ ok: true, external_code: app.code, canonical_code: canonical, already: false,
      product_name: SKU_BY_CODE[canonical].name_ko, teacher: label })
    const replay = await invoke(app, payload(app, { external_code: ' ' + app.code + ' ', canonical_code: ' nr-cm-100 ',
      channel: ' shop ', note: ' original ', product_name: ['fake'], taught_by: ['fake'], affected: -1 }), { key })
    expect(replay).toEqual({ ...first, replayed: '1' })
    expect(await aliasRow(app)).toMatchObject({ product_name: SKU_BY_CODE[canonical].name_ko, channel: 'shop', note: 'original', taught_by: label, owner_email: email })
    expect(await state(app, key)).toMatchObject({ logs: [expect.objectContaining({ title: label, link_id: app.code })], receipts: 1 })
    const logs = (await state(app, key)).logs
    expect(logs[0].link_kind).toBe(BUILD_ALIAS_KIND)
    expect(sideOf(logs[0].link_kind)).toBe('ax')
    expect(sideTally(logs)).toEqual({ ax: 1, dept: 0, proxy: 0, total: 1 })
    const view = await observed(app)
    expect(view.provenance).toEqual({ state: 'linked', applicationId: app.id })
    expect(view.review_available).toBe(true)
    for (const change of [{ channel: 'other' }, { note: 'changed' }, { canonical_code: 'NR-PA-030' }, { external_code: app.code.toUpperCase() }]) {
      expect((await invoke(app, payload(app, change), { key })).status).toBe(409)
    }
    const another = await fixture()
    expect((await invoke(another, payload(app), { key })).status).toBe(409)
  })

  it('same canonical preserves every legacy field and does not create missing provenance', async () => {
    const app = await fixture(), key = crypto.randomUUID()
    await DB.prepare('INSERT INTO sku_alias(external_code,canonical_code,product_name,channel,note,taught_by,owner_email) VALUES(?,?,?,?,?,?,?)')
      .bind(app.code, canonical, 'legacy label', 'legacy channel', 'legacy note', 'past teacher', email).run()
    const before = await aliasRow(app)
    const first = await invoke(app, payload(app, { channel: 'new', note: 'new' }), { key })
    expect(first.status).toBe(201)
    expect(first.body).toEqual({ ok: true, external_code: app.code, canonical_code: canonical, already: true, teacher: 'past teacher' })
    expect(await aliasRow(app)).toEqual(before)
    expect(await state(app, key)).toMatchObject({ logs: [], receipts: 1 })
    expect((await observed(app)).review_reason).toBe('origin_unavailable')
    expect((await invoke(app)).body.already).toBe(true)
    expect(await aliasRow(app)).toEqual(before)
    const different = await invoke(app, payload(app, { canonical_code: 'NR-PA-030' }))
    expect(different.status).toBe(409); expect(different.body.code).toBe('CODE_BUILD_ALIAS_CONFLICT')
    expect(different.body.error).toContain('/codes'); expect(await aliasRow(app)).toEqual(before)
  })

  it('recognizes both source kinds without combining different applications into one inferred origin', async () => {
    const app = await fixture(), second = await fixture()
    expect((await invoke(app)).status).toBe(201)
    await DB.prepare("INSERT INTO decision_log(id,application_id,stage,actor,title,what,why,link_kind,link_id) VALUES(?,?,'배포','human','부서의 합성 설명','상품 연결','합성 원본 출처','코드알림',?)")
      .bind('mixed-source-' + app.id, app.id, app.code).run()
    const same = await observed(app)
    expect(same.provenance).toEqual({ state: 'linked', applicationId: app.id })
    expect(same.review_available).toBe(true)
    await DB.prepare("INSERT INTO decision_log(id,application_id,stage,actor,title,what,why,link_kind,link_id) VALUES(?,?,'배포','human','다른 업무의 합성 설명','상품 연결','별도 합성 출처','코드알림',?)")
      .bind('mixed-source-' + second.id, second.id, app.code).run()
    const mixed = await observed(app)
    expect(mixed.provenance).toEqual({ state: 'ambiguous', applicationId: null })
    expect(mixed.review_reason).toBe('origin_ambiguous')
    expect(mixed.review_available).toBe(false)
    const before = await aliasRow(app), key = crypto.randomUUID()
    expect((await invoke(app, { action: 'correct', externalCode: app.code, expectedVersion: mixed.edit_version,
      canonicalCode: 'NR-PA-030', why: '출처가 다른 업무를 자동으로 추정해서는 안 됩니다.' }, { codes: true, key })).status).toBe(409)
    expect(await aliasRow(app)).toEqual(before)
    expect((await state(app, key)).receipts).toBe(0)
  })

  it('does not fabricate null legacy attribution or attach the alias to a second application', async () => {
    const app = await fixture(), second = await fixture()
    await DB.prepare('INSERT INTO sku_alias(external_code,canonical_code,owner_email) VALUES(?,?,?)').bind(app.code, canonical, email).run()
    const reply = await invoke(second, payload(app))
    expect(reply.status).toBe(201); expect(reply.body).not.toHaveProperty('teacher')
    expect((await state(second)).logs).toHaveLength(0)
  })

  it('returns the original lost response after codes correction without reapplying the old mapping', async () => {
    const app = await fixture(), key = crypto.randomUUID()
    dropCommitResponse = true
    expect((await invoke(app, undefined, { key })).status).toBe(503)
    const original = (await pg.query('SELECT response FROM ilson_private.mutation_receipts WHERE request_id=$1', [key])).rows[0].response
    const view = await observed(app)
    const corrected = await invoke(app, { action: 'correct', externalCode: app.code, expectedVersion: view.edit_version,
      canonicalCode: 'NR-PA-030', why: '원본 자료를 다시 확인하여 상품 연결을 정정합니다.' }, { codes: true })
    expect(corrected.status).toBe(200)
    const before = await aliasRow(app), logs = (await state(app, key)).logs
    const retry = await invoke(app, undefined, { key })
    expect(retry).toEqual({ status: 201, body: original.body, replayed: '1' })
    expect(retry.body.already).toBe(false); expect(await aliasRow(app)).toEqual(before)
    expect(before.canonical_code).toBe('NR-PA-030'); expect((await state(app, key)).logs).toEqual(logs)
    expect((await invoke(app)).status).toBe(409)
  })

  it('cannot perform ABA or silently revive old proof through a new build intent', async () => {
    const app = await fixture()
    expect((await invoke(app)).status).toBe(201)
    const view = await observed(app)
    expect((await invoke(app, { action: 'confirm', externalCode: app.code, expectedVersion: view.edit_version,
      why: '현재 상품의 원본을 확인하였습니다.' }, { codes: true })).status).toBe(200)
    const verified = await observed(app)
    expect(verified.confirmed.verified).toBe(true)
    expect((await invoke(app, payload(app, { canonical_code: 'NR-PA-030' }))).status).toBe(409)
    expect((await invoke(app)).body.already).toBe(true)
    const after = await observed(app)
    expect(after.mapping_revision).toBe(verified.mapping_revision); expect(after.edit_version).toBe(verified.edit_version)
  })

  it.each(['23514', '42501'])('rolls alias and receipt back with decision failure %s', async code => {
    const app = await fixture(), key = crypto.randomUUID()
    await pg.exec("CREATE FUNCTION reject_build_alias_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.link_kind='제작코드등록' THEN RAISE EXCEPTION 'Synthetic failure' USING ERRCODE='" + code + "'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_build_alias_test BEFORE INSERT ON decision_log FOR EACH ROW EXECUTE FUNCTION reject_build_alias_test();")
    try {
      const reply = await invoke(app, undefined, { key })
      expect(reply.status).toBe(code === '42501' ? 403 : 503)
      if (code === '42501') expect(reply.body.code).toBe('ACCESS_DENIED')
      expect(await state(app, key)).toEqual(empty)
    } finally { await pg.exec('DROP TRIGGER reject_build_alias_test ON decision_log; DROP FUNCTION reject_build_alias_test();') }
    expect((await invoke(app, undefined, { key })).status).toBe(201)
  })

  it.each([
    ['active', 0, 401], ['role', 'reviewer', 409], ['display_name', 'Changed name', 409],
    ['departments_json', '[]', 409], ['product_ids_json', '["changed"]', 409], ['updated_at', 'changed revision', 409],
  ])('CAS rejects actor %s changes after read', async (field, value, status) => {
    const app = await fixture(), key = crypto.randomUUID()
    beforeCommit = () => pg.query('UPDATE override_actor SET ' + field + '=$2 WHERE email=$1', [email, value])
    const reply = await invoke(app, undefined, { key })
    expect(reply.status).toBe(status); expect(await state(app, key)).toEqual(empty)
  })

  it.each([
    ['owner_email', 'build-other@local.invalid'], ['dept', 'Other'], ['updated_at', 'changed revision'], ['status', '반려'],
  ])('CAS rejects application %s changes after read', async (field, value) => {
    const app = await fixture(), key = crypto.randomUUID()
    beforeCommit = () => pg.query('UPDATE application SET ' + field + '=$2 WHERE id=$1', [app.id, value])
    expect((await invoke(app, undefined, { key })).status).toBe(409)
    expect(await state(app, key)).toEqual(empty)
  })

  it.each([['role', 'reviewer', 403], ['active', 0, 401]])('rejects actor %s revoked before first authoritative read', async (field, value, status) => {
    const app = await fixture(), key = crypto.randomUUID()
    beforeActorRead = () => pg.query('UPDATE override_actor SET ' + field + '=$2 WHERE email=$1', [email, value])
    expect((await invoke(app, undefined, { key })).status).toBe(status)
    expect(await state(app, key)).toEqual(empty)
  })

  it('uses an allowed current role/name before the first CAS read', async () => {
    const app = await fixture()
    beforeActorRead = () => pg.query("UPDATE override_actor SET role='engineer',display_name='Current name' WHERE email=$1", [email])
    expect((await invoke(app)).body.teacher).toBe('Current name')
    expect(await aliasRow(app)).toMatchObject({ taught_by: 'Current name' })
  })

  it.each([['role', 'engineer', 409], ['product_ids_json', '["changed"]', 409], ['updated_at', 'permission revision', 409], ['active', 0, 401]])(
    'does not disclose prior receipt after %s changes between middleware and receipt read', async (field, value, status) => {
      const app = await fixture(), key = crypto.randomUUID()
      expect((await invoke(app, undefined, { key })).status).toBe(201)
      const before = await state(app, key)
      beforeReceipt = () => pg.query('UPDATE override_actor SET ' + field + '=$2 WHERE email=$1', [email, value])
      const reply = await invoke(app, undefined, { key })
      expect(beforeReceipt).toBeNull(); expect(reply.status).toBe(status)
      expect(reply.body).not.toHaveProperty('teacher'); expect(reply.body).not.toHaveProperty('canonical_code')
      expect(await state(app, key)).toEqual(before)
    })

  it('keeps role, application ownership, origin and hidden alias PK protections', async () => {
    const app = await fixture(), key = crypto.randomUUID()
    expect((await invoke(app, undefined, { email: 'build-reviewer@local.invalid' })).status).toBe(403)
    expect((await invoke(app, undefined, { email: 'build-other@local.invalid' })).status).toBe(404)
    expect((await invoke(app, undefined, { origin: 'https://other.invalid' })).status).toBe(403)
    const otherApp = await fixture('build-other@local.invalid')
    await DB.prepare("UPDATE application SET dept='Other' WHERE id=?").bind(otherApp.id).run()
    otherApp.code = app.code
    expect((await invoke(otherApp, payload(otherApp, { canonical_code: 'NR-PA-030' }), { email: 'build-other@local.invalid' })).status).toBe(201)
    const before = await aliasRow(app)
    const reply = await invoke(app, undefined, { key })
    expect(reply.status).toBe(409); expect(reply.body.code).toBe('CODE_BUILD_ALIAS_CONFLICT')
    expect(JSON.stringify(reply.body)).not.toMatch(/NR-PA-030|타 부서 담당|build-other/)
    expect(await aliasRow(app)).toEqual(before)
    expect(await state(app, key)).toMatchObject({ logs: [], receipts: 0 })
  })

  it.each([false, true])('single-connection same-key interleaving (conflicting payload=%s) commits once', async changed => {
    const app = await fixture(), key = crypto.randomUUID()
    rendezvous()
    const replies = await Promise.all([invoke(app, undefined, { key }), invoke(app, payload(app, changed ? { canonical_code: 'NR-PA-030' } : {}), { key })])
    expect(replies.map(reply => reply.status).sort()).toEqual(changed ? [201, 409] : [201, 201])
    if (!changed) { expect(replies[0].body).toEqual(replies[1].body); expect(replies.map(reply => reply.replayed).sort()).toEqual(['0', '1']) }
    expect(await state(app, key)).toMatchObject({ aliases: [expect.any(Object)], logs: [expect.any(Object)], receipts: 1 })
  })

  it.each([false, true])('single-connection distinct intents (conflicting mapping=%s) preserve the winner', async changed => {
    const app = await fixture(), keys = [crypto.randomUUID(), crypto.randomUUID()], bodies = [payload(app), payload(app, changed ? { canonical_code: 'NR-PA-030' } : {})]
    rendezvous()
    const replies = await Promise.all(keys.map((key, index) => invoke(app, bodies[index], { key })))
    expect(replies.map(reply => reply.status).sort()).toEqual([201, 409])
    const winner = replies.findIndex(reply => reply.status === 201), loser = 1 - winner
    const before = await aliasRow(app)
    expect(before.canonical_code).toBe(bodies[winner].canonical_code)
    const retry = await invoke(app, bodies[loser], { key: keys[loser] })
    expect(retry.status).toBe(changed ? 409 : 201)
    if (!changed) expect(retry.body.already).toBe(true)
    expect(await aliasRow(app)).toEqual(before)
    expect((await state(app, keys[winner])).logs).toHaveLength(1)
  })

  it('keeps exact 80-character codes and rejects malformed identities before domain writes', async () => {
    const app = await fixture(); app.code = 'c'.repeat(80)
    expect((await invoke(app)).status).toBe(201)
    expect((await aliasRow(app)).external_code).toHaveLength(80)
    for (const change of [{ external_code: 'c'.repeat(81) }, { canonical_code: '__proto__' }, { canonical_code: [canonical] },
      { external_code: [] }, { note: 'n'.repeat(301) }, { channel: 1 }, { external_code: 'bad\0code' }]) {
      const bad = await fixture(), key = crypto.randomUUID()
      expect((await invoke(bad, payload(bad, change), { key })).status).toBe(400)
      expect(await state(bad, key)).toEqual(empty)
    }
  })

  it('isolates demo mappings and preserves the AX default teacher', async () => {
    const tokens = ['1'.repeat(64), '2'.repeat(64)], key = crypto.randomUUID(), code = 'same-demo-build-code'
    for (const token of tokens) {
      await DB.workspaceOpen(token, [])
      const database = createSupabaseDb(base, 'synthetic-only', token), app = await fixture(null, database); app.code = code
      const first = await invoke(app, payload(app, { taught_by: undefined }), { token, key })
      expect(first.status).toBe(201); expect(first.body.teacher).toBe('AX 담당자')
      expect(await invoke(app, payload(app, { taught_by: undefined }), { token, key })).toEqual({ ...first, replayed: '1' })
      expect((await state(app, key, database)).logs).toHaveLength(1)
    }
    expect((await DB.prepare('SELECT count(*) AS n FROM sku_alias WHERE external_code=?').bind(code).first()).n).toBe(0)
  })

  it('binds the receipt to the resolved application rather than its ticket URL spelling', async () => {
    const app = await fixture(), ticket = 'ticket-' + app.id, key = crypto.randomUUID()
    await DB.prepare('UPDATE application SET ticket_no=? WHERE id=?').bind(ticket, app.id).run()
    const first = await invoke(app, undefined, { key, routeId: ticket })
    expect(first.status).toBe(201)
    expect(await invoke(app, undefined, { key })).toEqual({ ...first, replayed: '1' })
    expect((await observed(app)).provenance).toEqual({ state: 'linked', applicationId: app.id })
  })

  it('retains a historical teacher in a prior receipt after a name-only account update', async () => {
    const app = await fixture(), key = crypto.randomUUID(), first = await invoke(app, undefined, { key })
    await pg.query("UPDATE override_actor SET display_name='Current renamed account' WHERE email=$1", [email])
    expect(await invoke(app, undefined, { key })).toEqual({ ...first, replayed: '1' })
    expect((await aliasRow(app)).taught_by).toBe(label)
  })

  it('rolls back when a real participation grant permits app reads but not decision writes', async () => {
    const app = await fixture('build-other@local.invalid'), key = crypto.randomUUID(), admin = 'build-admin@local.invalid'
    await pg.query("INSERT INTO override_actor(email,display_name,role,departments_json) VALUES($1,'검토 관리자','audit','[]')", [admin])
    await pg.query("UPDATE application SET dept='Other' WHERE id=$1", [app.id])
    await pg.query("UPDATE override_actor SET departments_json='[\"Finance\",\"재무\"]' WHERE email=$1", [email])
    const participation = 'build-participation-' + sequence
    await pg.exec('BEGIN')
    try {
      await pg.query("SELECT set_config('ilson.actor_email',$1,true)", [admin])
      await pg.query("INSERT INTO decision_log(id,application_id,stage,actor,title,what,why,link_kind,link_id) VALUES($1,$2,'협의안','human','검토 관리자','협의 참여','가상 참여 근거','같은건손듦','재무')", [participation, app.id])
      await pg.query("INSERT INTO application_participation(id,application_id,department_id,granted_by_email) VALUES($1,$2,'재무',$3)", [participation, app.id, admin])
      await pg.exec('COMMIT')
    } catch (error) { await pg.exec('ROLLBACK'); throw error }
    const before = await state(app, key)
    const reply = await invoke(app, undefined, { key })
    expect(reply.status).toBe(403); expect(reply.body.code).toBe('ACCESS_DENIED')
    expect(await state(app, key)).toEqual(before)
  })

  it('fails closed at the actual handler when the adapter has no atomic capability or mismatched scope', async () => {
    const app = await fixture(), key = crypto.randomUUID(), scoped = DB.forActor(email)
    for (const adapter of [
      { actorEmail: email, workspace: false, prepare: vi.fn(sql => scoped.prepare(sql)) },
      { actorEmail: 'other', workspace: false, prepare: vi.fn(sql => scoped.prepare(sql)), mutationReceipt: vi.fn(), commitMutation: vi.fn() },
      { actorEmail: email, workspace: true, prepare: vi.fn(sql => scoped.prepare(sql)), mutationReceipt: vi.fn(), commitMutation: vi.fn() },
    ]) {
      const response = await invoke(app, undefined, { key, adapter })
      expect(response.status).toBe(adapter.mutationReceipt ? 401 : 503)
      // The unchanged shared handler performs only its initial application lookup.
      expect(adapter.prepare).toHaveBeenCalledTimes(1)
      expect(adapter.prepare.mock.calls[0][0]).toMatch(/^SELECT id, ticket_no, dept, title, status FROM application/)
      if (adapter.mutationReceipt) expect(adapter.mutationReceipt).not.toHaveBeenCalled()
      if (adapter.commitMutation) expect(adapter.commitMutation).not.toHaveBeenCalled()
      expect(await state(app, key)).toEqual(empty)
    }
  })
})
