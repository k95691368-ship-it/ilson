// @vitest-environment happy-dom
import { webcrypto } from 'node:crypto'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import TeachQuarantine from '../src/components/TeachQuarantine.jsx'
import { beginAccessCheck, completeAccessCheck, getAccessSession, revokeAccess } from '../src/lib/accessSession.js'
import { catalog } from '../shared/teach.js'

const toasts = vi.hoisted(() => ({ error: vi.fn() }))
vi.mock('../src/context/ToastContext.jsx', () => ({ useToast: () => toasts }))
const SCOPE = 'e'.repeat(64), OTHER = 'f'.repeat(64)
const CANON = catalog()[0].code
const rows = (count = 41) => Array.from({ length: count }, (_, index) => ({
  reason: 'unknown_sku', externalCode: `CODE-${String(index).padStart(5, '0')}`,
  source: { file: 'synthetic.csv', sheet: 'data', rowNo: index + 2 }, raw: [`PRIVATE_SAMPLE_${index}`],
}))
const activate = (scope = SCOPE) => completeAccessCheck(beginAccessCheck(), { ok: true, mode: 'demo', scope })
const result = () => Response.json({ ok: true, already: false, canonicalCode: CANON, productName: '정규 상품', next: '다음 실행부터 반영됩니다.' })
function item(code = 'CODE-00000') { return screen.getByText(code, { selector: '.teach-code-name, .teach-code.done .mono' }).closest('li') }
function open(code) { fireEvent.click(within(item(code)).getByRole('button', { name: '어느 상품인지 알려주기' })) }
function fill(code = 'CODE-00000', teacher = 'PRIVATE_TEACHER') {
  const target = within(item(code))
  fireEvent.change(target.getByRole('combobox'), { target: { value: CANON } })
  fireEvent.change(target.getByRole('textbox', { name: /^누가 알려/ }), { target: { value: teacher } })
}
const next = () => fireEvent.click(screen.getByRole('button', { name: '다음 코드 20개' }))
const prev = () => fireEvent.click(screen.getByRole('button', { name: '이전 코드 20개' }))
const search = query => fireEvent.change(screen.getByRole('searchbox', { name: /^코드 찾기/ }), { target: { value: query } })
const submit = code => fireEvent.submit(item(code).querySelector('form'))
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }

beforeEach(() => { vi.stubGlobal('crypto', webcrypto); activate(); toasts.error.mockReset() })
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('bounded quarantine teaching UI', () => {
  it('renders 20 of 20,000 codes while preserving the total counts and page bounds', () => {
    render(<TeachQuarantine slug="large" quarantine={rows(20000)} />)
    expect(screen.getByText('밀려난 줄 20,000개')).toBeTruthy()
    expect(screen.getByText(/코드 20000종/)).toBeTruthy()
    expect(document.querySelectorAll('.teach-code')).toHaveLength(20)
    expect(screen.getByText('코드 1–20 / 20,000')).toBeTruthy()
    next()
    expect(document.querySelectorAll('.teach-code')).toHaveLength(20)
    expect(screen.queryByText('CODE-00000')).toBeNull()
    expect(screen.getByText('코드 21–40 / 20,000')).toBeTruthy()
  })

  it('finds and saves the last of 20,000 codes in one input without rendering every form', async () => {
    const fetcher = vi.fn(async () => result()); vi.stubGlobal('fetch', fetcher)
    render(<TeachQuarantine slug="last-code" quarantine={rows(20000)} />)
    search('  CODE-19999  ')
    expect(document.querySelectorAll('.teach-code')).toHaveLength(1)
    expect(screen.getByText('전체 코드 20,000종 · 일치 1종')).toBeTruthy()
    expect(screen.getByText('코드 1–1 / 1')).toBeTruthy()
    open('CODE-19999'); fill('CODE-19999'); submit('CODE-19999')
    await waitFor(() => expect(screen.getByText('알려주셨습니다')).toBeTruthy())
    expect(JSON.parse(fetcher.mock.calls[0][1].body).externalCode).toBe('CODE-19999')
    search('')
    expect(document.querySelectorAll('.teach-code')).toHaveLength(20)
    search('CODE-19999')
    expect(within(item('CODE-19999')).getByText('알려주셨습니다')).toBeTruthy()
  })

  it('shows zero matches, keeps exact-case policy, resets paging, and restores a hidden draft', () => {
    render(<TeachQuarantine slug="search-state" quarantine={rows()} />)
    open(); fill(); next()
    search('code-00000')
    expect(screen.getByText('검색 조건에 맞는 코드가 없습니다.')).toBeTruthy()
    expect(screen.getByText('전체 코드 41종 · 일치 0종')).toBeTruthy()
    expect(document.querySelectorAll('.teach-code')).toHaveLength(0)
    search('CODE-00000')
    expect(screen.getByText('코드 1–1 / 1')).toBeTruthy()
    expect(within(item()).getByRole('textbox').value).toBe('PRIVATE_TEACHER')
    search('')
    expect(screen.getByText('코드 1–20 / 41')).toBeTruthy()
    expect(within(item()).getByRole('textbox').value).toBe('PRIVATE_TEACHER')
  })

  it('filters the memoized sorted codes without re-reading or re-indexing original rows', () => {
    let codeReads = 0
    const source = rows().map(row => ({ ...row, get externalCode() { codeReads++; return row.externalCode } }))
    render(<TeachQuarantine slug="index-once" quarantine={source} />)
    const indexedReads = codeReads
    expect(indexedReads).toBeGreaterThan(0)
    search('00040'); search('missing'); search('')
    expect(codeReads).toBe(indexedReads)
    expect(document.querySelectorAll('.teach-code')).toHaveLength(20)
  })

  it('keeps a searching second-code draft unchanged when a hidden first-code save completes', async () => {
    const pending = deferred(), fetcher = vi.fn(() => pending.promise); vi.stubGlobal('fetch', fetcher)
    render(<TeachQuarantine slug="search-pending" quarantine={rows()} />)
    open(); fill(); submit()
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    search('CODE-00020'); open('CODE-00020'); fill('CODE-00020', '검색한 담당자')
    await act(async () => pending.resolve(result()))
    expect(within(item('CODE-00020')).getByRole('textbox').value).toBe('검색한 담당자')
    expect(within(item('CODE-00020')).queryByText('알려주셨습니다')).toBeNull()
    search('missing'); expect(document.querySelectorAll('.teach-code')).toHaveLength(0)
    search('CODE-00000'); expect(screen.getByText('알려주셨습니다')).toBeTruthy()
    search('CODE-00020'); expect(within(item('CODE-00020')).getByRole('textbox').value).toBe('검색한 담당자')
  })

  it.each(['calculation', 'slug', 'scope'])('resets search and page for a new %s lifetime', boundary => {
    const source = rows()
    const view = render(<TeachQuarantine slug="first" quarantine={source} />)
    search('CODE-000'); next()
    if (boundary === 'calculation') view.rerender(<TeachQuarantine slug="first" quarantine={rows()} />)
    if (boundary === 'slug') view.rerender(<TeachQuarantine slug="second" quarantine={source} />)
    if (boundary === 'scope') act(() => activate(OTHER))
    expect(screen.getByRole('searchbox').value).toBe('')
    expect(screen.getByText('코드 1–20 / 41')).toBeTruthy()
  })

  it('preserves a page-one form, field errors and cancellation state when its DOM is unmounted', async () => {
    const fetcher = vi.fn(async () => Response.json({ error: '검증 오류', fields: { teacher: '담당자를 확인해주세요.' } }, { status: 400 }))
    vi.stubGlobal('fetch', fetcher)
    render(<TeachQuarantine slug="fields" quarantine={rows()} />)
    open(); fill(); submit()
    await waitFor(() => expect(screen.getByText('담당자를 확인해주세요.')).toBeTruthy())
    next(); expect(screen.queryByDisplayValue('PRIVATE_TEACHER')).toBeNull(); prev()
    expect(within(item()).getByRole('textbox').value).toBe('PRIVATE_TEACHER')
    expect(within(item()).getByRole('combobox').value).toBe(CANON)
    expect(screen.getByText('담당자를 확인해주세요.')).toBeTruthy()
    fireEvent.click(within(item()).getByRole('button', { name: '그만두기' }))
    next(); prev(); expect(within(item()).queryByRole('textbox')).toBeNull()
    open(); expect(within(item()).getByRole('textbox').value).toBe('PRIVATE_TEACHER')
  })

  it('locks duplicate submits synchronously and retains off-page saving and completion state', async () => {
    const pending = deferred(), refresh = vi.fn().mockResolvedValue(undefined)
    const fetcher = vi.fn(() => pending.promise); vi.stubGlobal('fetch', fetcher)
    render(<TeachQuarantine slug="pending" quarantine={rows()} onTaught={refresh} />)
    open(); fill()
    const form = item().querySelector('form')
    act(() => { fireEvent.submit(form); fireEvent.submit(form) })
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    next(); prev()
    expect(within(item()).getByRole('button', { name: '보내는 중…' }).disabled).toBe(true)
    expect(within(item()).getByRole('textbox').disabled).toBe(true)
    next(); await act(async () => { pending.resolve(result()) })
    expect(refresh).toHaveBeenCalledTimes(1)
    prev(); expect(within(item()).getByText('알려주셨습니다')).toBeTruthy()
    expect(within(item()).queryByRole('form')).toBeNull()
  })

  it('does not overwrite a second-page draft when a first-page save finishes in StrictMode', async () => {
    const pending = deferred(), refresh = vi.fn()
    const fetcher = vi.fn(() => pending.promise); vi.stubGlobal('fetch', fetcher)
    render(<StrictMode><TeachQuarantine slug="two-pages" quarantine={rows()} onTaught={refresh} /></StrictMode>)
    open(); fill('CODE-00000', '첫 페이지 담당자'); submit()
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    next(); open('CODE-00020'); fill('CODE-00020', '다음 페이지 담당자')
    await act(async () => { pending.resolve(result()) })
    expect(within(item('CODE-00020')).getByRole('textbox').value).toBe('다음 페이지 담당자')
    expect(within(item('CODE-00020')).getByRole('combobox').value).toBe(CANON)
    expect(within(item('CODE-00020')).queryByText('알려주셨습니다')).toBeNull()
    prev(); expect(within(item()).getByText('알려주셨습니다')).toBeTruthy()
    next(); expect(within(item('CODE-00020')).getByRole('textbox').value).toBe('다음 페이지 담당자')
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('clamps repeated pagination events at the first/last page', () => {
    render(<TeachQuarantine slug="bounds" quarantine={rows(21)} />)
    const nextButton = screen.getByRole('button', { name: '다음 코드 20개' })
    act(() => { fireEvent.click(nextButton); fireEvent.click(nextButton) })
    expect(screen.getByText('코드 21–21 / 21')).toBeTruthy()
    expect(document.querySelectorAll('.teach-code')).toHaveLength(1)
    const previous = screen.getByRole('button', { name: '이전 코드 20개' })
    act(() => { fireEvent.click(previous); fireEvent.click(previous) })
    expect(screen.getByText('코드 1–20 / 21')).toBeTruthy()
  })

  it('reuses the actual client retry key after an off-page lost response without sending raw cells', async () => {
    const pending = deferred(), fetcher = vi.fn().mockImplementationOnce(() => pending.promise).mockResolvedValueOnce(result())
    vi.stubGlobal('fetch', fetcher)
    render(<TeachQuarantine slug="retry" quarantine={rows()} />)
    open(); fill(); submit()
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    next(); await act(async () => pending.reject(new Error('lost response'))); prev()
    expect(within(item()).getByRole('textbox').value).toBe('PRIVATE_TEACHER')
    submit(); await waitFor(() => expect(screen.getByText('알려주셨습니다')).toBeTruthy())
    const options = fetcher.mock.calls.map(([, option]) => option)
    expect(options[0].headers.get('X-Idempotency-Key')).toBeTruthy()
    expect(options[1].headers.get('X-Idempotency-Key')).toBe(options[0].headers.get('X-Idempotency-Key'))
    expect(options[0].body).not.toMatch(/PRIVATE_SAMPLE|synthetic.csv|raw|sheet/)
    expect(JSON.parse(options[0].body)).toMatchObject({ externalCode: 'CODE-00000', canonicalCode: CANON, affected: 1 })
  })

  it('keeps the saved result when refreshing the tool subsequently fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => result()))
    const refresh = vi.fn().mockRejectedValue(new Error('reload failed'))
    render(<TeachQuarantine slug="refresh" quarantine={rows()} onTaught={refresh} />)
    open(); fill(); submit()
    await waitFor(() => expect(screen.getByText('알려주셨습니다')).toBeTruthy())
    await waitFor(() => expect(toasts.error).toHaveBeenCalledWith(expect.stringContaining('내용은 저장됐지만')))
    next(); prev()
    expect(within(item()).getByText('알려주셨습니다')).toBeTruthy()
    expect(within(item()).getByRole('status').textContent).toContain('최신 상태')
    expect(within(item()).queryByRole('button', { name: /알려주기/ })).toBeNull()
  })

  it.each(['calculation', 'slug', 'scope', 'revocation', 'unmount'])('discards forms and late UI effects after a %s boundary', async boundary => {
    const pending = deferred(), refresh = vi.fn(), source = rows()
    const fetcher = vi.fn(() => pending.promise); vi.stubGlobal('fetch', fetcher)
    const view = render(<TeachQuarantine slug="old" quarantine={source} onTaught={refresh} />)
    open(); fill(); submit()
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    if (boundary === 'calculation') view.rerender(<TeachQuarantine slug="old" quarantine={rows()} onTaught={refresh} />)
    if (boundary === 'slug') view.rerender(<TeachQuarantine slug="new" quarantine={source} onTaught={refresh} />)
    if (boundary === 'scope') act(() => { activate(OTHER) })
    if (boundary === 'revocation') act(() => { revokeAccess(getAccessSession().generation) })
    if (boundary === 'unmount') view.unmount()
    expect(screen.queryByDisplayValue('PRIVATE_TEACHER')).toBeNull()
    await act(async () => { pending.resolve(result()) })
    expect(screen.queryByText('알려주셨습니다')).toBeNull()
    expect(refresh).not.toHaveBeenCalled(); expect(toasts.error).not.toHaveBeenCalled()
  })

  it('does not revive the first A calculation after A→B→A references and a late rejection', async () => {
    const pending = deferred(), refresh = vi.fn(), first = rows(), second = rows()
    const fetcher = vi.fn(() => pending.promise); vi.stubGlobal('fetch', fetcher)
    const view = render(<TeachQuarantine slug="same-tool" quarantine={first} onTaught={refresh} />)
    open(); fill(); submit(); await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    view.rerender(<TeachQuarantine slug="same-tool" quarantine={second} onTaught={refresh} />)
    view.rerender(<TeachQuarantine slug="same-tool" quarantine={first} onTaught={refresh} />)
    open(); fill('CODE-00000', '새 A 담당자')
    await act(async () => pending.reject(new Error('old failure')))
    expect(within(item()).getByRole('textbox').value).toBe('새 A 담당자')
    expect(toasts.error).not.toHaveBeenCalled(); expect(refresh).not.toHaveBeenCalled()
  })

  it('hides current forms on a real API access revocation without restoring them from the failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: '권한을 다시 확인해주세요.' }, { status: 401 })))
    render(<TeachQuarantine slug="denied" quarantine={rows()} />)
    open(); fill(); submit()
    await waitFor(() => expect(getAccessSession().status).toBe('blocked'))
    expect(document.querySelector('.teach')).toBeNull()
    expect(screen.queryByDisplayValue('PRIVATE_TEACHER')).toBeNull()
    expect(toasts.error).not.toHaveBeenCalled()
    act(() => activate())
    open(); expect(within(item()).getByRole('textbox').value).toBe('')
  })

  it('handles prototype-looking codes without state collision and uses the existing first-row sample/count contract', async () => {
    const source = [
      { reason: 'bad_date', externalCode: '__proto__', source: { channel: 'first-other-reason' }, raw: ['FIRST_SAMPLE'] },
      { reason: 'unknown_sku', externalCode: '__proto__', source: { channel: 'unknown-only' }, raw: ['SECOND_SAMPLE'] },
      { reason: 'unknown_sku', externalCode: '__proto__' },
      { reason: 'unknown_sku', externalCode: 'constructor' },
    ]
    const fetcher = vi.fn(async () => result()); vi.stubGlobal('fetch', fetcher)
    render(<TeachQuarantine slug="prototype" quarantine={source} />)
    expect(item('__proto__').textContent).toContain('이 코드로 2줄')
    expect(item('__proto__').textContent).toContain('FIRST_SAMPLE')
    open('__proto__'); fill('__proto__', '한 담당자')
    open('constructor'); fill('constructor', '다른 담당자')
    expect(within(item('__proto__')).getByRole('textbox').value).toBe('한 담당자')
    submit('__proto__')
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ externalCode: '__proto__', channel: 'first-other-reason', affected: 2 })
  })
})
