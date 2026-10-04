// @vitest-environment happy-dom
// Real FieldFeedbackView/useApi/client/session gate, synthetic HTTP only.
import { webcrypto } from 'node:crypto'
import { act, StrictMode } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import FieldFeedbackView from '../src/components/FieldFeedbackView.jsx'
import WorkspaceGate from '../src/components/WorkspaceGate.jsx'
import { beginAccessCheck, completeAccessCheck } from '../src/lib/accessSession.js'

const PRODUCTS = [{ id: 'product-1', name: '제품 A' }]
const ID = { publish_update: `ffu_${'a'.repeat(20)}`, create_sample: `qsb_${'a'.repeat(20)}`, record_nonuse: `nur_${'a'.repeat(20)}`,
  read_update: 'legacy-update', confirm_update: 'legacy-update', review_sample: 'legacy-sample', resolve_followup: 'legacy-followup' }
const BUTTON = { publish_update: '안내 등록', create_sample: '표본 추출', record_nonuse: '사용 의견 남기기', read_update: '새 안내 · 읽음으로 표시',
  confirm_update: '재확인 남기기', review_sample: '점검 확정', resolve_followup: '후속 검토 완료' }
const reply = (value, status = 200) => Response.json(value, { status })
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
const base = () => {
  const followup = { id: 'legacy-followup', event_id: 'event-1', source_kind: 'feedback', status: 'open', reason: '미해결 검토 사유' }
  return { manager: true, reviewer: true, unread: 1, casePage: { hasMore: false }, batchPage: { hasMore: false },
    cases: [{ id: 'legacy-case', event_id: 'event-1', product_name: '제품 A', reason_detail: '현장 원신고', is_mine: true, followups: [followup],
      updates: [{ id: 'legacy-update', kind: 'applied', body: '담당자의 적용 안내', actor_label: '담당자' }] }],
    batches: [{ id: 'legacy-batch', product_name: '제품 A', eligible_count: 1, sample_size: 1, requested_size: 1 }],
    samples: [{ id: 'legacy-sample', event_id: 'event-1', batch_id: 'legacy-batch', snapshot: { ai_decision: '추출한 원문', human_decision: '승인', policy_refs_json: '[]' }, review_history: [] }],
    followups: [followup], nonuse: [], nonuseSummary: [] }
}
let calls, data, respond, readResponse
const posts = () => calls.filter(call => call.method === 'POST')
const gets = () => calls.filter(call => call.path.startsWith('/api/feedback') && call.method === 'GET')
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto); calls = []; data = base(); readResponse = () => reply(data)
  completeAccessCheck(beginAccessCheck(), { ok: true, mode: 'demo', scope: 'a'.repeat(64) })
  respond = body => reply({ ok: true, id: ID[body.action] })
  vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
    const path = new URL(String(url), 'https://local.invalid').pathname, method = options.method ?? 'GET'
    calls.push({ path, method, body: options.body, key: new Headers(options.headers).get('X-Idempotency-Key') })
    if (method === 'POST') return respond(JSON.parse(options.body))
    if (path === '/api/demo/workspace') return reply({ enabled: false })
    if (path === '/api/session') return reply({ ok: true, mode: 'demo', scope: 'a'.repeat(64) })
    if (path === '/api/feedback') return readResponse()
    throw Error('Unexpected synthetic URL ' + path)
  }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
function Tree({ mode = 'feedback', role = 'product', products = PRODUCTS }) {
  return <WorkspaceGate><FieldFeedbackView mode={mode} role={role} products={products} /></WorkspaceGate>
}
async function show(action = 'confirm_update') {
  const mode = ['create_sample', 'review_sample', 'record_nonuse'].includes(action) ? 'quality' : 'feedback'
  const view = render(<StrictMode><Tree mode={mode} /></StrictMode>)
  await screen.findByText(mode === 'feedback' ? '현장 원신고' : '추출한 원문')
  return { view, mode }
}
function fill(action) {
  const button = screen.getByRole('button', { name: BUTTON[action], hidden: true }), form = button.closest('form')
  if (!form) return { button, form: null, input: null }
  const values = { verdict: action === 'confirm_update' ? 'not_resolved' : 'issue', note: '처음 작성한 현장 근거', message: '확인한 처리 안내',
    resolution: '후속 문제의 해결 근거', reason: action === 'record_nonuse' ? 'other' : '표본 점검의 오류 근거', evidenceRefs: '확인한 정책 근거',
    productId: 'product-1', startDate: '2026-01-01', endDate: '2026-01-02', occurredOn: '2026-01-02' }
  for (const [name, value] of Object.entries(values)) {
    const input = form.elements.namedItem(name)
    if (input) fireEvent.change(input, { target: { value } })
  }
  return { button, form, input: form.querySelector('textarea') }
}
function submit({ form, button }) { if (form) fireEvent.submit(form); else fireEvent.click(button) }
async function release(held, response) { await act(async () => { held.resolve(response); await held.promise }) }

it.each(Object.keys(BUTTON))('does not confirm/reset an empty successful response for %s', async action => {
  await show(action); const controls = fill(action), original = controls.input?.value, before = gets().length
  respond = () => reply({}); submit(controls)
  await screen.findByRole('alert')
  expect(screen.queryByText('기록을 저장했습니다.')).toBeNull()
  if (controls.input) expect(controls.input.value).toBe(original)
  expect(gets()).toHaveLength(before)
  respond = body => reply({ ok: true, id: ID[body.action] }); submit(controls)
  await screen.findByText('기록을 저장했습니다.')
  expect(posts()).toHaveLength(2)
  expect(posts()[1].key).toBe(posts()[0].key)
})

it.each(['read_update', 'confirm_update', 'review_sample', 'resolve_followup'])('requires exact legacy target identity for %s', async action => {
  await show(action); const controls = fill(action)
  respond = () => reply({ ok: true, id: 'another-legacy-id' }); submit(controls)
  await screen.findByRole('alert')
  expect(screen.queryByText('기록을 저장했습니다.')).toBeNull()
})

it.each(['publish_update', 'create_sample', 'record_nonuse'])('requires the action-specific allocated prefix for %s', async action => {
  await show(action); const controls = fill(action)
  respond = () => reply({ ok: true, id: `wrong_${'a'.repeat(20)}` }); submit(controls)
  await screen.findByRole('alert')
  expect(screen.queryByText('기록을 저장했습니다.')).toBeNull()
})

it('locks the complete native work area synchronously and only resets the submitted form', async () => {
  await show(); const controls = fill('confirm_update'), other = fill('publish_update'), held = deferred()
  const otherDraft = other.input.value
  respond = () => held.promise
  act(() => { submit(controls); submit(controls) })
  await waitFor(() => expect(posts()).toHaveLength(1))
  // happy-dom does not propagate :disabled through fieldset; browsers do.
  expect(controls.input.closest('fieldset').disabled).toBe(true)
  expect(other.input.closest('fieldset').disabled).toBe(true)
  expect(screen.getByRole('button', { name: '새로고침' }).disabled).toBe(true)
  await release(held, reply({ ok: true, id: ID.confirm_update }))
  await screen.findByText('기록을 저장했습니다.')
  expect(controls.input.value).toBe(''); expect(other.input.value).toBe(otherDraft)
})

it('keeps every draft on a failed request and retries only the confirmed write context', async () => {
  await show(); const controls = fill('confirm_update'), other = fill('publish_update')
  respond = () => reply({ error: 'synthetic unavailable' }, 503); submit(controls)
  await screen.findByText('synthetic unavailable')
  expect(controls.input.value).toBe('처음 작성한 현장 근거')
  expect(other.input.value).toBe('확인한 처리 안내')
})

it('keeps POST confirmation distinct from GET failure and retries GET without another POST', async () => {
  await show(); const controls = fill('confirm_update')
  readResponse = () => reply({ error: '저장 뒤 조회 실패' }, 503); submit(controls)
  await screen.findByText('저장 뒤 조회 실패')
  expect(screen.getByText('기록을 저장했습니다.')).toBeTruthy()
  expect(controls.input.closest('fieldset').disabled).toBe(true)
  readResponse = () => reply(data)
  fireEvent.click(screen.getByRole('button', { name: '새로고침' }))
  await waitFor(() => expect(screen.queryByText('저장 뒤 조회 실패')).toBeNull())
  expect(posts()).toHaveLength(1)
})

it.each(['mode', 'role', 'account'])('discards a late POST after %s changed', async change => {
  const { view } = await show(), controls = fill('confirm_update'), held = deferred(); respond = () => held.promise
  submit(controls); await waitFor(() => expect(posts()).toHaveLength(1))
  if (change === 'account') await act(async () => { completeAccessCheck(beginAccessCheck(), { ok: true, mode: 'demo', scope: 'b'.repeat(64) }) })
  else view.rerender(<StrictMode><Tree mode={change === 'mode' ? 'quality' : 'feedback'} role={change === 'role' ? 'operations' : 'product'} /></StrictMode>)
  await waitFor(() => expect(screen.queryByText('기록을 불러오는 중입니다.')).toBeNull())
  const before = gets().length
  await release(held, reply({ ok: true, id: ID.confirm_update }))
  expect(screen.queryByText('기록을 저장했습니다.')).toBeNull(); expect(gets()).toHaveLength(before)
})

it('blocks the sample picker while a review is pending', async () => {
  await show('review_sample'); const controls = fill('review_sample'), held = deferred(); respond = () => held.promise
  submit(controls); await waitFor(() => expect(posts()).toHaveLength(1))
  expect(screen.getByRole('combobox', { name: '점검 묶음' }).closest('fieldset').disabled).toBe(true)
  await release(held, reply({ ok: true, id: ID.review_sample }))
})

it('discards a sample response after a forced A-to-B-to-A selection change', async () => {
  data.batches.push({ ...data.batches[0], id: 'another-batch' })
  await show('review_sample'); const controls = fill('review_sample'), held = deferred(); respond = () => held.promise
  submit(controls); await waitFor(() => expect(posts()).toHaveLength(1))
  const picker = screen.getByRole('combobox', { name: '점검 묶음' })
  // Native interaction is locked; force component changes to test the lifetime
  // independently of that browser protection.
  fireEvent.change(picker, { target: { value: 'another-batch' } })
  fireEvent.change(picker, { target: { value: 'legacy-batch' } })
  const before = gets().length
  await release(held, reply({ ok: true, id: ID.review_sample }))
  expect(screen.queryByText('기록을 저장했습니다.')).toBeNull()
  expect(gets()).toHaveLength(before)
})

it('does not reload or publish confirmation after leaving the component', async () => {
  const { view } = await show(), controls = fill('confirm_update'), held = deferred(); respond = () => held.promise
  submit(controls); await waitFor(() => expect(posts()).toHaveLength(1))
  const before = gets().length
  view.unmount()
  await release(held, reply({ ok: true, id: ID.confirm_update }))
  expect(gets()).toHaveLength(before)
  expect(screen.queryByText('기록을 저장했습니다.')).toBeNull()
})

it.each([401, 403, 404, 410])('does not leave a confirmation on an unavailable post-save read: %i', async status => {
  await show(); const controls = fill('confirm_update')
  readResponse = () => reply({ error: '후속 조회 접근 불가' }, status); submit(controls)
  await screen.findByText('후속 조회 접근 불가')
  expect(screen.queryByText('기록을 저장했습니다.')).toBeNull()
  expect(screen.queryByText('현장 원신고')).toBeNull()
  expect(posts()).toHaveLength(1)
})

it('resets fieldset decoration while preserving panel spacing and native input ancestry', async () => {
  await show()
  const work = screen.getByRole('group', { name: '현장 피드백 작업' })
  expect(work.tagName).toBe('FIELDSET')
  expect(work.style.border).toBe('0px')
  expect(work.style.padding).toBe('0px')
  expect(Number.parseFloat(work.style.minWidth)).toBe(0)
  expect(work.style.display).toBe('grid')
  expect(work.style.gap).toBe('24px')
  expect(screen.getByRole('textbox', { name: '추가 설명 · 아직 불편한 경우 필수' }).closest('fieldset')).toBe(work)
  expect(screen.getByRole('button', { name: '새로고침' }).closest('fieldset')).toBeNull()
})

it('does not discard a confirmed update because an unrelated product prop changed', async () => {
  const { view } = await show(), controls = fill('confirm_update'), held = deferred(); respond = () => held.promise
  submit(controls); await waitFor(() => expect(posts()).toHaveLength(1))
  view.rerender(<StrictMode><Tree products={[...PRODUCTS, { id: 'unrelated-product', name: '무관한 제품' }]} /></StrictMode>)
  await release(held, reply({ ok: true, id: ID.confirm_update }))
  await screen.findByText('기록을 저장했습니다.')
})
