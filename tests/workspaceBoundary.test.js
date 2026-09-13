import { describe, it, expect, vi, afterEach } from 'vitest'
import { onRequest } from '../functions/api/_middleware.js'
import { workspaceToken, workspaceCookie } from '../functions/_lib/workspace.js'
import { onRequestPost, onRequestDelete } from '../functions/api/demo/workspace.js'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

vi.mock('../functions/_lib/rateLimit.js', () => ({ checkRateLimit: vi.fn(async () => 1) }))
afterEach(() => vi.unstubAllGlobals())
const token = 'd'.repeat(64)
const makeEnv = () => ({ DEMO_WORKSPACES: 'true', SUPABASE_URL: 'https://test.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test-only', DBBridgeApplied: true, DB: { original: true } })
const request = (path, method = 'GET', headers = {}, body) => new Request('https://ilson.test/api' + path, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) })
describe('workspace HTTP boundary', () => {
  it('every Pages API handler receives the request-scoped environment', () => {
    const walk = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(join(directory, entry.name)) : join(directory, entry.name))
    for (const file of walk('functions/api').filter(file => file.endsWith('.js') && !file.endsWith('_middleware.js'))) {
      const source = readFileSync(file, 'utf8')
      const signatures = [...source.matchAll(/export async function onRequest\w*\([^)]*\) \{/g)]
      for (const signature of signatures) {
        expect(source.slice(signature.index, signature.index + signature[0].length + 140)).toContain('requestEnv')
      }
    }
  })
  it('refuses reads/writes without a workspace instead of falling back to public', async () => {
    for (const path of ['/applications', '/override', '/applications/foreign/record', '/applications/foreign/journey', '/track/foreign', '/demo/seed']) {
      const next = vi.fn()
      const result = await onRequest({ env: makeEnv(), request: request(path), next })
      expect(result.status).toBe(428)
      expect(next).not.toHaveBeenCalled()
    }
  })
  it('rejects cross-origin writes, malformed and duplicate cookies', async () => {
    const result = await onRequest({ env: makeEnv(), request: request('/override', 'POST', { Origin: 'https://other.test', Cookie: `ilson_workspace=${token}` }), next: vi.fn() })
    expect(result.status).toBe(403)
    expect(workspaceToken(request('/', 'GET', { Cookie: 'ilson_workspace=public' }))).toBeNull()
    expect(workspaceToken(request('/', 'GET', { Cookie: `ilson_workspace=${token}; ilson_workspace=${token}` }))).toBeNull()
    expect(workspaceCookie(request('/'), token)).toContain('HttpOnly; SameSite=Lax; Max-Age=604800; Secure')
  })
  it('uses a request-local DB and prevents shared caching', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ rows: [{ value: 1 }], rowCount: 1 })))
    const original = makeEnv()
    const context = { env: original, request: request('/applications', 'GET', { Cookie: `ilson_workspace=${token}` }) }
    context.next = async () => {
      expect(context.env.DB.workspace).toBe(true)
      expect(context.env.DEMO_WORKSPACE).toBe(true)
      return Response.json({ ok: true })
    }
    const result = await onRequest(context)
    expect(original.DB).toEqual({ original: true })
    expect(original.DEMO_WORKSPACE).toBeUndefined()
    expect(result.headers.get('Cache-Control')).toBe('private, no-store')
    expect(result.headers.get('Vary')).toContain('Cookie')
  })
  it('rejects expired tokens before reaching route handlers', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ code: '28000' }, { status: 400 })))
    const next = vi.fn()
    const result = await onRequest({ env: makeEnv(), request: request('/applications', 'GET', { Cookie: `ilson_workspace=${token}` }), next })
    expect(result.status).toBe(428)
    expect(next).not.toHaveBeenCalled()
  })
  it('sets the capability only in an HttpOnly cookie, never the JSON response', async () => {
    const env = makeEnv()
    env.DB.workspaceOpen = vi.fn(async () => ({ expiresAt: '2026-09-20' }))
    const result = await onRequestPost({ env, request: request('/demo/workspace', 'POST', { Origin: 'https://ilson.test', 'X-Ilson-Request': '1' }) })
    expect(result.status).toBe(201)
    const body = await result.json()
    expect(body.active).toBe(true)
    expect(body.token).toBeUndefined()
    expect(result.headers.get('Set-Cookie')).toMatch(/^ilson_workspace=[a-f0-9]{64};/)
  })
  it('requires explicit reset confirmation and never accepts a target token from the body', async () => {
    const env = makeEnv()
    env.DB.workspaceReset = vi.fn(async () => ({ expiresAt: '2026-09-20' }))
    const headers = { Origin: 'https://ilson.test', 'X-Ilson-Request': '1', Cookie: `ilson_workspace=${token}` }
    expect((await onRequestDelete({ env, request: request('/demo/workspace', 'DELETE', headers, {}) })).status).toBe(400)
    expect(env.DB.workspaceReset).not.toHaveBeenCalled()
    const result = await onRequestDelete({ env, request: request('/demo/workspace', 'DELETE', headers, { confirm: 'reset-my-workspace', token: 'e'.repeat(64) }) })
    expect(result.status).toBe(200)
    expect(env.DB.workspaceReset.mock.calls[0][0]).toBe(token)
    expect(env.DB.workspaceReset.mock.calls[0][2]).not.toBe(token)
  })
})
