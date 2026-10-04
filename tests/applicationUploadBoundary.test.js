// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { onRequestPost } from '../functions/api/applications/index.js'
import { checkRateLimit, releaseRateLimit } from '../functions/_lib/rateLimit.js'

vi.mock('../functions/_lib/rateLimit.js', () => ({
  checkRateLimit: vi.fn(async () => 123), releaseRateLimit: vi.fn(async () => true),
}))

it('does not silently accept and discard application file attachments', async () => {
  const form = new FormData()
  form.set('title', '신청서')
  form.set('unexpectedField', new File(['local only'], 'report.csv'))
  const prepare = vi.fn()
  const response = await onRequestPost({ env: { DB: { prepare } }, request: new Request('https://ilson.test/api/applications', { method: 'POST', body: form }) })
  expect(response.status).toBe(400)
  expect((await response.json()).error).toContain('텍스트만')
  expect(prepare).not.toHaveBeenCalled()
  expect(checkRateLimit).not.toHaveBeenCalled()
  expect(releaseRateLimit).not.toHaveBeenCalled()
})

it('fails closed without an atomic application capability instead of using legacy individual writes', async () => {
  const form = new FormData()
  for (const [key, value] of Object.entries({ dept: '재무', applicant_label: '합성 담당자', title: '합성 신청' })) form.set(key, value)
  const prepare = vi.fn(), batch = vi.fn()
  const response = await onRequestPost({ env: { DB: { prepare, batch } }, request: new Request('https://ilson.test/api/applications', {
    method: 'POST', headers: { 'X-Idempotency-Key': crypto.randomUUID() }, body: form,
  }) })
  expect(response.status).toBe(503)
  expect(await response.json()).toMatchObject({ notSaved: true })
  expect(prepare).not.toHaveBeenCalled(); expect(batch).not.toHaveBeenCalled()
})
