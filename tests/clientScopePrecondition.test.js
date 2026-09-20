import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const A = 'a'.repeat(64), B = 'b'.repeat(64)
let client, session
const activate = scope => session.completeAccessCheck(session.beginAccessCheck(), { ok: true, mode: 'demo', scope })
beforeEach(async () => {
  vi.resetModules()
  client = await import('../src/api/client.js')
  session = await import('../src/lib/accessSession.js')
})
afterEach(() => vi.unstubAllGlobals())

describe('verified request identity preconditions', () => {
  it('does not send business requests or reset an unverified space', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    await expect(client.api.get('/override')).rejects.toMatchObject({ status: 401 })
    await expect(client.api.post('/applications', { title: 'local draft' })).rejects.toMatchObject({ status: 401 })
    await expect(client.resetWorkspace()).rejects.toMatchObject({ status: 401 })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it.each(['get', 'post', 'put', 'patch', 'remove', 'form'])('%s carries the confirmed scope without replacing authentication', async method => {
    activate(A)
    const fetcher = vi.fn(async () => Response.json({ ok: true }))
    vi.stubGlobal('fetch', fetcher)
    await client.api[method]('/local-example', method === 'form' ? new FormData() : { value: 'test' })
    const [, options] = fetcher.mock.calls[0]
    expect(options.headers.get('X-Ilson-Scope')).toBe(A)
    expect(options.headers.get('X-Ilson-Request')).toBe('1')
    expect(options.credentials).toBe('same-origin')
    expect(options.headers.get('Authorization')).toBeNull()
  })

  it('does not pin the explicit session probe to the old account', async () => {
    activate(A)
    const generation = session.beginAccessCheck()
    const fetcher = vi.fn(async () => Response.json({ ok: true, mode: 'demo', scope: B }))
    vi.stubGlobal('fetch', fetcher)
    const result = await client.readAccessSession(generation)
    expect(fetcher.mock.calls[0][1].headers.has('X-Ilson-Scope')).toBe(false)
    expect(session.completeAccessCheck(generation, result)).toBe(true)
    expect(session.getAccessSession().scope).toBe(B)
  })

  it.each([[428, 'SESSION_SCOPE_REQUIRED'], [400, 'SESSION_SCOPE_INVALID'], [409, 'SESSION_SCOPE_CHANGED']])('%s %s locks the protected tree without retrying a write', async (status, code) => {
    activate(A)
    const fetcher = vi.fn(async () => Response.json({ error: '접근을 다시 확인해주세요.', code }, { status }))
    vi.stubGlobal('fetch', fetcher)
    await expect(client.api.post('/applications/example/ask', { question: 'A-only' })).rejects.toMatchObject({ status, code })
    expect(session.getAccessSession()).toMatchObject({ status: 'blocked', scope: null })
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('keeps an ordinary revision conflict local to the form', async () => {
    activate(A)
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ code: 'REVIEW_CHANGED', error: '새 판정을 확인해주세요.' }, { status: 409 })))
    await expect(client.api.post('/applications/example/review', {})).rejects.toMatchObject({ status: 409 })
    expect(session.getAccessSession()).toMatchObject({ status: 'active', scope: A })
  })

  it('pins reset to the displayed scope and locks instead of deleting another space', async () => {
    activate(A)
    const fetcher = vi.fn(async () => Response.json({ code: 'SESSION_SCOPE_CHANGED', error: '체험 공간이 변경됐습니다.' }, { status: 409 }))
    vi.stubGlobal('fetch', fetcher)
    await expect(client.resetWorkspace()).rejects.toMatchObject({ status: 409 })
    const [path, options] = fetcher.mock.calls[0]
    expect(path).toBe('/api/demo/workspace')
    expect(options.method).toBe('DELETE')
    expect(options.headers.get('X-Ilson-Scope')).toBe(A)
    expect(JSON.parse(options.body)).toEqual({ confirm: 'reset-my-workspace' })
    expect(session.getAccessSession().status).toBe('blocked')
  })

  it('discards an old mismatch response after B has been explicitly verified', async () => {
    activate(A)
    let resolve
    vi.stubGlobal('fetch', vi.fn(() => new Promise(done => { resolve = done })))
    const old = client.api.get('/applications')
    const assertion = expect(old).rejects.toMatchObject({ code: 'ACCESS_CHANGED' })
    activate(B)
    resolve(Response.json({ code: 'SESSION_SCOPE_CHANGED' }, { status: 409 }))
    await assertion
    expect(session.getAccessSession()).toMatchObject({ status: 'active', scope: B })
  })
})
