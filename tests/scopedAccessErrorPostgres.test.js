// @vitest-environment node
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { createSupabaseDb } from '../functions/_lib/dbBridge.ts'
import { failUnexpected } from '../functions/_lib/http.ts'
import { onRequest } from '../functions/api/_middleware.js'
import { onRequestGet as feedbackGet, onRequestPost as feedbackPost } from '../functions/api/feedback.js'
import { onRequestGet as trackGet } from '../functions/api/track/[ticket].js'
import { onRequestGet as betaGet } from '../functions/api/applications/[id]/beta.js'
import { onRequestGet as toolGet } from '../functions/api/tools/[slug].js'

const pg = new PGlite(), base = 'https://scope-error-local.supabase.co', issuer = 'https://scope-error-local.cloudflareaccess.com'
const DB = createSupabaseDb(base, 'local-test-only'), email = 'staff@local.invalid'
const env = { DB, DBBridgeApplied: true, SUPABASE_URL: base, SUPABASE_SERVICE_ROLE_KEY: 'local-test-only', ACCESS_TEAM_DOMAIN: issuer, ACCESS_AUD: 'scope-error-local', DEMO_WORKSPACES: 'false', OVERRIDE_DEMO_MODE: 'false' }
const token = 'e'.repeat(64)
let queue = Promise.resolve(), pair, jwk, revokeAfterRpc = null
beforeAll(async () => {
  await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;')
  const folder = new URL('../supabase/migrations/', import.meta.url)
  for (const file of readdirSync(folder).filter(file => /^\d+.*\.sql$/.test(file)).sort()) await pg.exec(readFileSync(new URL(file, folder), 'utf8'))
  pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1,0,1]), hash: 'SHA-256' }, true, ['sign','verify'])
  jwk = { ...await crypto.subtle.exportKey('jwk', pair.publicKey), kid: 'scope-error-local', alg: 'RS256', use: 'sig' }
  vi.stubGlobal('fetch', (url, options) => {
    if (String(url) === issuer + '/cdn-cgi/access/certs') return Promise.resolve(Response.json({ keys: [jwk] }))
    if (!String(url).startsWith(base + '/rest/v1/rpc/')) throw Error('External call blocked')
    const result = queue.then(async () => {
      const name = new URL(url).pathname.split('/').at(-1), args = Object.values(JSON.parse(options.body))
      let payload
      try {
        await pg.exec('SET ROLE service_role')
        payload = (await pg.query(`SELECT public.${name}(${args.map((_, i) => '$' + (i+1)).join(',')}) data`, args)).rows[0].data
      } catch (error) { return Response.json({ code: error.code, message: 'PRIVATE SQL SENTINEL', details: 'PRIVATE ROW SENTINEL' }, { status: 400 }) }
      finally { await pg.exec('RESET ROLE') }
      if (revokeAfterRpc?.(name, args)) {
        revokeAfterRpc = null
        await pg.query('UPDATE public.override_actor SET active=0 WHERE email=$1', [email])
      }
      return Response.json(payload)
    })
    queue = result.catch(() => {})
    return result
  })
  await pg.query("INSERT INTO public.override_actor(email,display_name,role,departments_json) VALUES($1,'담당자','product','[\"재무\"]')", [email])
  await pg.query("INSERT INTO public.application(id,ticket_no,dept,applicant_label,title,bottleneck,problem,owner_email) VALUES('route-app','AX-ABC-DEF','재무','작성자','경합 확인','취합','반복',$1)", [email])
  await pg.exec("INSERT INTO public.handover(application_id,slug,title,handed_to_dept,handed_to_person) VALUES('route-app','route-tool','경합 도구','재무','작성자')")
  await DB.workspaceOpen(token, [])
}, 60000)
afterAll(async () => { vi.unstubAllGlobals(); await pg.close() })
const enc = value => Buffer.from(JSON.stringify(value)).toString('base64url')
async function invoke(handler = feedbackGet, { revoke = false, method = 'GET', body } = {}) {
  await pg.query('UPDATE public.override_actor SET active=1 WHERE email=$1', [email])
  const now = Math.floor(Date.now()/1000)
  const unsigned = enc({ alg: 'RS256', kid: jwk.kid }) + '.' + enc({ iss: issuer, aud: ['scope-error-local'], iat: now, exp: now+300, email })
  const jwt = unsigned + '.' + Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(unsigned))).toString('base64url')
  const request = new Request('https://local.invalid/api/feedback?role=product', { method, headers: { 'Cf-Access-Jwt-Assertion': jwt, Origin: 'https://local.invalid', 'X-Ilson-Request': '1', 'X-Ilson-Scope': await DB.forActor(email).toolRunScope(), 'Content-Type': 'application/json', 'X-Idempotency-Key': crypto.randomUUID() }, ...(body ? { body: JSON.stringify(body) } : {}) })
  const context = { env, request, data: {}, next: async forwarded => {
    expect(context.data.requestEnv.AUTH_ACTOR.email).toBe(email)
    if (revoke) await pg.query('UPDATE public.override_actor SET active=0 WHERE email=$1', [email])
    return handler({ request: forwarded, env, data: context.data })
  } }
  return onRequest(context)
}
async function safe(response, status) {
  expect(response.status).toBe(status)
  const body = await response.text()
  expect(body).not.toMatch(/PRIVATE|local-test-only|28000|42501|Database request|staff@/)
  expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  return JSON.parse(body)
}

describe.sequential('scoped database denial survives the HTTP boundary', () => {
  it('actual signed authentication succeeds, then revocation before feedback GET becomes 401 rather than 503', async () => {
    expect((await invoke()).status).toBe(200)
    expect(await safe(await invoke(feedbackGet, { revoke: true }), 401)).toMatchObject({ code: 'ACCESS_REVOKED' })
    expect((await pg.query('SELECT active FROM public.override_actor WHERE email=$1', [email])).rows[0].active).toBe(0)
  })
  it('revocation after the POST middleware check prevents the write and returns a safe 401', async () => {
    const response = await invoke(feedbackPost, { revoke: true, method: 'POST', body: { action: 'record_nonuse', productId: 'p', usageState: 'stopped', reason: 'quality', occurredOn: '2026-09-01', note: '현장 확인' } })
    await safe(response, 401)
    expect((await pg.query('SELECT count(*) n FROM public.tool_nonuse_report')).rows[0].n).toBe(0)
  })
  it('an actual scoped SQL permission rejection is 403 through the middleware exception boundary', async () => {
    const response = await invoke(async ({ data }) => { await data.requestEnv.DB.prepare("SELECT public.ilson_execute('SELECT 1')").all(); return Response.json({ unreachable: true }) })
    expect(await safe(response, 403)).toMatchObject({ code: 'ACCESS_DENIED' })
  })
  it('an expired workspace becomes 401 both before a handler and after its initial check', async () => {
    const demoEnv = { ...env, DEMO_WORKSPACES: 'true' }
    const request = new Request('https://local.invalid/api/feedback', { headers: { Cookie: `ilson_workspace=${token}`, 'X-Ilson-Scope': await createSupabaseDb(base, 'local-test-only', token).toolRunScope() } })
    const context = { env: demoEnv, request, data: {}, next: async forwarded => {
      await pg.exec("UPDATE ilson_private.workspaces SET expires_at=now()-interval '1 second'")
      return feedbackGet({ env: demoEnv, data: context.data, request: forwarded })
    } }
    expect(await safe(await onRequest(context), 401)).toMatchObject({ code: 'ACCESS_REVOKED' })
    const next = vi.fn()
    await safe(await onRequest({ env: demoEnv, request, next }), 401)
    expect(next).not.toHaveBeenCalled()
  })
  it('unscoped server access failures remain configuration errors, not end-user authentication errors', async () => {
    const error = await DB.prepare("SELECT public.ilson_actor_query('missing@local.invalid','SELECT 1')").all().catch(error => error)
    await safe(failUnexpected(error, '서버 설정을 확인해야 합니다.'), 503)
  })
  it('an unknown workspace token is rejected with safe 401 before reaching any handler', async () => {
    const request = new Request('https://local.invalid/api/feedback', { headers: { Cookie: `ilson_workspace=${'f'.repeat(64)}` } })
    const next = vi.fn()
    expect(await safe(await onRequest({ env: { ...env, DEMO_WORKSPACES: 'true' }, request, next }), 401)).toMatchObject({ code: 'ACCESS_REVOKED' })
    expect(next).not.toHaveBeenCalled()
  })
  it.each([['track', trackGet], ['beta', betaGet], ['tool', toolGet]])('%s revocation after its successful initial read is not swallowed by its inner DB catch', async (kind, handler) => {
    const run = context => handler({ ...context, params: { id: 'route-app', ticket: 'AX-ABC-DEF', slug: 'route-tool' } })
    expect((await invoke(run)).status).toBe(200)
    revokeAfterRpc = kind === 'tool'
      ? (name, args) => name === 'ilson_actor_query' && args.some(value => typeof value === 'string' && /FROM handover h JOIN application/i.test(value))
      : (name, args) => name === 'ilson_actor_query' && args.some(value => typeof value === 'string' && /FROM application WHERE/i.test(value))
    expect(await safe(await invoke(run), 401)).toMatchObject({ code: 'ACCESS_REVOKED' })
    expect(revokeAfterRpc).toBeNull()
  })
})
