// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import OverridePage from '../src/pages/OverridePage.jsx'

const client = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), success: vi.fn(), error: vi.fn() }))
vi.mock('../src/api/client.ts', () => ({ api: client }))
vi.mock('../src/context/ToastContext.jsx', () => ({ useToast: () => ({ success: client.success, error: client.error }) }))
const event = (id, overrides = {}) => ({ id, product_id: 'p1', product_name: '시험 AI', cluster_id: 'c1', occurred_at: '2026-01-01 00:00:00',
  decision_action: 'modify', is_override: 1, validity: 'pending', ai_decision: `AI 원문 ${id}`, human_decision: `직원 판단 ${id}`, reason_detail: `사건 근거 ${id}`,
  policy_refs: ['원본 정책'], changed_fields: [], data_refs: [], tools: [], model_version: 'v1', prompt_version: 'p1', ...overrides })
const cluster = id => ({ id, title: `문제 ${id}`, summary: '원문 재확인', cause_code: 'model', owner_team: '지원', priority_score: 0, cause_candidates: [], status: 'open', recurrence_count: 1, visible_event_count: 1 })
const page = (events, nextCursor = null, total = events.length) => ({ events, page: { total, limit: 100, hasMore: Boolean(nextCursor), nextCursor } })
const feedback = () => ({ cases: [{ id: 'case-old', event_id: 'old', product_name: '시험 AI', reason_detail: '이전 제보', is_mine: true, updates: [] }],
  unread: 0, batches: [], samples: [], nonuse: [], nonuseSummary: [], followups: [], manager: false, reviewer: false })
let workspace
beforeEach(() => {
  vi.clearAllMocks()
  window.location.hash = ''; localStorage.clear(); window.scrollTo = vi.fn()
  workspace = { generated_at: 'r1', demo_mode: false, current_actor: { email: 'worker@test.invalid', role: 'product' }, products: [{ id: 'p1', name: '시험 AI' }],
    events: [], clusters: [cluster('c1'), cluster('c2')], experiments: [], audit: [], ai_calls: [], integrations: [], assignment_candidates: [], actors: [],
    policy_impact: [], fairness: [], common_issues: [], graph: { nodes: [], edges: [] }, metrics: {} }
  client.post.mockResolvedValue({ ok: true })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })
function serve(handler) {
  client.get.mockImplementation(async path => path === '/override' ? workspace : path.startsWith('/feedback') ? feedback() : handler(new URL(path, 'https://test.invalid').searchParams))
}
function show(view = 'events') {
  return render(<MemoryRouter initialEntries={[`/#${view}`]}><OverridePage /></MemoryRouter>)
}
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }

it('reaches a previous event page and submits the old source for actual validation', async () => {
  let validated = false
  serve(params => params.has('cursor') ? page([event('old', { validity: validated ? 'valid' : 'pending' })]) : page([event('new')], 'old-page', 501))
  client.post.mockImplementation(async () => { validated = true; workspace = { ...workspace, generated_at: 'r2' }; return { ok: true } })
  show()
  await screen.findByText('AI 원문 new')
  fireEvent.click(screen.getByRole('button', { name: '다음 사건 페이지' }))
  await screen.findByText('AI 원문 old')
  expect(screen.queryByText('AI 원문 new')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '수정 타당성 검토' }))
  const dialog = screen.getByRole('dialog', { name: '사람의 수정 검토' })
  expect(within(dialog).getByText('AI 원문 old')).toBeTruthy()
  fireEvent.change(within(dialog).getByRole('textbox', { name: '검증 근거' }), { target: { value: '원문 정책과 대조했습니다.' } })
  fireEvent.submit(dialog.querySelector('form'))
  await waitFor(() => expect(client.post).toHaveBeenCalledWith('/override', expect.objectContaining({ action: 'validate_event', eventId: 'old', reason: '원문 정책과 대조했습니다.' })))
  await screen.findByText('타당 확인')
  expect(screen.queryByRole('button', { name: '수정 타당성 검토' })).toBeNull()
  expect(screen.getByText(/2페이지/)).toBeTruthy()
})

it('resets filters to the first page and never presents the stale page while a new filter is pending', async () => {
  const filtered = deferred()
  serve(params => params.get('q') === 'needle' ? filtered.promise : params.has('cursor') ? page([event('old')]) : page([event('new')], 'old-page', 501))
  show()
  fireEvent.click(await screen.findByRole('button', { name: '다음 사건 페이지' }))
  await screen.findByText('AI 원문 old')
  fireEvent.change(screen.getByPlaceholderText('사건·근거·제품 검색'), { target: { value: 'needle' } })
  expect(screen.queryByText('AI 원문 old')).toBeNull()
  await waitFor(() => expect(client.get.mock.calls.at(-1)[0]).toContain('q=needle'))
  expect(client.get.mock.calls.at(-1)[0]).not.toContain('cursor=')
  await act(async () => filtered.resolve(page([event('filtered')])))
  await screen.findByText('AI 원문 filtered')
  fireEvent.change(screen.getByPlaceholderText('사건·근거·제품 검색'), { target: { value: '' } })
  await screen.findByText('AI 원문 new')
  expect(screen.queryByText('AI 원문 old')).toBeNull()
  expect(screen.getByRole('button', { name: '이전 사건 페이지' }).disabled).toBe(true)
})

it('does not allow a late old page response to overwrite the current server filter', async () => {
  const oldPage = deferred()
  serve(params => params.has('q') ? page([event('filtered')]) : params.has('cursor') ? oldPage.promise : page([event('new')], 'old-page', 501))
  show()
  fireEvent.click(await screen.findByRole('button', { name: '다음 사건 페이지' }))
  fireEvent.change(screen.getByPlaceholderText('사건·근거·제품 검색'), { target: { value: 'filtered' } })
  await screen.findByText('AI 원문 filtered')
  await act(async () => oldPage.resolve(page([event('stale')])) )
  expect(screen.queryByText('AI 원문 stale')).toBeNull()
  expect(screen.getByText('AI 원문 filtered')).toBeTruthy()
})

it('treats the literal search word all as a query rather than a filter sentinel', async () => {
  serve(params => page([event(params.get('q') === 'all' ? 'literal-match' : 'unfiltered')]))
  show()
  await screen.findByText('AI 원문 unfiltered')
  fireEvent.change(screen.getByPlaceholderText('사건·근거·제품 검색'), { target: { value: 'all' } })
  await screen.findByText('AI 원문 literal-match')
  expect(client.get.mock.calls.at(-1)[0]).toContain('q=all')
})

it('uses an independent cluster source page and opens the original event by ID outside the workspace preview', async () => {
  serve(params => params.has('eventId') ? page([event('old')]) : page([event('old')]))
  show('clusters')
  await screen.findByText('사건 근거 old')
  expect(client.get.mock.calls.some(([path]) => path.includes('clusterId=c1'))).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: '원문 보기' }))
  const dialog = await screen.findByRole('dialog', { name: '판단 사건 원문' })
  await within(dialog).findByText('AI 원문 old')
  expect(workspace.events).toHaveLength(0)
  expect(client.get.mock.calls.some(([path]) => path.includes('eventId=old'))).toBe(true)
})

it('resets the cursor when changing clusters and hides responses from the previously selected cluster', async () => {
  const oldPage = deferred()
  serve(params => params.get('clusterId') === 'c2' ? page([event('second-cluster', { cluster_id: 'c2' })])
    : params.has('cursor') ? oldPage.promise : page([event('first-cluster')], 'cluster-page', 101))
  show('clusters')
  fireEvent.click(await screen.findByRole('button', { name: '다음 사건 페이지' }))
  fireEvent.click(screen.getByRole('button', { name: /문제 c2/ }))
  await screen.findByText('사건 근거 second-cluster')
  const path = client.get.mock.calls.at(-1)[0]
  expect(path).toContain('clusterId=c2'); expect(path).not.toContain('cursor=')
  await act(async () => oldPage.resolve(page([event('stale-cluster')])))
  expect(screen.queryByText('사건 근거 stale-cluster')).toBeNull()
  expect(screen.getByText('사건 근거 second-cluster')).toBeTruthy()
})

it('opens feedback source by ID, and an inaccessible source shows an error without leaking the preview', async () => {
  serve(() => { throw Error('이 판단 사건을 찾을 수 없습니다.') })
  show('feedback')
  fireEvent.click(await screen.findByRole('button', { name: '원 사건 보기' }))
  const dialog = screen.getByRole('dialog', { name: '판단 사건 원문' })
  await within(dialog).findByText('이 판단 사건을 찾을 수 없습니다.')
  expect(within(dialog).queryByRole('button', { name: '수정 타당성 검토' })).toBeNull()
  expect(client.get.mock.calls.some(([path]) => path.includes('eventId=old'))).toBe(true)
})

it('does not silently expand current-preview export to all viewed or historical event pages', async () => {
  workspace.events = [event('preview', { validity: 'valid' })]
  serve(() => page([event('historical', { validity: 'valid' })]))
  let blob
  vi.spyOn(URL, 'createObjectURL').mockImplementation(value => { blob = value; return 'blob:test-download' })
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  show()
  await screen.findByText('AI 원문 historical')
  fireEvent.click(screen.getByRole('button', { name: '조직 인사이트', exact: true }))
  expect(screen.getByText(/운영 자료에 불러온 최근 1건/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '현재 목록의 모델 오류 내보내기' }))
  const exported = JSON.parse(await blob.text())
  expect(exported.rows.map(row => row.id)).toEqual(['preview'])
})
