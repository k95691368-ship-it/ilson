// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Ready } from '../src/pages/HonestyPage.jsx'
import { beginAccessCheck, completeAccessCheck } from '../src/lib/accessSession.js'

const healthy = (provider = 'supabase') => ({ ready: true, checks: {
  db: true, schema: true, provider, ...(provider === 'supabase' ? { runtime: true, capacity: true } : {}),
}, notes: [] })
const activate = () => completeAccessCheck(beginAccessCheck(), { ok: true, mode: 'access', scope: 'c'.repeat(64) })
function deferred() { let resolve; const promise = new Promise(yes => { resolve = yes }); return { promise, resolve } }

beforeEach(() => { activate() })
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

it.each(['supabase', 'd1'])('renders the current public %s contract without needing table names or counts', async provider => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(healthy(provider))))
  render(<Ready />)
  await screen.findByText(/이 배포는 준비된 상태입니다/)
  expect(screen.getByRole('status').textContent).toContain(provider === 'supabase' ? 'Supabase' : 'Cloudflare D1')
  expect(screen.getByRole('status').textContent).not.toMatch(/\d+개|R2/)
  if (provider === 'supabase') expect(screen.getByRole('status').textContent).toContain('운영 접근 조건')
})

it('makes an actual 503 visible without reflecting its details, then recovers through the existing GET path', async () => {
  const fetcher = vi.fn(async () => fetcher.mock.calls.length === 1
    ? Response.json({ ready: false, error: 'private-table-and-migration-sentinel', checks: { db: false }, notes: ['private-table'] }, { status: 503 })
    : Response.json(healthy()))
  vi.stubGlobal('fetch', fetcher); render(<Ready />)
  await screen.findByText('배포 상태를 확인하지 못했습니다')
  expect(document.body.textContent).not.toMatch(/private-table|준비된 상태입니다/)
  fireEvent.click(screen.getByRole('button', { name: '상태 다시 확인' }))
  await screen.findByText(/이 배포는 준비된 상태입니다/)
  expect(fetcher.mock.calls.map(call => call[0])).toEqual(['/api/health', '/api/health'])
})

it('does not turn a malformed or contradictory success payload into a readiness claim', async () => {
  const responses = [{}, { ready: true, checks: { db: 'true', schema: true, provider: 'd1' } },
    { ready: true, checks: { db: true, schema: true, provider: 'supabase', runtime: false, capacity: true } },
    { ready: true, checks: { db: true, schema: true, provider: 'unknown' } }]
  const fetcher = vi.fn(async () => Response.json(responses.shift()))
  vi.stubGlobal('fetch', fetcher); render(<Ready />)
  for (let index = 0; index < 4; index++) {
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(index + 1))
    const retry = await screen.findByRole('button', { name: '상태 다시 확인' })
    expect(document.body.textContent).not.toContain('이 배포는 준비된 상태입니다')
    if (index < 3) fireEvent.click(retry)
  }
})

it('keeps a pending status request unconfirmed and disables the explicit retry during the request', async () => {
  const pending = deferred(), fetcher = vi.fn(async () => fetcher.mock.calls.length === 1
    ? Response.json({ error: 'unavailable' }, { status: 503 }) : pending.promise)
  vi.stubGlobal('fetch', fetcher); render(<Ready />)
  const retry = await screen.findByRole('button', { name: '상태 다시 확인' })
  fireEvent.click(retry)
  await waitFor(() => expect(screen.getByRole('button', { name: '확인 중…' }).disabled).toBe(true))
  expect(document.body.textContent).not.toContain('이 배포는 준비된 상태입니다')
  await act(async () => pending.resolve(Response.json(healthy())))
  await screen.findByText(/이 배포는 준비된 상태입니다/)
})

it('discards an old account request when its response completes after the access generation changes', async () => {
  const pending = deferred(), fetcher = vi.fn(async () => fetcher.mock.calls.length === 1 ? pending.promise
    : Response.json({ error: 'unavailable' }, { status: 503 }))
  vi.stubGlobal('fetch', fetcher); render(<Ready />)
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
  act(() => { activate() })
  await screen.findByText('배포 상태를 확인하지 못했습니다')
  await act(async () => pending.resolve(Response.json(healthy())))
  expect(document.body.textContent).not.toContain('이 배포는 준비된 상태입니다')
})
