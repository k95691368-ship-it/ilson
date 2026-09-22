// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { onRequestPost } from '../functions/api/applications/index.js'
import { releaseRateLimit } from '../functions/_lib/rateLimit.js'

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
  expect(releaseRateLimit).toHaveBeenCalledWith(expect.anything(), 'apply:unknown', 123)
})
