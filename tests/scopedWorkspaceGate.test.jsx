// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { onRequest } from '../functions/api/_middleware.js'
import { onRequestGet } from '../functions/api/demo/workspace.js'
import WorkspaceGate from '../src/components/WorkspaceGate.jsx'

const realEnv = () => ({ DEMO_WORKSPACES: 'false', OVERRIDE_DEMO_MODE: 'false', DBBridgeApplied: true,
  DB: { prepare: vi.fn(() => { throw Error('Status lookup must not query business data') }) } })
async function boundary(path, method = 'GET', handler = onRequestGet, env = realEnv(), headers = {}) {
  const request = new Request('https://local.invalid' + path, { method, headers })
  const context = { request, env, data: {} }
  const next = vi.fn(forwarded => handler({ request: forwarded ?? request, env, data: context.data }))
  context.next = next
  return { response: await onRequest(context), context, next }
}
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('real-account entry through the actual workspace gate boundary', () => {
  it('returns only disabled status without identity, database reads, or a workspace cookie', async () => {
    const env = realEnv()
    const {response,next} = await boundary('/api/demo/workspace', 'GET', onRequestGet, env)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ enabled: false })
    expect(next).toHaveBeenCalledOnce()
    expect(env.DB.prepare).not.toHaveBeenCalled()
    expect(response.headers.get('Set-Cookie')).toBeNull()
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  })
  it('checks the protected session after disabled-demo status instead of requesting a demo', async () => {
    const fetch = vi.fn(async (url, options) => {
      expect(options.method ?? 'GET').toBe('GET')
      if (url === '/api/session') return Response.json({ ok: true, mode: 'access', scope: 'a'.repeat(64) })
      expect(url).toBe('/api/demo/workspace')
      return (await boundary(url)).response
    })
    vi.stubGlobal('fetch', fetch)
    render(<WorkspaceGate><main>실계정 작업 화면</main></WorkspaceGate>)
    expect(await screen.findByText('실계정 작업 화면')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '개인 체험 시작' })).toBeNull()
    expect(fetch).toHaveBeenCalledTimes(2)
  })
  it.each([
    ['/api/demo/workspace','POST'], ['/api/demo/workspace','DELETE'], ['/api/demo/workspace','PUT'],
    ['/api/demo/workspace','HEAD'], ['/api/demo/workspace','OPTIONS'],
    ['/api/demo/seed','GET'], ['/api/demo/seed','POST'], ['/api/demo/seed','DELETE'],
    ['/api/demo/visitors','GET'], ['/api/demo/visitors','DELETE'], ['/api/demo/workspace-extra','GET'],
  ])('keeps %s %s blocked before invoking any demo handler', async (path, method) => {
    const handler = vi.fn(() => Response.json({ unsafe: true }))
    const {response,next} = await boundary(path, method, handler)
    expect(response.status).toBe(403)
    expect(handler).not.toHaveBeenCalled()
    expect(next).not.toHaveBeenCalled()
  })
  it.each(['/api/override','/api/applications','/api/track/AX-ABC-123/signoff','/api/tools/tool'])('does not authenticate or unlock business data at %s', async path => {
    const handler = vi.fn(() => Response.json({ unsafe: true }))
    const {response} = await boundary(path, 'GET', handler, realEnv(), { 'Cf-Access-Authenticated-User-Email': 'forged@local.invalid' })
    expect(response.status).toBe(401)
    expect(handler).not.toHaveBeenCalled()
  })
  it('preserves enabled-demo status and the workspace requirement on business APIs', async () => {
    const env = { ...realEnv(), DEMO_WORKSPACES: 'true' }
    const status = await boundary('/api/demo/workspace', 'GET', onRequestGet, env)
    expect(await status.response.json()).toEqual({ enabled: true, active: false })
    const protectedRoute = await boundary('/api/applications', 'GET', vi.fn(), env)
    expect(protectedRoute.response.status).toBe(428)
    expect(protectedRoute.next).not.toHaveBeenCalled()
  })
})
