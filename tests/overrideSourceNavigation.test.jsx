// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import OverridePage from '../src/pages/OverridePage.jsx'
import { beginAccessCheck, completeAccessCheck } from '../src/lib/accessSession.js'

const client = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), success: vi.fn(), error: vi.fn() }))
vi.mock('../src/api/client.ts', () => ({ api: client }))
vi.mock('../src/context/ToastContext.jsx', () => ({ useToast: () => ({ success: client.success, error: client.error }) }))
const event = id => ({ id, product_name: '시험 AI', decision_action: 'modify', validity: 'valid',
  ai_decision: `원문 ${id}`, human_decision: `판단 ${id}`, reason_detail: `근거 ${id}`, policy_refs: [], changed_fields: [], data_refs: [] })
const experiment = id => ({ id, title: `실험 ${id}`, hypothesis: `가설 ${id}`, status: 'expanded', current_phase: 'decided',
  cluster_id: 'c1', risk_level: 'low', guardrails: [], stop_conditions: [], runs: [], decisions: [] })
const page = events => ({ events, page: { total: events.length, hasMore: false } })
let workspace, details
function Probe() {
  const location = useLocation(), navigate = useNavigate()
  return <aside><output data-testid="address">{location.pathname + location.search + location.hash}</output>
    <button onClick={() => navigate('/override?source=journey&eventId=new#events')}>다른 사건</button>
    <button onClick={() => navigate(-1)}>뒤로</button><button onClick={() => navigate(1)}>앞으로</button></aside>
}
function show(path) { return render(<MemoryRouter initialEntries={[path]}><OverridePage /><Probe /></MemoryRouter>) }
function deferred() { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); window.scrollTo = vi.fn()
  const generation = beginAccessCheck(); completeAccessCheck(generation, { ok: true, mode: 'demo', scope: 'a'.repeat(64) })
  workspace = { generated_at: 'r1', demo_mode: false, current_actor: { role: 'product' }, events: [], clusters: [], experiments: [experiment('first')], products: [],
    audit: [], ai_calls: [], integrations: [], actors: [], metrics: {}, graph: { nodes: [], edges: [] }, policy_impact: [], fairness: [], common_issues: [] }
  details = experiment('old')
  client.get.mockImplementation(async path => {
    if (path === '/override') return workspace
    const params = new URL(path, 'https://local.invalid').searchParams
    if (params.has('editId')) return { entity: details }
    return page(params.has('eventId') ? [event(params.get('eventId'))] : [])
  })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('opens an exact past event absent from the workspace preview and closes only the source parameters', async () => {
  show('/override?source=journey&eventId=old#events')
  const dialog = await screen.findByRole('dialog', { name: '판단 사건 원문' })
  expect(await within(dialog).findByText('원문 old')).toBeTruthy()
  expect(client.get.mock.calls.some(([path]) => path.includes('eventId=old'))).toBe(true)
  fireEvent.click(within(dialog).getByRole('button', { name: '닫기' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(screen.getByTestId('address').textContent).toBe('/override?source=journey#events')
})

it('restores the exact source with back/forward without refetching the complete workspace', async () => {
  show('/override?source=journey&eventId=old#events')
  await screen.findByText('원문 old')
  fireEvent.click(screen.getByRole('button', { name: '다른 사건' }))
  await screen.findByText('원문 new')
  expect(screen.queryByText('원문 old')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '뒤로' }))
  await screen.findByText('원문 old')
  fireEvent.click(screen.getByRole('button', { name: '앞으로' }))
  await screen.findByText('원문 new')
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(client.get.mock.calls.filter(([path]) => path === '/override')).toHaveLength(1)
})

it('ignores a late old source response after navigation', async () => {
  const pending = deferred(), original = client.get.getMockImplementation()
  client.get.mockImplementation(path => path.includes('eventId=old') ? pending.promise : original(path))
  show('/override?eventId=old#events')
  await screen.findByRole('dialog')
  fireEvent.click(screen.getByRole('button', { name: '다른 사건' }))
  await screen.findByText('원문 new')
  await act(async () => pending.resolve(page([event('old')])) )
  expect(screen.queryByText('원문 old')).toBeNull()
})

it('opens the linked experiment and expands and focuses its exact result', async () => {
  details.runs = [{ id: 'run-old', phase: 'historical', status: 'passed', evidence_refs_json: '["원본 실행"]' }]
  show('/override?experimentId=old&runId=run-old#experiments')
  const target = await screen.findByRole('article', { name: '연결된 실험 결과' })
  expect(within(target).getByText(/원본 실행/)).toBeTruthy()
  expect(target.closest('details').open).toBe(true)
  // DOM insertion can finish before the passive focus effect has run.
  // Wait for the user-visible focus outcome instead of racing the passive effect.
  await waitFor(() => expect(document.activeElement).toBe(target))
  expect(screen.getByRole('heading', { name: '실험 old' })).toBeTruthy()
  expect(screen.queryByRole('heading', { name: '실험 first' })).toBeNull()
})

it('focuses the exact decision and keeps its captured evidence', async () => {
  details.decisions = [{ id: 'decision-old', decision: 'expand', basis: '당시 판단 근거', metrics_snapshot: { runs: [{ id: 'captured-run' }] } }]
  show('/override?experimentId=old&decisionId=decision-old#experiments')
  const target = await screen.findByRole('article', { name: '연결된 운영 결정' })
  expect(within(target).getByText('당시 판단 근거')).toBeTruthy()
  await waitFor(() => expect(document.activeElement).toBe(target))
})

it.each(['missing-experiment', 'wrong-result', 'wrong-decision'])('does not substitute the first experiment for an unavailable source (%s)', async scenario => {
  if (scenario === 'missing-experiment') details = null
  show(`/override?experimentId=old${scenario === 'wrong-result' ? '&runId=foreign' : scenario === 'wrong-decision' ? '&decisionId=foreign' : ''}#experiments`)
  await screen.findByText('연결된 원본 기록을 현재 권한으로 찾을 수 없습니다.')
  expect(screen.queryByRole('heading', { name: '실험 first' })).toBeNull()
  expect(screen.queryByRole('button', { name: '최종 결정', exact: true })).toBeNull()
})

it('clears source selection on explicit menu navigation while preserving unrelated query values', async () => {
  show('/override?source=journey&eventId=old#events')
  await screen.findByText('원문 old')
  fireEvent.click(screen.getByRole('button', { name: '개선 실험', exact: true }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(screen.getByTestId('address').textContent).toBe('/override?source=journey#experiments')
})

it('does not carry an old source into a new session lifetime', async () => {
  const pending = deferred(), original = client.get.getMockImplementation()
  let old = true
  client.get.mockImplementation(path => path.includes('eventId=old') ? old ? pending.promise : Promise.reject(Object.assign(Error('접근할 수 없습니다.'), { status: 404 })) : original(path))
  show('/override?eventId=old#events')
  await screen.findByRole('dialog')
  await act(async () => { old = false; const generation = beginAccessCheck(); completeAccessCheck(generation, { ok: true, mode: 'demo', scope: 'b'.repeat(64) }) })
  await screen.findByText('접근할 수 없습니다.')
  await act(async () => pending.resolve(page([event('old')])) )
  expect(screen.queryByText('원문 old')).toBeNull()
})

it.each(['eventId=old&eventId=new', 'eventId=%00bad', 'eventId=', 'runId=orphan', 'experimentId=old&eventId=new'])('rejects ambiguous or malformed source addresses (%s)', async query => {
  show(`/override?${query}#events`)
  await screen.findByText('연결된 원본 주소가 올바르지 않습니다.')
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(client.get.mock.calls.map(([path]) => path)).toEqual(['/override'])
})

it('shows a scoped experiment access error without using a workspace preview as a fallback', async () => {
  const original = client.get.getMockImplementation()
  client.get.mockImplementation(path => path.includes('editId=old') ? Promise.reject(Object.assign(Error('현재 권한으로 이 자료를 찾을 수 없습니다.'), { status: 404 })) : original(path))
  workspace.experiments = [experiment('old')]
  show('/override?experimentId=old#experiments')
  await screen.findByText('현재 권한으로 이 자료를 찾을 수 없습니다.')
  expect(screen.queryByRole('heading', { name: '실험 old' })).toBeNull()
  expect(screen.queryByRole('button', { name: '최종 결정', exact: true })).toBeNull()
})

it('uses a new experiment link when selecting another item and restores the linked result with back', async () => {
  details.runs = [{ id: 'run-old', phase: 'historical', status: 'passed', evidence_refs_json: '[]' }]
  const original = client.get.getMockImplementation()
  client.get.mockImplementation(path => path.includes('editId=first') ? Promise.resolve({ entity: experiment('first') }) : original(path))
  show('/override?experimentId=old&runId=run-old#experiments')
  await screen.findByRole('article', { name: '연결된 실험 결과' })
  fireEvent.click(screen.getByRole('button', { name: /실험 first/ }))
  await screen.findByRole('heading', { name: '실험 first' })
  expect(screen.getByTestId('address').textContent).toBe('/override?experimentId=first#experiments')
  fireEvent.click(screen.getByRole('button', { name: '뒤로' }))
  await screen.findByRole('article', { name: '연결된 실험 결과' })
  expect(screen.queryByRole('heading', { name: '실험 first' })).toBeNull()
})

it('does not let an old source mutation close or report success in a newly opened source', async () => {
  const pending = deferred(), original = client.get.getMockImplementation()
  client.get.mockImplementation(path => path.includes('eventId=old') ? Promise.resolve(page([{ ...event('old'), validity: 'pending', edit_version: 'old-version' }])) : original(path))
  client.post.mockReturnValue(pending.promise)
  show('/override?eventId=old#events')
  const sourceDialog = await screen.findByRole('dialog', { name: '판단 사건 원문' })
  fireEvent.click(await within(sourceDialog).findByRole('button', { name: '수정 타당성 검토' }))
  const form = screen.getByRole('dialog', { name: '사람의 수정 검토' })
  fireEvent.change(within(form).getByRole('textbox', { name: '검증 근거' }), { target: { value: '이전 사건의 원본 대조' } })
  fireEvent.submit(form.querySelector('form'))
  expect(client.post).toHaveBeenCalledWith('/override', expect.objectContaining({ action: 'validate_event', eventId: 'old', expectedVersion: 'old-version' }))
  fireEvent.click(screen.getByRole('button', { name: '다른 사건' }))
  await screen.findByText('원문 new')
  await act(async () => pending.resolve({ ok: true }))
  expect(screen.getByRole('dialog', { name: '판단 사건 원문' })).toBeTruthy()
  expect(screen.getByText('원문 new')).toBeTruthy()
  expect(client.success).not.toHaveBeenCalled()
})
