// @vitest-environment node
// Current signed middleware and SQL functions in disposable in-memory PG.
// The queued single connection tests interleaved HTTP requests, not a real
// multi-session PostgreSQL race or production throughput.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { createSupabaseDb } from '../functions/_lib/dbBridge.ts'
import { onRequest } from '../functions/api/_middleware.js'
import { onRequestGet as getCodes, onRequestPost as postCodes } from '../functions/api/codes.js'
import { logDecision } from '../functions/_lib/decisions.js'
import { decodeCodeReviewEvidence, CODE_REVIEW_PREFIX } from '../shared/codeReviewEvidence.ts'
import { SKU_BY_CODE } from '../shared/master.js'

const pg = new PGlite(), base = 'https://code-review-memory.supabase.co', issuer = 'https://code-review-memory.cloudflareaccess.com'
const DB = createSupabaseDb(base, 'synthetic-only'), operator = 'code-operator@local.invalid', admin = 'code-admin@local.invalid', other = 'code-other@local.invalid'
const label = '검증된 담당자', canonical = 'NR-CM-100', target = 'NR-PA-030'
const env = { DB, DBBridgeApplied: true, SUPABASE_URL: base, SUPABASE_SERVICE_ROLE_KEY: 'synthetic-only', ACCESS_TEAM_DOMAIN: issuer,
  ACCESS_AUD: 'code-review-memory', DEMO_WORKSPACES: 'false', OVERRIDE_DEMO_MODE: 'false' }
let pair, jwk, sequence = 0, queue = Promise.resolve(), beforeCommit = null, beforeAuthority = null, beforeReceipt = null, dropCommitResponse = false, barrier = null
const failures = []

beforeAll(async () => {
  await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;')
  const directory = new URL('../supabase/migrations/', import.meta.url)
  for (const file of readdirSync(directory).filter(name => /^\d+.*\.sql$/.test(name)).sort()) await pg.exec(readFileSync(new URL(file, directory), 'utf8'))
  pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])
  jwk = { ...await crypto.subtle.exportKey('jwk', pair.publicKey), kid: env.ACCESS_AUD, alg: 'RS256', use: 'sig' }
  await pg.query(`INSERT INTO override_actor(email,display_name,role,departments_json) VALUES($1,$2,'product','["Finance"]'),
    ($3,'검증된 관리자','audit','[]'),($4,'다른 담당자','product','["Other"]'),('code-reviewer@local.invalid','일반 사원','reviewer','["Finance"]')`, [operator, label, admin, other])
  vi.stubGlobal('fetch', (url, options) => {
    if (String(url) === issuer + '/cdn-cgi/access/certs') return Promise.resolve(Response.json({ keys: [jwk] }))
    if (!String(url).startsWith(base + '/rest/v1/rpc/')) throw Error('External network prohibited')
    const name = new URL(url).pathname.split('/').at(-1), args = JSON.parse(options.body), sql = args.p_sql ?? ''
    const task = queue.then(async () => {
      let response
      try {
        if (name === 'ilson_actor_commit' && beforeCommit) { const hook = beforeCommit; beforeCommit = null; await hook() }
        if (name === 'ilson_actor_receipt' && beforeReceipt) { const hook = beforeReceipt; beforeReceipt = null; await hook() }
        if (name === 'ilson_actor_query' && /^SELECT email,display_name,role,active/.test(sql) && beforeAuthority) { const hook = beforeAuthority; beforeAuthority = null; await hook() }
        await pg.exec('SET ROLE service_role')
        const values = Object.values(args)
        response = Response.json((await pg.query(`SELECT public.${name}(${values.map((_, index) => '$' + (index + 1)).join(',')}) AS data`, values)).rows[0].data)
      } catch (error) { failures.push({ name, code: error.code }); response = Response.json({ code: error.code }, { status: 400 }) }
      finally { await pg.exec('RESET ROLE') }
      if (name === 'ilson_actor_commit' && dropCommitResponse && response.ok) { dropCommitResponse = false; throw new TypeError('Synthetic response lost after commit') }
      return response
    })
    queue = task.catch(() => {})
    return task.then(async response => {
      if (barrier && name === 'ilson_actor_query' && /^SELECT \* FROM sku_alias WHERE external_code=/.test(sql)) {
        const current = barrier
        if (++current.reads === 2) current.release()
        await current.ready
      }
      return response
    })
  })
}, 60000)
afterEach(async () => {
  beforeCommit = null; beforeAuthority = null; beforeReceipt = null; dropCommitResponse = false; barrier = null; failures.length = 0
  vi.restoreAllMocks(); await queue
  await pg.exec('DELETE FROM public.rate_limit_hits; DELETE FROM ilson_private.actor_rate_tickets;')
  await pg.query(`UPDATE override_actor SET active=1,display_name=$2,role='product',departments_json='["Finance"]',product_ids_json='[]' WHERE email=$1`, [operator, label])
})
afterAll(async () => { await queue; vi.unstubAllGlobals(); await pg.close() })

async function jwt(email) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url'), now = Math.floor(Date.now() / 1000)
  const text = encode({ alg: 'RS256', kid: jwk.kid }) + '.' + encode({ iss: issuer, aud: [jwk.kid], email, iat: now, exp: now + 600 })
  return text + '.' + Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(text))).toString('base64url')
}
async function invoke(body, options = {}) {
  const method = options.method ?? 'POST', key = options.key === undefined ? crypto.randomUUID() : options.key, identity = options.email ?? operator
  const database = options.token ? createSupabaseDb(base, 'synthetic-only', options.token) : DB.forActor(identity)
  const headers = { 'Content-Type': 'application/json', Origin: options.origin ?? 'https://local.invalid', 'X-Ilson-Request': '1',
    'X-Ilson-Scope': await database.toolRunScope(), 'CF-Connecting-IP': key ?? 'missing' }
  if (key !== null) headers['X-Idempotency-Key'] = key
  if (options.token) headers.Cookie = 'ilson_workspace=' + options.token
  else headers['Cf-Access-Jwt-Assertion'] = await jwt(identity)
  const context = { env: options.token ? { ...env, DEMO_WORKSPACES: 'true', OVERRIDE_DEMO_MODE: 'true' } : env,
    request: new Request('https://local.invalid/api/codes', { method, headers, ...(method === 'GET' ? {} : { body: options.raw ?? JSON.stringify(body) }) }), data: {} }
  context.next = forwarded => (method === 'GET' ? getCodes : postCodes)({ env: context.env, data: context.data, request: forwarded ?? context.request })
  const response = await onRequest(context)
  return { status: response.status, body: await response.json(), replayed: response.headers.get('X-Idempotency-Replayed') }
}
async function createApplication(owner = operator, database = DB) {
  const id = 'code-app-' + (++sequence)
  await database.prepare(`INSERT INTO application(id,ticket_no,dept,applicant_label,title,bottleneck,problem,status,owner_email)
    VALUES(?,?,?,'가상 신청자','가상 업무','취합','반복 업무','수용',?)`).bind(id, id, owner === other ? 'Other' : 'Finance', owner).run()
  return id
}
async function origin(app, applicationId, database = DB) {
  return logDecision({ DB: database }, { applicationId, stage: '배포', title: label, what: app.code + ' 상품 연결', why: '가상 상품 연결 요청', linkKind: '코드알림', linkId: app.code })
}
async function fixture(options = {}) {
  const database = options.database ?? DB, app = { code: options.code ?? 'review-code-' + (++sequence), id: await createApplication(options.owner ?? operator, database) }
  await database.prepare('INSERT INTO sku_alias(external_code,canonical_code,product_name,taught_by,owner_email,created_at) VALUES(?,?,?,?,?,?)')
    .bind(app.code, canonical, SKU_BY_CODE[canonical].name_ko, label, options.owner ?? operator, '2026-10-04 01:02:03').run()
  if (options.linked !== false) await origin(app, app.id, database)
  return app
}
async function row(app, options = {}) {
  const result = await invoke(null, { ...options, method: 'GET' })
  expect(result.status).toBe(200)
  return result.body.codes.find(item => item.external_code === app.code)
}
function command(app, observed, action = 'confirm', changes = {}) {
  return { externalCode: app.code, expectedVersion: observed.edit_version, action,
    ...(action === 'correct' ? { canonicalCode: target, why: '표시된 상품과 원본 상품의 연결이 달라 정정합니다.' } : {}), ...changes }
}
async function state(app, key, database = DB) {
  return { alias: await database.prepare('SELECT * FROM sku_alias WHERE external_code=?').bind(app.code).first(),
    reviews: (await database.prepare('SELECT * FROM decision_log WHERE link_id=? AND link_kind IN (?,?) ORDER BY created_at,id').bind(app.code, '코드확인', '코드정정').all()).results,
    receipts: Number((await pg.query('SELECT count(*) AS n FROM ilson_private.mutation_receipts WHERE request_id=$1', [key])).rows[0].n) }
}
function rendezvous() { let release; const ready = new Promise(resolve => { release = resolve }); barrier = { reads: 0, ready, release } }

describe.sequential('current codes review evidence at the actual SQL boundary', () => {
  it('connects ordinary confirmation to its exact scoped teaching origin and verifies only the reviewed mapping', async () => {
    const app = await fixture(), observed = await row(app), key = crypto.randomUUID()
    expect(observed).toMatchObject({ review_available: true, review_reason: null, needsCheck: true })
    expect(observed.edit_version).toMatch(/^[a-f0-9]{64}$/); expect(observed.mapping_revision).toMatch(/^[a-f0-9]{64}$/)
    const first = await invoke(command(app, observed, 'confirm', { author: { fake: true }, applicationId: 'not-this-app' }), { key })
    expect(first.body).toMatchObject({ ok: true, action: 'confirm', externalCode: app.code, canonicalCode: canonical, author: label })
    const saved = await state(app, key), record = saved.reviews[0]
    expect(saved.receipts).toBe(1); expect(saved.reviews).toHaveLength(1); expect(record.application_id).toBe(app.id); expect(record.title).toBe(label)
    expect(record.why).toBe('표시된 상품 연결이 맞다고 확인했습니다.')
    expect(decodeCodeReviewEvidence(record.alternatives, record)).toMatchObject({ action: 'confirm', reviewedMappingRevision: observed.mapping_revision, provenance: { state: 'linked', applicationId: app.id } })
    const current = await row(app)
    expect(current.mapping_revision).toBe(observed.mapping_revision); expect(current.edit_version).not.toBe(observed.edit_version)
    expect(current.confirmed).toMatchObject({ by: label, verified: true, legacy: false }); expect(current.needsCheck).toBe(false)
    const retry = await invoke(command(app, observed, 'confirm', { author: 'different caller' }), { key })
    expect(retry).toEqual({ ...first, replayed: '1' }); expect(await state(app, key)).toEqual(saved)
  })

  it('corrects alias and provenance together then requires a fresh confirmation', async () => {
    const app = await fixture(), observed = await row(app), key = crypto.randomUUID()
    const reply = await invoke(command(app, observed, 'correct'), { key })
    expect(reply.status).toBe(200); expect(reply.body).toMatchObject({ action: 'correct', canonicalCode: target, productName: SKU_BY_CODE[target].name_ko, author: label })
    const saved = await state(app, key)
    expect(saved.alias.canonical_code).toBe(target); expect(saved.alias.created_at).not.toBe(observed.created_at)
    expect(saved.reviews).toHaveLength(1); expect(saved.reviews[0].application_id).toBe(app.id); expect(saved.receipts).toBe(1)
    const current = await row(app)
    expect(current.mapping_revision).not.toBe(observed.mapping_revision); expect(current.needsCheck).toBe(true)
    const stale = await invoke(command(app, observed), { key: crypto.randomUUID() })
    expect(stale.status).toBe(409); expect(stale.body.code).toBe('CODE_REVIEW_CONFLICT')
    expect(await state(app, key)).toEqual(saved)
  })

  it.each([false, 'hidden', 'multiple'])('ordinary missing/inaccessible/ambiguous origin %s fails before review or mapping writes', async mode => {
    const app = await fixture({ linked: mode === 'multiple' })
    if (mode === 'hidden') await origin(app, await createApplication(other))
    if (mode === 'multiple') await origin(app, await createApplication(operator))
    const observed = await row(app), key = crypto.randomUUID(), before = await state(app, key)
    expect(observed.review_available).toBe(false)
    expect(observed.review_reason).toBe(mode === 'multiple' ? 'origin_ambiguous' : 'origin_unavailable')
    for (const action of ['confirm', 'correct']) {
      const reply = await invoke(command(app, observed, action, { applicationId: app.id }), { key })
      expect(reply.status).toBe(409); expect(reply.body.code).toBe('CODE_REVIEW_UNAVAILABLE')
      expect(await state(app, key)).toEqual(before)
    }
  })

  it('uses only the scoped visible origin for ordinary actors, while admin detects the mixed hidden ambiguity and blocks', async () => {
    const app = await fixture(); await origin(app, await createApplication(other))
    const observed = await row(app), adminView = await row(app, { email: admin })
    expect(observed.provenance).toEqual({ state: 'linked', applicationId: app.id }); expect(observed.review_available).toBe(true)
    expect(adminView.review_reason).toBe('origin_ambiguous'); expect(adminView.review_available).toBe(false)
    const key = crypto.randomUUID(), before = await state(app, key)
    expect((await invoke(command(app, adminView, 'correct'), { email: admin, key })).status).toBe(409)
    expect(await state(app, key)).toEqual(before)
  })

  it('preserves admin null-application authority honestly when origin is absent and prefers a real single origin when present', async () => {
    for (const linked of [false, true]) {
      const app = await fixture({ linked }), observed = await row(app, { email: admin }), key = crypto.randomUUID()
      expect(observed.review_available).toBe(true); expect(observed.review_reason).toBe(linked ? null : 'origin_unknown_admin')
      const reply = await invoke(command(app, observed, 'correct'), { email: admin, key })
      expect(reply.status).toBe(200)
      const saved = await state(app, key), record = saved.reviews[0]
      expect(record.application_id).toBe(linked ? app.id : null)
      expect(decodeCodeReviewEvidence(record.alternatives, record).provenance).toEqual(linked ? { state: 'linked', applicationId: app.id } : { state: 'unknown', applicationId: null })
    }
  })

  it.each(['confirm', 'correct'])('rolls %s alias/log/receipt back on actual audit failure and preserves branded access denial', async action => {
    const app = await fixture(), observed = await row(app), key = crypto.randomUUID(), before = await state(app, key)
    for (const sqlstate of ['23514', '42501']) {
      await pg.exec(`CREATE FUNCTION reject_code_review_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.link_kind IN ('코드확인','코드정정') THEN RAISE EXCEPTION 'Synthetic review failure' USING ERRCODE='${sqlstate}'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER reject_code_review_test BEFORE INSERT ON public.decision_log FOR EACH ROW EXECUTE FUNCTION reject_code_review_test();`)
      try {
        const reply = await invoke(command(app, observed, action), { key })
        expect(reply.status).toBe(sqlstate === '42501' ? 403 : 503)
        if (sqlstate === '42501') expect(reply.body.code).toBe('ACCESS_DENIED')
        expect(await state(app, key)).toEqual(before)
      } finally { await pg.exec('DROP TRIGGER reject_code_review_test ON public.decision_log; DROP FUNCTION reject_code_review_test();') }
    }
  })

  it.each(['confirm', 'correct'])('recovers lost %s response with the original receipt and never repeats a review', async action => {
    const app = await fixture(), observed = await row(app), key = crypto.randomUUID(), body = command(app, observed, action)
    dropCommitResponse = true
    expect((await invoke(body, { key })).status).toBe(503)
    const saved = await state(app, key); expect(saved.reviews).toHaveLength(1); expect(saved.receipts).toBe(1)
    const original = (await pg.query('SELECT response FROM ilson_private.mutation_receipts WHERE request_id=$1', [key])).rows[0].response
    const reply = await invoke(body, { key }); expect(reply.status).toBe(200); expect(reply.replayed).toBe('1'); expect(reply.body).toEqual(original.body)
    expect(await state(app, key)).toEqual(saved)
    expect((await invoke({ ...body, why: '같은 키에서 다른 이유로 변경합니다.' }, { key })).status).toBe(409)
    expect(await state(app, key)).toEqual(saved)
  })

  it.each([
    ['active', () => pg.query('UPDATE override_actor SET active=0 WHERE email=$1', [operator]), 401, 'ACCESS_REVOKED'],
    ['role', () => pg.query("UPDATE override_actor SET role='reviewer' WHERE email=$1", [operator]), 409],
    ['name', () => pg.query("UPDATE override_actor SET display_name='Changed' WHERE email=$1", [operator]), 409],
    ['department', () => pg.query("UPDATE override_actor SET departments_json='[]' WHERE email=$1", [operator]), 409],
    ['revision', () => pg.query("UPDATE override_actor SET updated_at='changed-permission' WHERE email=$1", [operator]), 409],
  ])('rechecks actor %s during commit without partial changes', async (_name, change, status, code) => {
    const app = await fixture(), observed = await row(app), key = crypto.randomUUID(), before = await state(app, key)
    beforeCommit = change
    const reply = await invoke(command(app, observed, 'correct'), { key })
    expect(reply.status).toBe(status); if (code) expect(reply.body.code).toBe(code)
    expect(await state(app, key)).toEqual(before)
  })

  it('allows a currently permitted role/name changed before its first authority read, but rejects a forbidden role', async () => {
    const app = await fixture(), observed = await row(app), key = crypto.randomUUID()
    beforeAuthority = () => pg.query("UPDATE override_actor SET role='engineer',display_name='현재 이름' WHERE email=$1", [operator])
    const reply = await invoke(command(app, observed, 'correct'), { key })
    expect(reply.status).toBe(200); expect(reply.body.author).toBe('현재 이름')
    await pg.query("UPDATE override_actor SET role='product' WHERE email=$1", [operator])
    const another = await fixture(), view = await row(another), deniedKey = crypto.randomUUID(), before = await state(another, deniedKey)
    beforeAuthority = () => pg.query("UPDATE override_actor SET role='reviewer' WHERE email=$1", [operator])
    expect((await invoke(command(another, view), { key: deniedKey })).status).toBe(403); expect(await state(another, deniedKey)).toEqual(before)
  })

  it('rejects a receipt after permission revision or account revocation', async () => {
    const app = await fixture(), observed = await row(app), key = crypto.randomUUID(), body = command(app, observed)
    expect((await invoke(body, { key })).status).toBe(200); const saved = await state(app, key)
    beforeReceipt = () => pg.query("UPDATE override_actor SET role='engineer' WHERE email=$1", [operator])
    expect((await invoke(body, { key })).status).toBe(409)
    await pg.query('UPDATE override_actor SET active=0 WHERE email=$1', [operator])
    expect((await invoke(body, { key })).status).toBe(401); expect(await state(app, key)).toEqual(saved)
  })

  it('detects changed alias, review history or newly ambiguous origins at commit', async () => {
    for (const change of [
      app => pg.query('UPDATE sku_alias SET note=$2 WHERE external_code=$1', [app.code, 'changed-note']),
      app => pg.query(`INSERT INTO decision_log(id,application_id,stage,actor,title,what,why,link_kind,link_id)
        VALUES($1,$2,'제작','human','Concurrent','다른 검토','다른 검토 근거','코드확인',$3)`, [crypto.randomUUID(), app.id, app.code]),
      async app => {
        const id = 'code-concurrent-app-' + (++sequence)
        await pg.query(`INSERT INTO application(id,ticket_no,dept,applicant_label,title,bottleneck,problem,status,owner_email)
          VALUES($1,$1,'Finance','가상 신청자','가상 업무','취합','반복 업무','수용',$2)`, [id, operator])
        await pg.query(`INSERT INTO decision_log(id,application_id,stage,actor,title,what,why,link_kind,link_id)
          VALUES($1,$2,'배포','human','Concurrent','추가 연결','추가 연결 근거','코드알림',$3)`, [crypto.randomUUID(), id, app.code])
      },
    ]) {
      const app = await fixture(), observed = await row(app), key = crypto.randomUUID(), before = await state(app, key)
      // Hooks use direct memory SQL only: starting nested RPC on this queued
      // connection would deadlock. The helper builds equivalent fixture SQL.
      beforeCommit = () => change(app)
      const reply = await invoke(command(app, observed, 'correct'), { key })
      expect(reply.status).toBe(409)
      const after = await state(app, key); expect(after.alias.canonical_code).toBe(before.alias.canonical_code); expect(after.receipts).toBe(0)
      expect(after.reviews.filter(record => record.link_kind === '코드정정')).toHaveLength(0)
    }
  })

  it('protects same-second A→B→A within review history even if an outside fixture restores the old alias snapshot', async () => {
    const app = await fixture(), initial = await row(app), fixed = Date.parse(initial.created_at.replace(' ', 'T') + 'Z')
    vi.spyOn(Date, 'now').mockReturnValue(fixed)
    expect((await invoke(command(app, initial))).status).toBe(200)
    const confirmed = await row(app)
    expect((await invoke(command(app, confirmed, 'correct'))).status).toBe(200)
    const b = await row(app)
    expect((await invoke(command(app, b, 'correct', { canonicalCode: canonical }))).status).toBe(200)
    const aAgain = await row(app)
    expect(Date.parse(aAgain.created_at)).toBeGreaterThan(Date.parse(b.created_at))
    expect(aAgain.mapping_revision).not.toBe(confirmed.mapping_revision); expect(aAgain.confirmed.verified).toBe(false); expect(aAgain.needsCheck).toBe(true)
    await DB.prepare('UPDATE sku_alias SET created_at=? WHERE external_code=?').bind(initial.created_at, app.code).run()
    const restored = await row(app)
    expect(restored.mapping_revision).not.toBe(confirmed.mapping_revision)
    expect((await invoke(command(app, confirmed))).status).toBe(409); expect(restored.needsCheck).toBe(true)
  })

  it('retains legacy and malformed confirmation history without declaring it verified', async () => {
    const app = await fixture()
    for (const alternatives of ['과거 대안 원문', CODE_REVIEW_PREFIX + '{"version":9}']) {
      await logDecision({ DB }, { applicationId: app.id, stage: '제작', title: 'AX 담당자', what: '과거 확인 내용', why: '과거 확인 근거', alternatives, linkKind: '코드확인', linkId: app.code })
      const observed = await row(app)
      expect(observed.needsCheck).toBe(true); expect(observed.confirmed.verified).toBe(false)
    }
  })

  it.each(['__proto__', 'NR-XX-999'])('never promotes unknown or inherited canonical %s to a verified mapping', async corrupt => {
    const app = await fixture(), key = crypto.randomUUID()
    await DB.prepare('UPDATE sku_alias SET canonical_code=? WHERE external_code=?').bind(corrupt, app.code).run()
    const observed = await row(app), before = await state(app, key)
    expect(observed.review_available).toBe(false); expect(observed.review_reason).toBe('invalid_mapping')
    expect(observed.needsCheck).toBe(true)
    for (const action of ['confirm', 'correct']) {
      const reply = await invoke(command(app, observed, action), { key })
      expect(reply.status).toBe(409); expect(reply.body.review_reason).toBe('invalid_mapping')
      expect(await state(app, key)).toEqual(before)
    }
  })

  it('single-connection synthetic same-key concurrency records one review and returns the same body', async () => {
    const app = await fixture(), observed = await row(app), key = crypto.randomUUID(), body = command(app, observed, 'correct')
    rendezvous(); const replies = await Promise.all([invoke(body, { key }), invoke(body, { key })])
    expect(replies.map(reply => reply.status)).toEqual([200, 200]); expect(replies[0].body).toEqual(replies[1].body)
    expect(replies.map(reply => reply.replayed).sort()).toEqual(['0', '1'])
    const saved = await state(app, key); expect(saved.reviews).toHaveLength(1); expect(saved.receipts).toBe(1)
  })

  it('single-connection synthetic different-key stale intents cannot overwrite the winner or confirm unseen mapping', async () => {
    const app = await fixture(), observed = await row(app), keys = [crypto.randomUUID(), crypto.randomUUID()]
    rendezvous(); const replies = await Promise.all([invoke(command(app, observed, 'correct'), { key: keys[0] }), invoke(command(app, observed), { key: keys[1] })])
    expect(replies.map(reply => reply.status).sort()).toEqual([200, 409])
    const saved = await state(app, keys[0]); expect(saved.reviews).toHaveLength(1)
    const loser = replies.findIndex(reply => reply.status !== 200); expect((await state(app, keys[loser])).receipts).toBe(0)
  })

  it('keeps hidden aliases, reviewer and foreign-Origin access boundaries without exposing hidden mapping values', async () => {
    const app = await fixture({ owner: other }), observed = await row(app, { email: admin }), key = crypto.randomUUID(), before = await state(app, key)
    const hidden = await invoke(command(app, observed, 'correct'), { key })
    expect(hidden.status).toBe(404); expect(JSON.stringify(hidden.body)).not.toMatch(/NR-CM|NR-PA|code-other/)
    expect((await invoke(command(app, observed), { key, email: 'code-reviewer@local.invalid' })).status).toBe(403)
    expect((await invoke(command(app, observed), { key, origin: 'https://other.invalid' })).status).toBe(403)
    expect(await state(app, key)).toEqual(before)
  })

  it('validates exact input and keys before domain/log/receipt writes without truncating identities', async () => {
    const app = await fixture(), observed = await row(app), key = crypto.randomUUID(), before = await state(app, key)
    for (const changes of [{ externalCode: [] }, { externalCode: 'x'.repeat(81) }, { externalCode: 'bad\0code' }, { externalCode: 'bad\ud800code' },
      { action: ' confirm ' }, { expectedVersion: 'short' }, { canonicalCode: [] }, { why: null }, { why: 'x'.repeat(2001) }]) {
      const reply = await invoke({ ...command(app, observed, 'correct'), ...changes }, { key })
      expect(reply.status).toBe(400); expect(await state(app, key)).toEqual(before)
    }
    for (const options of [{ raw: 'null' }, { raw: '[]' }, { raw: '{' }, { key: null }, { key: 'short' }]) expect((await invoke(command(app, observed), options)).status).toBe(400)
    const exact = await fixture({ code: 'x'.repeat(80) })
    expect((await invoke(command(exact, await row(exact)))).status).toBe(200)
  })

  it('handles invalid writer time and rejects Date maximum advance without partial correction', async () => {
    for (const timestamp of ['invalid-legacy-time', '+275760-09-13T00:00:00.000Z']) {
      const app = await fixture(); await DB.prepare('UPDATE sku_alias SET created_at=? WHERE external_code=?').bind(timestamp, app.code).run()
      const observed = await row(app), key = crypto.randomUUID(), before = await state(app, key)
      const reply = await invoke(command(app, observed, 'correct'), { key })
      expect(reply.status).toBe(timestamp.startsWith('+') ? 409 : 200)
      if (timestamp.startsWith('+')) expect(await state(app, key)).toEqual(before)
      else expect((await state(app, key)).alias.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    }
  })

  it('isolates demo intent receipts and preserves its AX label without inventing a business origin', async () => {
    const key = crypto.randomUUID()
    for (const token of ['a'.repeat(64), 'b'.repeat(64)]) {
      await DB.workspaceOpen(token, [])
      const database = createSupabaseDb(base, 'synthetic-only', token), app = await fixture({ database, linked: false, code: 'shared-demo-code' })
      const observed = await row(app, { token }), body = command(app, observed, 'correct'), reply = await invoke(body, { token, key })
      expect(observed.review_reason).toBe('origin_unknown_admin'); expect(reply.status).toBe(200); expect(reply.body.author).toBe('AX 담당자')
      expect(await invoke(body, { token, key })).toEqual({ ...reply, replayed: '1' })
      const saved = await state(app, key, database); expect(saved.reviews).toHaveLength(1); expect(saved.reviews[0].application_id).toBeNull()
    }
    expect((await DB.prepare('SELECT count(*) AS n FROM sku_alias WHERE external_code=?').bind('shared-demo-code').first()).n).toBe(0)
    expect(Number((await pg.query('SELECT count(*) AS n FROM ilson_private.mutation_receipts WHERE request_id=$1', [key])).rows[0].n)).toBe(2)
  })

  it('fails closed on an adapter without atomic receipts', async () => {
    const prepare = vi.fn(() => { throw Error('Unsupported adapter SQL') })
    const request = new Request('https://local.invalid/api/codes', { method: 'POST', headers: { 'X-Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ externalCode: 'code', action: 'confirm', expectedVersion: 'a'.repeat(64) }) })
    expect((await postCodes({ env: { DB: { prepare }, DEMO_WORKSPACE: true }, request })).status).toBe(503)
    expect(prepare).not.toHaveBeenCalled()
  })
})
