// @vitest-environment happy-dom
// Real page, API client, useApi, action lifetime and workspace gate; fetch is
// synthetic. Failure responses must not erase drafts or invent a saved result.
import { webcrypto } from 'node:crypto'
import { act, StrictMode } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import AgreementPage from '../src/pages/AgreementPage.jsx'
import WorkspaceGate from '../src/components/WorkspaceGate.jsx'
import { ToastProvider } from '../src/context/ToastContext.jsx'
import { beginAccessCheck, completeAccessCheck } from '../src/lib/accessSession.js'

const deferred = () => {
  let resolve, reject
  const promise = new Promise((a, b) => { resolve = a; reject = b })
  return { promise, resolve, reject }
}
const app = id => ({ id, ticket_no: id === 'a' ? 'AX-AAA-123' : 'AX-BBB-123', dept: '재무',
  title: `${id.toUpperCase()} 업무`, status: '수용', current_people: 2, current_frequency: '주 1회' })
const data = id => ({ application: app(id),
  stakeholders: [{ id: `${id}-s`, dept: '재무', person_label: `${id} 담당`, role_label: '담당', wants: '정확한 정산', is_owner: 1 }],
  meetings: [{ id: `${id}-m`, seq: 1, title: `${id.toUpperCase()} 회의`, minutes_text: `${id.toUpperCase()} 기존 회의 원문` }],
  requirements: [{ id: `${id}-r`, kind: '요구', dept: '재무', body: `${id.toUpperCase()} 초안 요구`, priority: '보통', status: '초안' }],
  pendingJoins: [{ join_id: `${id}-j`, dept: '영업', by: '영업 직원', story: `${id.toUpperCase()} 참여 사정` }],
  conflicts: [], criteria: [], criteria_source_version: 'c'.repeat(64), baseline_source_version: 'd'.repeat(64),
  shadowRuns: [], baseline: null,
})
let mode, calls, wrote
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const receipt = kind => ({ ok: true, id: `${({ stakeholder: 'stk', meeting: 'mtg', requirement: 'req' })[kind]}_${'a'.repeat(20)}`, ...(kind === 'meeting' ? { seq: 1 } : {}) })
const errors = () => [...document.querySelectorAll('.toast-error')].map(n => n.textContent)
const successes = () => [...document.querySelectorAll('.toast-success')].map(n => n.textContent)
const writes = () => calls.filter(c => c.method !== 'GET')
const agreementReads = id => calls.filter(c => c.method === 'GET' && c.path === `/applications/${id}/agreement`)
const editor = () => screen.getByRole('group', { name: '협의 내용 편집' })
function open(title) { fireEvent.click(screen.getByText(title, { selector: 'h2' }).closest('summary')) }
function section(title) { return within(screen.getByText(title, { selector: 'h2' }).closest('details')) }
function reqCard() { return within(screen.getByText('A 초안 요구').closest('.draft')) }
async function show({ gated = false, strict = false } = {}) {
  const page = <ToastProvider><AgreementPage /></ToastProvider>
  const content = <MemoryRouter initialEntries={['/agreement?id=a']}>{gated ? <WorkspaceGate>{page}</WorkspaceGate> : page}</MemoryRouter>
  render(strict ? <StrictMode>{content}</StrictMode> : content)
  await screen.findByRole('button', { name: '회의 추가' })
}
async function failureSettled() {
  await waitFor(() => expect(errors().length).toBeGreaterThan(0))
  await waitFor(() => expect(editor().disabled).toBe(false))
}
async function editMeeting(value = 'A 편집 중인 회의 원문') {
  open('회의록')
  fireEvent.click(screen.getByRole('button', { name: '펼쳐서 고치기' }))
  fireEvent.change(screen.getByLabelText('A 회의 회의록'), { target: { value } })
}
function fillStakeholder(value = '원본을 다시 확인하는 기능') {
  open('누가 이 일에 얽혀 있나')
  const s = section('누가 이 일에 얽혀 있나')
  fireEvent.change(s.getByLabelText(/부서/), { target: { value: '재무' } })
  fireEvent.change(s.getByLabelText('누구입니까'), { target: { value: '초안 담당' } })
  fireEvent.change(s.getByLabelText('역할'), { target: { value: '검산' } })
  fireEvent.change(s.getByLabelText(/이 사람이 원하는 것/), { target: { value } })
  return s
}
function fillRequirement() {
  open('회의에서 나온 것들')
  const s = section('회의에서 나온 것들')
  fireEvent.click(s.getByText('회의에서 나온 것 적기'))
  fireEvent.change(s.getByLabelText(/내용/), { target: { value: '저장하려는 요구사항' } })
  fireEvent.change(s.getByLabelText('회의록에서 그대로 옮긴 말'), { target: { value: '회의 원문 인용' } })
  fireEvent.change(s.getByLabelText(/통과와 실패를 가르는 기준/), { target: { value: '오차 0원' } })
  return s
}
async function release(held, response) {
  await act(async () => { held.resolve(response); await held.promise })
}
beforeEach(() => {
  mode = { failure: 503, hold: null, readHold: null, reloadFailure: false, initialFailure: false, response: undefined }
  calls = []; wrote = false
  vi.stubGlobal('crypto', webcrypto)
  const generation = beginAccessCheck()
  completeAccessCheck(generation, { ok: true, mode: 'demo', scope: 'a'.repeat(64) })
  vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, '').replace(/^\/api/, '')
    const method = options.method ?? 'GET'
    calls.push({ path, method, body: options.body, key: new Headers(options.headers).get('X-Idempotency-Key') })
    if (method === 'GET') {
      if (path === '/demo/workspace') return reply({ enabled: false })
      if (path === '/session') return reply({ ok: true, mode: 'demo', scope: 'a'.repeat(64) })
      if (path === '/applications') return reply({ items: [app('a'), app('b')] })
      if (path.endsWith('/signoff')) return reply({ state: { binding: false, by: null }, objections: [], ways: [] })
      if (path.endsWith('/agreement')) {
        if (mode.readHold && path === '/applications/a/agreement') return mode.readHold.promise
        if (mode.initialFailure || (wrote && mode.reloadFailure)) return reply({ error: '합성 재조회 실패' }, typeof mode.reloadFailure === 'number' ? mode.reloadFailure : 503)
        return reply(data(path.includes('/a/') ? 'a' : 'b'))
      }
      throw Error(`Unexpected synthetic read ${path}`)
    }
    if (mode.hold) return mode.hold.promise
    if (mode.failure === 'transport') throw Error('Synthetic network loss')
    if (mode.failure) return reply({ error: '합성 저장 거절' }, mode.failure)
    wrote = true
    return reply(mode.response === undefined ? (method === 'POST' ? receipt(JSON.parse(options.body).kind) : { ok: true }) : mode.response)
  }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

it.each([400, 409, 503, 'transport'])('meeting %s failure keeps edited text and never claims success', async failure => {
  mode.failure = failure; await show(); await editMeeting()
  fireEvent.click(screen.getByRole('button', { name: '저장', exact: true }))
  await failureSettled()
  expect(screen.getByLabelText('A 회의 회의록').value).toBe('A 편집 중인 회의 원문')
  expect(successes()).toEqual([]); expect(wrote).toBe(false)
  expect(agreementReads('a')).toHaveLength(1)
  if (failure === 503 || failure === 'transport') {
    expect(errors().some(text => text.includes('저장 결과를 확인하지 못했습니다.'))).toBe(true)
    expect(errors().some(text => text.includes('이력을 먼저 확인'))).toBe(true)
  }
})
it('stakeholder POST failure preserves every draft field', async () => {
  await show(); const s = fillStakeholder()
  fireEvent.click(s.getByRole('button', { name: '추가', exact: true })); await failureSettled()
  expect(s.getByLabelText(/부서/).value).toBe('재무')
  expect(s.getByLabelText('누구입니까').value).toBe('초안 담당')
  expect(s.getByLabelText('역할').value).toBe('검산')
  expect(s.getByLabelText(/이 사람이 원하는 것/).value).toBe('원본을 다시 확인하는 기능')
  expect(successes()).toEqual([])
})
it('stakeholder DELETE failure retains the row and has no false success', async () => {
  await show(); open('누가 이 일에 얽혀 있나'); const s = section('누가 이 일에 얽혀 있나')
  fireEvent.click(s.getByRole('button', { name: '빼기' })); await failureSettled()
  expect(s.getByText('a 담당')).toBeTruthy(); expect(successes()).toEqual([])
})
it('new meeting POST failure preserves its title', async () => {
  await show(); open('회의록')
  fireEvent.change(screen.getByLabelText('새 회의 제목'), { target: { value: '작성 중인 신규 회의 제목' } })
  fireEvent.click(screen.getByRole('button', { name: '회의 추가' })); await failureSettled()
  expect(screen.getByLabelText('새 회의 제목').value).toBe('작성 중인 신규 회의 제목')
})
it('new requirement POST failure preserves body, quote and measurable draft', async () => {
  await show(); const s = fillRequirement()
  fireEvent.click(s.getByRole('button', { name: '추가', exact: true })); await failureSettled()
  expect(s.getByLabelText(/내용/).value).toBe('저장하려는 요구사항')
  expect(s.getByLabelText('회의록에서 그대로 옮긴 말').value).toBe('회의 원문 인용')
  expect(s.getByLabelText(/통과와 실패를 가르는 기준/).value).toBe('오차 0원')
})
it.each(['채택', '지우기'])('requirement %s failure preserves its row without false success', async name => {
  await show(); open('회의에서 나온 것들')
  fireEvent.click(reqCard().getByRole('button', { name, exact: true })); await failureSettled()
  expect(screen.getByText('A 초안 요구')).toBeTruthy(); expect(successes()).toEqual([])
})
it('amend failure leaves the edited sentence open', async () => {
  await show(); open('회의에서 나온 것들')
  fireEvent.click(reqCard().getByRole('button', { name: '고쳐서 채택' }))
  fireEvent.change(screen.getByLabelText('재무 요구사항을 고친 문장'), { target: { value: '검토해 다듬은 새 요구' } })
  fireEvent.click(screen.getByRole('button', { name: '이 문장으로 채택' })); await failureSettled()
  expect(screen.getByLabelText('재무 요구사항을 고친 문장').value).toBe('검토해 다듬은 새 요구')
  expect(successes()).toEqual([])
})
it('reject failure leaves the reason open and does not claim a recorded decision', async () => {
  await show(); open('회의에서 나온 것들')
  fireEvent.click(reqCard().getByRole('button', { name: '기각', exact: true }))
  fireEvent.change(screen.getByLabelText('재무 요구사항 기각 사유'), { target: { value: '실제 업무와 충돌하는 근거' } })
  fireEvent.click(screen.getByRole('button', { name: '기각 확정' })); await failureSettled()
  expect(screen.getByLabelText('재무 요구사항 기각 사유').value).toBe('실제 업무와 충돌하는 근거')
  expect(successes()).toEqual([])
})
it('pending join failure preserves its draft and does not claim it was lifted', async () => {
  await show(); open('누가 이 일에 얽혀 있나')
  fireEvent.change(screen.getByLabelText('영업 요구 내용'), { target: { value: '영업이 실제로 원하는 변경' } })
  fireEvent.click(screen.getByRole('button', { name: '협의안에 올리기' })); await failureSettled()
  expect(screen.getByLabelText('영업 요구 내용').value).toBe('영업이 실제로 원하는 변경')
  expect(successes()).toEqual([])
  expect(screen.getByRole('button', { name: '협의안에 올리기' }).disabled).toBe(false)
})
it('confirmed new meeting with an id and integer seq clears only its submitted title', async () => {
  mode.failure = 0; await show(); open('회의록')
  fireEvent.change(screen.getByLabelText('새 회의 제목'), { target: { value: '확정할 회의 제목' } })
  fireEvent.click(screen.getByRole('button', { name: '회의 추가' }))
  await waitFor(() => expect(screen.getByLabelText('새 회의 제목').value).toBe(''))
  expect(writes()).toHaveLength(1); expect(agreementReads('a')).toHaveLength(2)
  expect(JSON.parse(writes()[0].body)).toEqual({ kind: 'meeting', title: '확정할 회의 제목' })
})
it('confirmed new requirement clears its submitted body quote and measurable fields', async () => {
  mode.failure = 0; await show(); const s = fillRequirement()
  fireEvent.click(s.getByRole('button', { name: '추가', exact: true }))
  await waitFor(() => expect(s.getByLabelText(/내용/).value).toBe(''))
  expect(s.getByLabelText('회의록에서 그대로 옮긴 말').value).toBe('')
  expect(s.getByLabelText(/통과와 실패를 가르는 기준/).value).toBe('')
  expect(writes()).toHaveLength(1)
})
it('confirmed amendment closes its edited sentence after the current-view refresh', async () => {
  mode.failure = 0; await show(); open('회의에서 나온 것들')
  fireEvent.click(reqCard().getByRole('button', { name: '고쳐서 채택' }))
  fireEvent.change(screen.getByLabelText('재무 요구사항을 고친 문장'), { target: { value: '확정한 새 요구' } })
  fireEvent.click(screen.getByRole('button', { name: '이 문장으로 채택' }))
  await waitFor(() => expect(screen.queryByLabelText('재무 요구사항을 고친 문장')).toBeNull())
  expect(JSON.parse(writes()[0].body).decided_body).toBe('확정한 새 요구')
  expect(agreementReads('a')).toHaveLength(2)
})
it('confirmed rejection alone closes the reason and shows the recorded-decision notice', async () => {
  mode.failure = 0; await show(); open('회의에서 나온 것들')
  fireEvent.click(reqCard().getByRole('button', { name: '기각', exact: true }))
  fireEvent.change(screen.getByLabelText('재무 요구사항 기각 사유'), { target: { value: '기록할 기각 근거' } })
  fireEvent.click(screen.getByRole('button', { name: '기각 확정' }))
  await waitFor(() => expect(screen.queryByLabelText('재무 요구사항 기각 사유')).toBeNull())
  expect(successes()).toContain('기각했습니다. 기록에 남았습니다.')
  expect(JSON.parse(writes()[0].body).reject_reason).toBe('기록할 기각 근거')
})
it('confirmed pending join alone shows that its demand was lifted', async () => {
  mode.failure = 0; await show(); open('누가 이 일에 얽혀 있나')
  fireEvent.change(screen.getByLabelText('영업 요구 내용'), { target: { value: '협의로 올릴 영업 요구' } })
  fireEvent.click(screen.getByRole('button', { name: '협의안에 올리기' }))
  await waitFor(() => expect(successes()).toContain('영업의 요구로 올렸습니다. 회의 뒤에 채택/기각을 정하세요.'))
  expect(JSON.parse(writes()[0].body).body).toBe('협의로 올릴 영업 요구')
  expect(writes()).toHaveLength(1)
})
it.each(['patch', 'post'])('%s success plus GET failure retains other drafts and recovers with GET only', async method => {
  mode.failure = 0; mode.reloadFailure = true; await show(); const s = fillStakeholder('아직 저장하지 않은 다른 초안')
  if (method === 'patch') {
    await editMeeting(); fireEvent.click(screen.getByRole('button', { name: '저장', exact: true }))
  } else {
    open('회의록'); fireEvent.change(screen.getByLabelText('새 회의 제목'), { target: { value: '저장될 회의' } })
    fireEvent.click(screen.getByRole('button', { name: '회의 추가' }))
  }
  await screen.findByText('합성 재조회 실패')
  await waitFor(() => expect(editor().getAttribute('aria-busy')).toBe('false'))
  expect(wrote).toBe(true); expect(errors()).toEqual([])
  expect(s.getByLabelText(/이 사람이 원하는 것/).value).toBe('아직 저장하지 않은 다른 초안')
  expect(editor().disabled).toBe(true); expect(writes()).toHaveLength(1)
  if (method === 'patch') expect(successes()).toContain('회의록을 저장했습니다.')
  mode.reloadFailure = false
  fireEvent.click(screen.getByRole('button', { name: '최신 내용 다시 확인' }))
  await waitFor(() => expect(screen.queryByText('합성 재조회 실패')).toBeNull())
  expect(editor().disabled).toBe(false)
  expect(s.getByLabelText(/이 사람이 원하는 것/).value).toBe('아직 저장하지 않은 다른 초안')
  expect(writes()).toHaveLength(1); expect(agreementReads('a')).toHaveLength(3)
})
it('initial transient GET failure offers a read-only retry without forms or writes', async () => {
  mode.initialFailure = true
  render(<MemoryRouter initialEntries={['/agreement?id=a']}><ToastProvider><AgreementPage /></ToastProvider></MemoryRouter>)
  await screen.findByText('합성 재조회 실패')
  expect(screen.queryByRole('group', { name: '협의 내용 편집' })).toBeNull()
  mode.initialFailure = false
  fireEvent.click(screen.getByRole('button', { name: '최신 내용 다시 확인' }))
  await screen.findByRole('button', { name: '회의 추가' })
  expect(writes()).toEqual([]); expect(agreementReads('a')).toHaveLength(2)
})
it('a late A GET-only recovery cannot replace B or revive A notices', async () => {
  mode.failure = 0; mode.reloadFailure = true; await show(); await editMeeting()
  fireEvent.click(screen.getByRole('button', { name: '저장', exact: true }))
  await screen.findByText('합성 재조회 실패')
  await waitFor(() => expect(editor().getAttribute('aria-busy')).toBe('false'))
  // Discard the legitimate, already delivered A success before moving to B.
  for (const close of screen.queryAllByRole('button', { name: '알림 닫기' })) fireEvent.click(close)
  const held = deferred(); mode.reloadFailure = false; mode.readHold = held
  fireEvent.click(screen.getByRole('button', { name: '최신 내용 다시 확인' }))
  await waitFor(() => expect(agreementReads('a')).toHaveLength(3))
  fireEvent.click(screen.getByRole('button', { name: '재무 · B 업무' })); await screen.findByText('B 기존 회의 원문')
  await release(held, reply(data('a')))
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 15)) })
  expect(screen.getByText('B 기존 회의 원문')).toBeTruthy()
  expect(screen.queryByText('A 기존 회의 원문')).toBeNull()
  expect(screen.queryByText('합성 재조회 실패')).toBeNull()
  expect(editor().disabled).toBe(false); expect(writes()).toHaveLength(1)
  expect(errors()).toEqual([])
})
it.each([401, 403, 404, 410])('GET %s after a confirmed write hides previous source and forms', async status => {
  mode.failure = 0; mode.reloadFailure = status; await show(); await editMeeting()
  fireEvent.click(screen.getByRole('button', { name: '저장', exact: true }))
  await waitFor(() => expect(screen.queryByRole('group', { name: '협의 내용 편집' })).toBeNull())
  expect(screen.queryByLabelText('A 회의 회의록')).toBeNull()
  expect(screen.queryByText('A 기존 회의 원문')).toBeNull()
  expect(screen.queryByRole('button', { name: '최신 내용 다시 확인' })).toBeNull()
  expect(writes()).toHaveLength(1)
  expect(successes()).toEqual([])
})
it.each([{}, { ok: false }, { ok: 'true' }, [], null])('malformed PATCH success %j does not close input or claim success', async response => {
  mode.failure = 0; mode.response = response; await show(); await editMeeting()
  fireEvent.click(screen.getByRole('button', { name: '저장', exact: true })); await failureSettled()
  expect(screen.getByLabelText('A 회의 회의록').value).toBe('A 편집 중인 회의 원문')
  expect(successes()).toEqual([]); expect(agreementReads('a')).toHaveLength(1)
  expect(errors().some(text => text.includes('이력을 먼저 확인'))).toBe(true)
})
it('a lost response after a synthetic committed write is unknown, not confirmed-unsaved or success', async () => {
  const held = deferred(); mode.hold = held; await show(); const s = fillStakeholder('결과를 확인할 요청')
  fireEvent.click(s.getByRole('button', { name: '추가', exact: true }))
  await waitFor(() => expect(writes()).toHaveLength(1))
  // This is a synthetic durable-state marker, not a database mutation.
  wrote = true
  await act(async () => { held.reject(Error('Synthetic response loss')); await held.promise.catch(() => {}) })
  await failureSettled()
  expect(s.getByLabelText(/이 사람이 원하는 것/).value).toBe('결과를 확인할 요청')
  expect(successes()).toEqual([])
  expect(errors().some(text => text.includes('저장 결과를 확인하지 못했습니다.'))).toBe(true)
  expect(errors().some(text => text.includes('저장하지 못했습니다.'))).toBe(false)
  expect(agreementReads('a')).toHaveLength(1); expect(writes()).toHaveLength(1)
})
it.each([{ ok: true }, { ok: true, id: 4 }, { ok: true, id: '' }, { ok: true, id: ' padded ' },
  receipt('requirement'), { ok: true, id: `stk_${'a'.repeat(19)}` }, { ok: true, id: `stk_${'A'.repeat(20)}` },
  { ok: true, id: `stk_${'a'.repeat(20)}\u0000` }])('POST receipt %j without the actual id contract preserves the draft', async response => {
  mode.failure = 0; mode.response = response; await show(); const s = fillStakeholder()
  fireEvent.click(s.getByRole('button', { name: '추가', exact: true })); await failureSettled()
  expect(s.getByLabelText(/이 사람이 원하는 것/).value).toBe('원본을 다시 확인하는 기능')
  expect(successes()).toEqual([]); expect(agreementReads('a')).toHaveLength(1)
})
it.each([undefined, '1', 0, 1.5, Number.MAX_SAFE_INTEGER + 1])('meeting POST with invalid seq %s preserves its title', async seq => {
  mode.failure = 0; mode.response = { ...receipt('meeting'), seq }; await show(); open('회의록')
  fireEvent.change(screen.getByLabelText('새 회의 제목'), { target: { value: '보관할 회의 제목' } })
  fireEvent.click(screen.getByRole('button', { name: '회의 추가' })); await failureSettled()
  expect(screen.getByLabelText('새 회의 제목').value).toBe('보관할 회의 제목')
})
it('same-turn repeated save produces one request and locks only legacy sections', async () => {
  const held = deferred(); mode.hold = held; await show({ strict: true }); const s = fillStakeholder('첫 번째 저장 의도')
  const add = s.getByRole('button', { name: '추가', exact: true })
  act(() => { fireEvent.click(add); fireEvent.click(add) })
  await waitFor(() => expect(writes()).toHaveLength(1))
  expect(editor().disabled).toBe(true)
  expect(s.getByLabelText(/이 사람이 원하는 것/).closest('fieldset')).toBe(editor())
  expect(screen.getByText('합격 기준', { selector: 'h2' }).closest('fieldset')).toBeNull()
  expect(screen.getByText('기준선 실측', { selector: 'h2' }).closest('fieldset')).toBeNull()
  await release(held, reply({ error: '합성 저장 거절' }, 400)); await failureSettled()
  expect(s.getByLabelText(/이 사람이 원하는 것/).value).toBe('첫 번째 저장 의도')
  fireEvent.change(s.getByLabelText(/이 사람이 원하는 것/), { target: { value: '실패 뒤 편집한 새 초안' } })
  expect(s.getByLabelText(/이 사람이 원하는 것/).value).toBe('실패 뒤 편집한 새 초안')
})
it('a malformed delayed 2xx retains the same-view lock until validation and preserves its draft', async () => {
  const held = deferred(); mode.hold = held; await show(); const s = fillStakeholder('확정 응답을 기다리는 초안')
  const button = s.getByRole('button', { name: '추가', exact: true })
  act(() => { fireEvent.click(button); fireEvent.click(button) })
  await waitFor(() => expect(writes()).toHaveLength(1))
  expect(editor().disabled).toBe(true)
  await release(held, reply({ ok: true, id: 'not-a-stakeholder-receipt' }))
  await failureSettled()
  expect(s.getByLabelText(/이 사람이 원하는 것/).value).toBe('확정 응답을 기다리는 초안')
  expect(errors().some(text => text.includes('저장 응답을 확인하지 못했습니다.'))).toBe(true)
  expect(successes()).toEqual([]); expect(writes()).toHaveLength(1)
  expect(agreementReads('a')).toHaveLength(1)
})
it('confirmed stakeholder save clears its submitted draft and allows a new draft afterward', async () => {
  const held = deferred(); mode.hold = held; await show(); const s = fillStakeholder('첫 번째 저장 의도')
  fireEvent.click(s.getByRole('button', { name: '추가', exact: true }))
  await waitFor(() => expect(writes()).toHaveLength(1)); expect(editor().disabled).toBe(true)
  await release(held, reply(receipt('stakeholder')))
  await waitFor(() => expect(s.getByLabelText(/이 사람이 원하는 것/).value).toBe(''))
  expect(editor().disabled).toBe(false)
  fireEvent.change(s.getByLabelText(/이 사람이 원하는 것/), { target: { value: '다음 요청의 새 초안' } })
  expect(s.getByLabelText(/이 사람이 원하는 것/).value).toBe('다음 요청의 새 초안')
  expect(JSON.parse(writes()[0].body).wants).toBe('첫 번째 저장 의도')
})
it.each([200, 503])('late A response %s cannot affect B data, drafts or toasts', async status => {
  const held = deferred(); mode.hold = held; await show(); await editMeeting('A 오래된 저장 의도')
  fireEvent.click(screen.getByRole('button', { name: '저장', exact: true }))
  await waitFor(() => expect(writes()).toHaveLength(1))
  fireEvent.click(screen.getByRole('button', { name: '재무 · B 업무' })); await screen.findByText('B 기존 회의 원문')
  open('누가 이 일에 얽혀 있나')
  fireEvent.change(screen.getByLabelText(/이 사람이 원하는 것/), { target: { value: 'B의 새 초안' } })
  await release(held, reply(status === 200 ? { ok: true } : { error: '합성 늦은 A 실패' }, status))
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 15)) })
  expect(errors()).toEqual([]); expect(successes()).toEqual([])
  expect(screen.getByText('B 기존 회의 원문')).toBeTruthy()
  expect(screen.getByLabelText(/이 사람이 원하는 것/).value).toBe('B의 새 초안')
  expect(editor().disabled).toBe(false); expect(agreementReads('a')).toHaveLength(1)
})
it('late A success after A→B→A preserves the new A draft without a stale toast', async () => {
  const held = deferred(); mode.hold = held; await show(); await editMeeting('이전 A 의도')
  fireEvent.click(screen.getByRole('button', { name: '저장', exact: true })); await waitFor(() => expect(writes()).toHaveLength(1))
  fireEvent.click(screen.getByRole('button', { name: '재무 · B 업무' })); await screen.findByText('B 기존 회의 원문')
  fireEvent.click(screen.getByRole('button', { name: '재무 · A 업무' })); await screen.findByText('A 기존 회의 원문')
  await editMeeting('새 A 화면의 보존할 초안')
  await release(held, reply({ ok: true }))
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 15)) })
  expect(errors()).toEqual([]); expect(successes()).toEqual([])
  expect(screen.getByLabelText('A 회의 회의록').value).toBe('새 A 화면의 보존할 초안')
})
it('actual WorkspaceGate includes ToastProvider in the account-generation remount', async () => {
  const held = deferred(); mode.hold = held; await show({ gated: true }); await editMeeting()
  fireEvent.click(screen.getByRole('button', { name: '저장', exact: true })); await waitFor(() => expect(writes()).toHaveLength(1))
  await act(async () => {
    const g = beginAccessCheck(); completeAccessCheck(g, { ok: true, mode: 'demo', scope: 'b'.repeat(64) })
  })
  await screen.findByText('A 기존 회의 원문')
  await release(held, reply({ ok: true }))
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 15)) })
  expect(errors()).toEqual([]); expect(successes()).toEqual([])
  expect(screen.getByText('A 기존 회의 원문')).toBeTruthy(); expect(editor().disabled).toBe(false)
})

it.each([200, 403, 503])('confirmed write with pending reload cannot affect another application after GET %s', async status => {
  mode.failure = 0; await show(); await editMeeting()
  const held = deferred(); mode.readHold = held
  fireEvent.click(screen.getByRole('button', { name: '저장', exact: true }))
  await waitFor(() => expect(agreementReads('a')).toHaveLength(2))
  fireEvent.click(screen.getByRole('button', { name: '재무 · B 업무' })); await screen.findByText('B 기존 회의 원문')
  open('누가 이 일에 얽혀 있나')
  fireEvent.change(screen.getByLabelText(/이 사람이 원하는 것/), { target: { value: 'B의 새 초안' } })
  await release(held, reply(status === 200 ? data('a') : { error: '이전 A 조회 실패' }, status))
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 15)) })
  expect(errors()).toEqual([]); expect(successes()).toEqual([])
  expect(screen.getByLabelText(/이 사람이 원하는 것/).value).toBe('B의 새 초안')
  expect(editor().disabled).toBe(false)
})

it.each([200, 403, 503])('confirmed write with pending reload cannot affect a new account after GET %s', async status => {
  mode.failure = 0; await show({ gated: true }); await editMeeting()
  const held = deferred(); mode.readHold = held
  fireEvent.click(screen.getByRole('button', { name: '저장', exact: true }))
  await waitFor(() => expect(agreementReads('a')).toHaveLength(2))
  mode.readHold = null
  await act(async () => {
    const generation = beginAccessCheck()
    completeAccessCheck(generation, { ok: true, mode: 'demo', scope: 'b'.repeat(64) })
  })
  await screen.findByText('A 기존 회의 원문'); await editMeeting('새 계정의 초안')
  await release(held, reply(status === 200 ? data('a') : { error: '이전 계정 조회 실패' }, status))
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 15)) })
  expect(errors()).toEqual([]); expect(successes()).toEqual([])
  expect(screen.getByLabelText('A 회의 회의록').value).toBe('새 계정의 초안')
})
