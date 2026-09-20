// @vitest-environment happy-dom
import { act, StrictMode, useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import TrackPage from '../src/pages/TrackPage.jsx'
import Thread from '../src/components/Thread.jsx'
import { useActionLifetime } from '../src/hooks/useActionLifetime.js'

const client = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('../src/api/client.js', () => ({ api: client }))
vi.mock('../src/context/ToastContext.jsx', () => ({ useToast: () => toast }))
const A = 'AX-111-111', B = 'AX-222-222'
let pending, posts, navigate
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
function latest(path) { return pending.get(path)?.at(-1) }
function result(ticket) { return { ticket, application: { id: ticket, title: `신청 ${ticket}`, dept: '재무', status: '접수', applicant: '작성자', created_at: '2026-01-01' }, timeline: [], decisions: [], currentStage: '신청' } }
function signoff(ticket) { return { criteria: [{ id: `${ticket}-criterion`, body: `${ticket} 확정 기준`, check_kind: 'human' }], requiredDepts: ['재무', '영업'], state: { canSign: true, status: '확인 전', headline: '기준 확인', requiredDepts: ['재무', '영업'] } } }
function beta() { return { state: { canSay: true, round: { seq: 1, overall: '통과' }, total: 0, open: 0, answered: 0, says: [] } } }
function Controls() { navigate = useNavigate(); const location = useLocation(); return <output data-testid="location">{location.search}</output> }
function show(query = `?no=${A}`) { return render(<MemoryRouter initialEntries={[`/track${query}`]}><Controls /><TrackPage /></MemoryRouter>) }
async function move(query) { await act(async () => { navigate(`/track${query}`) }) }
async function answer(path, body, request = latest(path)) { await act(async () => { request.resolve(body) }) }
async function fail(request, message) { await act(async () => { request.reject(Error(message)) }) }
async function load(ticket) { await answer(`/track/${ticket}`, result(ticket)) }
function betaForm() {
  fireEvent.click(screen.getByRole('button', { name: '써 보고 느낀 것 적기' }))
  fireEvent.change(screen.getByLabelText(/^무슨 일이 있었습니까/), { target: { value: '현장 파일에서 오류를 확인했습니다.' } })
  fireEvent.change(screen.getByLabelText('적어주신 분'), { target: { value: '김직원' } })
  fireEvent.submit(document.querySelector('.betasay form'))
}

beforeEach(() => {
  pending = new Map(); posts = []; client.get.mockReset(); client.post.mockReset(); toast.success.mockReset(); toast.error.mockReset()
  client.get.mockImplementation((path, options) => { const item = { ...deferred(), signal: options?.signal }; const items = pending.get(path) ?? []; items.push(item); pending.set(path, items); return item.promise })
  client.post.mockImplementation((path, body) => { const item = { ...deferred(), path, body }; posts.push(item); return item.promise })
})
afterEach(cleanup)

describe('접수번호 조회는 현재 URL과 화면 생명주기에 귀속된다', () => {
  it.each(['success', 'failure'])('늦은 A %s 응답이 B 본문·주소·입력·문서 링크를 바꾸지 않는다', async kind => {
    show(); const old = latest(`/track/${A}`)
    await move(`?no=${B}`); await load(B)
    if (kind === 'success') await answer(`/track/${A}`, result(A), old)
    else await fail(old, '이전 A 조회 실패')
    expect(screen.getByRole('heading', { name: `신청 ${B}` })).toBeTruthy()
    expect(screen.getByTestId('location').textContent).toBe(`?no=${B}`)
    expect(screen.getByLabelText('접수번호').value).toBe(B)
    expect(screen.getByRole('link', { name: '기록을 문서 한 장으로 보기' }).getAttribute('href')).toBe(`/record/${B}`)
    expect(screen.queryByText('이전 A 조회 실패')).toBeNull()
    expect(old.signal.aborted).toBe(true)
  })

  it('B 조회가 진행되는 동안 A 본문과 쓰기 폼을 숨긴다', async () => {
    show(); await load(A); await answer(`/track/${A}/beta`, beta())
    betaForm()
    await move(`?no=${B}`)
    expect(screen.queryByRole('heading', { name: `신청 ${A}` })).toBeNull()
    expect(screen.queryByLabelText(/^무슨 일이 있었습니까/)).toBeNull()
    expect(screen.getByLabelText('접수번호').value).toBe(B)
  })

  it('A→B→A에서 첫 A의 응답은 새 A 요청을 대신하지 못한다', async () => {
    show(); const old = latest(`/track/${A}`)
    await move(`?no=${B}`); await move(`?no=${A}`)
    await answer(`/track/${A}`, { ...result(A), application: { ...result(A).application, title: '새 A 응답' } })
    await answer(`/track/${A}`, { ...result(A), application: { ...result(A).application, title: '오래된 A 응답' } }, old)
    expect(screen.getByRole('heading', { name: '새 A 응답' })).toBeTruthy()
    expect(screen.queryByText('오래된 A 응답')).toBeNull()
  })

  it('직접 검색은 번호를 정규화하고 as를 보존하며 같은 번호는 재조회한다', async () => {
    show('?as=영업')
    fireEvent.change(screen.getByLabelText('접수번호'), { target: { value: 'ax111111' } })
    fireEvent.submit(document.querySelector('.track-form'))
    expect(new URLSearchParams(screen.getByTestId('location').textContent).get('as')).toBe('영업')
    expect(new URLSearchParams(screen.getByTestId('location').textContent).get('no')).toBe(A)
    await load(A)
    fireEvent.submit(document.querySelector('.track-form'))
    expect(pending.get(`/track/${A}`)).toHaveLength(2)
    await load(A)
    expect(screen.getByRole('heading', { name: `신청 ${A}` })).toBeTruthy()
  })

  it('현재 조회 실패는 본문을 감추고 다른 번호로 정상 복구한다', async () => {
    show(); await fail(latest(`/track/${A}`), '현재 신청을 찾을 수 없습니다.')
    expect(screen.getByRole('alert').textContent).toContain('현재 신청을 찾을 수 없습니다.')
    await move(`?no=${B}`); await load(B)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('heading', { name: `신청 ${B}` })).toBeTruthy()
  })

  it('번호를 지우거나 화면을 떠나면 본문·하위 GET을 취소한다', async () => {
    const view = show(); await load(A)
    const children = [...pending.entries()].filter(([path]) => path.startsWith(`/track/${A}/`)).map(([, rows]) => rows.at(-1))
    await move('')
    expect(screen.queryByRole('heading', { name: `신청 ${A}` })).toBeNull()
    expect(children.every(request => request.signal.aborted)).toBe(true)
    await move(`?no=${B}`); const request = latest(`/track/${B}`)
    view.unmount(); expect(request.signal.aborted).toBe(true)
    await answer(`/track/${B}`, result(B), request)
  })

  it('하위 기준 응답과 서명 입력은 다른 ticket/as에 재사용하지 않는다', async () => {
    show(`?no=${A}&as=재무`); await load(A)
    const old = latest(`/track/${A}/signoff`)
    await answer(`/track/${A}/signoff`, signoff(A))
    fireEvent.change(screen.getByRole('combobox', { name: /^어느 부서로 확인하십니까/ }), { target: { value: '영업' } })
    await move(`?no=${B}&as=재무`); await load(B)
    await answer(`/track/${B}/signoff`, signoff(B))
    expect(screen.getByRole('combobox', { name: /^어느 부서로 확인하십니까/ }).value).toBe('재무')
    expect(screen.queryByText(`${A} 확정 기준`)).toBeNull()
    expect(old.signal.aborted).toBe(true)
    await move(`?no=${B}&as=영업`)
    await answer(`/track/${B}/signoff`, signoff(B))
    expect(screen.getByRole('combobox', { name: /^어느 부서로 확인하십니까/ }).value).toBe('영업')
  })

  for (const endpoint of ['resubmit', 'signoff', 'waitline', 'hold', 'beta', 'outcome']) it.each(['success', 'failure'])(`${endpoint} 하위 GET의 늦은 %s는 다른 신청서에 나타나지 않는다`, async kind => {
    show()
    const initial = result(A); initial.application.status = '반려'
    await answer(`/track/${A}`, initial)
    const old = latest(`/track/${A}/${endpoint}`)
    await move(`?no=${B}`); await load(B)
    if (kind === 'success') await answer(`/track/${A}/${endpoint}`, { ...signoff(A), state: { show: false, canTell: false, canSay: false, canConfirm: false }, eligible: false }, old)
    else await fail(old, '이전 신청서 하위 오류')
    expect(old.signal.aborted).toBe(true)
    expect(screen.getByRole('heading', { name: `신청 ${B}` })).toBeTruthy()
    expect(screen.queryByText(`${A} 확정 기준`)).toBeNull()
    expect(screen.queryByText('이전 신청서 하위 오류')).toBeNull()
  })

  it('서명 제출은 현재 번호·부서·기준 ID만 전송하고 성공 후 같은 번호를 조회한다', async () => {
    show(`?no=${A}&as=재무`); await load(A); await answer(`/track/${A}/signoff`, signoff(A))
    fireEvent.click(screen.getByRole('radio', { name: '맞습니다' }))
    fireEvent.change(screen.getByLabelText('확인하신 분'), { target: { value: '김직원' } })
    await move(`?no=${B}&as=영업`); await load(B); await answer(`/track/${B}/signoff`, signoff(B))
    expect(screen.getByLabelText('확인하신 분').value).toBe('')
    expect(screen.getByRole('radio', { name: '맞습니다' }).checked).toBe(false)
    fireEvent.click(screen.getByRole('radio', { name: '맞습니다' }))
    fireEvent.change(screen.getByLabelText('확인하신 분'), { target: { value: '이직원' } })
    fireEvent.submit(screen.getByRole('button', { name: '확인했습니다' }).closest('form'))
    expect(posts[0]).toMatchObject({ path: `/track/${B}/signoff`, body: { by: '이직원', dept: '영업', verdicts: { [`${B}-criterion`]: 'ok' }, reasons: {} } })
    await act(async () => { posts[0].resolve({ message: '현재 서명을 저장했습니다.' }) })
    expect(screen.getByText('현재 서명을 저장했습니다.')).toBeTruthy()
    expect(pending.get(`/track/${B}`)).toHaveLength(2)
    expect(pending.get(`/track/${B}/signoff`)).toHaveLength(2)
  })

  it('현재 접수번호의 대기 순서와 서버가 보낸 예상기간을 그대로 보여준다', async () => {
    show(); await load(A)
    await answer(`/track/${A}/waitline`, { state: { show: true, phase: 'unranked', headline: '검토 순서를 정하는 중', body: '검토 후 알려드립니다.', aheadRunning: [], aheadPicked: [] }, lead: { show: true, shaky: true, text: '완료 5건의 가운데값은 12.5일입니다.' } })
    expect(screen.getByText('검토 순서를 정하는 중')).toBeTruthy()
    expect(screen.getByText('언제쯤 되나')).toBeTruthy()
    expect(screen.getByText(/완료 5건의 가운데값은 12.5일입니다/)).toBeTruthy()
  })

  it.each(['success', 'failure'])('A 의견 저장의 늦은 %s는 A→B→A 후 새 화면을 갱신하지 않는다', async kind => {
    show(); await load(A); await answer(`/track/${A}/beta`, beta()); betaForm()
    expect(posts[0].path).toBe(`/track/${A}/beta`)
    await move(`?no=${B}`); await load(B)
    await move(`?no=${A}`); await load(A); await answer(`/track/${A}/beta`, beta())
    const count = client.get.mock.calls.length
    if (kind === 'success') await act(async () => { posts[0].resolve({ ...beta(), message: '이전 A 의견 저장 완료' }) })
    else await fail(posts[0], '이전 A 의견 저장 실패')
    expect(screen.queryByText(/이전 A 의견 저장/)).toBeNull()
    expect(client.get.mock.calls).toHaveLength(count)
    expect(screen.getByRole('button', { name: '써 보고 느낀 것 적기' }).disabled).toBe(false)
  })

  it('현재 ticket 의견 저장은 기존처럼 결과를 보이고 같은 ticket을 재조회한다', async () => {
    show(); await load(A); await answer(`/track/${A}/beta`, beta()); betaForm()
    await act(async () => { posts[0].resolve({ ...beta(), message: '의견을 저장했습니다.' }) })
    expect(screen.getByText('의견을 저장했습니다.')).toBeTruthy()
    expect(pending.get(`/track/${A}`)).toHaveLength(2)
    expect(screen.getByTestId('location').textContent).toBe(`?no=${A}`)
  })
})

const variants = [
  { name: '담당자 질문', mode: 'staff', decisions: [], open: '되물어보기', submit: '질문 남기기', path: '/applications/app-A/ask' },
  { name: '부서 질문', mode: 'dept', decisions: [], open: '담당자에게 물어보기', submit: '보내기', path: `/track/${A}/ask` },
  { name: '부서 답변', mode: 'dept', decisions: [{ id: 'q', link_kind: '질문', what: '담당자 질문', created_at: '2026-01-01' }], submit: '답 보내기', path: `/track/${A}/answer` },
  { name: '담당자 답변', mode: 'staff', decisions: [{ id: 'q', link_kind: '부서질문', what: '부서 질문', created_at: '2026-01-01' }], submit: '답하기', path: '/applications/app-A/reply' },
]
describe('질문·답변도 현재 신청서에 속하는 완료 알림만 표시한다', () => {
  for (const variant of variants) it.each(['success', 'failure'])(`${variant.name} 이전 화면 %s를 새 화면에서 처리하지 않는다`, async kind => {
    const saved = vi.fn()
    const element = ticket => <Thread mode={variant.mode} ticket={ticket} applicationId={ticket === A ? 'app-A' : 'app-B'} decisions={variant.decisions} onChanged={saved} />
    const view = render(element(A))
    if (variant.open) fireEvent.click(screen.getByRole('button', { name: variant.open }))
    const submit = screen.getByRole('button', { name: variant.submit })
    fireEvent.submit(submit.closest('form'))
    expect(posts[0].path).toBe(variant.path)
    view.rerender(element(B)); view.rerender(element(A))
    if (kind === 'success') await act(async () => { posts[0].resolve({ message: '이전 답변 완료', tellThem: '이전 질문 완료' }) })
    else await fail(posts[0], '이전 요청 실패')
    expect(toast.success).not.toHaveBeenCalled(); expect(toast.error).not.toHaveBeenCalled(); expect(saved).not.toHaveBeenCalled()
  })

  it('현재 질문 성공은 알림·재조회를 유지하고 unmount 뒤 결과는 무시한다', async () => {
    const saved = vi.fn()
    const view = render(<Thread mode="staff" applicationId="app-A" decisions={[]} onChanged={saved} />)
    fireEvent.click(screen.getByRole('button', { name: '되물어보기' }))
    fireEvent.submit(screen.getByRole('button', { name: '질문 남기기' }).closest('form'))
    await act(async () => { posts[0].resolve({ tellThem: '현재 질문 완료' }) })
    expect(toast.success).toHaveBeenCalledWith('현재 질문 완료'); expect(saved).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: '되물어보기' }))
    fireEvent.submit(screen.getByRole('button', { name: '질문 남기기' }).closest('form'))
    view.unmount(); await fail(posts[1], '닫힌 화면 실패')
    expect(toast.error).not.toHaveBeenCalled(); expect(saved).toHaveBeenCalledTimes(1)
  })

  it('현재 질문 실패는 오류를 보여 주고 다시 제출할 수 있다', async () => {
    render(<Thread mode="staff" applicationId="app-A" decisions={[]} />)
    fireEvent.click(screen.getByRole('button', { name: '되물어보기' }))
    fireEvent.submit(screen.getByRole('button', { name: '질문 남기기' }).closest('form'))
    await fail(posts[0], '현재 질문 저장 실패')
    expect(toast.error).toHaveBeenCalledWith('현재 질문 저장 실패')
    expect(screen.getByRole('button', { name: '질문 남기기' }).disabled).toBe(false)
  })
})

it('action lifetime은 같은 ID로 돌아오거나 effect가 다시 시작돼도 이전 토큰을 살리지 않는다', () => {
  const captures = []
  function Probe({ identity }) { const capture = useActionLifetime(identity); useEffect(() => { captures.push(capture()) }, [identity, capture]); return null }
  const view = render(<Probe identity="A" />)
  expect(captures[0]()).toBe(true)
  view.rerender(<Probe identity="B" />); view.rerender(<Probe identity="A" />)
  expect(captures.map(current => current())).toEqual([false, false, true])
  view.unmount(); expect(captures.at(-1)()).toBe(false)
})

it('StrictMode effect 재시작 뒤 이전 lifetime 토큰은 무효이고 현재 토큰은 유효하다', () => {
  const captures = []
  function Probe() { const capture = useActionLifetime('A'); useEffect(() => { captures.push(capture()) }, [capture]); return null }
  render(<StrictMode><Probe /></StrictMode>)
  expect(captures).toHaveLength(2)
  expect(captures.map(current => current())).toEqual([false, true])
})
