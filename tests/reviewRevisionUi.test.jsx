// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import ReviewPage, { Detail } from '../src/pages/ReviewPage.jsx'
import { Retry } from '../src/pages/TrackPage.jsx'

const client = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('../src/api/client.ts', () => ({ api: client }))
vi.mock('../src/context/ToastContext.jsx', () => ({ useToast: () => toast }))
vi.mock('../src/components/StageHeader.jsx', () => ({ default: () => null }))
vi.mock('../src/components/ApplicationOwnership.jsx', () => ({ default: () => null }))
vi.mock('../src/components/SimilarNotice.jsx', () => ({ default: () => null }))
vi.mock('../src/components/Thread.jsx', () => ({ default: ({ onChanged }) => <button onClick={onChanged}>대화 다시 불러오기</button> }))

let records
const changed = '등록 기능을 빼고 파일 작성만 요청합니다.'
const stale = () => Object.assign(new Error('다른 판정이 먼저 저장됐습니다.'), { status: 409 })
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
function application(id = 'a', revision = 2, status = '접수') {
  return { id, review_revision: revision, status, ticket_no: `AX-${id}`, title: `신청서 ${id}`, dept: '재무', applicant_label: '작성자', bottleneck: '반복 작업', problem: '시간이 오래 걸립니다.', created_at: '2026-01-01 00:00:00' }
}
function detail(id = 'a', revision = 2, verdict = '수용') {
  return { application: application(id, revision), review: { impact_score: 3, difficulty_score: 3, verdict, verdict_reason: `기존 판정 ${id}`, reviewer_label: '검토자', hold_until_condition: verdict === '보류' ? '예산 확인 뒤' : '' }, decisions: [] }
}
function retryInfo(revision = 2, eligible = true) {
  return { eligible, previous: { ticket_no: 'AX-a', review_revision: revision, status: eligible ? '반려' : '수용', verdict: eligible ? '반려' : '수용' },
    plan: eligible ? { canRetry: true, headline: '범위를 줄여 다시 내실 수 있습니다.', cta: '범위 줄여 다시 쓰기', left: 2, change: '파일 작성만 요청하세요.', fromReviewer: '담당자가 제안한 새 대안' } : null,
    why: eligible ? null : '현재 수용되어 다시 낼 수 없습니다.', draft: { title: '원래 신청', bottleneck: '반복 작업', problem: '오래 걸립니다.', wish: '' } }
}
const shell = node => <MemoryRouter>{node}</MemoryRouter>
const reason = () => screen.getByRole('textbox', { name: /^판정 근거/ })
const submitReview = () => fireEvent.submit(screen.getByRole('button', { name: '판정 다시 저장' }).closest('form'))
async function showDetail(id = 'a', onSaved = vi.fn().mockResolvedValue()) {
  const view = render(shell(<Detail key={id} id={id} onSaved={onSaved} pool={[]} />))
  await screen.findByRole('textbox', { name: /^판정 근거/ })
  await waitFor(() => expect(screen.getByRole('button', { name: '판정 다시 저장' }).disabled).toBe(false))
  return { ...view, onSaved }
}
async function showRetry(ticket = 'AX-a', onDone = vi.fn()) {
  const view = render(shell(<Retry key={ticket} ticket={ticket} onDone={onDone} />))
  fireEvent.click(await screen.findByRole('button', { name: '범위 줄여 다시 쓰기' }))
  fireEvent.change(screen.getByLabelText('무엇을 바꾸셨습니까'), { target: { value: changed } })
  return { ...view, onDone }
}

beforeEach(() => {
  vi.clearAllMocks()
  client.get.mockReset(); client.post.mockReset()
  records = { '/applications/a': detail(), '/applications/b': detail('b', 8), '/applications': { items: [application(), application('b', 8)] }, '/track/AX-a/resubmit': retryInfo(), '/track/AX-b/resubmit': retryInfo(8) }
  client.get.mockImplementation(async path => {
    if (path.endsWith('/join')) return { joins: [] }
    if (!(path in records)) throw new Error(`Unexpected GET ${path}`)
    return structuredClone(records[path])
  })
  client.post.mockResolvedValue({ verdict: '수용', message: '저장했습니다.', ticket_no: 'AX-new', previous_ticket: 'AX-a' })
})
afterEach(cleanup)

describe('검토 판정의 화면 버전과 초안', () => {
  it('409 뒤 최신 판정을 별도로 읽고 명시적으로 확인하기 전에는 초안이나 버전을 바꾸지 않는다', async () => {
    client.post.mockRejectedValueOnce(stale())
    await showDetail()
    fireEvent.change(reason(), { target: { value: '내가 작성 중인 근거' } })
    submitReview()
    await screen.findByRole('region', { name: '최신 판정 확인' })
    expect(client.post.mock.calls[0][1]).toMatchObject({ expectedRevision: 2, verdict_reason: '내가 작성 중인 근거' })
    expect(reason().value).toBe('내가 작성 중인 근거')
    records['/applications/a'] = detail('a', 3, '보류')
    records['/applications/a'].application.status = '보류'
    fireEvent.click(screen.getByRole('button', { name: '최신 판정 불러오기' }))
    await screen.findByText('최신 상태: 보류 · 최신 판정: 보류')
    expect(reason().value).toBe('내가 작성 중인 근거')
    expect(screen.getByRole('button', { name: '판정 다시 저장' }).disabled).toBe(true)
    submitReview(); expect(client.post).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: '최신 판정을 확인하고 작성 내용 유지' }))
    expect(reason().value).toBe('내가 작성 중인 근거')
    submitReview()
    await waitFor(() => expect(client.post).toHaveBeenCalledTimes(2))
    expect(client.post.mock.calls[1][1]).toMatchObject({ expectedRevision: 3, verdict: '수용', verdict_reason: '내가 작성 중인 근거' })
  })

  it('대화의 배경 재조회가 초안과 제출 기준 버전을 덮어쓰지 않는다', async () => {
    await showDetail()
    fireEvent.change(reason(), { target: { value: '새로 쓰던 판정' } })
    records['/applications/a'] = detail('a', 3, '반려')
    fireEvent.click(screen.getByRole('button', { name: '대화 다시 불러오기' }))
    await screen.findByRole('region', { name: '최신 판정 확인' })
    expect(reason().value).toBe('새로 쓰던 판정')
    submitReview(); expect(client.post).not.toHaveBeenCalled()
  })

  it('저장 성공 뒤에는 서버에서 읽은 판정과 버전을 함께 갱신하여 다음 판정을 저장한다', async () => {
    client.post.mockImplementation(async (_path, body) => {
      const saved = detail('a', body.expectedRevision + 1, body.verdict)
      saved.review = { ...saved.review, ...body }
      records['/applications/a'] = saved
      return { verdict: body.verdict }
    })
    await showDetail()
    fireEvent.change(reason(), { target: { value: '첫 번째 저장 근거' } }); submitReview()
    await waitFor(() => expect(screen.getByRole('button', { name: '판정 다시 저장' }).disabled).toBe(false))
    expect(reason().value).toBe('첫 번째 저장 근거')
    fireEvent.change(reason(), { target: { value: '두 번째 저장 근거' } }); submitReview()
    await waitFor(() => expect(client.post).toHaveBeenCalledTimes(2))
    expect(client.post.mock.calls.map(([, body]) => body.expectedRevision)).toEqual([2, 3])
    expect(client.post.mock.calls[1][1].verdict_reason).toBe('두 번째 저장 근거')
  })

  it.each(['resolve', 'reject'])('저장 중 폼을 잠그고 신청서를 바꾸면 이전 %s 응답의 후속 처리를 버린다', async end => {
    const pending = deferred(); client.post.mockReturnValueOnce(pending.promise)
    const view = await showDetail()
    fireEvent.change(reason(), { target: { value: 'A에서 보낸 근거' } }); submitReview()
    expect(reason().closest('fieldset').disabled).toBe(true)
    fireEvent.change(reason(), { target: { value: '저장 중 입력' } })
    expect(reason().value).toBe('A에서 보낸 근거')
    view.rerender(shell(<Detail key="b" id="b" onSaved={view.onSaved} pool={[]} />))
    await screen.findByDisplayValue('기존 판정 b')
    fireEvent.change(reason(), { target: { value: 'B에서 쓰는 근거' } })
    await act(async () => end === 'resolve' ? pending.resolve({ verdict: '수용' }) : pending.reject(stale()))
    expect(reason().value).toBe('B에서 쓰는 근거')
    expect(view.onSaved).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled(); expect(toast.error).not.toHaveBeenCalled()
  })

  it('최신 판정 읽기의 늦은 응답도 다른 신청서에 적용하지 않는다', async () => {
    client.post.mockRejectedValueOnce(stale())
    const view = await showDetail(); submitReview()
    await screen.findByRole('region', { name: '최신 판정 확인' })
    const pending = deferred(); client.get.mockImplementationOnce(() => pending.promise)
    fireEvent.click(screen.getByRole('button', { name: '최신 판정 불러오기' }))
    view.rerender(shell(<Detail key="b" id="b" onSaved={view.onSaved} pool={[]} />))
    await screen.findByDisplayValue('기존 판정 b')
    await act(async () => pending.resolve(detail('a', 10, '반려')))
    expect(screen.queryByRole('region', { name: '최신 판정 확인' })).toBeNull()
    expect(reason().value).toBe('기존 판정 b')
  })
})

describe('일괄 선택은 선택 시점의 판정 버전을 보관한다', () => {
  it('목록 재조회로 버전이 바뀌어도 기존 선택 버전을 보내며 409 뒤 사유를 보존하고 다시 선택한다', async () => {
    client.post.mockRejectedValueOnce(stale())
    render(shell(<ReviewPage />))
    fireEvent.click(await screen.findByRole('checkbox', { name: '신청서 a 고르기' }))
    fireEvent.click(screen.getByRole('button', { name: '보류로 미루기' }))
    fireEvent.change(screen.getByRole('textbox', { name: /^언제 다시 보시겠습니까/ }), { target: { value: '월말 업무가 끝나면 다시 봅니다.' } })
    records['/applications'].items[0].review_revision = 5
    fireEvent.click(await screen.findByRole('button', { name: '대화 다시 불러오기' }))
    await waitFor(() => expect(client.get.mock.calls.filter(([path]) => path === '/applications')).toHaveLength(2))
    fireEvent.click(screen.getByRole('button', { name: '1건 보류로 미루기' }))
    await screen.findByText('선택한 뒤 판정이 바뀌었습니다. 작성한 사유는 유지됩니다. 최신 목록을 읽고 처리할 신청서를 다시 골라주세요.')
    expect(client.post.mock.calls[0][1]).toMatchObject({ ids: ['a'], expectedRevisions: { a: 2 }, reason: '월말 업무가 끝나면 다시 봅니다.' })
    fireEvent.click(screen.getByRole('button', { name: '최신 목록을 읽고 선택 해제' }))
    await waitFor(() => expect(screen.getByRole('checkbox', { name: '신청서 a 고르기' }).checked).toBe(false))
    fireEvent.click(screen.getByRole('checkbox', { name: '신청서 a 고르기' }))
    expect(screen.getByRole('textbox', { name: /^언제 다시 보시겠습니까/ }).value).toBe('월말 업무가 끝나면 다시 봅니다.')
    fireEvent.click(screen.getByRole('button', { name: '1건 보류로 미루기' }))
    await waitFor(() => expect(client.post).toHaveBeenCalledTimes(2))
    expect(client.post.mock.calls[1][1].expectedRevisions).toEqual({ a: 5 })
  })

  it('일괄 저장 중 선택·사유를 잠그고 화면을 떠난 뒤 응답은 새 선택을 지우지 않는다', async () => {
    const pending = deferred(); client.post.mockReturnValueOnce(pending.promise)
    const view = render(shell(<ReviewPage />))
    fireEvent.click(await screen.findByRole('checkbox', { name: '신청서 a 고르기' }))
    fireEvent.click(screen.getByRole('button', { name: '보류로 미루기' }))
    const input = screen.getByRole('textbox', { name: /^언제 다시 보시겠습니까/ })
    fireEvent.change(input, { target: { value: '작성한 일괄 보류 사유' } })
    fireEvent.click(screen.getByRole('button', { name: '1건 보류로 미루기' }))
    expect(input.disabled).toBe(true)
    expect(screen.getByRole('checkbox', { name: '신청서 b 고르기' }).disabled).toBe(true)
    view.unmount(); render(shell(<ReviewPage />))
    fireEvent.click(await screen.findByRole('checkbox', { name: '신청서 b 고르기' }))
    await act(async () => pending.resolve({ message: 'A 처리 완료' }))
    expect(screen.getByRole('checkbox', { name: '신청서 b 고르기' }).checked).toBe(true)
    expect(toast.success).not.toHaveBeenCalled()
  })
})

describe('재신청은 폼을 연 때의 반려 판정을 사용한다', () => {
  it('409 뒤 작성 내용을 보존하고 최신 반려 안내를 확인한 뒤에만 새 버전으로 제출한다', async () => {
    client.post.mockRejectedValueOnce(stale())
    await showRetry()
    fireEvent.change(screen.getByLabelText('제목'), { target: { value: '내가 수정한 제목' } })
    fireEvent.click(screen.getByRole('button', { name: '다시 내기' }))
    await screen.findByRole('region', { name: '재신청 최신 판정 확인' })
    expect(client.post.mock.calls[0][1]).toMatchObject({ expectedRevision: 2, title: '내가 수정한 제목', changed })
    records['/track/AX-a/resubmit'] = retryInfo(4)
    fireEvent.click(screen.getByRole('button', { name: '최신 판정 불러오기' }))
    await screen.findByText('최신 상태: 반려 · 최신 판정: 반려')
    expect(screen.getByLabelText('제목').value).toBe('내가 수정한 제목')
    expect(screen.getByRole('button', { name: '다시 내기' }).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '최신 판정을 확인하고 작성 내용 유지' }))
    expect(screen.getByLabelText('무엇을 바꾸셨습니까').value).toBe(changed)
    fireEvent.click(screen.getByRole('button', { name: '다시 내기' }))
    await waitFor(() => expect(client.post).toHaveBeenCalledTimes(2))
    expect(client.post.mock.calls[1][1]).toMatchObject({ expectedRevision: 4, title: '내가 수정한 제목', changed })
  })

  it('최신 상태가 수용이면 초안을 보여주되 다시 내기를 허용하지 않는다', async () => {
    client.post.mockRejectedValueOnce(stale())
    await showRetry(); fireEvent.click(screen.getByRole('button', { name: '다시 내기' }))
    await screen.findByRole('region', { name: '재신청 최신 판정 확인' })
    records['/track/AX-a/resubmit'] = retryInfo(3, false)
    fireEvent.click(screen.getByRole('button', { name: '최신 판정 불러오기' }))
    const notice = await screen.findByRole('region', { name: '재신청 최신 판정 확인' })
    await within(notice).findByText('최신 상태: 수용 · 최신 판정: 수용')
    expect(screen.getByLabelText('무엇을 바꾸셨습니까').value).toBe(changed)
    expect(screen.queryByRole('button', { name: '최신 판정을 확인하고 작성 내용 유지' })).toBeNull()
    expect(screen.getByRole('button', { name: '다시 내기' }).disabled).toBe(true)
  })

  it.each(['resolve', 'reject'])('재신청 저장 중 수정·닫기를 막고 이전 %s 응답은 다른 접수번호를 갱신하지 않는다', async end => {
    const pending = deferred(); client.post.mockReturnValueOnce(pending.promise)
    const view = await showRetry(); fireEvent.click(screen.getByRole('button', { name: '다시 내기' }))
    expect(screen.getByLabelText('제목').closest('fieldset').disabled).toBe(true)
    expect(screen.getByRole('button', { name: '그만두기' }).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('제목'), { target: { value: '저장 중 바꾸기' } })
    expect(screen.getByLabelText('제목').value).toBe('원래 신청')
    view.rerender(shell(<Retry key="AX-b" ticket="AX-b" onDone={view.onDone} />))
    fireEvent.click(await screen.findByRole('button', { name: '범위 줄여 다시 쓰기' }))
    fireEvent.change(screen.getByLabelText('제목'), { target: { value: 'B 신청의 제목' } })
    await act(async () => end === 'resolve' ? pending.resolve({ ticket_no: 'AX-new', previous_ticket: 'AX-a' }) : pending.reject(stale()))
    expect(screen.getByLabelText('제목').value).toBe('B 신청의 제목')
    expect(view.onDone).not.toHaveBeenCalled()
    expect(screen.queryByText('새 접수번호는 AX-new입니다')).toBeNull()
  })
})
