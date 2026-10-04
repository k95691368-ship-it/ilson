// @vitest-environment happy-dom
import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import CodesPage from '../src/pages/CodesPage.jsx'
import { beginAccessCheck, completeAccessCheck, getAccessSession } from '../src/lib/accessSession.js'

const state = vi.hoisted(() => ({ data: null, error: null, loading: false, reload: vi.fn() }))
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('../src/hooks/useApi.js', () => ({ useApi: () => state }))
vi.mock('../src/context/ToastContext.jsx', () => ({ useToast: () => toasts }))
const A = 'a'.repeat(64), B = 'b'.repeat(64), VERSION = '1'.repeat(64)
const activate = (scope = A) => completeAccessCheck(beginAccessCheck(), { ok: true, mode: 'access', scope })
const row = (changes = {}) => ({ external_code: 'SYNTHETIC-CODE', canonical_code: 'NR-CM-100', product_name: '원래 상품',
  created_at: '2026-10-04 00:00:00', taught_by: '합성 직원', side: '부서', needsCheck: true, staleCheck: false,
  confirmed: null, corrections: [], edit_version: VERSION, review_available: true, review_reason: null, ...changes })
const data = (code = row()) => ({ codes: [code], summary: { total: 1, needsCheck: code.needsCheck ? 1 : 0, corrected: 0 },
  catalog: [{ code: 'NR-CM-100', name: '원래 상품' }, { code: 'NR-PA-030', name: '새 상품' }] })
const result = (changes = {}) => ({ ok: true, id: 'dec_synthetic', action: 'confirm', externalCode: 'SYNTHETIC-CODE', canonicalCode: 'NR-CM-100', author: '현재 직원', ...changes })
function deferred() { let resolve; const promise = new Promise(yes => { resolve = yes }); return { promise, resolve } }
function correct(why = '원본 상품 연결을 다시 확인했습니다.') {
  fireEvent.click(screen.getByRole('button', { name: '다른 상품이었습니다' }))
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'NR-PA-030' } })
  fireEvent.change(screen.getByRole('textbox', { name: /^왜 바꾸/ }), { target: { value: why } })
}
const submit = () => fireEvent.submit(document.querySelector('.thread-form'))
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto); activate()
  state.data = data(); state.error = null; state.loading = false; state.reload.mockReset()
  toasts.success.mockReset(); toasts.error.mockReset()
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('captures the viewed version and prevents synchronous duplicate confirmation without claiming source inspection', async () => {
  const pending = deferred(), fetcher = vi.fn(() => pending.promise)
  vi.stubGlobal('fetch', fetcher); render(<CodesPage />)
  const button = screen.getByRole('button', { name: '맞습니다' })
  act(() => { fireEvent.click(button); fireEvent.click(button) })
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ externalCode: 'SYNTHETIC-CODE', action: 'confirm', expectedVersion: VERSION })
  await act(async () => pending.resolve(Response.json(result())))
  expect(toasts.success).toHaveBeenCalledTimes(1); expect(state.reload).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('status').textContent).toContain('기록된 작성자: 현재 직원')
})

it.each([{}, [], result({ action: 'correct' }), result({ externalCode: 'other' }), result({ canonicalCode: 'NR-PA-030' }), result({ author: {} })])('does not retire the retry key for malformed success %j', async malformed => {
  const keys = [], fetcher = vi.fn(async (_url, options) => {
    keys.push(options.headers.get('X-Idempotency-Key'))
    return Response.json(keys.length === 1 ? malformed : result())
  })
  vi.stubGlobal('fetch', fetcher); render(<CodesPage />)
  fireEvent.click(screen.getByRole('button', { name: '맞습니다' }))
  await waitFor(() => expect(toasts.error).toHaveBeenCalledWith(expect.stringContaining('응답을 확인하지 못했습니다')))
  expect(toasts.success).not.toHaveBeenCalled(); expect(state.reload).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '맞습니다' }))
  await waitFor(() => expect(toasts.success).toHaveBeenCalledTimes(1))
  expect(keys[1]).toBe(keys[0])
})

it('preserves correction fields and same key after lost response; refresh failure remains a confirmed write', async () => {
  const keys = [], fetcher = vi.fn(async (_url, options) => {
    keys.push(options.headers.get('X-Idempotency-Key'))
    return keys.length === 1 ? Response.json({ error: '저장 결과 미확인' }, { status: 503 })
      : Response.json(result({ action: 'correct', canonicalCode: 'NR-PA-030', productName: '새 상품' }))
  })
  state.reload.mockRejectedValue(new Error('synthetic refresh failure'))
  vi.stubGlobal('fetch', fetcher); render(<CodesPage />); correct(); submit()
  await waitFor(() => expect(toasts.error).toHaveBeenCalledWith('저장 결과 미확인'))
  expect(screen.getByRole('textbox', { name: /^왜 바꾸/ }).value).toBe('원본 상품 연결을 다시 확인했습니다.')
  expect(screen.getByRole('combobox').value).toBe('NR-PA-030')
  submit(); await waitFor(() => expect(screen.getByText(/이 요청은 저장됐지만/)).toBeTruthy())
  expect(keys[1]).toBe(keys[0]); expect(toasts.success).toHaveBeenCalledTimes(1)
  expect(toasts.error).toHaveBeenCalledTimes(1)
  expect(screen.getByText(/이 요청을 기록했습니다/).textContent).toContain('새 상품')
  expect(screen.queryByRole('button', { name: '바꾸고 기록에 남기기' })).toBeNull()
})

it('preserves the draft across a conflict and explicit refresh, then submits only the displayed new version', async () => {
  const fetcher = vi.fn(async (_url, options) => {
    const payload = JSON.parse(options.body)
    return payload.expectedVersion === VERSION ? Response.json({ error: '연결이 변경됐습니다.' }, { status: 409 })
      : Response.json(result({ action: 'correct', canonicalCode: 'NR-PA-030' }))
  })
  vi.stubGlobal('fetch', fetcher); const view = render(<CodesPage />); correct('원본에 적힌 상품으로 정정합니다.'); submit()
  await waitFor(() => expect(screen.getByText('연결이 변경됐습니다.')).toBeTruthy())
  state.reload.mockImplementation(async () => {
    state.data = data(row({ edit_version: '2'.repeat(64), product_name: '다른 현재 상품' }))
    view.rerender(<CodesPage />)
  })
  fireEvent.click(screen.getByRole('button', { name: '최신 연결 확인' }))
  await waitFor(() => expect(screen.getByText('다른 현재 상품')).toBeTruthy())
  expect(screen.getByRole('textbox', { name: /^왜 바꾸/ }).value).toBe('원본에 적힌 상품으로 정정합니다.')
  expect(screen.getByRole('combobox').value).toBe('NR-PA-030')
  submit(); await waitFor(() => expect(toasts.success).toHaveBeenCalledTimes(1))
  expect(JSON.parse(fetcher.mock.calls[1][1].body).expectedVersion).toBe('2'.repeat(64))
})

it('late A response cannot affect renewed A after A -> B -> A', async () => {
  const pending = deferred(), fetcher = vi.fn(() => pending.promise)
  vi.stubGlobal('fetch', fetcher); render(<CodesPage />); correct('PRIVATE_OLD_DRAFT'); submit()
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
  act(() => activate(B)); act(() => activate(A))
  correct('CURRENT_DRAFT')
  const generation = getAccessSession().generation
  await act(async () => pending.resolve(Response.json({ error: 'old denial' }, { status: 401 })))
  expect(getAccessSession()).toMatchObject({ generation, status: 'active', scope: A })
  expect(screen.queryByDisplayValue('PRIVATE_OLD_DRAFT')).toBeNull()
  expect(screen.getByRole('textbox', { name: /^왜 바꾸/ }).value).toBe('CURRENT_DRAFT')
  expect(state.reload).not.toHaveBeenCalled(); expect(toasts.error).not.toHaveBeenCalled(); expect(toasts.success).not.toHaveBeenCalled()
})

it('a late result for a replaced mapping cannot show success or refresh the new view', async () => {
  const pending = deferred(), fetcher = vi.fn(() => pending.promise)
  vi.stubGlobal('fetch', fetcher); const view = render(<CodesPage />)
  fireEvent.click(screen.getByRole('button', { name: '맞습니다' }))
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
  state.data = data(row({ edit_version: '3'.repeat(64), canonical_code: 'NR-PA-030', product_name: '새 현재 상품' }))
  view.rerender(<CodesPage />)
  await act(async () => pending.resolve(Response.json(result())))
  expect(screen.getByText('새 현재 상품')).toBeTruthy(); expect(screen.queryByText(/이 요청을 기록했습니다/)).toBeNull()
  expect(state.reload).not.toHaveBeenCalled(); expect(toasts.success).not.toHaveBeenCalled()
})

it('a legacy confirmation is history, not current proof, and missing provenance has no mutation controls', () => {
  state.data = data(row({ review_available: false, review_reason: 'origin_unavailable', confirmed: { by: 'legacy', at: '2026-10-01', verified: false, legacy: true } }))
  render(<CodesPage />)
  expect(screen.getByText(/과거 확인 기록/)).toBeTruthy(); expect(screen.getByText(/관련 업무 근거를 확인하지 못했습니다/)).toBeTruthy()
  expect(screen.queryByText('전부 확인했습니다')).toBeNull()
  expect(screen.queryByRole('button', { name: '맞습니다' })).toBeNull()
  expect(screen.queryByRole('button', { name: '다른 상품이었습니다' })).toBeNull()
})

it('retains a confirmed write even when a real reload reports an error while keeping old data', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(result())))
  const view = render(<CodesPage />)
  state.reload.mockImplementation(async () => { state.error = '합성 조회 실패'; view.rerender(<CodesPage />) })
  fireEvent.click(screen.getByRole('button', { name: '맞습니다' }))
  await waitFor(() => expect(screen.getByText(/이 요청을 기록했습니다/)).toBeTruthy())
  expect(screen.getByText(/최신 목록을 불러오지 못했습니다/)).toBeTruthy()
  expect(toasts.error).not.toHaveBeenCalled(); expect(toasts.success).toHaveBeenCalledTimes(1)
})
