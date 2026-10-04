// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { createSupabaseDb } from '../functions/_lib/dbBridge.ts'
import { onRequestPost as apply } from '../functions/api/applications/index.js'

const pg = new PGlite(), endpoint = 'https://application-receipts-local.supabase.co'
const root = createSupabaseDb(endpoint, 'local-synthetic'), bucket = 'apply:192.0.2.17'
let queue = Promise.resolve(), actorNumber = 0, dropResponse = false
let privilegesBefore
const privilegeCatalog = async () => ({
  functions: (await pg.query(`SELECT n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' AS object,
    p.proowner::regrole::text AS owner,p.proacl::text AS acl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname IN ('public','ilson_private','procurement_ax','auth') AND p.proname<>'ilson_record_application' ORDER BY object`)).rows,
  relations: (await pg.query(`SELECT n.nspname||'.'||c.relname AS object,c.relowner::regrole::text AS owner,c.relacl::text AS acl
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','ilson_private','procurement_ax','auth') ORDER BY object`)).rows,
  schemas: (await pg.query(`SELECT nspname,nspowner::regrole::text AS owner,nspacl::text AS acl FROM pg_namespace ORDER BY nspname`)).rows,
  roles: (await pg.query(`SELECT rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls,rolconfig FROM pg_roles ORDER BY rolname`)).rows,
  defaults: (await pg.query('SELECT defaclrole::regrole::text,defaclnamespace,defaclobjtype,defaclacl::text FROM pg_default_acl ORDER BY oid')).rows,
})
const form = changes => {
  const body = new FormData()
  for (const [key, value] of Object.entries({ dept: '재무', applicant_label: '합성 신청자', title: '정산 신청', bottleneck: '취합', problem: '반복 입력', ...changes })) body.set(key, value)
  return body
}
const submit = (env, key, changes) => apply({ env, request: new Request('https://local.invalid/api/applications', {
  method: 'POST', headers: { 'CF-Connecting-IP': '192.0.2.17', ...(key == null ? {} : { 'X-Idempotency-Key': key }) }, body: form(changes),
}) })
async function actor() {
  const email = `application-${++actorNumber}@local.invalid`
  await root.prepare("INSERT INTO override_actor(email,display_name,role) VALUES(?,'합성 담당자','reviewer')").bind(email).run()
  return { DB: root.forActor(email), AUTH_ACTOR: { email, label: '합성 담당자' } }
}
async function state(env) {
  return { applications: Number((await env.DB.prepare('SELECT count(*) AS n FROM application').first()).n),
    remaining: Number((await env.DB.rateLimitState(bucket, 12, 3600)).remaining) }
}
beforeAll(async () => {
  await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;')
  const directory = new URL('../supabase/migrations/', import.meta.url)
  for (const file of readdirSync(directory).filter(name => /^\d+.*\.sql$/.test(name) && !name.startsWith('0014_')).sort()) await pg.exec(readFileSync(new URL(file, directory), 'utf8'))
  // Synthetic shared-project sentinels exist only inside this in-memory DB.
  await pg.exec(`CREATE SCHEMA procurement_ax; CREATE ROLE procurement_ax_runner NOINHERIT;
    CREATE TABLE procurement_ax.shared_marker(value text); INSERT INTO procurement_ax.shared_marker VALUES('preserve-purchasing');
    GRANT USAGE ON SCHEMA procurement_ax TO procurement_ax_runner; GRANT SELECT ON procurement_ax.shared_marker TO procurement_ax_runner;
    CREATE SCHEMA auth; CREATE TABLE auth.shared_marker(value text); INSERT INTO auth.shared_marker VALUES('preserve-shared-auth');`)
  privilegesBefore = await privilegeCatalog()
  await pg.exec(readFileSync(new URL('0014_application_receipts.sql', directory), 'utf8'))
  vi.stubGlobal('fetch', (url, options) => {
    if (!String(url).startsWith(endpoint + '/rest/v1/rpc/')) throw Error('External network prohibited')
    const task = queue.then(async () => {
      const name = new URL(url).pathname.split('/').at(-1), args = Object.values(JSON.parse(options.body))
      let response
      try {
        await pg.exec('SET ROLE service_role')
        response = Response.json((await pg.query(`SELECT public.${name}(${args.map((_, index) => '$' + (index + 1)).join(',')}) AS data`, args)).rows[0].data)
      } catch (error) { response = Response.json({ code: error.code }, { status: 400 }) }
      finally { await pg.exec('RESET ROLE') }
      if (name === 'ilson_record_application' && dropResponse && response.ok) {
        dropResponse = false
        throw new TypeError('Synthetic response lost after transaction committed')
      }
      return response
    })
    queue = task.catch(() => {})
    return task
  })
}, 60000)
afterAll(async () => { vi.unstubAllGlobals(); await pg.close() })

describe.sequential('application intent receipts and success quota share a commit', () => {
  it('changes no pre-existing ACL, role, shared schema data or default privilege', async () => {
    expect(await privilegeCatalog()).toEqual(privilegesBefore)
    expect((await pg.query('SELECT * FROM procurement_ax.shared_marker')).rows).toEqual([{ value: 'preserve-purchasing' }])
    expect((await pg.query('SELECT * FROM auth.shared_marker')).rows).toEqual([{ value: 'preserve-shared-auth' }])
    const signature = 'public.ilson_record_application(text,text,text,text,text,jsonb)'
    for (const role of ['anon', 'authenticated', 'ilson_scoped_executor', 'procurement_ax_runner']) {
      expect((await pg.query('SELECT has_function_privilege($1,$2,\'EXECUTE\') AS allowed', [role, signature])).rows[0].allowed).toBe(false)
    }
    expect((await pg.query('SELECT has_function_privilege(\'service_role\',$1,\'EXECUTE\') AS allowed', [signature])).rows[0].allowed).toBe(true)
    expect(await root.readiness()).toMatchObject({ migration: '0014', schemaReady: true, ready: true })
  })

  it('replays the same normalized form intent without a second application or quota charge', async () => {
    const env = await actor(), key = crypto.randomUUID()
    const first = await submit(env, key), second = await submit(env, key, { title: '  정산 신청  ', applicant_label: '위조 이름' })
    expect(first.status).toBe(201); expect(second.status).toBe(201)
    expect(await second.json()).toEqual(await first.json())
    expect(second.headers.get('X-Idempotency-Replayed')).toBe('1')
    expect(await state(env)).toEqual({ applications: 1, remaining: 11 })
    expect((await env.DB.prepare('SELECT applicant_label,owner_email FROM application').first())).toEqual({ applicant_label: '합성 담당자', owner_email: env.AUTH_ACTOR.email })
  })

  it('charges once for concurrent copies of one intent', async () => {
    const env = await actor(), key = crypto.randomUUID()
    const responses = await Promise.all(Array.from({ length: 6 }, () => submit(env, key)))
    expect(responses.map(response => response.status)).toEqual(Array(6).fill(201))
    const bodies = await Promise.all(responses.map(response => response.json()))
    expect(new Set(bodies.map(body => body.id)).size).toBe(1)
    expect(responses.filter(response => response.headers.get('X-Idempotency-Replayed') === '0')).toHaveLength(1)
    expect(await state(env)).toEqual({ applications: 1, remaining: 11 })
  })

  it('rejects changed content under a used key but permits a deliberate new intent with identical content', async () => {
    const env = await actor(), key = crypto.randomUUID()
    expect((await submit(env, key)).status).toBe(201)
    const conflict = await submit(env, key, { title: '다른 신청 내용' })
    expect(conflict.status).toBe(409)
    expect(await conflict.json()).toMatchObject({ code: 'APPLICATION_INTENT_CONFLICT' })
    expect(await state(env)).toEqual({ applications: 1, remaining: 11 })
    expect((await submit(env, crypto.randomUUID())).status).toBe(201)
    expect(await state(env)).toEqual({ applications: 2, remaining: 10 })
  })

  it('does not charge for invalid form fields, binary form values, missing keys or malformed keys', async () => {
    const env = await actor()
    for (const [key, fields] of [[crypto.randomUUID(), { title: '' }], [crypto.randomUUID(), { upload: new File(['x'], 'x.csv') }], [null, {}], ['short', {}]]) {
      const response = await submit(env, key, fields)
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ notSaved: true })
    }
    expect(await state(env)).toEqual({ applications: 0, remaining: 12 })
  })

  it('reconciles a lost committed response with the original receipt and quota', async () => {
    const env = await actor(), key = crypto.randomUUID()
    dropResponse = true
    const uncertain = await submit(env, key)
    expect(uncertain.status).toBe(503)
    expect((await uncertain.json()).notSaved).not.toBe(true)
    const saved = await env.DB.prepare('SELECT id,ticket_no FROM application').first()
    expect(await state(env)).toEqual({ applications: 1, remaining: 11 })
    const retry = await submit(env, key)
    expect(retry.status).toBe(201)
    expect(await retry.json()).toMatchObject(saved)
    expect(retry.headers.get('X-Idempotency-Replayed')).toBe('1')
    expect(await state(env)).toEqual({ applications: 1, remaining: 11 })
  })

  it('rolls the quota back with a failed insert rather than refunding an uncertain commit', async () => {
    const env = await actor(), key = crypto.randomUUID()
    await pg.exec(`CREATE FUNCTION reject_application_receipt_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.title='합성 저장 실패' THEN RAISE EXCEPTION 'Synthetic insert failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER reject_application_receipt_test BEFORE INSERT ON public.application FOR EACH ROW EXECUTE FUNCTION reject_application_receipt_test();`)
    try {
      expect((await submit(env, key, { title: '합성 저장 실패' })).status).toBe(503)
      expect(await state(env)).toEqual({ applications: 0, remaining: 12 })
      expect((await pg.query('SELECT count(*)::int AS n FROM ilson_private.mutation_receipts WHERE request_id=$1', [key])).rows[0].n).toBe(0)
    } finally { await pg.exec('DROP TRIGGER reject_application_receipt_test ON public.application; DROP FUNCTION reject_application_receipt_test();') }
    expect((await submit(env, key, { title: '합성 저장 실패' })).status).toBe(201)
    expect(await state(env)).toEqual({ applications: 1, remaining: 11 })
  })

  it('returns an existing receipt even at the quota limit and does not record a denied new intent', async () => {
    const env = await actor(), keys = Array.from({ length: 13 }, () => crypto.randomUUID())
    for (const key of keys.slice(0, 12)) expect((await submit(env, key)).status).toBe(201)
    expect((await submit(env, keys[0])).status).toBe(201)
    const limited = await submit(env, keys[12])
    expect(limited.status).toBe(429)
    expect(await limited.json()).toMatchObject({ notSaved: true })
    expect(await state(env)).toEqual({ applications: 12, remaining: 0 })
    expect((await pg.query('SELECT count(*)::int AS n FROM ilson_private.mutation_receipts WHERE request_id=$1', [keys[12]])).rows[0].n).toBe(0)
  })

  it('isolates the same request key across accounts and workspaces', async () => {
    const first = await actor(), second = await actor(), key = crypto.randomUUID()
    const a = await (await submit(first, key)).json(), b = await (await submit(second, key)).json()
    expect(a.id).not.toBe(b.id)
    expect(await state(first)).toEqual({ applications: 1, remaining: 11 })
    expect(await state(second)).toEqual({ applications: 1, remaining: 11 })
    const tokens = ['a'.repeat(64), 'b'.repeat(64)], ids = []
    for (const token of tokens) {
      await root.workspaceOpen(token, [])
      const DB = createSupabaseDb(endpoint, 'local-synthetic', token), env = { DB, DEMO_WORKSPACE: true }
      const first = await submit(env, key), replay = await submit(env, key)
      expect(first.status).toBe(201); expect(replay.status).toBe(201)
      ids.push((await first.json()).id)
      expect((await DB.prepare('SELECT count(*) AS n FROM application').first()).n).toBe(1)
      expect((await DB.prepare('SELECT count(*) AS n FROM rate_limit_hits').first()).n).toBe(1)
    }
    expect(new Set(ids).size).toBe(2)
  })

  it('does not replay a receipt after account revocation', async () => {
    const env = await actor(), key = crypto.randomUUID()
    expect((await submit(env, key)).status).toBe(201)
    await root.prepare('UPDATE override_actor SET active=0 WHERE email=?').bind(env.AUTH_ACTOR.email).run()
    const response = await submit(env, key)
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ code: 'ACCESS_REVOKED' })
    expect((await root.prepare('SELECT count(*) AS n FROM application WHERE owner_email=?').bind(env.AUTH_ACTOR.email).first()).n).toBe(1)
  })

  it('refuses old-scope replay after a permission revision without creating another application', async () => {
    const env = await actor(), key = crypto.randomUUID()
    expect((await submit(env, key)).status).toBe(201)
    await root.prepare("UPDATE override_actor SET departments_json='[\"재무\"]' WHERE email=?").bind(env.AUTH_ACTOR.email).run()
    const response = await submit(env, key)
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'APPLICATION_INTENT_CONFLICT' })
    expect((await root.prepare('SELECT count(*) AS n FROM application WHERE owner_email=?').bind(env.AUTH_ACTOR.email).first()).n).toBe(1)
  })

  it('rejects malformed direct RPC payloads before quota or receipt writes', async () => {
    const env = await actor()
    const original = { id: 'app_' + 'a'.repeat(20), ticket_no: 'AX-ABC-234', dept: '재무', applicant_label: '합성', title: '합성', bottleneck: '', problem: '' }
    for (const payload of [null, [], { ...original, current_minutes: -1 }, { ...original, current_people: 501 },
      { ...original, current_frequency: 'unknown' }, { ...original, source_ip_hash: 'raw-ip' }, { ...original, dept: 'unknown' },
      { ...original, title: 'x'.repeat(81) }, { ...original, title: [] }, { ...original, id: 'malformed' }]) {
      const key = crypto.randomUUID()
      await expect(env.DB.recordApplication(bucket, key, 'a'.repeat(64), payload)).rejects.toThrow('/22023')
      expect((await pg.query('SELECT count(*)::int AS n FROM ilson_private.mutation_receipts WHERE request_id=$1', [key])).rows[0].n).toBe(0)
    }
    expect(await state(env)).toEqual({ applications: 0, remaining: 12 })
  })
})

it('aborts additive installation instead of altering an unrelated role inherited from default privileges', async () => {
  const isolated = new PGlite(), directory = new URL('../supabase/migrations/', import.meta.url)
  try {
    await isolated.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE ROLE unrelated_executor;')
    for (const file of readdirSync(directory).filter(name => /^\d+.*\.sql$/.test(name) && !name.startsWith('0014_')).sort()) await isolated.exec(readFileSync(new URL(file, directory), 'utf8'))
    await isolated.exec('ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO unrelated_executor;')
    const before = (await isolated.query('SELECT defaclacl::text FROM pg_default_acl')).rows
    await expect(isolated.exec(readFileSync(new URL('0014_application_receipts.sql', directory), 'utf8'))).rejects.toThrow('Unexpected inherited execute grant')
    await isolated.exec('ROLLBACK')
    expect((await isolated.query('SELECT defaclacl::text FROM pg_default_acl')).rows).toEqual(before)
    expect((await isolated.query("SELECT to_regprocedure('public.ilson_record_application(text,text,text,text,text,jsonb)') AS installed")).rows[0].installed).toBeNull()
    expect((await isolated.query('SELECT public.ilson_readiness(NULL) AS data')).rows[0].data.migration).toBe('0013')
  } finally { await isolated.close() }
}, 60000)
