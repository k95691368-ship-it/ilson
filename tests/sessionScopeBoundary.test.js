import { afterEach, describe, expect, it, vi } from 'vitest'
import { onRequest } from '../functions/api/_middleware.js'
import { createSupabaseDb } from '../functions/_lib/dbBridge.js'
import { requireSessionScope } from '../functions/_lib/sessionScope.js'

const scope = 'a'.repeat(64), other = 'b'.repeat(64), token = 'e'.repeat(64)
afterEach(() => vi.unstubAllGlobals())
function fixture({ demo = false, actor = true, role = 'product' } = {}) {
  const quota = vi.fn(async () => 1), prepare = vi.fn(() => { throw Error('Unexpected business query') })
  const actorDB = { actorEmail: 'staff@local.invalid', workspace: false, toolRunScope: vi.fn(async () => scope), claimRateLimit: quota, prepare }
  const DB = { prepare, claimRateLimit: quota, forActor: vi.fn(() => actorDB) }
  const env = { DB, DBBridgeApplied: true, DEMO_WORKSPACES: String(demo), OVERRIDE_DEMO_MODE: 'false',
    ...(demo ? { SUPABASE_URL: 'https://scope-header-local.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'local-only' }
      : actor ? { AUTH_ACTOR: { email: actorDB.actorEmail, role, label: '담당자', mode: 'access' } } : {}) }
  const fetcher = vi.fn(async (_url, options) => {
    expect(JSON.parse(options.body)).toMatchObject({ p_token: token, p_sql: 'SELECT 1' })
    return Response.json({ rows: [{ value: 1 }], rowCount: 1 })
  })
  if (demo) vi.stubGlobal('fetch', fetcher)
  const invoke = async (path, method = 'GET', expected = scope) => {
    const headers = { Origin: 'https://local.invalid', 'X-Ilson-Request': '1', ...(demo ? { Cookie: `ilson_workspace=${token}` } : {}), ...(expected === null ? {} : { 'X-Ilson-Scope': expected }) }
    const request = new Request('https://local.invalid/api' + path, { method, headers, ...(!['GET', 'HEAD', 'OPTIONS'].includes(method) ? { body: '{}' } : {}) })
    const next = vi.fn(async () => Response.json({ ok: true }))
    const context = { request, env, data: {}, next }
    return { response: await onRequest(context), next, bound: context.data.requestEnv }
  }
  return { invoke, quota, prepare, actorDB, DB, fetcher }
}

describe('mandatory expected scope is checked before business handlers and quota writes', () => {
  for (const demo of [false, true]) it.each([
    [null, 428, 'SESSION_SCOPE_REQUIRED'], ['', 400, 'SESSION_SCOPE_INVALID'],
    ['g'.repeat(64), 400, 'SESSION_SCOPE_INVALID'], ['A'.repeat(64), 400, 'SESSION_SCOPE_INVALID'],
    ['a'.repeat(65), 400, 'SESSION_SCOPE_INVALID'], [scope + ', ' + other, 400, 'SESSION_SCOPE_INVALID'],
    [other, 409, 'SESSION_SCOPE_CHANGED'],
  ])(`${demo ? 'demo' : 'access'} rejects scope %s safely with %s`, async (expected, status, code) => {
    for (const method of ['GET', 'POST']) {
      const setup = fixture({ demo })
      const { response, next } = await setup.invoke('/override', method, expected)
      expect(response.status).toBe(status)
      const body = await response.json()
      expect(body).toMatchObject({ code })
      expect(JSON.stringify(body)).not.toMatch(/local-only|staff@|Database request/)
      expect(next).not.toHaveBeenCalled()
      expect(setup.quota).not.toHaveBeenCalled()
      expect(setup.prepare).not.toHaveBeenCalled()
    }
  })
  it.each(['GET', 'POST'])('matching real %s reaches the handler with its server-selected actor DB', async method => {
    const setup = fixture()
    const { response, next, bound } = await setup.invoke('/override', method)
    expect(response.status).toBe(200)
    expect(next).toHaveBeenCalledOnce()
    expect(bound.DB).toBe(setup.actorDB)
    expect(setup.DB.forActor).toHaveBeenCalledWith('staff@local.invalid')
    expect(setup.quota).toHaveBeenCalledTimes(method === 'GET' ? 0 : 1)
  })
  it('scope possession does not replace real authentication or route permission', async () => {
    const anonymous = fixture({ actor: false })
    const denied = await anonymous.invoke('/override')
    expect(denied.response.status).toBe(401)
    expect(denied.next).not.toHaveBeenCalled()
    const reviewer = fixture({ role: 'reviewer' })
    const action = await reviewer.invoke('/applications/id/owner', 'POST', other)
    expect(action.response.status).toBe(403)
    expect(action.next).not.toHaveBeenCalled()
    expect(reviewer.quota).not.toHaveBeenCalled()
  })
  it.each(['GET', 'POST'])('matching demo %s preserves the original global IP rate-limit binding', async method => {
    const setup = fixture({ demo: true })
    const expected = await createSupabaseDb('https://scope-header-local.supabase.co', 'local-only', token).toolRunScope()
    const { response, next, bound } = await setup.invoke('/override', method, expected)
    expect(response.status).toBe(200)
    expect(next).toHaveBeenCalledOnce()
    expect(bound.DB.workspace).toBe(true)
    expect(setup.quota).toHaveBeenCalledTimes(method === 'GET' ? 0 : 1)
  })
  it('demo reset requires the current scope but retains the control route raw DB binding', async () => {
    const setup = fixture({ demo: true })
    const expected = await createSupabaseDb('https://scope-header-local.supabase.co', 'local-only', token).toolRunScope()
    const accepted = await setup.invoke('/demo/workspace', 'DELETE', expected)
    expect(accepted.response.status).toBe(200)
    expect(accepted.bound.DB).toBe(setup.DB)
    expect(accepted.next).toHaveBeenCalledOnce()
    setup.quota.mockClear()
    for (const candidate of [null, other]) {
      const denied = await setup.invoke('/demo/workspace', 'DELETE', candidate)
      expect(denied.response.status).toBe(candidate === null ? 428 : 409)
      expect(denied.next).not.toHaveBeenCalled()
      expect(setup.quota).not.toHaveBeenCalled()
    }
  })
  it.each(['/session', '/health', '/demo/workspace'])('demo bootstrap GET %s does not require an existing scope header', async path => {
    const setup = fixture({ demo: true })
    const { response, next } = await setup.invoke(path, 'GET', null)
    expect(response.status).toBe(200)
    expect(next).toHaveBeenCalledOnce()
  })
  it('new demo workspace POST and real session GET remain available without a scope header', async () => {
    expect((await fixture({ demo: true }).invoke('/demo/workspace', 'POST', null)).response.status).toBe(200)
    expect((await fixture().invoke('/session', 'GET', null)).response.status).toBe(200)
  })
  it.each([undefined, '', {}, 'A'.repeat(64)])('invalid server scope %j is a configuration error, never a client-selected scope', async actual => {
    const response = await requireSessionScope(new Request('https://local.invalid/api/x', { headers: { 'X-Ilson-Scope': scope } }), { toolRunScope: async () => actual })
    expect(response.status).toBe(503)
    expect(await response.json()).not.toHaveProperty('scope')
  })
})
