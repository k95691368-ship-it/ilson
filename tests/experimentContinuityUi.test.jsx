// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import OverridePage from '../src/pages/OverridePage.jsx'

const client = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), success: vi.fn(), error: vi.fn() }))
vi.mock('../src/api/client.js', () => ({ api: client }))
vi.mock('../src/context/ToastContext.jsx', () => ({ useToast: () => ({ success: client.success, error: client.error }) }))
const plan = { metricType: 'rate', minimumWindowSeconds: 60, minimumSamples: { historical: 10, shadow: 10, limited: 10 }, rationale: '단계별 측정', datasetVersion: 'd1', modelVersion: 'm1', policyVersion: 'p1' }
let experiment, workspace
beforeEach(() => {
  vi.clearAllMocks(); window.location.hash = '#experiments'; localStorage.clear(); window.scrollTo = vi.fn()
  experiment = { id: 'exp1', cluster_id: 'c1', title: '정책 검색 개선', hypothesis: '오류 감소', risk_level: 'medium', status: 'running', approved_at: '2026-01-01 00:00:00', approval_id: 'a1', change_version: 'v1', evaluation_plan_json: JSON.stringify(plan), guardrails: ['위반 0건'], stop_conditions: ['1건이면 중단'], target_improvement: 20, success_metric: '수정률', rollback_plan: 'v1 복귀', runs: [], decisions: [] }
  workspace = { demo_mode: false, current_actor: { role: 'product', email: 'owner@local.invalid' }, products: [], events: [], clusters: [{ id: 'c1', title: '정책 검색 오류' }], experiments: [experiment], audit: [], ai_calls: [], integrations: [] }
  client.get.mockImplementation(async () => workspace); client.post.mockResolvedValue({ ok: true })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })
const show = () => render(<MemoryRouter initialEntries={['/#experiments']}><OverridePage /></MemoryRouter>)
const decisionDialog = () => screen.getByRole('dialog', { name: '확대·보류·중단 결정' })

it('allows only an additional rollback decision after expansion and keeps the original decision visible', async () => {
  experiment.status = 'expanded'
  experiment.decisions = [{ id: 'd1', decision: 'expand', basis: '최초 확대 근거', decided_by: '책임자', created_at: '2026-01-01T00:00:00Z', metrics_snapshot: { runs: [{ id: 'original-evidence' }] } }]
  show()
  fireEvent.click(await screen.findByRole('button', { name: '롤백 결정 기록' }))
  const dialog = decisionDialog()
  expect(within(dialog).getByText(/최초 확대 결정과 근거는 그대로 보존/)).toBeTruthy()
  expect(within(dialog).getAllByRole('option').map(option => option.value)).toEqual(['rollback'])
  fireEvent.change(within(dialog).getByRole('textbox', { name: '결정 근거' }), { target: { value: '현장 재확인에서 문제가 다시 발생했습니다.' } })
  fireEvent.submit(dialog.querySelector('form'))
  await waitFor(() => expect(client.post).toHaveBeenCalledWith('/override', expect.objectContaining({ action: 'decide_experiment', experimentId: 'exp1', decision: 'rollback', basis: '현장 재확인에서 문제가 다시 발생했습니다.' })))
  expect(screen.getByText('최초 확대 근거')).toBeTruthy()
  expect(client.success).toHaveBeenCalledWith('최종 결정과 근거를 남겼습니다.')
})

it('keeps a rolled-back experiment sealed', async () => {
  experiment.status = 'rolled_back'; show()
  expect((await screen.findByRole('button', { name: '최종 결정' })).disabled).toBe(true)
  expect(screen.getByRole('button', { name: '실험 결과 입력' }).disabled).toBe(true)
  expect(screen.queryByRole('button', { name: '사람 승인' })).toBeNull()
})

it('distinguishes the historical dataset period from live measurement and explains timezone boundaries', async () => {
  show(); fireEvent.click(await screen.findByRole('button', { name: '실험 결과 입력' }))
  const dialog = screen.getByRole('dialog', { name: '실험 결과 기록' })
  expect(within(dialog).getByLabelText(/재생 대상 데이터 시작 시각/)).toBeTruthy()
  expect(within(dialog).getByText(/승인 전 데이터도 사용할 수 있습니다/)).toBeTruthy()
  fireEvent.change(within(dialog).getByRole('combobox', { name: '실행 단계' }), { target: { value: 'shadow' } })
  expect(within(dialog).getByLabelText(/측정 시작 시각/)).toBeTruthy()
  expect(within(dialog).queryByLabelText(/재생 대상 데이터 시작 시각/)).toBeNull()
  expect(within(dialog).getByText(/현재 승인 이후의 실제 측정 기간/)).toBeTruthy()
  expect(within(dialog).getByText(/현재 기기 시간대에서 UTC로 변환/)).toBeTruthy()
})

it('does not offer expansion for stored passed results with invalid timing', async () => {
  experiment.runs = ['historical', 'shadow', 'limited'].map((phase, index) => ({ id: phase, phase, status: 'passed', approval_id: 'a1', change_version: 'v1', run_sequence: index, guardrail_breaches: 0, measurement_start: '2000-01-01T00:00:00Z', measurement_end: '2000-01-01T01:00:00Z' }))
  show(); fireEvent.click(await screen.findByRole('button', { name: '최종 결정' }))
  const dialog = decisionDialog()
  expect(within(dialog).getByRole('option', { name: '적용 범위 확대' }).disabled).toBe(true)
  expect(within(dialog).getByText(/Shadow·제한 배포의 측정은 현재 승인 시각 이후/)).toBeTruthy()
})

it('keeps field rejection reasons and entered evidence visible until a corrected submission succeeds', async () => {
  const reason = 'Shadow·제한 배포의 측정은 현재 승인 시각 이후여야 합니다.'
  client.post.mockRejectedValueOnce(Object.assign(new Error('적어 주신 내용을 확인해주세요.'), { fields: { measurementStart: reason } }))
  show(); fireEvent.click(await screen.findByRole('button', { name: '실험 결과 입력' }))
  const dialog = screen.getByRole('dialog', { name: '실험 결과 기록' })
  fireEvent.change(within(dialog).getByRole('combobox', { name: '실행 단계' }), { target: { value: 'shadow' } })
  fireEvent.change(within(dialog).getByLabelText(/측정 시작 시각/), { target: { value: '2001-01-01T09:00' } })
  fireEvent.change(within(dialog).getByLabelText(/측정 종료 시각/), { target: { value: '2001-01-01T09:01' } })
  fireEvent.submit(dialog.querySelector('form'))
  const alert = await within(dialog).findByRole('alert')
  expect(within(alert).getByText(reason)).toBeTruthy()
  expect(within(dialog).getByLabelText(/측정 시작 시각/).value).toBe('2001-01-01T09:00')
  expect(client.error).toHaveBeenCalledWith(reason)
  fireEvent.change(within(dialog).getByLabelText(/측정 시작 시각/), { target: { value: '2026-01-02T09:00' } })
  fireEvent.change(within(dialog).getByLabelText(/측정 종료 시각/), { target: { value: '2026-01-02T09:01' } })
  fireEvent.submit(dialog.querySelector('form'))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(client.post).toHaveBeenCalledTimes(2)
  fireEvent.click(screen.getByRole('button', { name: '실험 결과 입력' }))
  expect(screen.queryByRole('alert')).toBeNull()
})

it('offers expansion for historical data and adjacent live windows that share the same UTC boundary', async () => {
  experiment.runs = ['historical', 'shadow', 'limited'].map((phase, index) => ({ id: phase, phase, status: 'passed', approval_id: 'a1', change_version: 'v1', run_sequence: index, guardrail_breaches: 0,
    measurement_start: phase === 'historical' ? '2000-01-01T00:00:00Z' : `2026-01-01T09:0${index-1}:00+09:00`,
    measurement_end: phase === 'historical' ? '2000-01-01T00:01:00Z' : `2026-01-01T09:0${index}:00+09:00` }))
  show(); fireEvent.click(await screen.findByRole('button', { name: '최종 결정' }))
  const dialog = decisionDialog()
  expect(within(dialog).getByRole('option', { name: '적용 범위 확대' }).disabled).toBe(false)
  expect(within(dialog).getByRole('combobox', { name: '결정' }).value).toBe('expand')
})
