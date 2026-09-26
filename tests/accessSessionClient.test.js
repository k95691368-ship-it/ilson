import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, ensureWorkspace, readAccessSession } from '../src/api/client.ts'
import { beginAccessCheck, completeAccessCheck, getAccessSession, revokeAccess } from '../src/lib/accessSession.js'

const A = 'a'.repeat(64)
const B = 'b'.repeat(64)
const verified = scope => ({ ok: true, mode: 'access', scope })
function activate(scope = A) { completeAccessCheck(beginAccessCheck(), verified(scope)) }
function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}
beforeEach(() => { activate() })
afterEach(() => { vi.unstubAllGlobals() })

describe('current-session denial and older response isolation', () => {
  it.each([401, 428])('%s hides the current lifetime and blocks new business requests', async status => {
    const request = vi.fn(async () => Response.json({ error: '접근을 다시 확인해주세요.' }, { status }))
    vi.stubGlobal('fetch', request)
    await expect(api.get('/feedback')).rejects.toMatchObject({ status })
    expect(getAccessSession()).toMatchObject({ status: 'blocked', scope: null })
    await expect(api.post('/override', { action: 'synthetic-blocked' })).rejects.toMatchObject({ status: 401 })
    expect(request).toHaveBeenCalledTimes(1)
  })

  it.each([403, 404, 410, 429, 503])('%s stays resource-specific instead of logging out every screen', async status => {
    const generation = getAccessSession().generation
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({ error: '리소스 오류' }, { status }))
      .mockResolvedValueOnce(Response.json({ value: '다른 허용 자료' })))
    await expect(api.get('/feedback')).rejects.toMatchObject({ status })
    expect(getAccessSession()).toMatchObject({ generation, status: 'active', scope: A })
    await expect(api.get('/override')).resolves.toEqual({ value: '다른 허용 자료' })
  })

  it.each([200, 401, 428])('an older %s response cannot restore data or revoke a newly verified scope', async status => {
    const result = deferred()
    vi.stubGlobal('fetch', vi.fn(() => result.promise))
    const old = api.get('/private-old')
    const rejection = expect(old).rejects.toMatchObject({ status: 409, code: 'ACCESS_CHANGED' })
    activate(B)
    result.resolve(Response.json({ value: '이전 원문', error: '이전 거부' }, { status }))
    await rejection
    expect(getAccessSession()).toMatchObject({ status: 'active', scope: B })
  })

  it('checks identity again after asynchronously reading the JSON body', async () => {
    const body = deferred()
    const entered = deferred()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: () => { entered.resolve(); return body.promise } })))
    const old = api.get('/slow-json')
    const rejection = expect(old).rejects.toMatchObject({ code: 'ACCESS_CHANGED' })
    await entered.promise
    activate(B)
    body.resolve({ evidence: '이전 원문' })
    await rejection
    expect(getAccessSession().scope).toBe(B)
  })

  it('does not let an already cancelled request revoke even the same session', async () => {
    const result = deferred()
    vi.stubGlobal('fetch', vi.fn(() => result.promise))
    const controller = new AbortController()
    const generation = getAccessSession().generation
    const old = api.get('/cancelled', { signal: controller.signal })
    const rejection = expect(old).rejects.toMatchObject({ code: 'ACCESS_CHANGED' })
    controller.abort()
    result.resolve(Response.json({ error: '취소된 조회' }, { status: 401 }))
    await rejection
    expect(getAccessSession()).toMatchObject({ generation, status: 'active', scope: A })
  })

  it('also discards an old network failure after the new session has been verified', async () => {
    const result = deferred()
    vi.stubGlobal('fetch', vi.fn(async () => { await result.promise; throw Error('offline') }))
    const old = api.get('/old-network')
    const rejection = expect(old).rejects.toMatchObject({ code: 'ACCESS_CHANGED' })
    activate(B)
    result.resolve()
    await rejection
    expect(getAccessSession().scope).toBe(B)
  })
})

describe('explicit protected recovery', () => {
  it('allows only the session probe while locked and does not unlock from HTTP success alone', async () => {
    const generation = beginAccessCheck()
    const fetcher = vi.fn(async () => Response.json(verified(B)))
    vi.stubGlobal('fetch', fetcher)
    await expect(api.get('/override')).rejects.toMatchObject({ status: 401 })
    const result = await readAccessSession(generation)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0][0]).toBe('/api/session')
    expect(fetcher.mock.calls[0][1]).not.toHaveProperty('sessionProbe')
    expect(getAccessSession().status).toBe('checking')
    expect(completeAccessCheck(generation, result)).toBe(true)
    expect(getAccessSession()).toMatchObject({ status: 'active', scope: B })
  })

  it.each([null, {}, { ok: false, mode: 'access', scope: A }, { ok: true, mode: 'unknown', scope: A },
    { ok: true, mode: 'access', scope: [A] }, { ok: true, mode: 'access', scope: 'a'.repeat(63) },
    { ok: true, mode: 'access', scope: 'z'.repeat(64) }])('rejects malformed confirmation %j', body => {
    const generation = beginAccessCheck()
    expect(completeAccessCheck(generation, body)).toBe(false)
    expect(getAccessSession()).toMatchObject({ status: 'checking', scope: null })
  })

  it('never reuses prefetched business data from before a recovery attempt', () => {
    vi.stubGlobal('window', { __boot: { '/override': Promise.resolve(Response.json({ original: true })) } })
    beginAccessCheck()
    expect(window.__boot).toBeUndefined()
  })

  it('reuses uncertain mutation keys only within the same verified account', async () => {
    const keys = []
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
      keys.push(options.headers.get('X-Idempotency-Key'))
      return Response.json({ error: '응답 확인 불가' }, { status: 503 })
    }))
    const payload = { action: 'same-account-recovery' }
    await expect(api.post('/override', payload)).rejects.toMatchObject({ status: 503 })
    revokeAccess(getAccessSession().generation)
    activate(A)
    await expect(api.post('/override', payload)).rejects.toMatchObject({ status: 503 })
    activate(B)
    await expect(api.post('/override', payload)).rejects.toMatchObject({ status: 503 })
    expect(keys[1]).toBe(keys[0])
    expect(keys[2]).not.toBe(keys[0])
  })

  it('does not reuse the old resolved workspace promise after a session transition', async () => {
    const methods = []
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
      methods.push(options.method || 'GET')
      return Response.json({ enabled: true, active: options.method === 'POST' })
    }))
    await ensureWorkspace({ fresh: true })
    await ensureWorkspace()
    expect(methods).toEqual(['GET', 'POST'])
    activate(B)
    await ensureWorkspace({ fresh: true })
    expect(methods).toEqual(['GET', 'POST', 'GET', 'POST'])
  })
})
