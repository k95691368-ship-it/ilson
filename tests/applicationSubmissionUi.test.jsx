// @vitest-environment happy-dom
import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import ApplyPage from '../src/pages/ApplyPage.jsx'
import { beginAccessCheck, completeAccessCheck } from '../src/lib/accessSession.js'
import { draftKey, saveDraft } from '../src/lib/draft.js'
import { validateApplication } from '../functions/_lib/applications.js'

const mocks = vi.hoisted(() => ({ reload: vi.fn(), success: vi.fn(), error: vi.fn() }))
vi.mock('../src/hooks/useApi.js', () => ({ useApi: () => ({ data: { items: [], summary: { total: 0, overdue: 0 } }, error: null, reload: mocks.reload }) }))
vi.mock('../src/context/ToastContext.jsx', () => ({ useToast: () => ({ success: mocks.success, error: mocks.error }) }))
const SCOPE = 'd'.repeat(64)
const success = () => Response.json({ id: 'app_dom', ticket_no: 'AX-DOM-1', message: '접수' }, { status: 201 })
const show = () => render(<MemoryRouter><ApplyPage /></MemoryRouter>)
const submit = () => fireEvent.submit(screen.getByRole('button', { name: '신청서 내기' }).closest('form'))
const type = title => fireEvent.change(screen.getByRole('textbox', { name: /^한 줄로/ }), { target: { value: title } })

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear()
  vi.stubGlobal('crypto', webcrypto)
  vi.stubGlobal('navigator', { locks: { request: async (_name, action) => action() } })
  completeAccessCheck(beginAccessCheck(), { ok: true, mode: 'demo', scope: SCOPE })
  mocks.reload.mockReset().mockResolvedValue(undefined); mocks.success.mockReset(); mocks.error.mockReset()
})
afterEach(() => { cleanup(); localStorage.clear(); sessionStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('application form and actual retry client', () => {
  it.each(['정', '정산'])('짧은 유효 제목 %s도 제출 직전 snapshot을 남겨 다시 연 탭에서 같은 키로 복구한다', async title => {
    expect(validateApplication({ dept: '재무', applicant_label: '담당', title, current_people: '1' }).ok).toBe(true)
    const fetcher = vi.fn().mockRejectedValueOnce(new Error('lost after commit')).mockResolvedValueOnce(success())
    vi.stubGlobal('fetch', fetcher)
    const view = show(); type(title)
    fireEvent.change(screen.getByRole('combobox', { name: /^신청 부서/ }), { target: { value: '재무' } })
    fireEvent.change(screen.getByRole('textbox', { name: /^신청자/ }), { target: { value: '담당' } })
    submit()
    expect(JSON.parse(localStorage.getItem(draftKey(SCOPE))).form.title).toBe(title)
    await waitFor(() => expect(mocks.error).toHaveBeenCalledTimes(1))
    // A late typing-debounce must not remove the submitted short snapshot.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 850)) })
    expect(JSON.parse(localStorage.getItem(draftKey(SCOPE))).form.title).toBe(title)
    view.unmount(); sessionStorage.clear(); show()
    fireEvent.click(screen.getByRole('button', { name: '이어서 쓰기' }))
    expect(screen.getByRole('textbox', { name: /^한 줄로/ }).value).toBe(title)
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 850)) })
    expect(JSON.parse(localStorage.getItem(draftKey(SCOPE))).form.title).toBe(title)
    submit()
    await waitFor(() => expect(screen.getByText('접수됐습니다')).toBeTruthy())
    expect(fetcher.mock.calls[1][1].headers.get('X-Idempotency-Key')).toBe(fetcher.mock.calls[0][1].headers.get('X-Idempotency-Key'))
  })

  it('prevents same-tick duplicate submission before asynchronous hashing completes', async () => {
    let resolve
    const fetcher = vi.fn(() => new Promise(done => { resolve = done })); vi.stubGlobal('fetch', fetcher)
    show(); type('동시 제출')
    const element = screen.getByRole('button', { name: '신청서 내기' }).closest('form')
    act(() => { fireEvent.submit(element); fireEvent.submit(element) })
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    await act(async () => resolve(success()))
    expect(screen.getByText('접수됐습니다')).toBeTruthy()
  })

  it('restores a draft after remount and retries an uncertain receipt with the same key', async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new Error('lost receipt')).mockResolvedValueOnce(success()); vi.stubGlobal('fetch', fetcher)
    const view = show(); type('원래 신청 내용입니다')
    submit()
    // Submission saves immediately, without waiting for the 800ms draft debounce.
    expect(JSON.parse(localStorage.getItem(draftKey(SCOPE))).form.title).toBe('원래 신청 내용입니다')
    await waitFor(() => expect(mocks.error).toHaveBeenCalledTimes(1))
    expect(screen.queryByText('접수됐습니다')).toBeNull()
    expect(localStorage.getItem(draftKey(SCOPE))).not.toBeNull()
    view.unmount(); sessionStorage.clear(); show()
    expect(document.body.textContent).not.toContain('서버로 보낸 적은 없습니다')
    expect(document.body.textContent).toContain('접수 여부는 아래 내역에서 확인할 수 있습니다')
    fireEvent.click(screen.getByRole('button', { name: '이어서 쓰기' }))
    expect(screen.getByRole('textbox', { name: /^한 줄로/ }).value).toBe('원래 신청 내용입니다')
    submit()
    await waitFor(() => expect(screen.getByText('접수됐습니다')).toBeTruthy())
    expect(fetcher.mock.calls[1][1].headers.get('X-Idempotency-Key')).toBe(fetcher.mock.calls[0][1].headers.get('X-Idempotency-Key'))
    expect(localStorage.getItem(draftKey(SCOPE))).toBeNull()
  })

  it('blocks changed uncertain input and offers an explicit new application without discarding the text', async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new Error('lost receipt')).mockResolvedValueOnce(success()); vi.stubGlobal('fetch', fetcher)
    show(); type('원래 신청'); submit()
    await waitFor(() => expect(mocks.error).toHaveBeenCalledTimes(1))
    type('바꾼 신청'); submit()
    await waitFor(() => expect(screen.getByRole('button', { name: '내역 확인 후 새 신청' })).toBeTruthy())
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('link', { name: '접수 내역 확인' }).getAttribute('href')).toBe('#submitted-applications')
    expect(screen.getByRole('textbox', { name: /^한 줄로/ }).value).toBe('바꾼 신청')
    fireEvent.click(screen.getByRole('button', { name: '내역 확인 후 새 신청' }))
    await waitFor(() => expect(screen.getByText('접수됐습니다')).toBeTruthy())
    expect(fetcher.mock.calls[1][1].body.get('title')).toBe('바꾼 신청')
    expect(fetcher.mock.calls[1][1].headers.get('X-Idempotency-Key')).not.toBe(fetcher.mock.calls[0][1].headers.get('X-Idempotency-Key'))
  })

  it('does not clear the draft or claim success for a malformed receipt, but preserves a confirmed receipt on list-refresh failure', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({}, { status: 201 })).mockResolvedValueOnce(success()); vi.stubGlobal('fetch', fetcher)
    mocks.reload.mockRejectedValueOnce(new Error('list unavailable'))
    show(); type('응답 확인 신청입니다'); saveDraft(localStorage, SCOPE, { title: '응답 확인 신청입니다' }); submit()
    await waitFor(() => expect(mocks.error).toHaveBeenCalledTimes(1))
    expect(screen.queryByText('접수됐습니다')).toBeNull()
    expect(localStorage.getItem(draftKey(SCOPE))).not.toBeNull()
    submit()
    await waitFor(() => expect(screen.getByText('접수됐습니다')).toBeTruthy())
    expect(screen.queryByRole('link', { name: '접수 내역 확인' })).toBeNull()
    expect(mocks.error).toHaveBeenLastCalledWith(expect.stringContaining('접수는 완료됐지만'))
    expect(fetcher.mock.calls[1][1].headers.get('X-Idempotency-Key')).toBe(fetcher.mock.calls[0][1].headers.get('X-Idempotency-Key'))
  })
})
