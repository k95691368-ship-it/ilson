import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError, readWorkspace } from '../src/api/client.ts'
import { beginAccessCheck, completeAccessCheck, getAccessSession } from '../src/lib/accessSession.js'

beforeEach(() => completeAccessCheck(beginAccessCheck(), { ok: true, mode: 'demo', scope: 'a'.repeat(64) }))
afterEach(() => vi.unstubAllGlobals())

describe('API JSON boundary normalization', () => {
  it('retains valid per-field messages without treating arbitrary field JSON as display text', () => {
    const error = new ApiError('입력 오류', { status: 400,
      fields: { reason: '근거가 필요합니다.', unsafe: { nested: true }, array: ['text'], count: 1 },
      code: ['invalid'], notSaved: 'true' })
    expect(error).toMatchObject({ status: 400, fields: { reason: '근거가 필요합니다.' }, code: null, notSaved: false })
  })

  it('keeps malformed error bodies local and never passes objects as React error text', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: { object: true }, fields: ['bad'], code: 123 }, { status: 403 })))
    await expect(api.get('/contract-only')).rejects.toMatchObject({
      name: 'ApiError', status: 403, message: '요청에 실패했습니다.', fields: null, code: null,
    })
    expect(getAccessSession().status).toBe('active')
  })

  it('does not silently interpret invalid workspace JSON as a verified workspace state', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ enabled: 'true', active: true })))
    await expect(readWorkspace()).rejects.toThrow('체험 공간을 확인하지 못했습니다.')
  })

  it('rejects a truncated successful mutation without changing its retry key', async () => {
    const keys = []
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
      keys.push(options.headers.get('X-Idempotency-Key'))
      return new Response('truncated-json', { status: 200 })
    }))
    await expect(api.post('/contract-only', { reason: 'same body' })).rejects.toMatchObject({ status: 502 })
    await expect(api.post('/contract-only', { reason: 'same body' })).rejects.toMatchObject({ status: 502 })
    expect(keys[1]).toBe(keys[0])
  })
})
