// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import BuildPage from '../src/pages/BuildPage.jsx'

const state = vi.hoisted(() => ({ post: vi.fn(), read: vi.fn(), reload: vi.fn(), success: vi.fn(), error: vi.fn(), data: null }))
vi.mock('../src/api/client.ts', () => ({ api: { post: state.post } }))
vi.mock('../src/context/ToastContext.jsx', () => ({ useToast: () => ({ success: state.success, error: state.error }) }))
vi.mock('../src/lib/readFiles.js', () => ({ readLocalFiles: state.read }))
vi.mock('../src/hooks/useApi.js', () => ({ useApi: path => ({ data: path === '/applications' ? { items: [{ id: 'build-local', status: '진행중', dept: '재무', title: '합성 원본 식별 검사' }] } : state.data, loading: false, error: null, reload: state.reload }) }))

const shaA = 'a'.repeat(64), shaB = 'b'.repeat(64)
const entry = (id, sha256) => ({ id, date: '2026-06-01', channel: '자사몰', sku_name: '합성 상품', qty: 1, net_revenue_krw: 10000, contribution_krw: 5000,
  source_file: '01_정산.csv', source_sheet: '', source_row_no: 2, source_sha256: sha256, source_ambiguous_name: true, trace: [{ step: '입력', value: '10000' }] })

beforeEach(() => {
  vi.clearAllMocks()
  state.data = { runs: [{ id: 'build-1', seq: 1, rows_out: 2, quarantined: 1, files: [{ name: '01_정산.csv', sha256: shaA, ambiguousName: true }, { name: '01_정산.csv', sha256: shaB, ambiguousName: true }] }], aliases: [],
    rows: [entry('row-a', shaA), entry('row-b', shaB)], quarantine: [{ id: 'q-a', reason: 'bad_amount', source_file: '01_정산.csv', source_row_no: 3, source_sha256: shaA, source_ambiguous_name: true, raw: [] }] }
  state.post.mockResolvedValue({ ok: true }); state.reload.mockResolvedValue(undefined)
})
afterEach(cleanup)

it('renders stored same-name references and makes each full original hash available from the row', async () => {
  render(<MemoryRouter><BuildPage /></MemoryRouter>)
  const rows = await screen.findAllByRole('row', { name: /합성 상품.*어디서 왔는지/ })
  fireEvent.click(rows[0])
  expect(screen.getAllByText(shaA)).toHaveLength(2)
  expect(screen.queryByText(/이전 기록에는 원본 지문이 없어/)).toBeNull()
  fireEvent.keyDown(rows[1], { key: 'Enter' })
  expect(screen.getAllByText(shaB)).toHaveLength(2)
  expect(screen.getByText('원본 파일에서 확인')).toBeTruthy()
})

it('does not retrofit a fingerprint onto legacy rows with only filename and line references', async () => {
  state.data.rows = [{ ...entry('legacy', null), source_ambiguous_name: null }]
  render(<MemoryRouter><BuildPage /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('row', { name: /합성 상품.*어디서 왔는지/ }))
  expect(screen.getByText(/이전 기록에는 원본 지문이 없어/)).toBeTruthy()
  expect(screen.queryByText('원본 지문 보기')).toBeNull()
})

it('shows the saved duplicate source hash, sheet and row instead of conflating equal filenames', async () => {
  state.data.rows = [{ ...entry('suspect', shaB), duplicate_of: '01_정산.csv:2',
    duplicate_source: { file: '01_정산.csv', sheet: '6월', rowNo: 2, sha256: shaA, ambiguousName: true } }]
  render(<MemoryRouter><BuildPage /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('row', { name: /합성 상품.*어디서 왔는지/ }))
  expect(screen.getByText('중복 의심 원본 지문 보기')).toBeTruthy()
  expect(screen.getAllByText(shaA)).toHaveLength(2)
  expect(screen.getByText(/6월 · 2번째 줄과 내용이 같습니다/)).toBeTruthy()
  expect(screen.queryByText('이전 기록에는 중복 의심 원본의 지문이 없습니다.')).toBeNull()
})

it('retains the legacy duplicate string without claiming its original content was verified', async () => {
  state.data.rows = [{ ...entry('legacy-suspect', null), duplicate_of: 'old.csv:7', duplicate_source: null }]
  render(<MemoryRouter><BuildPage /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('row', { name: /합성 상품.*어디서 왔는지/ }))
  expect(screen.getByText(/old.csv:7 줄과 내용이 같습니다/)).toBeTruthy()
  expect(screen.getByText('이전 기록에는 중복 의심 원본의 지문이 없습니다.')).toBeTruthy()
})

it('sends normalized references, not quarantined raw cells, when the actual build upload path runs', async () => {
  const buffer = new TextEncoder().encode('주문일자,상품코드,상품명,수량,판매가,할인액,고객메모\n2026-06-01,NR-CM-100,가상 상품,1,10000,0,PRIVATE_VALID_CELL\n2026-06-02,UNKNOWN,검토 상품,1,10000,0,PRIVATE_CELL_MARKER')
  state.read.mockResolvedValue([{ name: 'same.csv', buffer }])
  const view = render(<MemoryRouter><BuildPage /></MemoryRouter>)
  await screen.findByRole('button', { name: '파일 넣기' })
  fireEvent.change(view.container.querySelector('input[type="file"]'), { target: { files: [new File(['test'], 'same.csv')] } })
  await waitFor(() => expect(state.post).toHaveBeenCalledTimes(1))
  const payload = state.post.mock.calls[0][1]
  expect(payload.rows).toHaveLength(1)
  expect(payload.quarantine).toHaveLength(1)
  expect(payload.rows[0].source.sha256).toMatch(/^[a-f0-9]{64}$/)
  expect(payload.quarantine[0].source.sha256).toBe(payload.rows[0].source.sha256)
  expect(JSON.stringify(payload)).not.toContain('PRIVATE_CELL_MARKER')
  expect(JSON.stringify(payload)).not.toContain('PRIVATE_VALID_CELL')
  expect(payload.quarantine[0]).not.toHaveProperty('raw')
  expect(state.error).not.toHaveBeenCalled()
})
