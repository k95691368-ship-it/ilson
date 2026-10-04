// @vitest-environment node
// Actual signed middleware + current SQL functions in disposable memory PG.
// Receipt authorization is checked after signed middleware on ONE connection;
// this is not a multi-session PostgreSQL concurrency or production load test.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { createSupabaseDb } from '../functions/_lib/dbBridge.ts'
import { onRequest } from '../functions/api/_middleware.js'
import { onRequestPost as teach } from '../functions/api/tools/[slug]/teach.js'

const pg = new PGlite(), base = 'https://teach-mutation-memory.supabase.co'
const issuer = 'https://teach-mutation-memory.cloudflareaccess.com'
const DB = createSupabaseDb(base, 'synthetic-only'), email = 'teach-operator@local.invalid', label = '검증된 담당자'
const canonical = 'NR-CM-100'
const env = { DB, DBBridgeApplied: true, SUPABASE_URL: base, SUPABASE_SERVICE_ROLE_KEY: 'synthetic-only',
  ACCESS_TEAM_DOMAIN: issuer, ACCESS_AUD: 'teach-memory', DEMO_WORKSPACES: 'false', OVERRIDE_DEMO_MODE: 'false' }
let pair, jwk, queue = Promise.resolve(), sequence = 0, beforeReceipt = null

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
    const task = queue.then(async () => {
      let response
      try {
        if (name === 'ilson_actor_receipt' && beforeReceipt) { const hook = beforeReceipt; beforeReceipt = null; await hook() }
        await pg.exec('SET ROLE service_role')
        const values = Object.values(args)
        response = Response.json((await pg.query(`SELECT public.${name}(${values.map((_, index) => '$' + (index + 1)).join(',')}) AS data`, values)).rows[0].data)
      } catch (error) {
        response = Response.json({ code: error.code }, { status: 400 })
      } finally { await pg.exec('RESET ROLE') }
      return response
    })
    queue = task.catch(() => {})
    return task
  })
}, 60000)

afterEach(async () => {
  beforeReceipt = null
  await queue
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


describe.sequential('C14 distinct independent PG boundaries', () => {
  it('does not reuse the same intent key across tool slugs', async () => {
    const firstApp = await fixture(), otherApp = await fixture(), key = crypto.randomUUID()
    const first = await invoke(firstApp, undefined, { key })
    expect(first.status).toBe(200)
    const conflict = await invoke(otherApp, undefined, { key })
    expect(conflict.status).toBe(409)
    expect(conflict.body).not.toHaveProperty('teacher')
    expect(conflict.body).not.toHaveProperty('canonicalCode')
    const other = await state(otherApp, key)
    expect(other.aliases).toEqual([]); expect(other.logs).toEqual([])
    expect((await state(firstApp, key)).logs).toHaveLength(1)
  })

  it('rechecks a changed private scope at receipt lookup after middleware already allowed the old role', async () => {
    const app = await fixture(), key = crypto.randomUUID()
    expect((await invoke(app, undefined, { key })).status).toBe(200)
    const saved = await state(app, key)
    beforeReceipt = () => pg.query("UPDATE override_actor SET role='engineer' WHERE email=$1", [email])
    const response = await invoke(app, undefined, { key })
    expect(beforeReceipt).toBeNull()
    expect(response.status).toBe(409)
    expect(JSON.stringify(response.body)).not.toContain(label)
    expect(response.body).not.toHaveProperty('canonicalCode')
    expect(await state(app, key)).toEqual(saved)
  })

  it('rechecks revocation at receipt lookup after middleware already authenticated the account', async () => {
    const app = await fixture(), key = crypto.randomUUID()
    expect((await invoke(app, undefined, { key })).status).toBe(200)
    const saved = await state(app, key)
    beforeReceipt = () => pg.query('UPDATE override_actor SET active=0 WHERE email=$1', [email])
    const response = await invoke(app, undefined, { key })
    expect(beforeReceipt).toBeNull()
    expect(response.status).toBe(401)
    expect(response.body.code).toBe('ACCESS_REVOKED')
    expect(response.body).not.toHaveProperty('canonicalCode')
    expect(await state(app, key)).toEqual(saved)
  })

  it('never returns the teacher from an invisible same-canonical alias', async () => {
    const app = await fixture(), key = crypto.randomUUID()
    await DB.prepare('INSERT INTO sku_alias(external_code,canonical_code,taught_by,owner_email) VALUES(?,?,?,?)')
      .bind(app.code, canonical, 'SECRET_OTHER_OWNER_TEACHER', 'teach-other@local.invalid').run()
    const response = await invoke(app, undefined, { key })
    expect(response.status).toBe(409)
    expect(JSON.stringify(response.body)).not.toContain('SECRET_OTHER_OWNER_TEACHER')
    expect(response.body).not.toHaveProperty('already')
    expect(response.body).not.toHaveProperty('teacher')
    const saved = await state(app, key)
    expect(saved.aliases[0].taught_by).toBe('SECRET_OTHER_OWNER_TEACHER')
    expect(saved.logs).toEqual([]); expect(saved.receipts).toBe(0)
  })

  it('same-key replay preserves the historical no-op answer after a later alias correction', async () => {
    const app = await fixture(), key = crypto.randomUUID()
    await DB.prepare('INSERT INTO sku_alias(external_code,canonical_code,taught_by,owner_email) VALUES(?,?,?,?)')
      .bind(app.code, canonical, 'ORIGINAL_TEACHER', email).run()
    const first = await invoke(app, undefined, { key })
    expect(first.body).toMatchObject({ already: true, teacher: 'ORIGINAL_TEACHER' })
    await DB.prepare('UPDATE sku_alias SET canonical_code=?,taught_by=? WHERE external_code=?')
      .bind('NR-PA-030', 'CURRENT_TEACHER', app.code).run()
    expect(await invoke(app, undefined, { key })).toEqual({ ...first, replayed: '1' })
    const fresh = await invoke(app)
    expect(fresh.status).toBe(409)
    const saved = await state(app, key)
    expect(saved.aliases[0]).toMatchObject({ canonical_code: 'NR-PA-030', taught_by: 'CURRENT_TEACHER' })
    expect(saved.logs).toEqual([])
  })
})
