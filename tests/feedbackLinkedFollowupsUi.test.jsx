// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import FieldFeedbackView from '../src/components/FieldFeedbackView.jsx'

const client = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))
vi.mock('../src/api/client.js', () => ({ api: client }))
const empty = () => ({ cases: [], casePage: { hasMore: false }, unread: 0, manager: true, reviewer: true,
  batches: [], batchPage: { hasMore: false }, samples: [], followups: [], nonuse: [], nonuseSummary: [] })
const followup = (id, overrides = {}) => ({ id, cluster_id: 'cluster-old', source_kind: 'feedback', source_id: 'notice-' + id,
  event_id: 'event-old', product_id: 'p', reason: '이전 검토 ' + id, status: 'open', ...overrides })
const show = mode => render(<FieldFeedbackView mode={mode} role="product" products={[{ id: 'p', name: '테스트 AI' }]} onCapture={vi.fn()} onOpenCluster={vi.fn()} />)
beforeEach(() => { client.get.mockReset(); client.post.mockReset(); client.post.mockResolvedValue({ ok: true }) })
afterEach(cleanup)

it('renders every old case link outside the summary, keeps resolved evidence and completes only the selected followup', async () => {
  const links = [followup('open-one'), followup('open-two'), followup('closed', { status: 'resolved', resolution: '이전 처리 근거', resolved_by: '이전 담당자' })]
  const old = { ...empty(), cases: [{ id: 'case-old', event_id: 'event-old', product_name: '테스트 AI', reason_detail: '오래된 제보', updates: [], followups: links }] }
  client.get.mockImplementation(async path => path.includes('caseCursor=') ? old : { ...empty(), casePage: { hasMore: true, nextCursor: 'older' } })
  client.post.mockImplementation(async (_, body) => {
    const target = links.find(item => item.id === body.followupId)
    Object.assign(target, { status: 'resolved', resolution: body.resolution, resolved_by: '담당자' })
    return { ok: true }
  })
  show('feedback')
  fireEvent.click(await screen.findByRole('button', { name: '다음 페이지' }))
  await screen.findByText('오래된 제보')
  expect(screen.getAllByRole('region', { name: '후속 검토' })).toHaveLength(3)
  expect(screen.getByText(/처리 근거: 이전 처리 근거/)).toBeTruthy()
  const target = screen.getByText('이전 검토 open-two').closest('section')
  fireEvent.click(within(target).getByText('후속 검토 처리'))
  fireEvent.change(within(target).getByRole('textbox', { name: '처리 결과와 확인 근거' }), { target: { value: '수정 배포 후 같은 입력을 확인했습니다.' } })
  fireEvent.submit(within(target).getByRole('button', { name: '후속 검토 완료' }).closest('form'))
  await waitFor(() => expect(client.post).toHaveBeenCalledWith('/feedback', { action: 'resolve_followup', followupId: 'open-two', resolution: '수정 배포 후 같은 입력을 확인했습니다.', role: 'product' }))
  await screen.findByText(/처리 근거: 수정 배포 후 같은 입력/)
  expect(screen.getAllByText('후속 검토 대기')).toHaveLength(1)
  expect(screen.getByText('이전 검토 open-one')).toBeTruthy()
  expect(screen.queryByRole('heading', { name: '남아 있는 후속 검토' })).toBeNull()
})

it('shows old quality sample open and resolved followups that are absent from the global summary', async () => {
  const samples = ['open', 'resolved'].map((status, i) => ({ id: 'sample-' + i, event_id: 'event-' + i, batch_id: 'batch-old',
    snapshot: { ai_decision: '보존 원문 ' + i }, verdict: 'issue', reason: '표본 오류 ' + i,
    followup: followup('sample-task-' + i, { source_kind: 'quality_sample', source_id: 'sample-' + i, status,
      ...(status === 'resolved' ? { resolution: '이전 표본 처리 확인', resolved_by: '담당자' } : {}) }),
  }))
  client.get.mockImplementation(async path => path.includes('batchCursor=') ? { ...empty(), batches: [{ id: 'batch-old', product_name: '테스트 AI' }], samples } : { ...empty(), batchPage: { hasMore: true, nextCursor: 'older' } })
  show('quality')
  fireEvent.click(await screen.findByRole('button', { name: '다음 묶음 페이지' }))
  await screen.findByText('보존 원문 0')
  expect(screen.getAllByRole('region', { name: '후속 검토' })).toHaveLength(2)
  expect(screen.getByText('이전 검토 sample-task-0')).toBeTruthy()
  expect(screen.getByText(/처리 근거: 이전 표본 처리 확인/)).toBeTruthy()
  expect(screen.getAllByText('후속 검토 대기')).toHaveLength(1)
  expect(screen.getByText('보존 원문 1')).toBeTruthy()
  expect(screen.queryByRole('heading', { name: '남아 있는 후속 검토' })).toBeNull()
})

it('does not duplicate a linked followup also present in the capped overview', async () => {
  const item = followup('shared')
  client.get.mockResolvedValue({ ...empty(), cases: [{ id: 'c', event_id: 'event-old', reason_detail: '연결 중복 확인', updates: [], followups: [item] }], followups: [item] })
  show('feedback')
  await screen.findByText('이전 검토 shared')
  expect(screen.getAllByRole('region', { name: '후속 검토' })).toHaveLength(1)
  expect(screen.queryByRole('heading', { name: '남아 있는 후속 검토' })).toBeNull()
})
