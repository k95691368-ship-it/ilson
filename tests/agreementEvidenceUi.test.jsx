// @vitest-environment happy-dom
import { act, useState } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import AgreementEvidence from '../src/components/AgreementEvidence.jsx'

const client = vi.hoisted(() => ({ post: vi.fn(), patch: vi.fn() }))
vi.mock('../src/api/client.js', () => ({ api: client }))
let latest, refresh
const base = () => ({ application: { id: 'a', ticket_no: 'AX-AAA-123', current_people: 2, current_frequency: '매주' },
  criteria_source_version: 'criteria-v1', baseline_source_version: 'baseline-v1', baseline: null, shadowRuns: [], criteria: [] })
function Harness({ id = 'a' }) {
  const [data, setData] = useState(latest)
  refresh = vi.fn(async () => { setData(latest); return latest })
  return <AgreementEvidence key={id} id={id} data={data} refresh={() => refresh()} />
}
function show() { return render(<MemoryRouter><Harness /></MemoryRouter>) }
function open(label) { fireEvent.click(screen.getByText(label, { selector: 'h2' }).closest('summary')) }
const conflict = () => Object.assign(Error('최신 기록과 다릅니다.'), { status: 409 })
beforeEach(() => { latest = base(); client.post.mockReset(); client.patch.mockReset() })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('두 입력은 접힌 상태이고 신청 인원과 주기를 유지한다', () => {
  const view = show()
  expect([...view.container.querySelectorAll('details')].every(d => !d.open)).toBe(true)
  open('기준선 실측')
  expect(screen.getByLabelText(/참여 인원/).value).toBe('2')
  expect(screen.getByLabelText('업무 주기').value).toBe('매주')
  expect(screen.getByRole('button', { name: '기준선 확정' }).disabled).toBe(true)
})

it('직접 기준 추가는 미확정이며 목록 판본을 보내고 성공 후 입력을 비운다', async () => {
  show(); open('합격 기준')
  client.post.mockResolvedValue({ ok: true })
  fireEvent.change(screen.getByLabelText(/합격 조건/), { target: { value: '담당자가 검산할 수 있다' } })
  fireEvent.click(screen.getByRole('button', { name: '기준 추가' }))
  await waitFor(() => expect(client.post).toHaveBeenCalledWith('/applications/a/agreement', {
    kind: 'criterion', check_key: '', body: '담당자가 검산할 수 있다', is_required_safety: false, expectedVersion: 'criteria-v1',
  }))
  await waitFor(() => expect(screen.getByLabelText(/합격 조건/).value).toBe(''))
})

it('규칙 항목은 정해진 본문·기본 안전 설정을 사용하며 별도 확정한다', async () => {
  show(); open('합격 기준'); client.post.mockResolvedValue({ ok: true })
  fireEvent.change(screen.getByLabelText('판정 항목'), { target: { value: 'amount_exact' } })
  expect(screen.queryByLabelText(/합격 조건/)).toBeNull()
  expect(screen.getByRole('checkbox', { name: '필수 안전 기준' }).checked).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: '기준 추가' }))
  await waitFor(() => expect(client.post).toHaveBeenCalledWith('/applications/a/agreement', expect.objectContaining({
    kind: 'criterion', check_key: 'amount_exact', is_required_safety: true, expectedVersion: 'criteria-v1',
  })))
  expect(client.post.mock.calls[0][1]).not.toHaveProperty('confirmed')
})

it('추가 요청의 응답 유실은 입력을 잠그고 같은 본문으로만 재시도한다', async () => {
  show(); open('합격 기준')
  client.post.mockRejectedValueOnce(Object.assign(Error('응답 유실'), { status: 503 })).mockResolvedValue({ ok: true })
  fireEvent.change(screen.getByLabelText(/합격 조건/), { target: { value: '원본 추적 확인' } })
  fireEvent.click(screen.getByRole('button', { name: '기준 추가' }))
  await screen.findByRole('button', { name: '같은 기록 저장 확인' })
  expect(screen.getByLabelText(/합격 조건/).closest('fieldset').disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: '같은 기록 저장 확인' }))
  await waitFor(() => expect(client.post).toHaveBeenCalledTimes(2))
  expect(client.post.mock.calls[1]).toEqual(client.post.mock.calls[0])
})

it('쓰기 성공 뒤 재조회 실패는 새 쓰기 없이 조회만 재시도한다', async () => {
  show(); open('합격 기준'); client.post.mockResolvedValue({ ok: true })
  refresh.mockRejectedValueOnce(Error('조회 실패'))
  fireEvent.change(screen.getByLabelText(/합격 조건/), { target: { value: '원본 확인' } })
  fireEvent.click(screen.getByRole('button', { name: '기준 추가' }))
  await screen.findByText('저장은 완료됐지만 최신 목록을 불러오지 못했습니다.')
  fireEvent.click(screen.getByRole('button', { name: '최신 기록 확인' }))
  await screen.findByText('최신 기록을 불러왔습니다. 입력한 내용과 비교한 뒤 저장해주세요.')
  expect(client.post).toHaveBeenCalledTimes(1)
})

it('기준 변경 충돌은 초안을 보존하고 최신 판본을 확인한 뒤 재저장한다', async () => {
  const item = { id: 'c1', ord: 1, body: '원본 확인', check_kind: 'human', confirmed_at: null, is_required_safety: 0, edit_version: 'row-v1' }
  latest.criteria = [item]
  show(); open('합격 기준')
  const row = within(screen.getByRole('form', { name: '1. 원본 확인' }))
  fireEvent.click(row.getByRole('checkbox', { name: '이 기준으로 시험하도록 확정' }))
  client.patch.mockRejectedValueOnce(conflict()).mockResolvedValue({ ok: true })
  fireEvent.click(row.getByRole('button', { name: '기준 상태 저장' }))
  await row.findByRole('button', { name: '최신 기록 확인' })
  latest = { ...base(), criteria: [{ ...item, edit_version: 'row-v2', is_required_safety: 1 }] }
  fireEvent.click(row.getByRole('button', { name: '최신 기록 확인' }))
  await waitFor(() => expect(row.getByRole('button', { name: '기준 상태 저장' }).closest('fieldset').disabled).toBe(false))
  expect(row.getByText(/현재 기록:/).textContent).toContain('필수 안전')
  expect(row.getByRole('checkbox', { name: '이 기준으로 시험하도록 확정' }).checked).toBe(true)
  fireEvent.click(row.getByRole('button', { name: '기준 상태 저장' }))
  await waitFor(() => expect(client.patch).toHaveBeenCalledTimes(2))
  expect(client.patch.mock.calls[1][1]).toMatchObject({ confirmed: true, is_required_safety: true, expectedVersion: 'row-v2' })
})

it('기준선 충돌은 미편집 인원을 최신값으로 합치고 같은 단가 충돌은 명시적으로 고른다', async () => {
  latest.shadowRuns = [580, 600, 620].map((seconds, i) => ({ id: `r${i}`, seq: i + 1, total_seconds: seconds, error_count: 0 }))
  show(); open('기준선 실측')
  client.post.mockRejectedValueOnce(conflict()).mockResolvedValue({ ok: true })
  fireEvent.change(screen.getByLabelText(/시간당 비용/), { target: { value: '3600' } })
  fireEvent.click(screen.getByRole('button', { name: '기준선 확정' }))
  await screen.findByRole('button', { name: '최신 기록 확인' })
  latest = { ...latest, baseline_source_version: 'baseline-v2', baseline: { people: 4, hourly_wage_krw: 7200, frequency: '매월', median_seconds: 600, sample_n: 3 } }
  fireEvent.click(screen.getByRole('button', { name: '최신 기록 확인' }))
  await screen.findByText('같은 항목이 다른 곳에서도 변경되었습니다. 저장할 값을 선택해주세요.')
  expect(screen.getByLabelText(/참여 인원/).value).toBe('4')
  expect(screen.getByLabelText('업무 주기').value).toBe('매월')
  expect(screen.getByLabelText(/시간당 비용/).value).toBe('3600')
  expect(screen.getByRole('button', { name: '기준선 다시 확정' }).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: '최신 값 유지 (7200)' }))
  fireEvent.click(screen.getByRole('button', { name: '기준선 다시 확정' }))
  await waitFor(() => expect(client.post).toHaveBeenCalledTimes(2))
  expect(client.post.mock.calls[1][1]).toMatchObject({ people: '4', hourly_wage_krw: '7200', frequency: '매월', expectedVersion: 'baseline-v2' })
})

it('실측 기록 후 응답 유실도 원래 시간·오류·메모를 유지한다', async () => {
  show(); open('기준선 실측')
  client.post.mockRejectedValueOnce(Object.assign(Error('응답 유실'), { status: 0 })).mockResolvedValue({ ok: true })
  fireEvent.change(screen.getByLabelText(/소요 시간/), { target: { value: '600' } })
  fireEvent.change(screen.getByLabelText('측정 메모'), { target: { value: '검증용 실제 측정 기록' } })
  fireEvent.click(screen.getByRole('button', { name: '실측 기록 저장' }))
  await screen.findByRole('button', { name: '같은 기록 저장 확인' })
  expect(screen.getByLabelText(/소요 시간/).value).toBe('600')
  fireEvent.click(screen.getByRole('button', { name: '같은 기록 저장 확인' }))
  await waitFor(() => expect(client.post).toHaveBeenCalledTimes(2))
  expect(client.post.mock.calls[1]).toEqual(client.post.mock.calls[0])
})

it('3회 실측을 근거로 사람이 인원·단가·주기와 현재 판본을 확정한다', async () => {
  latest.shadowRuns = [580, 600, 620].map((seconds, i) => ({ id: `r${i}`, seq: i + 1, total_seconds: seconds, error_count: 0 }))
  show(); open('기준선 실측'); client.post.mockResolvedValue({ ok: true })
  fireEvent.change(screen.getByLabelText(/시간당 비용/), { target: { value: '3600' } })
  fireEvent.click(screen.getByRole('button', { name: '기준선 확정' }))
  await waitFor(() => expect(client.post).toHaveBeenCalledWith('/applications/a/agreement', expect.objectContaining({
    kind: 'baseline', people: '2', hourly_wage_krw: '3600', frequency: '매주', expectedVersion: 'baseline-v1',
  })))
})

it('목록을 떠난 뒤 늦은 저장 성공은 다른 신청의 조회·입력을 건드리지 않는다', async () => {
  let resolve
  client.post.mockReturnValue(new Promise(done => { resolve = done }))
  const view = show(); open('합격 기준')
  fireEvent.change(screen.getByLabelText(/합격 조건/), { target: { value: '이전 과제 기준' } })
  fireEvent.click(screen.getByRole('button', { name: '기준 추가' }))
  const previousRefresh = refresh
  view.rerender(<MemoryRouter><Harness id="b" /></MemoryRouter>)
  await act(async () => { resolve({ ok: true }) })
  expect(previousRefresh).not.toHaveBeenCalled()
  expect(refresh).not.toHaveBeenCalled()
})
