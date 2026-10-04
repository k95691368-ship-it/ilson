// @vitest-environment happy-dom
// Independent regressions retained in CI, not only a local scratch run.
import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import TeachQuarantine from '../src/components/TeachQuarantine.jsx'
import { beginAccessCheck, completeAccessCheck, getAccessSession } from '../src/lib/accessSession.js'
import { catalog } from '../shared/teach.js'

const toasts = vi.hoisted(() => ({ error: vi.fn() }))
vi.mock('../src/context/ToastContext.jsx', () => ({ useToast: () => toasts }))
const SCOPE_A = 'a'.repeat(64), SCOPE_B = 'b'.repeat(64), CANON = catalog()[0].code
const activate = scope => completeAccessCheck(beginAccessCheck(), { ok: true, mode: 'demo', scope })
const rows = () => [{ reason: 'unknown_sku', externalCode: 'EXTERNAL', raw: ['local-only'] }]
const done = () => Response.json({ ok: true, already: false, canonicalCode: CANON, productName: 'Synthetic' })
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
function fill(teacher = 'synthetic') {
  fireEvent.click(screen.getByRole('button', { name: '어느 상품인지 알려주기' }))
  fireEvent.change(screen.getByRole('combobox'), { target: { value: CANON } })
  fireEvent.change(screen.getByRole('textbox', { name: /^누가 알려/ }), { target: { value: teacher } })
}
const submit = () => fireEvent.submit(document.querySelector('.teach-form'))
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); activate(SCOPE_A); toasts.error.mockReset() })
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('an old A denial cannot revoke renewed A after the scope changes A -> B -> A', async () => {
  const pending = deferred(), refresh = vi.fn(), fetcher = vi.fn(() => pending.promise)
  vi.stubGlobal('fetch', fetcher)
  render(<TeachQuarantine slug="late-denial" quarantine={rows()} onTaught={refresh} />)
  fill('old A'); submit(); await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
  act(() => activate(SCOPE_B)); act(() => activate(SCOPE_A))
  const generation = getAccessSession().generation
  fill('new A')
  await act(async () => pending.resolve(Response.json({ error: 'old denied' }, { status: 401 })))
  expect(getAccessSession()).toMatchObject({ generation, status: 'active', scope: SCOPE_A })
  expect(screen.getByRole('textbox', { name: /^누가 알려/ }).value).toBe('new A')
  expect(toasts.error).not.toHaveBeenCalled(); expect(refresh).not.toHaveBeenCalled()
})

it('same-scope renewed generation discards old form and late completion', async () => {
  const pending = deferred(), refresh = vi.fn(), fetcher = vi.fn(() => pending.promise)
  vi.stubGlobal('fetch', fetcher)
  render(<TeachQuarantine slug="renew" quarantine={rows()} onTaught={refresh} />)
  fill('old generation'); submit(); await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
  act(() => activate(SCOPE_A))
  fill('new generation')
  await act(async () => pending.resolve(done()))
  expect(screen.getByRole('textbox', { name: /^누가 알려/ }).value).toBe('new generation')
  expect(screen.queryByText('알려주셨습니다')).toBeNull()
  expect(refresh).not.toHaveBeenCalled(); expect(toasts.error).not.toHaveBeenCalled()
})

it.each([{}, [], { ok: true, already: false, canonicalCode: 'wrong' }])('malformed success %j is not rendered as completed', async body => {
  const refresh = vi.fn()
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(body)))
  render(<TeachQuarantine slug="malformed" quarantine={rows()} onTaught={refresh} />)
  fill(); submit()
  await waitFor(() => expect(toasts.error).toHaveBeenCalledWith(expect.stringContaining('응답을 확인하지 못했습니다')))
  expect(screen.queryByText('알려주셨습니다')).toBeNull()
  expect(screen.getByRole('textbox', { name: /^누가 알려/ }).value).toBe('synthetic')
  expect(screen.getByRole('button', { name: /알려주기 \(/ }).disabled).toBe(false)
  expect(refresh).not.toHaveBeenCalled()
})

it('late reload failure for the completed old calculation cannot mark a new calculation', async () => {
  const reload = deferred(), refresh = vi.fn(() => reload.promise)
  vi.stubGlobal('fetch', vi.fn(async () => done()))
  const view = render(<TeachQuarantine slug="reload-life" quarantine={rows()} onTaught={refresh} />)
  fill(); submit(); await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
  view.rerender(<TeachQuarantine slug="reload-life" quarantine={rows()} onTaught={refresh} />)
  fill('new calculation')
  await act(async () => reload.reject(new Error('late reload failure')))
  expect(screen.getByRole('textbox', { name: /^누가 알려/ }).value).toBe('new calculation')
  expect(toasts.error).not.toHaveBeenCalled()
  expect(screen.queryByText(/내용은 저장됐지만/)).toBeNull()
})

it('non-teaching source references retain file disambiguation, sheet, first twelve rows and total', () => {
  const hash = '1'.repeat(64)
  const source = Array.from({ length: 13 }, (_, index) => ({ reason: 'bad_date', source: { file: 'same.csv', sha256: hash, ambiguousName: true, sheet: 'synthetic-sheet', rowNo: index + 2 }, raw: ['synthetic', index] }))
  render(<TeachQuarantine slug="provenance" quarantine={source} />)
  const group = document.querySelector('.kind-fix_source')
  expect(within(group).getByText('13줄')).toBeTruthy()
  expect(within(group).getAllByTitle(`SHA-256 ${hash}`)).toHaveLength(12)
  expect(group.querySelectorAll('li')).toHaveLength(12)
  expect(group.textContent).toContain('synthetic-sheet · 2번째 줄')
  expect(group.textContent).toContain('앞 12줄만 보여드립니다.')
})
