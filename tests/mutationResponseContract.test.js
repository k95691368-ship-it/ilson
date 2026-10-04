import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { api } from '../src/api/client.ts'
import { beginAccessCheck, completeAccessCheck, getAccessSession } from '../src/lib/accessSession.js'

beforeEach(() => completeAccessCheck(beginAccessCheck(), { ok: true, mode: 'access', scope: 'a'.repeat(64) }))
afterEach(() => vi.unstubAllGlobals())

it.each([{}, [], { ok: false }, { ok: true, id: null }])('preserves an uncertain key after consumer-invalid success %j', async malformed => {
  const keys = [], options = { validateResponse: value => value?.ok === true && value.id === 'confirmed-id' }
  const fetcher = vi.fn(async (_url, init) => {
    expect(init).not.toHaveProperty('validateResponse')
    keys.push(init.headers.get('X-Idempotency-Key'))
    return Response.json(keys.length === 1 ? malformed : { ok: true, id: 'confirmed-id' })
  })
  vi.stubGlobal('fetch', fetcher)
  const payload = { action: 'contract-test', value: JSON.stringify(malformed) }
  await expect(api.post('/codes', payload, options)).rejects.toMatchObject({ status: 502, notSaved: false })
  expect(getAccessSession().status).toBe('active')
  await expect(api.post('/codes', payload, options)).resolves.toEqual({ ok: true, id: 'confirmed-id' })
  await api.post('/codes', payload, options)
  expect(keys[1]).toBe(keys[0]); expect(keys[2]).not.toBe(keys[1])
})

it('preserves the key when a synchronous decoder throws and keeps old callers opt-in', async () => {
  const keys = []
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    keys.push(init.headers.get('X-Idempotency-Key'))
    return Response.json({ legacy: true })
  }))
  const payload = { action: 'decoder-throw' }
  await expect(api.post('/codes', payload, { validateResponse: () => { throw new Error('invalid consumer shape') } })).rejects.toMatchObject({ status: 502 })
  await expect(api.post('/codes', payload)).resolves.toEqual({ legacy: true })
  expect(keys[1]).toBe(keys[0])
})

it('does not substitute a decoder error for an actual current permission denial', async () => {
  const validateResponse = vi.fn(() => false)
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: '권한이 없습니다.' }, { status: 403 })))
  await expect(api.post('/codes', { action: 'denied' }, { validateResponse })).rejects.toMatchObject({ status: 403 })
  expect(validateResponse).not.toHaveBeenCalled()
})
