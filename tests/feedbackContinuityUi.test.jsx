// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import FieldFeedbackView from '../src/components/FieldFeedbackView.jsx'

const client = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))
vi.mock('../src/api/client.js', () => ({ api: client }))
const empty = () => ({ cases: [], casePage: { hasMore: false, nextCursor: null }, unread: 0, manager: false, reviewer: false,
  batches: [], batchPage: { hasMore: false, nextCursor: null }, samples: [], followups: [], nonuse: [], nonuseSummary: [] })
const sample = (overrides = {}) => ({ id: 'sample-old', batch_id: 'batch-old', event_id: 'approval-original', snapshot: { ai_decision: '추출 당시 원문', human_decision: '원래 직원 승인', policy_refs_json: '["당시 정책"]' }, ...overrides })
const batch = (id = 'batch-old') => ({ id, product_name: '테스트 AI', eligible_count: 1, sample_size: 1, requested_size: 1 })
const show = (mode = 'feedback', role = 'reviewer') => render(<FieldFeedbackView mode={mode} role={role} products={[{ id: 'p', name: '테스트 AI' }]} onCapture={vi.fn()} />)
beforeEach(() => { client.get.mockReset(); client.post.mockReset(); client.post.mockResolvedValue({ ok: true }) })
afterEach(cleanup)

it('navigates to an old notice, lets its reporter confirm it, and returns to the first page', async () => {
  const first = { ...empty(), unread: 101, casePage: { hasMore: true, nextCursor: 'older+page=' }, cases: [{ id: 'new', product_name: '테스트 AI', event_id: 'new-event', reason_detail: '최근 제보', is_mine: true, updates: [] }] }
  const old = { ...empty(), unread: 101, cases: [{ id: 'old', product_name: '테스트 AI', event_id: 'old-event', reason_detail: '오래된 제보', is_mine: true,
    updates: [{ id: 'old-notice', kind: 'applied', body: '오래된 제보의 새 안내', actor_label: '담당자' }] }] }
  client.get.mockImplementation(async path => path.includes('caseCursor=') ? old : first)
  show()
  await screen.findByText('최근 제보')
  expect(screen.getByRole('button', { name: '이전 페이지' }).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: '다음 페이지' }))
  await screen.findByText('오래된 제보의 새 안내')
  expect(client.get).toHaveBeenLastCalledWith('/feedback?role=reviewer&caseCursor=older%2Bpage%3D', expect.any(Object))
  expect(screen.queryByText('최근 제보')).toBeNull()
  fireEvent.change(screen.getByRole('combobox', { name: '현장에서 다시 확인한 결과' }), { target: { value: 'not_resolved' } })
  fireEvent.change(screen.getByRole('textbox', { name: '추가 설명 · 아직 불편한 경우 필수' }), { target: { value: '여전히 같은 문제입니다.' } })
  fireEvent.submit(screen.getByRole('button', { name: '재확인 남기기' }).closest('form'))
  await waitFor(() => expect(client.post).toHaveBeenCalledWith('/feedback', expect.objectContaining({ action: 'confirm_update', updateId: 'old-notice', verdict: 'not_resolved', note: '여전히 같은 문제입니다.' })))
  await waitFor(() => expect(screen.getByRole('button', { name: '이전 페이지' }).disabled).toBe(false))
  fireEvent.click(screen.getByRole('button', { name: '이전 페이지' }))
  await screen.findByText('최근 제보')
})

it('keeps a way back when loading an older page fails', async () => {
  client.get.mockImplementation(async path => {
    if (path.includes('caseCursor=')) throw Error('이전 기록 조회 실패')
    return { ...empty(), casePage: { hasMore: true, nextCursor: 'older' } }
  })
  show()
  fireEvent.click(await screen.findByRole('button', { name: '다음 페이지' }))
  await screen.findByRole('alert')
  fireEvent.click(screen.getByRole('button', { name: '이전 페이지' }))
  await screen.findByRole('button', { name: '판단 기록하기' })
})

it('offers an insufficient-only recheck while retaining prior history and original snapshot', async () => {
  const review = { revision: 1, verdict: 'insufficient', reason: '이전 판정 사유', evidence_refs: '', reviewed_by: '이전 점검자', reviewed_at: '2026-01-01 00:00:00' }
  let current = { ...empty(), reviewer: true, batches: [batch()], samples: [sample({ ...review, review_history: [review] })] }
  client.get.mockImplementation(async () => current)
  client.post.mockImplementation(async (_, body) => {
    const latest = { revision: 2, verdict: body.verdict, reason: body.reason, evidence_refs: body.evidenceRefs, reviewed_by: '새 점검자', reviewed_at: '2026-01-02 00:00:00' }
    current = { ...current, samples: [sample({ ...latest, review_history: [review, latest] })] }
    return { ok: true }
  })
  show('quality', 'product')
  await screen.findByText('추출 당시 원문')
  expect(screen.getByText('이전 판정 사유')).toBeTruthy()
  expect(screen.getByText('점검한 표본')).toBeTruthy()
  expect(screen.queryByText('점검 완료')).toBeNull()
  fireEvent.change(screen.getByRole('combobox', { name: '점검 결과' }), { target: { value: 'issue' } })
  fireEvent.change(screen.getByRole('textbox', { name: '판정 이유' }), { target: { value: '추가 근거로 확인한 오류' } })
  fireEvent.change(screen.getByRole('textbox', { name: '확인한 근거 · 근거 부족 판정 외 필수' }), { target: { value: '확정 정책 3조' } })
  fireEvent.submit(screen.getByRole('button', { name: '근거 보완 후 재점검' }).closest('form'))
  await screen.findByText('점검 이력 2회')
  expect(screen.queryByRole('button', { name: '근거 보완 후 재점검' })).toBeNull()
  expect(screen.queryByRole('button', { name: '점검 확정' })).toBeNull()
  expect(screen.getByText('이전 판정 사유')).toBeTruthy()
  expect(screen.getByText('추출 당시 원문')).toBeTruthy()
  expect(screen.getByText(/이전 점검자 · 2026-01-01/)).toBeTruthy()
  expect(client.post).toHaveBeenCalledWith('/feedback', expect.objectContaining({ action: 'review_sample', itemId: 'sample-old', verdict: 'issue', evidenceRefs: '확정 정책 3조' }))
})

it.each(['correct', 'issue'])('never offers a form to overwrite final %s verdicts', async verdict => {
  client.get.mockResolvedValue({ ...empty(), reviewer: true, batches: [batch()], samples: [sample({ verdict, reason: '최종 판단 근거' })] })
  show('quality', 'product')
  await screen.findByText('최종 판단 근거')
  expect(screen.queryByRole('combobox', { name: '점검 결과' })).toBeNull()
})

it('reaches older quality batches separately from cases and resets to newest after sampling', async () => {
  let created = false
  client.get.mockImplementation(async path => path.includes('batchCursor=') ? {
    ...empty(), reviewer: true, batches: [batch()], samples: [sample({ verdict: 'insufficient', reason: '오래된 부족 판정' })],
  } : { ...empty(), reviewer: true, batchPage: { hasMore: true, nextCursor: 'old-batches' }, batches: [batch(created ? 'batch-created' : 'batch-new')] })
  client.post.mockImplementation(async () => { created = true; return { id: 'batch-created' } })
  show('quality', 'product')
  fireEvent.click(await screen.findByRole('button', { name: '다음 묶음 페이지' }))
  await screen.findByText('오래된 부족 판정')
  expect(client.get).toHaveBeenLastCalledWith('/feedback?role=product&batchCursor=old-batches', expect.any(Object))
  expect(screen.getByRole('button', { name: '근거 보완 후 재점검' })).toBeTruthy()
  fireEvent.submit(screen.getByRole('button', { name: '표본 추출' }).closest('form'))
  await waitFor(() => expect(screen.getByRole('combobox', { name: '점검 묶음' }).value).toBe('batch-created'))
  expect(screen.getByRole('button', { name: '이전 묶음 페이지' }).disabled).toBe(true)
  expect(client.get).toHaveBeenLastCalledWith('/feedback?role=product', expect.any(Object))
})
