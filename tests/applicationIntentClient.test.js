import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let client, session, storage
const A = 'a'.repeat(64), B = 'b'.repeat(64)
const activate = scope => session.completeAccessCheck(session.beginAccessCheck(), { ok: true, mode: 'demo', scope })
const form = (title = 'PRIVATE_APPLICATION_TITLE') => { const value = new FormData(); value.append('title', title); value.append('contact', 'private@example.invalid'); return value }
const receipt = () => Response.json({ id: 'app_local', ticket_no: 'AX-LOCAL-1', message: '접수됨' }, { status: 201 })
const storageKey = scope => `ilson.application-intent.v1:${scope}`
async function loadClient() { vi.resetModules(); client = await import('../src/api/client.ts'); session = await import('../src/lib/accessSession.js'); activate(A) }
beforeEach(async () => {
  storage = new Map()
  vi.stubGlobal('localStorage', { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) })
  vi.stubGlobal('navigator', { locks: { request: async (_name, action) => action() } })
  await loadClient()
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers() })

describe('application submission intent identity', () => {
  it('retries uncertain text FormData with one UUID while a confirmed repeated submission gets a new UUID', async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(receipt()).mockResolvedValueOnce(receipt())
    vi.stubGlobal('fetch', fetcher)
    await expect(client.api.form('/applications', form())).rejects.toMatchObject({ status: 0 })
    await client.api.form('/applications', form())
    await client.api.form('/applications', form())
    const keys = fetcher.mock.calls.map(([, options]) => options.headers.get('X-Idempotency-Key'))
    expect(keys[0]).toMatch(/^[a-zA-Z0-9_-]{16,100}$/)
    expect(keys[1]).toBe(keys[0]); expect(keys[2]).not.toBe(keys[0])
  })

  it.each([new Response('truncated', { status: 201 }), Response.json({}), Response.json([]), Response.json({ id: 'app_local' })])('retains the key when a successful HTTP response is not an application receipt', async response => {
    const fetcher = vi.fn().mockResolvedValueOnce(response).mockResolvedValueOnce(receipt())
    vi.stubGlobal('fetch', fetcher)
    await expect(client.api.form('/applications', form())).rejects.toMatchObject({ status: 502 })
    await client.api.form('/applications', form())
    expect(fetcher.mock.calls[0][1].headers.get('X-Idempotency-Key')).toBe(fetcher.mock.calls[1][1].headers.get('X-Idempotency-Key'))
  })

  it('blocks edited uncertain contents until explicitly confirmed, and isolates another scope', async () => {
    const fetcher = vi.fn(async () => Response.json({ error: 'uncertain' }, { status: 503 }))
    vi.stubGlobal('fetch', fetcher)
    await expect(client.api.form('/applications', form())).rejects.toMatchObject({ status: 503 })
    await expect(client.api.form('/applications', form('edited'))).rejects.toMatchObject({ code: 'APPLICATION_INTENT_UNRESOLVED' })
    expect(fetcher).toHaveBeenCalledTimes(1)
    activate(B)
    await expect(client.api.form('/applications', form())).rejects.toMatchObject({ status: 503 })
    activate(A)
    await expect(client.api.form('/applications', form())).rejects.toMatchObject({ status: 503 })
    const keys = fetcher.mock.calls.map(([, options]) => options.headers.get('X-Idempotency-Key'))
    expect(keys[1]).not.toBe(keys[0]); expect(keys[2]).toBe(keys[0])
    await expect(client.api.form('/applications', form('edited'), { confirmedNewIntent: true })).rejects.toMatchObject({ status: 503 })
    expect(fetcher.mock.calls[3][1].headers.get('X-Idempotency-Key')).not.toBe(keys[0])
  })

  it('snapshots text before asynchronous identity hashing and refuses file attachments', async () => {
    const value = form(), fetcher = vi.fn(async () => receipt())
    vi.stubGlobal('fetch', fetcher)
    const pending = client.api.form('/applications', value)
    value.set('title', 'CHANGED_AFTER_SUBMIT')
    await pending
    expect(fetcher.mock.calls[0][1].body.get('title')).toBe('PRIVATE_APPLICATION_TITLE')
    const withFile = form(); withFile.append('attachment', new Blob(['PRIVATE_FILE']), 'secret.txt')
    await expect(client.api.form('/applications', withFile)).rejects.toMatchObject({ code: 'FORM_FILES_UNSUPPORTED' })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('does not fetch after revocation during asynchronous hashing', async () => {
    const original = crypto.subtle.digest.bind(crypto.subtle)
    let release, entered
    const hashing = new Promise(resolve => { entered = resolve })
    vi.spyOn(crypto.subtle, 'digest').mockImplementation((algorithm, data) => new Promise(resolve => { release = () => original(algorithm, data).then(resolve); entered() }))
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    const pending = client.api.form('/applications', form())
    const assertion = expect(pending).rejects.toMatchObject({ code: 'ACCESS_CHANGED' })
    await hashing; activate(B); await release(); await assertion
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('fails closed when cryptographic retry identity cannot be created', async () => {
    vi.spyOn(crypto.subtle, 'digest').mockRejectedValueOnce(new Error('unavailable'))
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    await expect(client.api.form('/applications', form())).rejects.toMatchObject({ code: 'MUTATION_IDENTITY_UNAVAILABLE' })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('keeps only opaque retry metadata through a full module reload and reuses the original key', async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new Error('lost receipt')).mockResolvedValueOnce(receipt())
    vi.stubGlobal('fetch', fetcher)
    await expect(client.api.form('/applications', form())).rejects.toMatchObject({ status: 0 })
    const stored = JSON.parse(storage.get(storageKey(A)))
    expect(stored.pending.digest).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify([...storage])).not.toMatch(/PRIVATE_APPLICATION_TITLE|private@example|contact|title/)
    await loadClient()
    await client.api.form('/applications', form())
    expect(fetcher.mock.calls[1][1].headers.get('X-Idempotency-Key')).toBe(fetcher.mock.calls[0][1].headers.get('X-Idempotency-Key'))
    expect(JSON.parse(storage.get(storageKey(A))).pending).toBeNull()
  })

  it('does not renew a seven-day expired uncertain key without an explicit new intent', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-01T00:00:00Z'))
    const fetcher = vi.fn(async () => { throw new Error('lost receipt') }); vi.stubGlobal('fetch', fetcher)
    await expect(client.api.form('/applications', form())).rejects.toMatchObject({ status: 0 })
    const initial = JSON.parse(storage.get(storageKey(A))).pending
    vi.setSystemTime(new Date('2026-10-07T00:00:00Z'))
    await expect(client.api.form('/applications', form())).rejects.toMatchObject({ status: 0 })
    expect(JSON.parse(storage.get(storageKey(A))).pending).toMatchObject({ ...initial, attempts: 2 })
    vi.setSystemTime(new Date('2026-10-08T00:00:00Z'))
    await expect(client.api.form('/applications', form())).rejects.toMatchObject({ code: 'APPLICATION_INTENT_EXPIRED' })
    expect(fetcher).toHaveBeenCalledTimes(2)
    await expect(client.api.form('/applications', form(), { confirmedNewIntent: true })).rejects.toMatchObject({ status: 0 })
    expect(fetcher.mock.calls[2][1].headers.get('X-Idempotency-Key')).not.toBe(initial.key)
  })

  it.each([429, 503])('retains the retry key for an uncertain or deferred %s response', async status => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ error: 'later', notSaved: status === 429 }, { status })).mockResolvedValueOnce(receipt())
    vi.stubGlobal('fetch', fetcher)
    await expect(client.api.form('/applications', form())).rejects.toMatchObject({ status })
    await client.api.form('/applications', form())
    expect(fetcher.mock.calls[1][1].headers.get('X-Idempotency-Key')).toBe(fetcher.mock.calls[0][1].headers.get('X-Idempotency-Key'))
  })

  it('allows correction after a definite validation rejection but persists a conflict through reload', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ error: 'validation', notSaved: true }, { status: 400 }))
      .mockResolvedValueOnce(Response.json({ error: 'conflict', code: 'APPLICATION_INTENT_CONFLICT' }, { status: 409 }))
      .mockResolvedValueOnce(receipt())
    vi.stubGlobal('fetch', fetcher)
    await expect(client.api.form('/applications', form())).rejects.toMatchObject({ status: 400 })
    await expect(client.api.form('/applications', form('corrected'))).rejects.toMatchObject({ status: 409 })
    await loadClient()
    await expect(client.api.form('/applications', form('corrected'))).rejects.toMatchObject({ code: 'APPLICATION_INTENT_CONFLICT', notSaved: false })
    expect(fetcher).toHaveBeenCalledTimes(2)
    await client.api.form('/applications', form('corrected'), { confirmedNewIntent: true })
    expect(new Set(fetcher.mock.calls.map(([, options]) => options.headers.get('X-Idempotency-Key'))).size).toBe(3)
  })

  it.each(['unavailable', 'corrupt', 'silent-write'])('does not post when storage is %s', async kind => {
    if (kind === 'corrupt') storage.set(storageKey(A), '{bad-json')
    if (kind === 'unavailable') vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked') } })
    if (kind === 'silent-write') vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} })
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    await expect(client.api.form('/applications', form())).rejects.toMatchObject({ code: 'MUTATION_IDENTITY_UNAVAILABLE' })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('fails closed when cross-tab locking is unavailable', async () => {
    vi.stubGlobal('navigator', {})
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    await expect(client.api.form('/applications', form())).rejects.toMatchObject({ code: 'MUTATION_IDENTITY_UNAVAILABLE' })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('shares the same key across independent tab modules with one unresolved intent', async () => {
    const firstTab = client
    const fetcher = vi.fn(async () => { throw new Error('lost receipt') }); vi.stubGlobal('fetch', fetcher)
    await expect(firstTab.api.form('/applications', form())).rejects.toMatchObject({ status: 0 })
    await loadClient()
    await expect(client.api.form('/applications', form())).rejects.toMatchObject({ status: 0 })
    expect(fetcher.mock.calls[1][1].headers.get('X-Idempotency-Key')).toBe(fetcher.mock.calls[0][1].headers.get('X-Idempotency-Key'))
  })

  it('does not create a late duplicate when another tab confirms while identity hashing is in flight', async () => {
    const firstTab = client
    await loadClient()
    const secondTab = client
    const original = crypto.subtle.digest.bind(crypto.subtle)
    let resume, entered
    const delayed = new Promise(resolve => { entered = resolve })
    vi.spyOn(crypto.subtle, 'digest').mockImplementationOnce((algorithm, data) => new Promise(resolve => { resume = () => original(algorithm, data).then(resolve); entered() }))
    const fetcher = vi.fn(async () => receipt()); vi.stubGlobal('fetch', fetcher)
    const older = firstTab.api.form('/applications', form())
    const rejected = expect(older).rejects.toMatchObject({ code: 'APPLICATION_INTENT_CHANGED' })
    await delayed
    await secondTab.api.form('/applications', form())
    await resume(); await rejected
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it.each([400, 503])('does not clear a prior uncertain intent on a later notSaved %s, including an old v1 record without attempts', async status => {
    const fetcher = vi.fn().mockRejectedValueOnce(new Error('lost receipt'))
      .mockResolvedValueOnce(Response.json({ error: 'this request did not save', notSaved: true }, { status }))
      .mockResolvedValueOnce(receipt())
    vi.stubGlobal('fetch', fetcher)
    await expect(client.api.form('/applications', form())).rejects.toMatchObject({ status: 0 })
    const original = JSON.parse(storage.get(storageKey(A)))
    delete original.pending.attempts
    storage.set(storageKey(A), JSON.stringify(original))
    await loadClient()
    await expect(client.api.form('/applications', form())).rejects.toMatchObject({ status, notSaved: false })
    expect(JSON.parse(storage.get(storageKey(A))).pending.key).toBe(original.pending.key)
    await client.api.form('/applications', form())
    expect(new Set(fetcher.mock.calls.map(([, options]) => options.headers.get('X-Idempotency-Key'))).size).toBe(1)
  })

  it('preserves a concurrent uncertain attempt even when the first request later says notSaved', async () => {
    const firstTab = client; await loadClient(); const secondTab = client
    const pending = []
    const fetcher = vi.fn(() => new Promise((resolve, reject) => pending.push({ resolve, reject })))
    vi.stubGlobal('fetch', fetcher)
    const first = firstTab.api.form('/applications', form())
    const rejectedFirst = expect(first).rejects.toMatchObject({ status: 400, notSaved: false })
    await vi.waitFor(() => expect(pending).toHaveLength(1))
    const second = secondTab.api.form('/applications', form())
    const rejectedSecond = expect(second).rejects.toMatchObject({ status: 0 })
    await vi.waitFor(() => expect(pending).toHaveLength(2))
    pending[1].reject(new Error('lost receipt')); await rejectedSecond
    pending[0].resolve(Response.json({ error: 'validation', notSaved: true }, { status: 400 })); await rejectedFirst
    expect(JSON.parse(storage.get(storageKey(A))).pending.key).toBe(fetcher.mock.calls[0][1].headers.get('X-Idempotency-Key'))
  })

  it.each(['success-first', 'failure-first'])('recovers a concurrent tab from the confirmed receipt (%s)', async order => {
    const firstTab = client; await loadClient(); const secondTab = client
    const pending = []
    const fetcher = vi.fn(() => new Promise((resolve, reject) => pending.push({ resolve, reject })))
    vi.stubGlobal('fetch', fetcher)
    const first = firstTab.api.form('/applications', form())
    await vi.waitFor(() => expect(pending).toHaveLength(1))
    const second = secondTab.api.form('/applications', form())
    const outcome = order === 'success-first' ? expect(second).resolves.toMatchObject({ id: 'app_local', ticket_no: 'AX-LOCAL-1' }) : expect(second).rejects.toMatchObject({ status: 0 })
    await vi.waitFor(() => expect(pending).toHaveLength(2))
    if (order === 'failure-first') { pending[1].reject(new Error('lost receipt')); await outcome }
    pending[0].resolve(receipt()); await first
    if (order === 'success-first') { pending[1].reject(new Error('lost receipt')); await outcome }
    else {
      const retry = secondTab.api.form('/applications', form())
      await vi.waitFor(() => expect(pending).toHaveLength(3))
      pending[2].resolve(receipt())
      await expect(retry).resolves.toMatchObject({ id: 'app_local', ticket_no: 'AX-LOCAL-1' })
      expect(fetcher.mock.calls[2][1].headers.get('X-Idempotency-Key')).toBe(fetcher.mock.calls[0][1].headers.get('X-Idempotency-Key'))
    }
    expect(fetcher).toHaveBeenCalledTimes(order === 'success-first' ? 2 : 3)
    expect(fetcher.mock.calls[0][1].headers.get('X-Idempotency-Key')).toBe(fetcher.mock.calls[1][1].headers.get('X-Idempotency-Key'))
    const stored = JSON.parse(storage.get(storageKey(A)))
    expect(stored.pending).toBeNull()
    expect(stored.confirmed.receipt).toEqual({ id: 'app_local', ticket_no: 'AX-LOCAL-1' })
    expect(JSON.stringify(stored)).not.toMatch(/PRIVATE_APPLICATION_TITLE|private@example/)
  })

  it('fails closed for an old late failure after a third tab replaces the last receipt, including after reload', async () => {
    const firstTab = client; await loadClient(); const secondTab = client
    const pending = []
    const fetcher = vi.fn(() => new Promise((resolve, reject) => pending.push({ resolve, reject })))
    vi.stubGlobal('fetch', fetcher)
    const first = firstTab.api.form('/applications', form())
    await vi.waitFor(() => expect(pending).toHaveLength(1))
    const second = secondTab.api.form('/applications', form())
    const rejected = expect(second).rejects.toMatchObject({ code: 'APPLICATION_INTENT_CHANGED' })
    await vi.waitFor(() => expect(pending).toHaveLength(2))
    pending[0].resolve(receipt()); await first
    await loadClient()
    const third = client.api.form('/applications', form('a truly new intent'))
    await vi.waitFor(() => expect(pending).toHaveLength(3))
    pending[2].resolve(Response.json({ id: 'app_newer', ticket_no: 'AX-NEWER-1' }, { status: 201 })); await third
    pending[1].reject(new Error('old lost receipt')); await rejected
    expect(JSON.parse(storage.get(storageKey(A))).reviewRequired).toBe(true)
    await loadClient()
    await expect(client.api.form('/applications', form())).rejects.toMatchObject({ code: 'APPLICATION_INTENT_CHANGED' })
    expect(fetcher).toHaveBeenCalledTimes(3)
    const explicit = client.api.form('/applications', form(), { confirmedNewIntent: true })
    await vi.waitFor(() => expect(pending).toHaveLength(4))
    pending[3].resolve(receipt()); await explicit
    expect(fetcher.mock.calls[3][1].headers.get('X-Idempotency-Key')).not.toBe(fetcher.mock.calls[0][1].headers.get('X-Idempotency-Key'))
  })

  it.each([401, 403, 404, 428])('preserves an explicit %s denial even when another tab has the matching confirmed receipt', async status => {
    const firstTab = client; await loadClient(); const secondTab = client
    const pending = []
    const fetcher = vi.fn(() => new Promise(resolve => pending.push(resolve)))
    vi.stubGlobal('fetch', fetcher)
    const first = firstTab.api.form('/applications', form())
    await vi.waitFor(() => expect(pending).toHaveLength(1))
    const second = secondTab.api.form('/applications', form())
    const denial = expect(second).rejects.toMatchObject({ status })
    await vi.waitFor(() => expect(pending).toHaveLength(2))
    pending[0](receipt()); await first
    pending[1](Response.json({ error: 'Current permission denied' }, { status })); await denial
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('does not bypass a new server denial on retry by returning an older cached receipt', async () => {
    const firstTab = client; await loadClient(); const secondTab = client
    const pending = []
    const fetcher = vi.fn(() => new Promise((resolve, reject) => pending.push({ resolve, reject })))
    vi.stubGlobal('fetch', fetcher)
    const first = firstTab.api.form('/applications', form())
    await vi.waitFor(() => expect(pending).toHaveLength(1))
    const second = secondTab.api.form('/applications', form())
    const failed = expect(second).rejects.toMatchObject({ status: 0 })
    await vi.waitFor(() => expect(pending).toHaveLength(2))
    pending[1].reject(new Error('lost response')); await failed
    pending[0].resolve(receipt()); await first
    const retry = secondTab.api.form('/applications', form())
    const denied = expect(retry).rejects.toMatchObject({ status: 403 })
    await vi.waitFor(() => expect(pending).toHaveLength(3))
    pending[2].resolve(Response.json({ error: 'permission changed' }, { status: 403 })); await denied
    expect(fetcher.mock.calls[2][1].headers.get('X-Idempotency-Key')).toBe(fetcher.mock.calls[0][1].headers.get('X-Idempotency-Key'))
  })
})
