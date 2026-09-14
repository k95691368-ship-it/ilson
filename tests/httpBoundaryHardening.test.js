// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { onRequest } from '../functions/api/_middleware.js'
import { failUnexpected, ok } from '../functions/_lib/http.js'
import { onRequestGet as health } from '../functions/api/health.js'
import { requestBodyLimit } from '../functions/_lib/requestBody.js'

vi.mock('../functions/_lib/rateLimit.js', () => ({ checkRateLimit: vi.fn(async () => true) }))
const env = { DBBridgeApplied: true, OVERRIDE_DEMO_MODE: 'true' }
const sentry = 'private-sql-and-credential-sentinel'
const run = (request, next, options = env) => onRequest({ request, next: bounded => next(bounded ?? request), env: options })
const post = body => new Request('https://ilson.test/api/override', { method: 'POST', body })

describe('API resource and information boundary', () => {
  it('never reflects an unexpected exception into the response', async () => {
    expect(await failUnexpected(new Error(sentry), '저장하지 못했습니다.').json()).toEqual({ error: '저장하지 못했습니다.' })
    const response = await health({ env: { DB: { prepare() { throw Error(sentry) } } } })
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain(sentry)
  })
  it('does not interpolate raw exception details in any API route', () => {
    const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(item => item.isDirectory() ? walk(join(dir, item.name)) : [join(dir, item.name)])
    for (const file of walk('functions/api').filter(file => file.endsWith('.js'))) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/\$\{String\(err(?:or)?\.message\)/)
    }
  })
  it('protects normal, early-error, and thrown-error responses without losing cookies', async () => {
    const normal = await run(new Request('https://ilson.test/api/override'), async () => new Response('ok', { headers: { 'Set-Cookie': 'session=test; HttpOnly', Vary: 'Accept', 'Cache-Control': 'public' } }))
    const denied = await run(new Request('https://ilson.test/api/override'), vi.fn(), { DEMO_WORKSPACES: 'true' })
    const unexpected = await run(new Request('https://ilson.test/api/override'), async () => { throw Error(sentry) })
    expect(unexpected.status).toBe(503)
    expect(await unexpected.text()).not.toContain(sentry)
    for (const response of [normal, denied, unexpected, ok({ ok: true })]) {
      expect(response.headers.get('Cache-Control')).toBe('private, no-store')
      expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
      expect(response.headers.get('Referrer-Policy')).toBe('no-referrer')
    }
    expect(normal.headers.get('Set-Cookie')).toContain('HttpOnly')
    expect(normal.headers.get('Vary')).toContain('Accept')
    expect(normal.headers.get('Vary')).toContain('Cookie')
    expect(normal.headers.get('Vary')).toContain('Authorization')
  })
  it('rejects excessive advertised sizes before reaching a handler', async () => {
    const next = vi.fn()
    const request = new Request('https://ilson.test/api/override', { method: 'POST', body: '{}', headers: { 'Content-Length': '999999999' } })
    expect((await run(request, next)).status).toBe(413)
    expect(next).not.toHaveBeenCalled()
  })
  it.each([undefined, '1'])('bounds actual streamed bytes even with Content-Length %s', async length => {
    let wrote = false
    let cancelled = false
    const stream = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(65536).fill(32)) }, cancel() { cancelled = true } })
    const request = new Request('https://ilson.test/api/override', { method: 'POST', body: stream, duplex: 'half', headers: length ? { 'Content-Length': length } : {} })
    const response = await run(request, async bounded => {
      try { await bounded.json() } catch { return new Response('bad json', { status: 400 }) }
      wrote = true
      return ok({ ok: true })
    })
    expect(response.status).toBe(413)
    expect(wrote).toBe(false)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(cancelled).toBe(true)
  })
  it('preserves valid JSON and multipart file requests', async () => {
    const response = await run(post(JSON.stringify({ note: '정상 입력' })), async bounded => ok(await bounded.json()))
    expect(await response.json()).toEqual({ note: '정상 입력' })
    const form = new FormData()
    form.set('title', '신청서')
    form.set('files', new File(['col\nvalue'], 'sample.csv', { type: 'text/csv' }))
    const multipart = new Request('https://ilson.test/api/applications', { method: 'POST', body: form })
    const saved = await run(multipart, async bounded => {
      const received = await bounded.formData()
      return ok({ title: received.get('title'), file: await received.get('files').text() })
    })
    expect(await saved.json()).toEqual({ title: '신청서', file: 'col\nvalue' })
  })
  it('uses larger limits only for the existing attachment and settlement endpoints', () => {
    const make = (path, method = 'POST', type = 'application/json') => new Request('https://ilson.test' + path, { method, headers: { 'Content-Type': type } })
    expect(requestBodyLimit(make('/api/override'))).toBe(1024 * 1024)
    expect(requestBodyLimit(make('/api/applications/a/build'))).toBe(16 * 1024 * 1024)
    expect(requestBodyLimit(make('/api/applications', 'POST', 'multipart/form-data; boundary=test'))).toBe(51 * 1024 * 1024)
    expect(requestBodyLimit(make('/api/override', 'POST', 'multipart/form-data; boundary=test'))).toBe(1024 * 1024)
    expect(requestBodyLimit(make('/api/applications/a/build', 'PUT'))).toBe(1024 * 1024)
  })
  it('accepts an exact-limit UTF-8 body but not one byte more', async () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ value: '한글' }))
    const body = new Uint8Array(1024 * 1024).fill(32)
    body.set(bytes)
    const response = await run(post(body), async bounded => ok(await bounded.json()))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ value: '한글' })
    const excessive = new Uint8Array(body.length + 1).fill(32)
    excessive.set(bytes)
    const rejected = await run(post(excessive), async bounded => ok(await bounded.json()))
    expect(rejected.status).toBe(413)
  })
  it('cancels an unread body on early rejection', async () => {
    const cancel = vi.fn()
    const body = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(8)) }, cancel })
    const request = new Request('https://ilson.test/api/override', { method: 'POST', body, duplex: 'half' })
    expect((await run(request, vi.fn(), { DB_MAINTENANCE: 'true' })).status).toBe(503)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(cancel).toHaveBeenCalled()
  })
})
