import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError, readWorkspace } from '../src/api/client.ts'
import { beginAccessCheck, completeAccessCheck, getAccessSession } from '../src/lib/accessSession.js'

beforeEach(() => completeAccessCheck(beginAccessCheck(), { ok: true, mode: 'demo', scope: 'a'.repeat(64) }))
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

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

  it('keeps a caller-owned UUID across 409, 429, malformed success and more than 30 minutes', async () => {
    const idempotencyKey = '11111111-1111-4111-8111-111111111111', calls = []
    let time = 100000, status = 409
    vi.spyOn(Date, 'now').mockImplementation(() => time)
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
      calls.push(options)
      return Response.json(status === 200 ? {} : { error: 'uncertain result' }, { status })
    }))
    const options = { idempotencyKey, validateResponse: value => value?.ok === true }
    for (const next of [409,429,200]) {
      status = next
      await expect(api.post('/contract-explicit', { reason: 'same body' }, options)).rejects.toBeInstanceOf(ApiError)
      time += 31 * 60000
    }
    expect(calls.map(call => call.headers.get('X-Idempotency-Key'))).toEqual([idempotencyKey,idempotencyKey,idempotencyKey])
    expect(calls.every(call => !Object.hasOwn(call, 'idempotencyKey') && !Object.hasOwn(call, 'validateResponse'))).toBe(true)
    expect(calls.every(call => call.headers.get('X-Ilson-Scope') === 'a'.repeat(64))).toBe(true)
  })

  it.each(['', 'not-a-uuid', null, 42, {}, '11111111-1111-4111-8111-111111111111\n'])('rejects an invalid explicit key before fetch: %j', async idempotencyKey => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    await expect(api.post('/contract-explicit', {}, { idempotencyKey })).rejects.toMatchObject({ status: 400, notSaved: true })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('does not change automatic callers when explicit keys are used for the same body', async () => {
    const keys = [], idempotencyKey = '22222222-2222-4222-8222-222222222222'
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
      keys.push(options.headers.get('X-Idempotency-Key'))
      return Response.json({ error: 'retry' }, { status: 503 })
    }))
    await expect(api.post('/contract-mixed', { a: 1 })).rejects.toMatchObject({ status: 503 })
    await expect(api.post('/contract-mixed', { a: 1 }, { idempotencyKey })).rejects.toMatchObject({ status: 503 })
    await expect(api.post('/contract-mixed', { a: 1 })).rejects.toMatchObject({ status: 503 })
    expect(keys[1]).toBe(idempotencyKey)
    expect(keys[2]).toBe(keys[0])
    expect(keys[0]).not.toBe(idempotencyKey)
  })
})
