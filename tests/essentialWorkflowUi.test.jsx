// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import OverridePage from '../src/pages/OverridePage.jsx'
import FieldFeedbackView from '../src/components/FieldFeedbackView.jsx'

const mocks = vi.hoisted(() => ({ post: vi.fn(), reload: vi.fn(), success: vi.fn(), error: vi.fn(), workspace: null, feedback: null }))
vi.mock('../src/api/client.ts', () => ({ api: { post: mocks.post } }))
vi.mock('../src/hooks/useApi.js', () => ({ useApi: path => ({ data: path.startsWith('/feedback') ? mocks.feedback : mocks.workspace, loading: false, error: null, reload: mocks.reload }) }))
vi.mock('../src/context/ToastContext.jsx', () => ({ useToast: () => ({ success: mocks.success, error: mocks.error }) }))

const cluster = (id, email) => ({ id, title: `문제 ${id}`, summary: '확인 필요', cause_code: 'model', cause_status: 'candidate', owner_team: '개선팀', status: 'open', priority_score: 20, recurrence_count: 1, cause_candidates: [], assignee_email: email, next_response_on: '2000-01-01' })
beforeEach(() => {
  vi.clearAllMocks()
  window.location.hash = ''
  window.localStorage.clear()
  window.scrollTo = vi.fn()
  mocks.post.mockResolvedValue({ ok: true })
  mocks.reload.mockResolvedValue(undefined)
  mocks.workspace = { demo_mode: false, current_actor: { email: 'owner@example.test', label: '담당자', role: 'product', is_admin: false }, products: [{ id: 'p1', name: '시험 AI' }], events: [], clusters: [cluster('mine', 'owner@example.test'), cluster('other', 'other@example.test')], experiments: [], integrations: [], audit: [], ai_calls: [], assignment_candidates: [{ email: 'owner@example.test', label: '담당자' }, { email: 'other@example.test', label: '다른 담당자' }], actors: [] }
  mocks.feedback = { cases: [], batches: [], samples: [], nonuse: [], nonuseSummary: [], followups: [], unread: 0, manager: true, reviewer: true }
})
afterEach(cleanup)
function page(view) {
  return render(<MemoryRouter initialEntries={[view ? `/#${view}` : '/']}><OverridePage /></MemoryRouter>)
}
function eventDialog() {
  page('events')
  fireEvent.click(screen.getAllByRole('button', { name: '판단 기록', exact: true })[0])
  return screen.getByRole('dialog')
}
function fill(dialog, name, value) { fireEvent.change(dialog.querySelector(`[name="${name}"]`), { target: { value } }) }
const followup = (overrides = {}) => ({ id: 'f1', cluster_id: 'c1', source_kind: 'feedback', event_id: 'e1', reason: '여전히 해결되지 않음', evidence_refs: ['문서 1'], status: 'open', ...overrides })

describe('필수 업무 흐름 화면', () => {
  it('공유 문제의 전체 집계와 열람 가능한 원문 수를 구분한다', () => {
    mocks.workspace.clusters = [{ ...cluster('mine', 'owner@example.test'), recurrence_count: 2, visible_event_count: 1 }]
    mocks.workspace.events = [{ id: 'own', cluster_id: 'mine', product_name: '시험 AI', reason_detail: '본인 제보', validity: 'valid' }]
    page('clusters')
    expect(screen.getByText('현재 1건 표시 · 열람 가능 전체 1건')).toBeTruthy()
    expect(screen.getByText('문제 수치는 전체 연결 사건 기준입니다. 원문은 계정에 열람이 허용된 사건만 표시합니다.')).toBeTruthy()
    expect(document.querySelector('.ol-detail-metrics').textContent).toContain('2건')
  })
  it('간편 제보는 기본 5항목만 먼저 보여주고 선택 상세는 접는다', () => {
    const dialog = eventDialog()
    const details = dialog.querySelector('details')
    expect(details.open).toBe(false)
    expect([...dialog.querySelectorAll('input, select, textarea')].filter(field => !field.closest('details')).map(field => field.name)).toEqual(['productId', 'decisionAction', 'aiDecision', 'humanDecision', 'reasonDetail'])
    expect(dialog.querySelector('[name="customerImpact"]').value).toBe('')
    expect(dialog.querySelector('[name="recordingSeconds"]').value).toBe('')
  })
  it('미입력 위험도·기록 시간·모델 정보를 지어내서 전송하지 않는다', async () => {
    const dialog = eventDialog()
    fill(dialog, 'aiDecision', '원래 답변')
    fill(dialog, 'humanDecision', '원하는 결과')
    fill(dialog, 'reasonDetail', '정책이 달랐음')
    fireEvent.submit(dialog.querySelector('form'))
    await waitFor(() => expect(mocks.post).toHaveBeenCalled())
    const payload = mocks.post.mock.calls[0][1]
    expect(payload).toMatchObject({ action: 'capture_event', productId: 'p1', aiDecision: '원래 답변', humanDecision: '원하는 결과', reasonDetail: '정책이 달랐음' })
    for (const key of ['customerImpact', 'regulatoryRisk', 'recordingSeconds', 'modelVersion', 'externalRef']) expect(payload).not.toHaveProperty(key)
  })
  it('제보 전용 제품 목록은 전체 운영 자료 접근 없이 선택할 수 있다', () => {
    mocks.workspace.products = []
    mocks.workspace.capture_products = [{ id: 'capture1', name: '제보 가능한 AI' }]
    const dialog = eventDialog()
    expect(dialog.querySelector('[name="productId"]').value).toBe('capture1')
  })
  it('추가한 상세 정보는 접었다 펼쳐도 유지하고 저장한다', async () => {
    const dialog = eventDialog()
    const details = dialog.querySelector('details')
    details.open = true
    fill(dialog, 'externalRef', 'CRM-17')
    details.open = false
    fireEvent.submit(dialog.querySelector('form'))
    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith('/override', expect.objectContaining({ externalRef: 'CRM-17' })))
  })
  it('개인 담당자와 기한을 저장하고 접수 확인 요청을 보낸다', async () => {
    page('clusters')
    expect(screen.getByRole('region', { name: '문제 담당과 회신 일정' }).textContent).toContain('기한 지남')
    fireEvent.click(screen.getByRole('button', { name: '담당 접수 확인' }))
    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith('/override', expect.objectContaining({ action: 'acknowledge_cluster', clusterId: 'mine' })))
    fireEvent.click(screen.getByRole('button', { name: '원인·담당 확정' }))
    const dialog = screen.getByRole('dialog')
    fill(dialog, 'assigneeEmail', 'other@example.test')
    fill(dialog, 'nextResponseOn', '2030-01-20')
    fill(dialog, 'reason', '후속 확인 배정')
    fireEvent.submit(dialog.querySelector('form'))
    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith('/override', expect.objectContaining({ action: 'update_cluster', assigneeEmail: 'other@example.test', nextResponseOn: '2030-01-20' })))
  })
  it('내 할 일은 다른 담당자와 해결된 문제를 제외한다', () => {
    mocks.workspace.clusters.push({ ...cluster('done', 'owner@example.test'), status: 'resolved' })
    page('clusters')
    fireEvent.click(screen.getByRole('checkbox', { name: '내가 맡은 할 일만' }))
    expect(screen.queryByRole('button', { name: /문제 other/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /문제 done/ })).toBeNull()
    expect(screen.getByRole('button', { name: /문제 mine/ })).toBeTruthy()
  })
  it('담당자 배정은 기한을 요구하고 미배정으로 바꾸면 기한도 해제한다', async () => {
    page('clusters')
    fireEvent.click(screen.getByRole('button', { name: '원인·담당 확정' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog.querySelector('[name="nextResponseOn"]').required).toBe(true)
    fill(dialog, 'assigneeEmail', '')
    fireEvent.submit(dialog.querySelector('form'))
    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith('/override', expect.objectContaining({ assigneeEmail: '', nextResponseOn: '' })))
  })
  it('다른 담당자의 접수를 대신 확인할 버튼을 제공하지 않는다', () => {
    mocks.workspace.clusters = [cluster('other', 'other@example.test')]
    page('clusters')
    expect(screen.queryByRole('button', { name: '담당 접수 확인' })).toBeNull()
  })
  it('미기록 비용과 위험도를 0으로 표시하거나 담당자 수정 때 전송하지 않는다', async () => {
    mocks.workspace.clusters = [{ ...cluster('mine', 'owner@example.test'), customer_impact_score: null, regulatory_risk_score: null, operations_cost_krw: null }]
    page('clusters')
    const metrics = document.querySelector('.ol-detail-metrics')
    expect(metrics.textContent).not.toContain('0원')
    expect(metrics.textContent).not.toContain('null/5')
    expect(metrics.textContent.match(/—/g)?.length).toBeGreaterThanOrEqual(2)
    fireEvent.click(screen.getByRole('button', { name: '원인·담당 확정' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog.querySelector('[name="customerImpact"]').value).toBe('')
    fireEvent.submit(dialog.querySelector('form'))
    await waitFor(() => expect(mocks.post).toHaveBeenCalled())
    for (const key of ['customerImpact', 'regulatoryRisk', 'operationsCost']) expect(mocks.post.mock.calls[0][1]).not.toHaveProperty(key)
  })
  it('기존 수치를 미기록으로 바꾸면 명시적 null로 초기화를 요청한다', async () => {
    mocks.workspace.clusters = [{ ...cluster('mine', 'owner@example.test'), customer_impact_score: 3, regulatory_risk_score: 0, operations_cost_krw: 12000 }]
    page('clusters')
    fireEvent.click(screen.getByRole('button', { name: '원인·담당 확정' }))
    const dialog = screen.getByRole('dialog')
    for (const field of ['customerImpact', 'regulatoryRisk', 'operationsCost']) fill(dialog, field, '')
    fireEvent.submit(dialog.querySelector('form'))
    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith('/override', expect.objectContaining({ action: 'update_cluster', customerImpact: null, regulatoryRisk: null, operationsCost: null })))
  })
  it('실제 모드 비관리자에게 계정 편집을 노출하지 않는다', () => {
    page('audit')
    expect(screen.queryByRole('region', { name: '계정 접근 관리' })).toBeNull()
    expect(screen.queryByRole('button', { name: '접근 역할 등록' })).toBeNull()
  })
  it('체험 모드에서는 관리자 역할이어도 계정을 바꾸지 않는다', () => {
    mocks.workspace.demo_mode = true
    localStorage.setItem('override-role', 'audit')
    page('audit')
    expect(screen.queryByRole('button', { name: '접근 역할 등록' })).toBeNull()
    expect(screen.getByText('체험 모드에서는 실제 계정의 접근 권한을 변경하지 않습니다.')).toBeTruthy()
  })
  it('관리자는 부서·제품 범위를 지정하고 확인 후 계정을 비활성화한다', async () => {
    mocks.workspace.current_actor = { email: 'admin@example.test', role: 'audit', is_admin: true }
    mocks.workspace.actors = [{ email: 'staff@example.test', display_name: '직원', role: 'reviewer', active: true, departments: ['인사'], product_ids: ['p1'] }]
    page('audit')
    fireEvent.click(screen.getByRole('button', { name: '직원 접근 권한 변경' }))
    const dialog = screen.getByRole('dialog')
    fill(dialog, 'departments', '인사, 운영')
    fireEvent.click(within(dialog).getByRole('checkbox', { name: '계정 활성' }))
    const submit = within(dialog).getByRole('button', { name: '접근 역할 저장' })
    expect(submit.disabled).toBe(true)
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /이 계정의 접근을 차단/ }))
    expect(submit.disabled).toBe(false)
    fireEvent.submit(dialog.querySelector('form'))
    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith('/override', expect.objectContaining({ action: 'save_actor', email: 'staff@example.test', active: false, departments: ['인사', '운영'], productIds: ['p1'] })))
  })
  it('미해결 피드백의 연결 문제와 후속 처리 근거를 보여준다', async () => {
    mocks.feedback.cases = [{ id: 'case1', event_id: 'e1', product_name: '시험 AI', reason_detail: '제보 내용', updates: [], followups: [followup()] }]
    render(<FieldFeedbackView mode="feedback" role="product" products={[]} />)
    const panel = screen.getByRole('region', { name: '후속 검토' })
    expect(panel.textContent).toContain('c1')
    fireEvent.change(within(panel).getByLabelText('처리 결과와 확인 근거'), { target: { value: '정책 원문과 재확인했습니다.' } })
    fireEvent.submit(panel.querySelector('form'))
    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith('/feedback', expect.objectContaining({ action: 'resolve_followup', followupId: 'f1', resolution: '정책 원문과 재확인했습니다.' })))
  })
  it('후속 검토에서 원인이 연결된 반복 문제로 이동한다', async () => {
    mocks.feedback.cases = [{ id: 'case1', event_id: 'e1', updates: [], followups: [followup({ cluster_id: 'other' })] }]
    page('feedback')
    fireEvent.click(screen.getByRole('button', { name: '연결된 반복 문제 보기' }))
    await waitFor(() => expect(screen.getByRole('heading', { name: '문제 other' })).toBeTruthy())
    expect(mocks.reload).toHaveBeenCalled()
  })
  it('일반 제보자는 후속 검토 처리 버튼 없이 상태만 확인한다', () => {
    mocks.feedback.manager = false
    mocks.feedback.cases = [{ id: 'case1', event_id: 'e1', updates: [], followups: [followup()] }]
    render(<FieldFeedbackView mode="feedback" role="reviewer" products={[]} />)
    expect(screen.getByText('후속 검토 대기')).toBeTruthy()
    expect(screen.queryByText('후속 검토 처리')).toBeNull()
  })
  it('점검 원본과 새 개선 문제를 구분해 표시한다', () => {
    mocks.feedback.batches = [{ id: 'batch1' }]
    mocks.feedback.samples = [{ id: 'sample1', batch_id: 'batch1', event_id: 'e1', snapshot: { ai_decision: '원래 승인 답변', human_decision: '승인함' }, verdict: 'issue', reason: '사후 문제 확인', followup: followup({ source_kind: 'quality_sample' }) }]
    render(<FieldFeedbackView mode="quality" role="product" products={[]} />)
    expect(screen.getByText('원래 승인 답변')).toBeTruthy()
    expect(screen.getByText('점검에서 발견한 문제')).toBeTruthy()
    expect(screen.getByText(/원래 승인 판단이나 직원의 미해결 답변은 바꾸지 않습니다/)).toBeTruthy()
  })
  it('최근 목록 밖의 미처리 후속 검토도 담당자에게 노출한다', () => {
    mocks.feedback.followups = [followup()]
    render(<FieldFeedbackView mode="feedback" role="product" products={[]} />)
    expect(screen.getByRole('heading', { name: '남아 있는 후속 검토' })).toBeTruthy()
    expect(screen.getAllByRole('region', { name: '후속 검토' })).toHaveLength(1)
  })
})
