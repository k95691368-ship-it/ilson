// @vitest-environment node
// Actual signed middleware + current SQL functions in disposable memory PG.
// The RPC queue models interleaved HTTP requests on ONE database connection;
// it is not a multi-session PostgreSQL concurrency or production load test.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { createSupabaseDb } from '../functions/_lib/dbBridge.ts'
import { onRequest } from '../functions/api/_middleware.js'
import { onRequestPost as teach } from '../functions/api/tools/[slug]/teach.js'
import { runPipeline } from '../shared/pipeline.js'
import { readLocalFiles } from '../src/lib/readFiles.js'

const pg = new PGlite(), base = 'https://teach-mutation-memory.supabase.co'
const issuer = 'https://teach-mutation-memory.cloudflareaccess.com'
const DB = createSupabaseDb(base, 'synthetic-only'), email = 'teach-operator@local.invalid', label = '검증된 담당자'
const canonical = 'NR-CM-100'
const env = { DB, DBBridgeApplied: true, SUPABASE_URL: base, SUPABASE_SERVICE_ROLE_KEY: 'synthetic-only',
  ACCESS_TEAM_DOMAIN: issuer, ACCESS_AUD: 'teach-memory', DEMO_WORKSPACES: 'false', OVERRIDE_DEMO_MODE: 'false' }
let pair, jwk, queue = Promise.resolve(), sequence = 0, beforeCommit = null, beforeActorRead = null, dropCommitResponse = false, barrier = null
const failures = []

beforeAll(async () => {
  await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;')
  const directory = new URL('../supabase/migrations/', import.meta.url)
  for (const file of readdirSync(directory).filter(name => /^\d+.*\.sql$/.test(name)).sort()) await pg.exec(readFileSync(new URL(file, directory), 'utf8'))
  pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])
  jwk = { ...await crypto.subtle.exportKey('jwk', pair.publicKey), kid: env.ACCESS_AUD, alg: 'RS256', use: 'sig' }
  await pg.query(`INSERT INTO override_actor(email,display_name,role,departments_json) VALUES
    ($1,$2,'product','["Finance"]'),('teach-reviewer@local.invalid','일반 사원','reviewer','["Finance"]'),
    ('teach-other@local.invalid','타 부서 담당','product','["Other"]')`, [email, label])
  vi.stubGlobal('fetch', (url, options) => {
    if (String(url) === issuer + '/cdn-cgi/access/certs') return Promise.resolve(Response.json({ keys: [jwk] }))
    if (!String(url).startsWith(base + '/rest/v1/rpc/')) throw Error('External network prohibited')
    const name = new URL(url).pathname.split('/').at(-1), args = JSON.parse(options.body)
    const sql = args.p_sql ?? args.p_query ?? ''
    const task = queue.then(async () => {
      let response
      try {
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
      if (barrier && name === 'ilson_actor_query' && /^SELECT canonical_code, taught_by FROM sku_alias/.test(sql)) {
        const current = barrier
        if (++current.reads === 2) current.release()
        await current.ready
      }
      return response
    })
  })
}, 60000)

afterEach(async () => {
  beforeCommit = null; beforeActorRead = null; dropCommitResponse = false; barrier = null; failures.length = 0
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
  const app = { id: 'teach-app-' + (++sequence), slug: 'teach-tool-' + sequence, code: 'teach-code-' + sequence }
  await database.prepare(`INSERT INTO application(id,ticket_no,dept,applicant_label,title,bottleneck,problem,status,owner_email)
    VALUES(?,?,'Finance','가상 신청자','검증 신청','취합','반복 업무','수용',?)`).bind(app.id, app.id, owner).run()
  await database.prepare(`INSERT INTO handover(application_id,slug,title,handed_to_dept,handed_to_person)
    VALUES(?,?,'검증 도구','Finance','가상 신청자')`).bind(app.id, app.slug).run()
  return app
}
const payload = (app, changes) => ({ externalCode: app.code, canonicalCode: canonical, teacher: '사칭 작성자', affected: 1, ...changes })
async function invoke(app, body = payload(app), options = {}) {
  const key = options.key === undefined ? crypto.randomUUID() : options.key
  const identity = options.email ?? email, database = options.token ? createSupabaseDb(base, 'synthetic-only', options.token) : DB.forActor(identity)
  const headers = { 'Content-Type': 'application/json', Origin: options.origin ?? 'https://local.invalid', 'X-Ilson-Request': '1',
    'X-Ilson-Scope': await database.toolRunScope(), 'CF-Connecting-IP': key ?? 'missing' }
  if (key !== null) headers['X-Idempotency-Key'] = key
  if (options.token) headers.Cookie = 'ilson_workspace=' + options.token
  else headers['Cf-Access-Jwt-Assertion'] = await jwt(identity)
  const context = { env: options.token ? { ...env, DEMO_WORKSPACES: 'true', OVERRIDE_DEMO_MODE: 'true' } : env,
    request: new Request('https://local.invalid/api/tools/' + app.slug + '/teach', { method: 'POST', headers, body: options.raw ?? JSON.stringify(body) }), data: {} }
  context.next = forwarded => teach({ env: context.env, data: context.data, params: { slug: app.slug }, request: forwarded ?? context.request })
  const response = await onRequest(context)
  return { status: response.status, body: await response.json(), replayed: response.headers.get('X-Idempotency-Replayed') }
}
async function state(app, key, database = DB) {
  return { aliases: (await database.prepare('SELECT external_code,canonical_code,taught_by,owner_email FROM sku_alias WHERE external_code=?').bind(app.code).all()).results,
    logs: (await database.prepare('SELECT title,what,why,link_id FROM decision_log WHERE application_id=? ORDER BY id').bind(app.id).all()).results,
    receipts: Number((await pg.query('SELECT count(*) AS n FROM ilson_private.mutation_receipts WHERE request_id=$1', [key])).rows[0].n) }
}
const empty = { aliases: [], logs: [], receipts: 0 }
function rendezvous() {
  let release
  const ready = new Promise(resolve => { release = resolve })
  barrier = { reads: 0, ready, release }
}

describe.sequential('atomic teaching evidence and intent receipts', () => {
  it('records the current verified account and replays normalized intent despite forged teacher changes', async () => {
    const app = await fixture(), key = crypto.randomUUID()
    const first = await invoke(app, payload(app, { teacher: { fake: true } }), { key })
    const replay = await invoke(app, payload(app, { externalCode: ' ' + app.code + ' ', canonicalCode: ' nr-cm-100 ', teacher: ['another'], ignored: 'unused' }), { key })
    expect(first.status).toBe(200); expect(first.body).toMatchObject({ ok: true, already: false, affected: 1, teacher: label })
    expect(replay).toEqual({ ...first, replayed: '1' })
    const saved = await state(app, key)
    expect(saved.aliases).toEqual([{ external_code: app.code, canonical_code: canonical, taught_by: label, owner_email: email }])
    expect(saved.logs).toHaveLength(1); expect(saved.logs[0].title).toBe(label); expect(saved.receipts).toBe(1)
    expect(first.body.next).toBe('다음 계산부터 상품 연결이 반영됩니다. 다른 오류가 있는 줄은 계속 격리됩니다.')
    expect(saved.logs[0].why).toContain('요청에서 미등록 1줄을 알려줬습니다.')
    for (const content of [app.code.toUpperCase(), 'another-code']) {
      expect((await invoke(app, payload(app, { externalCode: content }), { key })).status).toBe(409)
    }
    for (const change of [{ affected: 2 }, { channel: 'new-channel' }, { note: 'different-note' }, { canonicalCode: 'NR-PA-030' }]) {
      expect((await invoke(app, payload(app, change), { key })).status).toBe(409)
    }
    expect(await state(app, key)).toEqual(saved)
  })

  it('keeps an existing same mapping untouched and gives each new intent its receipt without reconstructing old evidence', async () => {
    const app = await fixture(), key = crypto.randomUUID()
    await DB.prepare('INSERT INTO sku_alias(external_code,canonical_code,taught_by,owner_email) VALUES(?,?,?,?)').bind(app.code, canonical, '기존 기록자', email).run()
    const first = await invoke(app, undefined, { key }), replay = await invoke(app, undefined, { key })
    const differentKey = crypto.randomUUID(), same = await invoke(app, undefined, { key: differentKey })
    expect(first.body).toMatchObject({ ok: true, already: true, teacher: '기존 기록자', affected: 0 })
    expect(replay).toEqual({ ...first, replayed: '1' }); expect(same.body).toEqual(first.body)
    expect(await state(app, key)).toMatchObject({ logs: [], receipts: 1 })
    expect(await state(app, differentKey)).toMatchObject({ logs: [], receipts: 1 })
    expect((await invoke(app, payload(app, { canonicalCode: 'NR-PA-030' }))).status).toBe(409)
  })

  it('does not fabricate a teacher for legacy null attribution', async () => {
    const app = await fixture()
    await DB.prepare('INSERT INTO sku_alias(external_code,canonical_code,owner_email) VALUES(?,?,?)').bind(app.code, canonical, email).run()
    const reply = await invoke(app)
    expect(reply.status).toBe(200); expect(reply.body).not.toHaveProperty('teacher')
  })

  it('rolls alias, decision and receipt back together on a real audit trigger failure', async () => {
    const app = await fixture(), key = crypto.randomUUID()
    await pg.exec(`CREATE FUNCTION reject_teach_audit_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.link_kind='코드알림' THEN RAISE EXCEPTION 'Synthetic audit failure' USING ERRCODE='23514'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER reject_teach_audit_test BEFORE INSERT ON public.decision_log FOR EACH ROW EXECUTE FUNCTION reject_teach_audit_test();`)
    try {
      expect((await invoke(app, undefined, { key })).status).toBe(503)
      expect(await state(app, key)).toEqual(empty)
    } finally { await pg.exec('DROP TRIGGER reject_teach_audit_test ON public.decision_log; DROP FUNCTION reject_teach_audit_test();') }
    expect((await invoke(app, undefined, { key })).status).toBe(200)
    expect(await state(app, key)).toMatchObject({ aliases: [expect.any(Object)], logs: [expect.any(Object)], receipts: 1 })
  })

  it('recovers a lost committed response using the original success rather than an already reply', async () => {
    const app = await fixture(), key = crypto.randomUUID()
    dropCommitResponse = true
    expect((await invoke(app, undefined, { key })).status).toBe(503)
    const saved = await state(app, key)
    expect(saved.aliases).toHaveLength(1); expect(saved.logs).toHaveLength(1); expect(saved.receipts).toBe(1)
    const original = (await pg.query('SELECT response FROM ilson_private.mutation_receipts WHERE request_id=$1', [key])).rows[0].response
    const retry = await invoke(app, undefined, { key })
    expect(retry.status).toBe(200); expect(retry.replayed).toBe('1'); expect(retry.body).toEqual(original.body)
    expect(retry.body.already).toBe(false); expect(await state(app, key)).toEqual(saved)
  })

  it('preserves a real scoped 42501 access failure instead of turning it into a conflict or generic save error', async () => {
    const app = await fixture(), key = crypto.randomUUID()
    await pg.exec(`CREATE FUNCTION deny_teach_audit_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.link_kind='코드알림' THEN RAISE EXCEPTION 'Synthetic scoped permission denied' USING ERRCODE='42501'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER deny_teach_audit_test BEFORE INSERT ON public.decision_log FOR EACH ROW EXECUTE FUNCTION deny_teach_audit_test();`)
    try {
      const reply = await invoke(app, undefined, { key })
      expect(reply.status).toBe(403); expect(reply.body.code).toBe('ACCESS_DENIED')
      expect(await state(app, key)).toEqual(empty)
    } finally { await pg.exec('DROP TRIGGER deny_teach_audit_test ON public.decision_log; DROP FUNCTION deny_teach_audit_test();') }
  })

  it.each([
    ['active', () => pg.query('UPDATE override_actor SET active=0 WHERE email=$1', [email]), 401, 'ACCESS_REVOKED'],
    ['role', () => pg.query("UPDATE override_actor SET role='reviewer' WHERE email=$1", [email]), 409],
    ['name', () => pg.query("UPDATE override_actor SET display_name='변경된 이름' WHERE email=$1", [email]), 409],
    ['department', () => pg.query("UPDATE override_actor SET departments_json='[]' WHERE email=$1", [email]), 409],
    ['products', () => pg.query("UPDATE override_actor SET product_ids_json='[\"another-product\"]' WHERE email=$1", [email]), 409],
    ['updated_at', () => pg.query("UPDATE override_actor SET updated_at='permission-revision' WHERE email=$1", [email]), 409],
  ])('rejects current %s changes after the authority read with no partial save', async (_field, change, status, code) => {
    const app = await fixture(), key = crypto.randomUUID()
    beforeCommit = change
    const reply = await invoke(app, undefined, { key })
    expect(beforeCommit).toBeNull(); expect(reply.status).toBe(status)
    if (code) expect(reply.body.code).toBe(code)
    expect(await state(app, key)).toEqual(empty)
  })

  it('blocks a changed handover between read and commit', async () => {
    const app = await fixture(), key = crypto.randomUUID()
    beforeCommit = () => pg.query("UPDATE handover SET rolled_back_at='stopped' WHERE application_id=$1", [app.id])
    expect((await invoke(app, undefined, { key })).status).toBe(409)
    expect(await state(app, key)).toEqual(empty)
  })

  it('replays historical success after later tool stop, but blocks a fresh intent', async () => {
    const app = await fixture(), key = crypto.randomUUID(), first = await invoke(app, undefined, { key })
    await DB.prepare("UPDATE handover SET rolled_back_at='stopped' WHERE application_id=?").bind(app.id).run()
    expect(await invoke(app, undefined, { key })).toEqual({ ...first, replayed: '1' })
    expect((await invoke(app)).status).toBe(409)
    expect(await state(app, key)).toMatchObject({ aliases: [expect.any(Object)], logs: [expect.any(Object)], receipts: 1 })
  })

  it.each([
    ['forbidden', () => pg.query("UPDATE override_actor SET role='reviewer' WHERE email=$1", [email]), 403],
    ['inactive', () => pg.query('UPDATE override_actor SET active=0 WHERE email=$1', [email]), 401],
  ])('rejects an actor made %s after middleware but before its first staged read', async (_name, change, status) => {
    const app = await fixture(), key = crypto.randomUUID()
    beforeActorRead = change
    expect((await invoke(app, undefined, { key })).status).toBe(status)
    expect(await state(app, key)).toEqual(empty)
  })

  it('uses currently allowed role and name when changed before first CAS read, not UI identity scope as a permission revision', async () => {
    const app = await fixture(), key = crypto.randomUUID()
    beforeActorRead = () => pg.query("UPDATE override_actor SET role='engineer',display_name='현재 이름' WHERE email=$1", [email])
    const reply = await invoke(app, undefined, { key })
    expect(reply.status).toBe(200); expect(reply.body.teacher).toBe('현재 이름')
    expect(await state(app, key)).toMatchObject({ aliases: [expect.objectContaining({ taught_by: '현재 이름' })], logs: [expect.objectContaining({ title: '현재 이름' })], receipts: 1 })
  })

  it('does not replay a previous receipt after a scoped permission revision', async () => {
    const app = await fixture(), key = crypto.randomUUID()
    expect((await invoke(app, undefined, { key })).status).toBe(200)
    const saved = await state(app, key)
    await pg.query("UPDATE override_actor SET role='engineer' WHERE email=$1", [email])
    expect((await invoke(app, undefined, { key })).status).toBe(409)
    expect(await state(app, key)).toEqual(saved)
  })

  it('does not expose a prior receipt or save a new intent after the account is disabled', async () => {
    const app = await fixture(), key = crypto.randomUUID()
    expect((await invoke(app, undefined, { key })).status).toBe(200)
    const saved = await state(app, key)
    await pg.query('UPDATE override_actor SET active=0 WHERE email=$1', [email])
    expect((await invoke(app, undefined, { key })).status).toBe(401)
    expect((await invoke(app, undefined, { key: crypto.randomUUID() })).status).toBe(401)
    expect(await state(app, key)).toEqual(saved)
  })

  it('keeps reviewer, other-department and foreign-Origin boundaries', async () => {
    const app = await fixture(), key = crypto.randomUUID()
    expect((await invoke(app, undefined, { key, email: 'teach-reviewer@local.invalid' })).status).toBe(403)
    expect((await invoke(app, undefined, { key, email: 'teach-other@local.invalid' })).status).toBe(404)
    expect((await invoke(app, undefined, { key, origin: 'https://other.invalid' })).status).toBe(403)
    expect(await state(app, key)).toEqual(empty)
  })

  it('does not expose or overwrite a hidden other-owner primary-key alias', async () => {
    const app = await fixture(), key = crypto.randomUUID()
    await DB.prepare('INSERT INTO sku_alias(external_code,canonical_code,taught_by,owner_email) VALUES(?,?,?,?)').bind(app.code, 'NR-PA-030', '비공개 이름', 'teach-other@local.invalid').run()
    const reply = await invoke(app, undefined, { key })
    expect(reply.status).toBe(409); expect(JSON.stringify(reply.body)).not.toMatch(/NR-PA-030|비공개 이름|teach-other/)
    expect(failures).toContainEqual({ name: 'ilson_actor_commit', code: '23505' })
    expect(await state(app, key)).toMatchObject({ aliases: [expect.objectContaining({ canonical_code: 'NR-PA-030', taught_by: '비공개 이름' })], logs: [], receipts: 0 })
  })

  it('single-connection synthetic: same-key interleaving commits once and replays original body', async () => {
    const app = await fixture(), key = crypto.randomUUID()
    rendezvous()
    const replies = await Promise.all([invoke(app, undefined, { key }), invoke(app, undefined, { key })])
    expect(replies.map(reply => reply.status)).toEqual([200, 200]); expect(replies[0].body).toEqual(replies[1].body)
    expect(replies.map(reply => reply.replayed).sort()).toEqual(['0', '1'])
    expect(await state(app, key)).toMatchObject({ aliases: [expect.any(Object)], logs: [expect.any(Object)], receipts: 1 })
  })

  it('single-connection synthetic: different keys race safely without inventing evidence or overriding a mapping', async () => {
    const app = await fixture(), keys = [crypto.randomUUID(), crypto.randomUUID()]
    rendezvous()
    const replies = await Promise.all(keys.map(key => invoke(app, undefined, { key })))
    expect(replies.map(reply => reply.status).sort()).toEqual([200, 409])
    const winner = replies.findIndex(reply => reply.status === 200), loser = 1 - winner
    expect(await state(app, keys[winner])).toMatchObject({ aliases: [expect.any(Object)], logs: [expect.any(Object)], receipts: 1 })
    expect((await state(app, keys[loser])).receipts).toBe(0)
    const retry = await invoke(app, undefined, { key: keys[loser] })
    expect(retry.status).toBe(200); expect(retry.body.already).toBe(true)
    expect((await state(app, keys[loser])).logs).toHaveLength(1)
  })

  it('single-connection synthetic: conflicting mapping intents never overwrite the winner', async () => {
    const app = await fixture(), keys = [crypto.randomUUID(), crypto.randomUUID()], mappings = [canonical, 'NR-PA-030']
    rendezvous()
    const replies = await Promise.all(keys.map((key, index) => invoke(app, payload(app, { canonicalCode: mappings[index] }), { key })))
    expect(replies.map(reply => reply.status).sort()).toEqual([200, 409])
    const winner = replies.findIndex(reply => reply.status === 200), loser = 1 - winner
    const saved = await state(app, keys[winner])
    expect(saved.aliases).toEqual([expect.objectContaining({ canonical_code: mappings[winner] })]); expect(saved.logs).toHaveLength(1)
    expect((await invoke(app, payload(app, { canonicalCode: mappings[loser] }), { key: keys[loser] })).status).toBe(409)
    expect(await state(app, keys[winner])).toEqual(saved)
    expect((await state(app, keys[loser])).receipts).toBe(0)
  })

  it('saves exact 80-character and paired-Unicode identities but rejects 81-character collisions before domain writes', async () => {
    const app = await fixture(), key = crypto.randomUUID(); app.code = 'x'.repeat(80)
    expect((await invoke(app, undefined, { key })).status).toBe(200)
    const aliases = await DB.prepare('SELECT external_code,canonical_code FROM sku_alias WHERE external_code=?').bind(app.code).all()
    expect(aliases.results[0].external_code).toBe(app.code)
    for (const suffix of ['a', 'b']) {
      const rejected = await fixture(), invalidKey = crypto.randomUUID(); rejected.code = app.code + suffix
      const reply = await invoke(rejected, undefined, { key: invalidKey })
      expect(reply.status).toBe(400); expect(reply.body.fields.externalCode).toBeDefined(); expect(await state(rejected, invalidKey)).toEqual(empty)
    }
    const unicode = await fixture(); unicode.code += '-😀'
    expect((await invoke(unicode)).status).toBe(200)
    const csv = '주문일자,상품코드,상품명,수량,판매가,할인액\n2026-06-12,' + app.code + ',unknown,1,1000,0\n'
    const bytes = new TextEncoder().encode(csv)
    const files = await readLocalFiles([{ name: 'synthetic.csv', size: bytes.byteLength, arrayBuffer: async () => bytes.buffer }])
    const pipeline = await runPipeline({ files, aliases: { [app.code]: canonical } })
    expect(pipeline.quarantine).toHaveLength(0)
  })

  it('rejects invalid JSON, field types, unsafe numbers and missing/malformed intent keys', async () => {
    const app = await fixture()
    for (const options of [{ raw: 'null' }, { raw: '[]' }, { raw: '{' }, { key: null }, { key: 'short' }, { key: 'x'.repeat(101) }, { key: 'invalid.key.12345678' }]) {
      expect((await invoke(app, undefined, options)).status).toBe(400)
    }
    for (const changes of [{ externalCode: [] }, { canonicalCode: 1 }, { affected: '1' }, { affected: null }, { affected: Number.MAX_SAFE_INTEGER + 1 }, { note: 'x'.repeat(301) }, { externalCode: 'bad\0code' }, { externalCode: 'bad\ud800code' }]) {
      const key = crypto.randomUUID()
      expect((await invoke(app, payload(app, changes), { key })).status).toBe(400)
      expect(await state(app, key)).toEqual(empty)
    }
  })

  it('separates the same intent key and mapping in isolated demo workspaces without touching business aliases', async () => {
    const tokens = ['c'.repeat(64), 'd'.repeat(64)], key = crypto.randomUUID(), code = 'shared-demo-code'
    for (const [index, token] of tokens.entries()) {
      await DB.workspaceOpen(token, [])
      const database = createSupabaseDb(base, 'synthetic-only', token), app = await fixture(null, database); app.code = code
      const body = payload(app, { teacher: '체험 작성자 ' + index })
      const first = await invoke(app, body, { token, key }), replay = await invoke(app, body, { token, key })
      expect(first.status).toBe(200); expect(first.body.teacher).toBe(body.teacher); expect(replay).toEqual({ ...first, replayed: '1' })
      expect((await database.prepare('SELECT external_code,taught_by FROM sku_alias WHERE external_code=?').bind(code).first())).toEqual({ external_code: code, taught_by: body.teacher })
      expect((await database.prepare('SELECT count(*) AS n FROM decision_log WHERE application_id=?').bind(app.id).first()).n).toBe(1)
    }
    expect((await DB.prepare('SELECT count(*) AS n FROM sku_alias WHERE external_code=?').bind(code).first()).n).toBe(0)
    expect(Number((await pg.query('SELECT count(*) AS n FROM ilson_private.mutation_receipts WHERE request_id=$1', [key])).rows[0].n)).toBe(2)
  })

  it('accepts the exact intent-key length boundaries and still rejects an empty demo teacher', async () => {
    const app = await fixture()
    for (const key of ['key' + 'x'.repeat(13), 'key' + 'x'.repeat(97)]) expect((await invoke(app, undefined, { key })).status).toBe(200)
    const token = 'e'.repeat(64); await DB.workspaceOpen(token, [])
    const demo = await fixture(null, createSupabaseDb(base, 'synthetic-only', token)), key = crypto.randomUUID()
    const reply = await invoke(demo, payload(demo, { teacher: '' }), { token, key })
    expect(reply.status).toBe(400); expect(reply.body.fields.teacher).toBeDefined()
    expect((await state(demo, key, createSupabaseDb(base, 'synthetic-only', token))).receipts).toBe(0)
  })

  it('fails closed on a storage adapter without atomic receipts before quota/domain SQL', async () => {
    const prepare = vi.fn(() => { throw Error('Unexpected unsupported adapter SQL') })
    const response = await teach({ env: { DB: { prepare }, DEMO_WORKSPACE: true }, params: { slug: 'tool' },
      request: new Request('https://local.invalid/api/tools/tool/teach', { method: 'POST', headers: { 'X-Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ externalCode: 'code', canonicalCode: canonical, teacher: '담당자' }) }) })
    expect(response.status).toBe(503); expect(prepare).not.toHaveBeenCalled()
  })
})
