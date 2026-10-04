// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { createSupabaseDb } from '../functions/_lib/dbBridge.ts'
import { onRequestPost } from '../functions/api/applications/index.js'

const key = 'application-intent-1234', fingerprint = 'a'.repeat(64)
const payload = { id: 'app_' + 'a'.repeat(20), ticket_no: 'AX-ABC-234', dept: '재무', applicant_label: '합성 담당자', title: '합성 신청', bottleneck: '', problem: '' }
const responseBody = { id: payload.id, ticket_no: payload.ticket_no, message: '접수됐습니다.' }
const request = () => {
  const form = new FormData()
  for (const [name, value] of Object.entries(payload)) form.set(name, value)
  return new Request('https://local.invalid/api/applications', { method: 'POST', headers: { 'X-Idempotency-Key': key }, body: form })
}
afterEach(() => vi.unstubAllGlobals())

it.each([[null, null], ['a'.repeat(64), null], [null, 'actor@local.invalid']])('forwards exactly the bridge-owned token/actor scope %j %j', async (token, actor) => {
  const fetch = vi.fn(async () => Response.json({ response: { status: 201, body: responseBody }, replayed: false }))
  vi.stubGlobal('fetch', fetch)
  const DB = createSupabaseDb('https://application-local.supabase.co', 'local-only', token, actor)
  expect(await DB.recordApplication('apply:local', key, fingerprint, payload)).toEqual({ response: { status: 201, body: responseBody }, replayed: false })
  expect(fetch).toHaveBeenCalledOnce()
  const [url, options] = fetch.mock.calls[0]
  expect(url).toBe('https://application-local.supabase.co/rest/v1/rpc/ilson_record_application')
  expect(JSON.parse(options.body)).toEqual({ p_token: token, p_actor: actor, p_bucket: 'apply:local', p_request_id: key, p_fingerprint: fingerprint, p_application: payload })
})

it.each([null, [], {}, { response: { status: 201, body: responseBody } }, { response: { status: 201 }, replayed: false }])('rejects a malformed RPC receipt envelope without another RPC: %j', async data => {
  const fetch = vi.fn(async () => Response.json(data))
  vi.stubGlobal('fetch', fetch)
  const DB = createSupabaseDb('https://application-local.supabase.co', 'local-only')
  await expect(DB.recordApplication('apply:local', key, fingerprint, payload)).rejects.toThrow('Invalid Supabase mutation response')
  expect(fetch).toHaveBeenCalledOnce()
})

it.each([
  { status: 201, body: {} }, { status: 201, body: [] }, { status: 201, body: { id: '', ticket_no: '', message: '' } },
  { status: 200, body: responseBody }, { status: 429, body: { error: 'unverified refusal' } },
])('does not mark an invalid application-specific receipt as known-unsaved: %j', async response => {
  const recordApplication = vi.fn(async () => ({ response, replayed: false })), prepare = vi.fn()
  const result = await onRequestPost({ env: { DB: { recordApplication, prepare } }, request: request() })
  expect(result.status).toBe(503)
  expect((await result.json()).notSaved).not.toBe(true)
  expect(recordApplication).toHaveBeenCalledOnce()
  expect(prepare).not.toHaveBeenCalled()
})

it('does not expose upstream failure details or refund an uncertain response', async () => {
  const recordApplication = vi.fn(async () => { throw new Error('secret-db-sql-token') }), prepare = vi.fn(), releaseRateLimit = vi.fn()
  const result = await onRequestPost({ env: { DB: { recordApplication, prepare, releaseRateLimit } }, request: request() })
  expect(result.status).toBe(503)
  const body = await result.json()
  expect(JSON.stringify(body)).not.toContain('secret-db-sql-token')
  expect(body.notSaved).not.toBe(true)
  expect(releaseRateLimit).not.toHaveBeenCalled(); expect(prepare).not.toHaveBeenCalled()
})
