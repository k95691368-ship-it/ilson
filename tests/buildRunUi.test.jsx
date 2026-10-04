// @vitest-environment happy-dom
import { webcrypto } from 'node:crypto'
import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import BuildPage from '../src/pages/BuildPage.jsx'
import { beginAccessCheck, completeAccessCheck, getAccessSession, revokeAccess } from '../src/lib/accessSession.js'

const state = vi.hoisted(() => ({ read: vi.fn(), pipeline: vi.fn(), success: vi.fn(), error: vi.fn() }))
vi.mock('../src/lib/readFiles.js', () => ({ readLocalFiles: state.read }))
vi.mock('../shared/pipeline.js', async original => ({ ...await original(), runPipeline: state.pipeline }))
vi.mock('../src/context/ToastContext.jsx', () => ({ useToast: () => state }))
const SCOPE = '3'.repeat(64), OTHER = '4'.repeat(64), HASH = 'a'.repeat(64)
const STORED = 'run_' + '1'.repeat(20)
const activate = (scope = SCOPE) => completeAccessCheck(beginAccessCheck(), { ok: true, mode: 'access', scope })
const source = { file: 'selected.csv', sheet: '정산', rowNo: 2, sha256: HASH, ambiguousName: false }
const result = () => ({ files: [{ name: 'selected.csv', sha256: HASH, sheet: '정산', ok: true, headerRowNo: 1, rowsIn: 2, rowsOut: 1, quarantined: 1, buffer: 'PRIVATE_BUFFER' }],
  rows: [{ date: '2026-06-01', iso_week: '2026-W23', sku: 'NR-CM-100', sku_name: '가상 계산 상품', channel: '자사몰', qty: 2, net_revenue_krw: 12000, contribution_krw: 3000, source,
    trace: [{ step: '계산', value: '12000' }], raw: ['PRIVATE_ROW'] }],
  quarantine: [{ reason: 'unknown_sku', externalCode: 'UNKNOWN', productName: '가상 미등록 상품', source: { ...source, rowNo: 3 }, raw: ['PRIVATE_QUARANTINE'] }],
  totals: { all: { rows: 1, qty: 2, net_revenue_krw: 12000, contribution_krw: 3000 }, byChannel: [], byChannelWeek: [] }, stats: { durationMs: 137, duplicateSuspects: 0 } })
const receipt = () => Response.json({ ok: true, run_id: STORED, seq: 1 }, { status: 201 })
const failure = (status, extra = {}) => Response.json({ error: '합성 실행 저장 오류', ...extra }, { status })
const empty = () => ({ runs: [], rows: [], quarantine: [], aliases: [] })
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
let records, postReply, readStatus, fetcher, calculated
const posts = () => fetcher.mock.calls.filter(([, options]) => options.method === 'POST')
const statusPanel = () => screen.getByRole('region', { name: '이번 계산의 저장 상태' })
const pendingError = async () => within(await screen.findByRole('region', { name: '이번 계산의 저장 상태' })).findByRole('alert')
const choose = view => fireEvent.change(view.container.querySelector('input[type=file]'), { target: { files: [new File(['PRIVATE_FILE'], 'selected.csv')] } })
const retry = () => fireEvent.click(screen.getByRole('button', { name: '같은 계산 결과 저장 다시 시도' }))
async function show(strict = false) {
  const body = <MemoryRouter><BuildPage /></MemoryRouter>
  const view = render(strict ? <StrictMode>{body}</StrictMode> : body)
  await screen.findByRole('button', { name: '파일 넣기' })
  return view
}
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal('crypto', webcrypto); activate()
  calculated = result(); state.read.mockResolvedValue([{ name: 'selected.csv', buffer: new ArrayBuffer(0) }]); state.pipeline.mockResolvedValue(calculated)
  records = { a: empty(), b: empty() }; readStatus = null; postReply = () => receipt()
  fetcher = vi.fn(async (url, options) => {
    if (String(url) === '/api/applications') return Response.json({ items: ['a', 'b'].map(id => ({ id, title: `과제 ${id}`, status: '진행중', dept: '재무' })) })
    const id = String(url).match(/applications\/(a|b)\/build/)?.[1]
    if (!id) throw Error('Unexpected local request: ' + url)
    if (options.method === 'POST') return postReply(JSON.parse(options.body), id)
    return readStatus ? failure(readStatus, { error: '제작 기록 조회 실패' }) : Response.json(records[id])
  })
  vi.stubGlobal('fetch', fetcher)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('locks duplicate file events synchronously, freezes one calculated command, and never sends raw fields', async () => {
  const reading = deferred(), saving = deferred(); state.read.mockReturnValue(reading.promise); postReply = () => saving.promise
  const storage = vi.spyOn(Storage.prototype, 'setItem')
  const view = await show(true)
  act(() => { choose(view); choose(view) })
  expect(state.read).toHaveBeenCalledTimes(1)
  await act(async () => reading.resolve([{ name: 'selected.csv', buffer: new ArrayBuffer(0) }]))
  await waitFor(() => expect(posts()).toHaveLength(1))
  const payload = JSON.parse(posts()[0][1].body)
  expect(payload).toMatchObject({ kind: 'run', run_scope: SCOPE, duration_ms: 137, duplicate_suspects: 0 })
  expect(payload.run_id).toMatch(/^[a-f0-9-]{36}$/)
  expect(JSON.stringify(payload)).not.toContain('PRIVATE_')
  expect(state.pipeline).toHaveBeenCalledTimes(1)
  expect(within(statusPanel()).getByText(/결과 1줄 · 검토함 1줄/)).toBeTruthy()
  expect(screen.getByRole('button', { name: '결과를 기록하는 중…' }).disabled).toBe(true)
  expect(storage).not.toHaveBeenCalled()
  await act(async () => saving.resolve(receipt()))
  await screen.findByText(`1차 실행 · 기록 ${STORED}`)
  expect(state.success).toHaveBeenCalledWith('제작 실행 기록을 저장했습니다.')
})

it.each(['network', '503'])('retries an uncertain %s with identical body/intent/duration and no repeated read or calculation', async kind => {
  postReply = () => kind === 'network' ? Promise.reject(Error('reply lost')) : failure(503)
  const view = await show(); choose(view)
  await pendingError()
  const originalBody = posts()[0][1].body
  calculated.stats.durationMs = 999999
  calculated.rows[0].net_revenue_krw = 999999
  calculated.quarantine[0].raw.push('NEW_PRIVATE_MARKER')
  expect(within(statusPanel()).getByText('12,000원')).toBeTruthy()
  expect(within(statusPanel()).getAllByText(/selected.csv/).length).toBeGreaterThan(0)
  postReply = () => receipt(); retry()
  await screen.findByText(`1차 실행 · 기록 ${STORED}`)
  expect(posts()).toHaveLength(2)
  expect(posts()[1][1].body).toBe(originalBody)
  expect(posts()[0][1].headers.get('X-Idempotency-Key')).toBe(posts()[1][1].headers.get('X-Idempotency-Key'))
  expect(state.read).toHaveBeenCalledTimes(1); expect(state.pipeline).toHaveBeenCalledTimes(1)
})

it('shows a fractional quantity rejection while preserving the exact calculation, source and retry intent', async () => {
  calculated.rows[0].qty = 1.5
  calculated.rows[0].return_qty = 0.5
  calculated.totals.all.qty = 1.5
  const message = '제작 결과 1번째 행의 수량이 소수입니다. 현재 저장 형식에서는 정확히 보존할 수 없습니다. 원본 수량과 단위를 확인해주세요.'
  postReply = () => failure(400, { error: message, fields: { 'rows.0.qty': message } })
  const view = await show(); choose(view)
  expect((await pendingError()).textContent).toContain(message)
  const original = posts()[0][1].body, payload = JSON.parse(original)
  expect(payload.rows[0]).toMatchObject({ qty: 1.5, return_qty: 0.5, source })
  expect(payload.totals.all.qty).toBe(1.5)
  const preview = within(statusPanel()).getByRole('table', { name: '저장할 정산 계산 결과', hidden: true })
  expect(within(preview).getByRole('columnheader', { name: '수량', hidden: true })).toBeTruthy()
  expect(within(preview).getByRole('columnheader', { name: '반품수량', hidden: true })).toBeTruthy()
  expect(within(preview).getByText('1.5')).toBeTruthy()
  expect(within(preview).getByText('0.5')).toBeTruthy()
  expect(within(statusPanel()).getAllByText(/selected.csv/).length).toBeGreaterThan(0)
  expect(screen.getByRole('button', { name: '파일 넣기' }).disabled).toBe(true)
  expect(state.success).not.toHaveBeenCalled()
  retry(); await waitFor(() => expect(posts()).toHaveLength(2)); await pendingError()
  expect(posts()[1][1].body).toBe(original)
  expect(state.read).toHaveBeenCalledTimes(1); expect(state.pipeline).toHaveBeenCalledTimes(1)
  expect(calculated.rows[0].qty).toBe(1.5)
})

it.each([{}, { ok: true }, { ok: false, run_id: STORED, seq: 1 }, { ok: true, run_id: null, seq: 1 },
  { ok: true, run_id: 'bad id', seq: 1 }, { ok: true, run_id: STORED, seq: 0 }, { ok: true, run_id: STORED, seq: '1' }, { ok: true, run_id: STORED, seq: 1.5 },
])('preserves the retry key until an exact success receipt is validated: %j', async body => {
  postReply = () => Response.json(body, { status: 201 })
  const view = await show(); choose(view)
  await pendingError()
  expect(state.success).not.toHaveBeenCalled()
  postReply = () => receipt(); retry()
  await screen.findByText(`1차 실행 · 기록 ${STORED}`)
  expect(posts()[0][1].body).toBe(posts()[1][1].body)
  expect(posts()[0][1].headers.get('X-Idempotency-Key')).toBe(posts()[1][1].headers.get('X-Idempotency-Key'))
})

it('keeps a server-confirmed receipt visible after GET503 and retries only the read', async () => {
  postReply = () => { readStatus = 503; return receipt() }
  const view = await show(); choose(view)
  await screen.findByText(`1차 실행 · 기록 ${STORED}`)
  await screen.findByText(/제작 기록 조회 실패/)
  expect(screen.queryByRole('button', { name: '같은 계산 결과 저장 다시 시도' })).toBeNull()
  readStatus = null
  fireEvent.click(screen.getByRole('button', { name: '최신 제작 기록 다시 읽기' }))
  await waitFor(() => expect(screen.queryByText(/제작 기록 조회 실패/)).toBeNull())
  expect(posts()).toHaveLength(1)
})

it('uses the same intent on explicit 409 retry, without regenerating a calculation or UUID', async () => {
  postReply = () => failure(409, { code: 'BUILD_RUN_CONFLICT' })
  const view = await show(); choose(view)
  await screen.findByText(/새 실행 번호를 자동으로 만들지 않습니다/)
  const first = posts()[0][1].body
  postReply = () => receipt(); retry()
  await screen.findByText(`1차 실행 · 기록 ${STORED}`)
  expect(posts()[1][1].body).toBe(first)
  expect(state.pipeline).toHaveBeenCalledTimes(1)
})

it('keeps the body intent after the transport header expires at 30 minutes', async () => {
  const now = Date.now(), clock = vi.spyOn(Date, 'now').mockReturnValue(now)
  postReply = () => failure(503)
  const view = await show(); choose(view)
  await pendingError()
  const original = posts()[0][1]
  clock.mockReturnValue(now + 31 * 60000)
  postReply = () => receipt(); retry()
  await screen.findByText(`1차 실행 · 기록 ${STORED}`)
  expect(posts()[1][1].body).toBe(original.body)
  expect(posts()[1][1].headers.get('X-Idempotency-Key')).not.toBe(original.headers.get('X-Idempotency-Key'))
  expect(state.pipeline).toHaveBeenCalledTimes(1)
})

it('does not extend the seven-day window when an uncertain save is retried', async () => {
  const now = Date.now(), clock = vi.spyOn(Date, 'now').mockReturnValue(now)
  postReply = () => failure(503)
  const view = await show(); choose(view)
  await pendingError()
  const original = posts()[0][1].body
  clock.mockReturnValue(now + 6 * 24 * 60 * 60000)
  retry(); await waitFor(() => expect(posts()).toHaveLength(2)); await pendingError()
  expect(posts()[1][1].body).toBe(original)
  clock.mockReturnValue(now + 7 * 24 * 60 * 60000)
  retry()
  await screen.findByText(/재시도 확인 기간이 지났거나/)
  expect(screen.getByRole('button', { name: '같은 계산 결과 저장 다시 시도' }).disabled).toBe(true)
  expect(within(statusPanel()).getByText('12,000원')).toBeTruthy()
  expect(screen.getByRole('button', { name: '저장 이력 다시 확인' }).disabled).toBe(false)
  expect(posts()).toHaveLength(2)
  expect(state.pipeline).toHaveBeenCalledTimes(1)
})

it('keeps the calculation but fails closed after browser clock reversal', async () => {
  const now = Date.now(), clock = vi.spyOn(Date, 'now').mockReturnValue(now)
  postReply = () => failure(503)
  const view = await show(); choose(view)
  await pendingError()
  clock.mockReturnValue(now - 1)
  retry()
  await screen.findByText(/브라우저 시간이 바뀌었습니다/)
  expect(screen.getByRole('button', { name: '같은 계산 결과 저장 다시 시도' }).disabled).toBe(true)
  expect(within(statusPanel()).getByText('12,000원')).toBeTruthy()
  expect(screen.getByText(/보관을 끝내도 서버 저장이 취소되거나 삭제되지 않습니다/)).toBeTruthy()
  expect(posts()).toHaveLength(1)
})

it('keeps 413 results for inspection, offers splitting guidance, and never silently chunks or retries them', async () => {
  postReply = () => failure(413, { code: 'BUILD_RUN_TOO_LARGE' })
  const view = await show(); choose(view)
  await screen.findByText(/파일을 나누어 계산해주세요/)
  expect(screen.getByRole('button', { name: '같은 계산 결과 저장 다시 시도' }).disabled).toBe(true)
  expect(within(statusPanel()).getByText('12,000원')).toBeTruthy()
  expect(posts()).toHaveLength(1)
  expect(screen.getByText(/미확인 결과가 이미 저장됐을 수 있고 새 실행은 중복/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '현재 결과 보관을 끝내고 새 파일 선택' }))
  expect(screen.queryByRole('region', { name: '이번 계산의 저장 상태' })).toBeNull()
  postReply = () => receipt(); choose(view)
  await screen.findByText(`1차 실행 · 기록 ${STORED}`)
  expect(JSON.parse(posts()[0][1].body).run_id).not.toBe(JSON.parse(posts()[1][1].body).run_id)
})

it('restores A pending data after A→B→A, ignores the original late response, then recovers through the same intent', async () => {
  const pending = deferred(); postReply = () => pending.promise
  const view = await show(); choose(view); await waitFor(() => expect(posts()).toHaveLength(1))
  const first = posts()[0][1].body
  fireEvent.click(screen.getByRole('button', { name: '재무 · 과제 b' }))
  await screen.findByRole('button', { name: '파일 넣기' })
  expect(screen.queryByRole('region', { name: '이번 계산의 저장 상태' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '재무 · 과제 a' }))
  await screen.findByRole('button', { name: '같은 계산 결과 저장 다시 시도' })
  await act(async () => pending.resolve(receipt()))
  expect(state.success).not.toHaveBeenCalled()
  expect(screen.queryByText(`1차 실행 · 기록 ${STORED}`)).toBeNull()
  postReply = () => receipt(); retry()
  await screen.findByText(`1차 실행 · 기록 ${STORED}`)
  expect(posts()[1][1].body).toBe(first)
  expect(state.pipeline).toHaveBeenCalledTimes(1)
})

it.each(['read', 'calculate', 'save'])('does not continue a late %s into another account lifetime', async phase => {
  const pending = deferred()
  if (phase === 'read') state.read.mockReturnValue(pending.promise)
  if (phase === 'calculate') state.pipeline.mockReturnValue(pending.promise)
  if (phase === 'save') postReply = () => pending.promise
  const view = await show(); choose(view)
  if (phase === 'calculate') await waitFor(() => expect(state.pipeline).toHaveBeenCalledTimes(1))
  if (phase === 'save') await waitFor(() => expect(posts()).toHaveLength(1))
  await act(async () => { activate(OTHER) })
  await screen.findByRole('button', { name: '파일 넣기' })
  await act(async () => pending.resolve(phase === 'read' ? [{ name: 'selected.csv', buffer: new ArrayBuffer(0) }] : phase === 'calculate' ? calculated : receipt()))
  expect(screen.queryByRole('region', { name: '이번 계산의 저장 상태' })).toBeNull()
  expect(state.success).not.toHaveBeenCalled(); expect(state.error).not.toHaveBeenCalled()
  expect(posts()).toHaveLength(phase === 'save' ? 1 : 0)
})

it.each([401, 403, 410])('clears and hides an execution on POST permission/resource denial %s', async status => {
  postReply = () => failure(status)
  const view = await show(); choose(view)
  await waitFor(() => expect(posts()).toHaveLength(1))
  await waitFor(() => expect(screen.queryByRole('region', { name: '이번 계산의 저장 상태' })).toBeNull())
  expect(screen.queryByText('가상 계산 상품')).toBeNull()
  expect(screen.queryByRole('button', { name: '같은 계산 결과 저장 다시 시도' })).toBeNull()
})

it.each([403, 404, 410])('clears pending data on a protected GET denial %s without treating it as a transient 503', async status => {
  postReply = () => failure(503)
  const view = await show(); choose(view)
  await pendingError()
  readStatus = status
  fireEvent.click(screen.getByRole('button', { name: '저장 이력 다시 확인' }))
  await screen.findByText(/계산 결과를 숨겼습니다/)
  expect(screen.queryByRole('region', { name: '이번 계산의 저장 상태' })).toBeNull()
  readStatus = null
  fireEvent.click(screen.getByRole('button', { name: '재무 · 과제 b' }))
  await screen.findByRole('button', { name: '파일 넣기' })
  fireEvent.click(screen.getByRole('button', { name: '재무 · 과제 a' }))
  await screen.findByRole('button', { name: '파일 넣기' })
  expect(screen.queryByRole('region', { name: '이번 계산의 저장 상태' })).toBeNull()
})

it('warns on unload only for an uncertain run and removes the handler after confirmation/unmount', async () => {
  postReply = () => failure(503)
  const view = await show(); choose(view)
  await pendingError()
  const uncertain = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(uncertain)
  expect(uncertain.defaultPrevented).toBe(true)
  postReply = () => receipt(); retry()
  await screen.findByText(`1차 실행 · 기록 ${STORED}`)
  const confirmed = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(confirmed)
  expect(confirmed.defaultPrevented).toBe(false)
  view.unmount()
  const closed = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(closed)
  expect(closed.defaultPrevented).toBe(false)
})

it('removes pending data and unload protection when access is revoked while saving', async () => {
  const pending = deferred(); postReply = () => pending.promise
  const view = await show(); choose(view); await waitFor(() => expect(posts()).toHaveLength(1))
  await act(async () => revokeAccess(getAccessSession().generation))
  await act(async () => pending.resolve(receipt()))
  expect(screen.queryByRole('region', { name: '이번 계산의 저장 상태' })).toBeNull()
  const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(false)
  expect(state.success).not.toHaveBeenCalled()
})
