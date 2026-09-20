// @vitest-environment happy-dom
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import ApplyPage from '../src/pages/ApplyPage.jsx'
import { DRAFT_KEY, draftKey, saveDraft } from '../src/lib/draft.js'
import { keepToolRun, pendingToolRun, forgetToolRun } from '../src/lib/pendingToolRuns.js'
import { keepBetaRound, pendingBetaRound, forgetBetaRound } from '../src/lib/pendingBetaRounds.js'

const state = vi.hoisted(() => ({ snapshot: null, listeners: new Set(), post: vi.fn(), form: vi.fn(), reload: vi.fn(), success: vi.fn(), error: vi.fn() }))
vi.mock('../src/lib/accessSession.js', () => ({
  getAccessSession: () => state.snapshot,
  subscribeAccessSession: listener => { state.listeners.add(listener); return () => state.listeners.delete(listener) },
}))
vi.mock('../src/api/client.js', () => ({ api: { post: (...args) => state.post(...args), form: (...args) => state.form(...args) } }))
vi.mock('../src/hooks/useApi.js', () => ({ useApi: () => ({ data: { items: [], summary: { total: 0, overdue: 0 } }, error: null, reload: state.reload }) }))
vi.mock('../src/context/ToastContext.jsx', () => ({ useToast: () => ({ success: state.success, error: state.error }) }))

const A = 'a'.repeat(64), B = 'b'.repeat(64)
const NOW = new Date('2026-09-19T00:00:00Z')
const legacy = JSON.stringify({ savedAt: NOW.toISOString(), form: { title: '소유 미확인 공용 초안 제목입니다', applicant_label: '이전 이름', contact: 'old@example.invalid' } })
const savedForm = label => ({ dept: '재무', title: `${label} 비공개 신청서 제목입니다`, applicant_label: `${label} 이름`, contact: `${label}@example.invalid` })
let posts, submissions
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
function changeSession(scope, { status = 'active', mode = 'access', generation = state.snapshot.generation + 1 } = {}) {
  act(() => {
    state.snapshot = { generation, status, scope, mode, error: status === 'blocked' ? '권한 없음' : '' }
    for (const listener of state.listeners) listener()
  })
}
function show(strict = false) {
  const tree = <MemoryRouter initialEntries={['/apply']}><ApplyPage /></MemoryRouter>
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree)
}
function type(label) {
  const values = savedForm(label)
  fireEvent.change(screen.getByRole('textbox', { name: /^한 줄로/ }), { target: { value: values.title } })
  fireEvent.change(screen.getByRole('textbox', { name: /^신청자/ }), { target: { value: values.applicant_label } })
  fireEvent.change(screen.getByRole('textbox', { name: /^연락처/ }), { target: { value: values.contact } })
  return values
}
async function advance(ms = 850) { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }
function submit() { fireEvent.submit(screen.getByRole('button', { name: '신청서 내기' }).closest('form')) }
function restore() { fireEvent.click(screen.getByRole('button', { name: '이어서 쓰기' })) }
const hit = title => ({ id: title, ticket_no: 'AX-111-111', title, score: 0.8, status: '접수', dept: '재무', created_at: NOW.toISOString(), shared: [] })

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(NOW)
  localStorage.clear(); state.listeners.clear()
  state.snapshot = { generation: 1, status: 'active', scope: A, mode: 'access', error: '' }
  posts = []; submissions = []
  state.post.mockReset(); state.form.mockReset(); state.reload.mockReset().mockResolvedValue(undefined); state.success.mockReset(); state.error.mockReset()
  state.post.mockImplementation((path, body) => { const pending = { ...deferred(), path, body }; posts.push(pending); return pending.promise })
  state.form.mockImplementation((path, body) => { const pending = { ...deferred(), path, body }; submissions.push(pending); return pending.promise })
})
afterEach(() => {
  cleanup()
  for (const scope of [A, B]) { forgetToolRun(scope, 'local-tool'); forgetBetaRound(scope, 'local-application') }
  localStorage.clear(); vi.useRealTimers(); vi.restoreAllMocks()
})

describe('확인된 계정·체험 공간에서만 신청 초안을 복구한다', () => {
  it.each(['access', 'demo'])('%s의 A→B→A에서 제목·이름·연락처가 섞이지 않는다', async mode => {
    state.snapshot = { ...state.snapshot, mode }
    show(); type('A'); await advance()
    const originalA = localStorage.getItem(draftKey(A))
    changeSession(B, { mode })
    expect(screen.queryByText('적으시던 것이 있습니다')).toBeNull()
    expect(screen.getByRole('textbox', { name: /^신청자/ }).value).toBe('')
    expect(screen.getByRole('textbox', { name: /^연락처/ }).value).toBe('')
    expect(document.body.textContent).not.toContain('A 비공개 신청서')
    type('B'); await advance()
    const originalB = localStorage.getItem(draftKey(B))
    changeSession(A, { mode }); restore()
    expect(screen.getByRole('textbox', { name: /^신청자/ }).value).toBe('A 이름')
    expect(screen.getByRole('textbox', { name: /^연락처/ }).value).toBe('A@example.invalid')
    expect(localStorage.getItem(draftKey(A))).toBe(originalA)
    expect(localStorage.getItem(draftKey(B))).toBe(originalB)
  })

  it('체험 공간 만료 후 새 공간에서는 직전에 저장한 구 공간 초안도 보이지 않는다', async () => {
    state.snapshot = { ...state.snapshot, mode: 'demo' }
    show(); type('만료 공간'); await advance()
    const original = localStorage.getItem(draftKey(A))
    changeSession(null, { status: 'blocked', mode: 'demo' })
    expect(document.body.textContent).not.toContain('만료 공간 비공개 신청서')
    changeSession(B, { mode: 'demo' })
    expect(screen.queryByRole('button', { name: '이어서 쓰기' })).toBeNull()
    expect(screen.getByRole('textbox', { name: /^연락처/ }).value).toBe('')
    expect(localStorage.getItem(draftKey(A))).toBe(original)
  })

  it.each([
    ['unverified', null], ['checking', A], ['blocked', A], ['active', null], ['active', 'not-server-scope'],
  ])('%s/%s 확인 전에는 저장소를 읽거나 지우지 않으며 입력은 허용한다', async (status, scope) => {
    localStorage.setItem(DRAFT_KEY, legacy)
    saveDraft(localStorage, A, savedForm('A'))
    const prior = localStorage.getItem(draftKey(A))
    const read = vi.spyOn(Storage.prototype, 'getItem'), write = vi.spyOn(Storage.prototype, 'setItem'), remove = vi.spyOn(Storage.prototype, 'removeItem')
    state.snapshot = { ...state.snapshot, status, scope }
    show()
    expect(screen.getByRole('status').textContent).toContain('초안을 자동 저장하거나 불러오지 않습니다')
    expect(screen.queryByText('적으시던 것이 있습니다')).toBeNull()
    type('새 입력'); await advance()
    expect(screen.getByRole('textbox', { name: /^신청자/ }).value).toBe('새 입력 이름')
    expect(read).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled()
    expect(state.post).not.toHaveBeenCalled()
    expect(localStorage.getItem(DRAFT_KEY)).toBe(legacy)
    expect(localStorage.getItem(draftKey(A))).toBe(prior)
  })

  it('활성 화면이 blocked로 바뀌면 복구한 원문을 즉시 숨기고 저장 원본은 보존한다', async () => {
    saveDraft(localStorage, A, savedForm('A'))
    const original = localStorage.getItem(draftKey(A))
    show(); restore()
    changeSession(A, { status: 'blocked' })
    expect(screen.queryByRole('button', { name: '이어서 쓰기' })).toBeNull()
    expect(screen.getByRole('textbox', { name: /^신청자/ }).value).toBe('')
    expect(screen.getByRole('textbox', { name: /^연락처/ }).value).toBe('')
    expect(document.body.textContent).not.toContain('A 비공개 신청서')
    await advance()
    expect(localStorage.getItem(draftKey(A))).toBe(original)
  })

  it('구 공용 초안은 복구·이관하지 않고 새 초안 폐기와 접수 후에도 원본 그대로 보존한다', async () => {
    localStorage.setItem(DRAFT_KEY, legacy)
    const view = show()
    expect(screen.queryByRole('button', { name: '이어서 쓰기' })).toBeNull()
    expect(document.body.textContent).not.toContain('소유 미확인 공용')
    type('새 A'); await advance(); view.unmount(); show()
    fireEvent.click(screen.getByRole('button', { name: '버리고 새로 쓰기' }))
    expect(localStorage.getItem(draftKey(A))).toBeNull()
    expect(localStorage.getItem(DRAFT_KEY)).toBe(legacy)
    type('접수할 A'); await advance(); submit()
    await act(async () => { submissions[0].resolve({ ticket_no: 'AX-111-111' }) })
    expect(screen.getByText('접수됐습니다')).toBeTruthy()
    expect(state.success).toHaveBeenCalledTimes(1)
    expect(state.reload).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem(draftKey(A))).toBeNull()
    expect(localStorage.getItem(DRAFT_KEY)).toBe(legacy)
  })

  it('scope 전환 전에 예약된 자동저장은 새 범위나 기존 저장본을 덮어쓰지 않는다', async () => {
    saveDraft(localStorage, A, savedForm('저장된 A'))
    const original = localStorage.getItem(draftKey(A))
    show(); restore(); type('아직 저장 안 된 A'); await advance(500)
    changeSession(B); await advance()
    expect(localStorage.getItem(draftKey(A))).toBe(original)
    expect(localStorage.getItem(draftKey(B))).toBeNull()
  })

  it('동일 scope의 재인증도 옛 폼의 개인정보와 자동저장 타이머를 재사용하지 않는다', async () => {
    show(); type('저장된 A'); await advance()
    const original = localStorage.getItem(draftKey(A))
    type('이전 인증에서 미저장 입력'); await advance(400)
    changeSession(A, { status: 'checking' })
    expect(screen.getByRole('textbox', { name: /^연락처/ }).value).toBe('')
    expect(document.body.textContent).not.toContain('저장된 A 비공개 신청서')
    await advance()
    expect(localStorage.getItem(draftKey(A))).toBe(original)
    changeSession(A); restore()
    expect(screen.getByRole('textbox', { name: /^한 줄로/ }).value).toBe('저장된 A 비공개 신청서 제목입니다')
  })

  it('세션 통지 렌더링 전에 도착한 완료도 최신 snapshot을 확인하여 초안을 지우지 않는다', async () => {
    show(); type('A'); await advance(); submit()
    const original = localStorage.getItem(draftKey(A))
    state.snapshot = { ...state.snapshot, generation: 2, status: 'blocked', scope: null }
    await act(async () => { submissions[0].resolve({ ticket_no: 'OLD-RECEIPT' }) })
    expect(localStorage.getItem(draftKey(A))).toBe(original)
    expect(state.success).not.toHaveBeenCalled(); expect(state.reload).not.toHaveBeenCalled()
    expect(document.body.textContent).not.toContain('OLD-RECEIPT')
  })

  it.each(['success', 'failure'])('A→B→A 재인증 후 옛 접수 %s가 새 초안·알림·목록을 바꾸지 않는다', async kind => {
    localStorage.setItem(DRAFT_KEY, legacy)
    show(); type('첫 A'); await advance(); submit()
    expect(submissions[0].body.get('title')).toBe('첫 A 비공개 신청서 제목입니다')
    changeSession(B); type('B'); await advance()
    const storedB = localStorage.getItem(draftKey(B))
    changeSession(A); restore(); type('현재 A'); await advance()
    const currentA = localStorage.getItem(draftKey(A))
    await act(async () => {
      if (kind === 'success') submissions[0].resolve({ ticket_no: 'OLD-PRIVATE-RECEIPT' })
      else submissions[0].reject(Object.assign(Error('옛 계정의 비공개 오류'), { fields: { title: '옛 오류 원문' } }))
    })
    expect(screen.getByRole('textbox', { name: /^한 줄로/ }).value).toBe('현재 A 비공개 신청서 제목입니다')
    expect(localStorage.getItem(draftKey(A))).toBe(currentA)
    expect(localStorage.getItem(draftKey(B))).toBe(storedB)
    expect(localStorage.getItem(DRAFT_KEY)).toBe(legacy)
    expect(document.body.textContent).not.toContain('OLD-PRIVATE-RECEIPT')
    expect(document.body.textContent).not.toContain('옛 오류 원문')
    expect(state.success).not.toHaveBeenCalled(); expect(state.error).not.toHaveBeenCalled(); expect(state.reload).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '신청서 내기' }).disabled).toBe(false)
  })

  it.each(['success', 'failure'])('이전 scope 유사 검색의 늦은 %s가 새 검색 결과를 덮어쓰지 않는다', async kind => {
    show(); type('A'); await advance(700)
    const old = posts[0]
    changeSession(B); type('B'); await advance(700)
    const latest = posts.at(-1)
    await act(async () => { latest.resolve({ hits: [hit('현재 B 검색 결과')] }) })
    await act(async () => {
      if (kind === 'success') old.resolve({ hits: [hit('이전 A 비공개 검색 결과')] })
      else old.reject(Error('이전 A 검색 오류'))
    })
    expect(screen.getByText('현재 B 검색 결과')).toBeTruthy()
    expect(screen.queryByText('이전 A 비공개 검색 결과')).toBeNull()
  })

  it('현재 계정의 접수 실패는 초안을 보존하고 다시 제출할 수 있다', async () => {
    show(); type('현재 A'); await advance(); submit()
    const saved = localStorage.getItem(draftKey(A))
    await act(async () => { submissions[0].reject(Object.assign(Error('접수 실패'), { fields: { title: '제목 확인 필요' } })) })
    expect(screen.getByText('제목 확인 필요')).toBeTruthy()
    expect(state.error).toHaveBeenCalledWith('접수 실패')
    expect(localStorage.getItem(draftKey(A))).toBe(saved)
    expect(screen.getByRole('button', { name: '신청서 내기' }).disabled).toBe(false)
  })

  it('같은 계정에서 검색어가 바뀌면 이전 검색 응답이 최신 결과를 덮어쓰지 않는다', async () => {
    show(); type('첫 검색'); await advance(700)
    const old = posts[0]
    type('다음 검색'); await advance(700)
    await act(async () => { posts.at(-1).resolve({ hits: [hit('최신 검색 결과')] }) })
    await act(async () => { old.resolve({ hits: [hit('오래된 검색 결과')] }) })
    expect(screen.getByText('최신 검색 결과')).toBeTruthy()
    expect(screen.queryByText('오래된 검색 결과')).toBeNull()
  })

  it('StrictMode 재시작·scope 전환·초안 폐기는 미확정 Tool/Beta 영수증을 지우지 않는다', async () => {
    const tool = { payload: { run_id: 'unconfirmed-tool-run', run_scope: A }, error: '응답 미확인' }
    const beta = { payload: { run_id: 'unconfirmed-beta-run', run_scope: A }, error: '응답 미확인' }
    keepToolRun(A, 'local-tool', tool); keepBetaRound(A, 'local-application', beta)
    show(true); type('A'); await advance()
    changeSession(B); changeSession(A)
    fireEvent.click(screen.getByRole('button', { name: '버리고 새로 쓰기' }))
    expect(pendingToolRun(A, 'local-tool')).toEqual(tool)
    expect(pendingBetaRound(A, 'local-application')).toEqual(beta)
    expect(pendingToolRun(B, 'local-tool')).toBeNull()
    expect(pendingBetaRound(B, 'local-application')).toBeNull()
  })
})
