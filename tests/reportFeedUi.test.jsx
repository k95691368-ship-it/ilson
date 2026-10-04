// @vitest-environment happy-dom
// Real routes, useApi, client, and account gate; every HTTP result is synthetic.
import { webcrypto } from 'node:crypto'
import { act, StrictMode } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom'
import ToolsPage from '../src/pages/ToolsPage.jsx'
import BugPage from '../src/pages/BugPage.jsx'
import WorkspaceGate from '../src/components/WorkspaceGate.jsx'
import { ToastProvider } from '../src/context/ToastContext.jsx'
import { beginAccessCheck, completeAccessCheck } from '../src/lib/accessSession.js'

const BASIS = 'a'.repeat(64), NEXT_BASIS = 'b'.repeat(64)
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const report = (number, { fixed = false, prefix = '신고 원문' } = {}) => ({ id: `r${number}`, body: `${prefix} ${number}`,
  version: 'c'.repeat(64),
  code: 'wrong_number', label: '숫자가 안 맞습니다', urgent: true, open: !fixed, reporter: '합성 제보자', at: '2026-01-01',
  fix: fixed ? { how: '수정한 내용', why: '확인된 원인' } : null })
const feed = (number = 1, { total = 205, basis = BASIS, size, prefix, fixed, appOpen = total - 5 } = {}) => {
  const shown = size ?? Math.max(0, Math.min(100, total - (number - 1) * 100))
  return { summary: { total, open: appOpen, urgent: appOpen, fixed: total - appOpen, toolsUntrusted: appOpen ? 1 : 0 },
    tools: shown ? [{ applicationId: 'app-a', ticket_no: 'AX-AAA-001', dept: '재무', slug: null, toolTitle: '인계 전 기능',
      total, open: appOpen, urgent: appOpen, fixed: total - appOpen,
      reports: Array.from({ length: shown }, (_, i) => report((number - 1) * 100 + i + 1, { fixed: fixed ?? ((number - 1) * 100 + i + 1 > appOpen), prefix })) }] : [],
    page: { number, size: 100, total, totalPages: Math.max(1, Math.ceil(total / 100)), hasPrevious: number > 1, hasMore: number * 100 < total, basis } }
}
let calls, getReports, postReply, toolsResponse
const reads = () => calls.filter(c => c.method === 'GET' && c.path.startsWith('/reports'))
const writes = () => calls.filter(c => c.method !== 'GET')
const successes = () => [...document.querySelectorAll('.toast-success')].map(n => n.textContent)
const errors = () => [...document.querySelectorAll('.toast-error')].map(n => n.textContent)
const nav = () => within(screen.getByRole('navigation', { name: '신고 페이지' }))
beforeEach(() => {
  calls = []
  vi.stubGlobal('crypto', webcrypto)
  completeAccessCheck(beginAccessCheck(), { ok: true, mode: 'demo', scope: 'a'.repeat(64) })
  getReports = url => reply(feed(Number(url.searchParams.get('page') ?? 1)))
  postReply = (_path, options) => reply({ ok: true, id: `dec_${'a'.repeat(20)}`, ticket_no: 'AX-AAA-001', reportId: JSON.parse(options.body).reportId, author: 'AX 담당자' })
  toolsResponse = { items: [], summary: { total: 0 }, failures: [] }
  vi.stubGlobal('fetch', vi.fn(async (input, options = {}) => {
    const url = new URL(String(input), 'https://local.invalid'), path = url.pathname.replace(/^\/api/, '') + url.search
    const method = options.method ?? 'GET'
    calls.push({ path, method, body: options.body, key: new Headers(options.headers).get('X-Idempotency-Key') })
    if (method !== 'GET') return postReply(path, options)
    if (path === '/demo/workspace') return reply({ enabled: false })
    if (path === '/session') return reply({ ok: true, mode: 'demo', scope: 'a'.repeat(64) })
    if (path === '/tools') return reply(toolsResponse)
    if (path === '/codes') return reply({ summary: { needsCheck: 0 } })
    if (path === '/bugs') return reply({ targets: [{ id: 'app-a', ticket_no: 'AX-AAA-001', dept: '재무', title: '기능 A' }] })
    if (path.startsWith('/reports')) return getReports(url)
    throw Error(`Unexpected request ${path}`)
  }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
async function show(path = '/tools', { gated = false, strict = false } = {}) {
  const pages = <ToastProvider><Link to="/tools">도구 화면</Link><Link to="/bug">버그 화면</Link><Routes>
    <Route path="/tools" element={<ToolsPage />} /><Route path="/bug" element={<BugPage />} />
  </Routes></ToastProvider>
  const tree = <MemoryRouter initialEntries={[path]}>{gated ? <WorkspaceGate>{pages}</WorkspaceGate> : pages}</MemoryRouter>
  render(strict ? <StrictMode>{tree}</StrictMode> : tree)
  await screen.findByText('현재 페이지 원문 100건 · 전체 신고 205건 · 1 / 3페이지')
}
async function release(held, result) { await act(async () => { held.resolve(result); await held.promise }) }
async function next() { fireEvent.click(nav().getByRole('button', { name: '다음 페이지' })); await screen.findByText(/현재 페이지 원문 100건 · 전체 신고 205건 · 2/); }
async function editFix() {
  const item = document.querySelector('.report-item')
  fireEvent.click(within(item).getByRole('button', { name: '처리했다고 남기기' }))
  fireEvent.change(within(item).getByLabelText(/무엇을 하셨습니까/), { target: { value: '컬럼 누락을 차단했습니다' } })
  fireEvent.change(within(item).getByLabelText(/왜 그랬던 것입니까/), { target: { value: '필수 컬럼 검사가 없었습니다' } })
  return item.querySelector('form')
}

it('shows accepted application reports even without handed-over tools, capped at 100 originals', async () => {
  await show()
  expect(screen.getByText('아직 넘긴 도구가 없습니다')).toBeTruthy()
  expect(document.querySelectorAll('.report-item')).toHaveLength(100)
  expect(screen.getByText('전체 미처리 200건 · 긴급 200건 · 처리 5건')).toBeTruthy()
  expect(screen.getByText('이 기능 전체 미처리 200건 · 처리 5건 · 현재 페이지 원문 100건')).toBeTruthy()
  expect(writes()).toHaveLength(0)
})
it('uses the current basis for next and previous, with a synchronous double-click lock', async () => {
  await show('/tools', { strict: true })
  const before = reads().length, held = deferred()
  getReports = () => held.promise
  const button = nav().getByRole('button', { name: '다음 페이지' })
  act(() => { fireEvent.click(button); fireEvent.click(button) })
  await waitFor(() => expect(reads()).toHaveLength(before + 1))
  expect(reads().at(-1).path).toBe(`/reports?page=2&basis=${BASIS}`)
  expect(screen.queryByText('신고 원문 1')).toBeNull()
  await release(held, reply(feed(2)))
  getReports = url => reply(feed(Number(url.searchParams.get('page') ?? 1)))
  fireEvent.click(nav().getByRole('button', { name: '이전 페이지' }))
  await screen.findByText('신고 원문 1')
  expect(reads().at(-1).path).toBe(`/reports?page=1&basis=${BASIS}`)
})
it('hides old originals after REPORTS_CHANGED and only reopens with a fresh first-page basis', async () => {
  await show(); await next()
  getReports = () => reply({ error: '목록이 변경되었습니다.', code: 'REPORTS_CHANGED' }, 409)
  fireEvent.click(nav().getByRole('button', { name: '다음 페이지' }))
  await screen.findByText('목록이 변경되었습니다.')
  expect(document.querySelectorAll('.report-item')).toHaveLength(0)
  expect(screen.queryByRole('button', { name: '처리했다고 남기기' })).toBeNull()
  getReports = () => reply(feed(1, { basis: NEXT_BASIS }))
  fireEvent.click(screen.getByRole('button', { name: '첫 페이지 다시 확인' }))
  await screen.findByText('신고 원문 1')
  expect(reads().at(-1).path).toBe('/reports')
  fireEvent.click(nav().getByRole('button', { name: '다음 페이지' }))
  await waitFor(() => expect(reads().at(-1).path).toBe(`/reports?page=2&basis=${NEXT_BASIS}`))
  expect(writes()).toHaveLength(0)
})
it('keeps source and locks processing after a transient refresh failure; retry is GET only', async () => {
  await show()
  getReports = () => reply({ error: '잠시 조회할 수 없습니다.' }, 503)
  fireEvent.click(nav().getByRole('button', { name: '첫 페이지 다시 확인' }))
  await screen.findByText('잠시 조회할 수 없습니다.')
  expect(screen.getByText('신고 원문 1')).toBeTruthy()
  expect(screen.getAllByRole('button', { name: '처리했다고 남기기' }).every(button => button.disabled)).toBe(true)
  getReports = () => reply(feed())
  fireEvent.click(screen.getByRole('button', { name: '신고 목록 다시 조회' }))
  await waitFor(() => expect(screen.queryByText('잠시 조회할 수 없습니다.')).toBeNull())
  expect(writes()).toHaveLength(0)
})
it.each([401, 403, 404, 410])('denial %s removes previously visible originals', async status => {
  await show()
  getReports = () => reply({ error: '목록 접근 거절' }, status)
  fireEvent.click(nav().getByRole('button', { name: '첫 페이지 다시 확인' }))
  await screen.findByText('목록 접근 거절')
  expect(screen.queryByText('신고 원문 1')).toBeNull()
  expect(screen.queryByRole('button', { name: '처리했다고 남기기' })).toBeNull()
})
it.each([{}, { tools: [], summary: {} }, feed(1, { size: 101 })])('rejects malformed or oversized response without claiming zero reports', async value => {
  await show()
  getReports = () => reply(value)
  fireEvent.click(nav().getByRole('button', { name: '첫 페이지 다시 확인' }))
  await screen.findByText('신고 목록 응답을 확인하지 못했습니다. 다시 조회해주세요.')
  expect(screen.queryByText('아직 들어온 신고가 없습니다.')).toBeNull()
  expect(document.querySelectorAll('.report-item')).toHaveLength(0)
})
it('rejects an incomplete requested page instead of calling the whole list empty', async () => {
  await show()
  getReports = () => reply(feed(2, { size: 0 }))
  fireEvent.click(nav().getByRole('button', { name: '다음 페이지' }))
  await screen.findByText('신고 목록 응답을 확인하지 못했습니다. 다시 조회해주세요.')
  expect(document.querySelectorAll('.report-item')).toHaveLength(0)
  expect(screen.queryByText('아직 들어온 신고가 없습니다.')).toBeNull()
  getReports = () => reply(feed(2))
  fireEvent.click(screen.getByRole('button', { name: '신고 목록 다시 조회' }))
  await screen.findByText('신고 원문 101')
  getReports = () => reply(feed(1, { total: 0, appOpen: 0 }))
  fireEvent.click(nav().getByRole('button', { name: '첫 페이지 다시 확인' }))
  await screen.findByText('아직 들어온 신고가 없습니다.')
})
it('does not describe a page containing fixed reports as a fully fixed application', async () => {
  getReports = url => reply(feed(Number(url.searchParams.get('page') ?? 1), { appOpen: 100 }))
  await show('/bug')
  fireEvent.click(nav().getByRole('button', { name: '다음 페이지' }))
  await screen.findByText('신고 원문 101')
  expect(screen.getByText('안 고친 것 100건')).toBeTruthy()
  expect(screen.queryByText('전부 처리됨')).toBeNull()
  expect(screen.queryByText('현재 페이지의 전체 처리 완료 기능')).toBeNull()
})
it('labels the completed fold count as current-page groups instead of all completed tools', async () => {
  getReports = url => reply(feed(Number(url.searchParams.get('page') ?? 1), { appOpen: 0 }))
  await show('/bug')
  getReports = () => reply(feed(2, { fixed: true, appOpen: 0 }))
  fireEvent.click(nav().getByRole('button', { name: '다음 페이지' }))
  await screen.findByText('현재 페이지의 전체 처리 완료 기능')
  expect(screen.getByText('전체 기능 수가 아니라 이 페이지에 원문이 있는 기능 수입니다')).toBeTruthy()
})
it.each([200, 403, 503])('late page GET %s cannot affect the newly mounted route', async status => {
  await show(); const held = deferred(); getReports = () => held.promise
  fireEvent.click(nav().getByRole('button', { name: '다음 페이지' }))
  await waitFor(() => expect(reads().at(-1).path).toContain('page=2'))
  getReports = () => reply(feed(1, { prefix: '새 버그 화면 원문' }))
  fireEvent.click(screen.getByRole('link', { name: '버그 화면' }))
  await screen.findByText('새 버그 화면 원문 1')
  await release(held, reply(status === 200 ? feed(2) : { error: '이전 화면 실패' }, status))
  expect(screen.getByText('새 버그 화면 원문 1')).toBeTruthy()
  expect(screen.queryByText('신고 원문 101')).toBeNull(); expect(screen.queryByText('이전 화면 실패')).toBeNull()
})
it.each([200, 403, 503])('late page GET %s cannot affect another account generation', async status => {
  await show('/tools', { gated: true }); const held = deferred(); getReports = () => held.promise
  fireEvent.click(nav().getByRole('button', { name: '다음 페이지' }))
  await waitFor(() => expect(reads().at(-1).path).toContain('page=2'))
  getReports = () => reply(feed(1, { prefix: '새 계정 원문', basis: NEXT_BASIS }))
  await act(async () => { completeAccessCheck(beginAccessCheck(), { ok: true, mode: 'demo', scope: 'b'.repeat(64) }) })
  await screen.findByText('새 계정 원문 1')
  await release(held, reply(status === 200 ? feed(2) : { error: '이전 계정 실패' }, status))
  expect(screen.getByText('새 계정 원문 1')).toBeTruthy(); expect(screen.queryByText('이전 계정 실패')).toBeNull()
  expect(reads().at(-1).path).toBe('/reports')
})
it('confirmed fix on page two resets to a fresh first page and does not misclassify GET failure as write failure', async () => {
  await show(); await next(); const form = await editFix()
  getReports = () => reply({ error: '저장 뒤 목록 조회 실패' }, 503)
  fireEvent.submit(form)
  await screen.findByText('저장 뒤 목록 조회 실패')
  expect(successes()).toEqual(['처리한 것을 남겼습니다.']); expect(errors()).toEqual([])
  expect(screen.queryByText('긴급 미처리 신고가 있는 기능 1개')).toBeNull()
  expect(reads().at(-1).path).toBe('/reports'); expect(writes()).toHaveLength(1)
  getReports = () => reply(feed(1, { basis: NEXT_BASIS }))
  fireEvent.click(screen.getByRole('button', { name: '신고 목록 다시 조회' }))
  await screen.findByText('신고 원문 1'); expect(writes()).toHaveLength(1)
})
it.each([{}, { ok: true }, [], { ok: true, id: 'wrong' }])('uncertain fix response %j retains draft and does not refresh', async receipt => {
  await show(); const form = await editFix(), before = reads().length
  postReply = () => reply(receipt)
  fireEvent.submit(form)
  await waitFor(() => expect(errors()).toHaveLength(1))
  expect(within(form).getByLabelText(/무엇을 하셨습니까/).value).toBe('컬럼 누락을 차단했습니다')
  expect(successes()).toEqual([]); expect(reads()).toHaveLength(before)
})
it('one synchronous fix intent sends once; a late success cannot reset another page', async () => {
  await show(); const form = await editFix(), held = deferred(); postReply = () => held.promise
  act(() => { fireEvent.submit(form); fireEvent.submit(form) })
  await waitFor(() => expect(writes()).toHaveLength(1))
  await next(); const before = reads().length
  await release(held, reply({ ok: true, id: `dec_${'a'.repeat(20)}` }))
  expect(successes()).toEqual([]); expect(reads()).toHaveLength(before)
  expect(screen.getByText('신고 원문 101')).toBeTruthy()
})
it('confirmed bug submission keeps its existing endpoint and resets pagination only after success', async () => {
  await show('/bug'); await next()
  fireEvent.change(screen.getByLabelText(/어느 기능/), { target: { value: 'app-a' } })
  fireEvent.change(screen.getByLabelText(/무슨 일이/), { target: { value: 'wrong_number' } })
  fireEvent.change(screen.getByLabelText(/자세히/), { target: { value: '합계 금액에 차이가 있습니다' } })
  fireEvent.change(screen.getByLabelText(/누구신지/), { target: { value: '합성 담당자' } })
  fireEvent.click(screen.getByRole('button', { name: '신고하기' }))
  await waitFor(() => expect(successes()).toHaveLength(1))
  await screen.findByText('신고 원문 1')
  expect(writes()).toHaveLength(1); expect(writes()[0].path).toBe('/bugs'); expect(reads().at(-1).path).toBe('/reports')
  expect(screen.getByLabelText(/자세히/).value).toBe('')
})

it('keeps an application page of 98 separate from its 405 total and a complete 100-original page', async () => {
  await show()
  const value = feed(1, { total: 405, size: 98, appOpen: 302 })
  value.tools.push({ applicationId: 'app-b', ticket_no: 'AX-BBB-002', dept: '재무', slug: null, toolTitle: '다른 기능',
    total: 2, open: 2, urgent: 2, fixed: 0, reports: [report(406), report(407)] })
  Object.assign(value.summary, { total: 407, open: 304, urgent: 304, toolsUntrusted: 2 })
  value.page.total = 407
  getReports = () => reply(value)
  fireEvent.click(nav().getByRole('button', { name: '첫 페이지 다시 확인' }))
  await screen.findByText('현재 페이지 원문 100건 · 전체 신고 407건 · 1 / 5페이지')
  expect(screen.getByText('전체 미처리 304건 · 긴급 304건 · 처리 103건')).toBeTruthy()
  expect(screen.getByText('긴급 미처리 신고가 있는 기능 2개')).toBeTruthy()
  expect(screen.getByText('이 기능 전체 미처리 302건 · 처리 103건 · 현재 페이지 원문 98건')).toBeTruthy()
  expect(document.querySelectorAll('.report-item')).toHaveLength(100)
})

it('report GET failure is unknown, not a zero-warning tools tile', async () => {
  toolsResponse = { items: [{ application_id: 'app-a', ticket_no: 'AX-AAA-001', title: '도구 A', slug: 'a', health: '돌고 있음',
    handed_to_dept: '재무', handed_to_person: '합성 담당자', handed_at: '2026-01-01', runs: 1, rowsOut: 1,
    failedRuns: 0, recentRuns: 1, daily_limit: 10, max_file_mb: 5 }],
    summary: { total: 1, running: 1, totalRuns: 1, totalFailed: 0, idle: 0, unconfirmed: 1, recentDays: 7 }, failures: [] }
  await show()
  getReports = () => reply({ error: '집계 조회 실패' }, 503)
  fireEvent.click(nav().getByRole('button', { name: '첫 페이지 다시 확인' }))
  await screen.findByText('집계 조회 실패')
  const tile = screen.getByText('부서가 이상하다고 한 것').closest('.stat-tile')
  expect(within(tile).getByText('미확인')).toBeTruthy()
  expect(within(tile).queryByText('0')).toBeNull()
  expect(screen.getByText('신고 목록을 확인해주세요')).toBeTruthy()
})

it('does not treat unhanded application warnings as a subset of handed-over tools', async () => {
  toolsResponse = { items: [{ application_id: 'app-a', ticket_no: 'AX-AAA-001', title: '도구 A', slug: 'a', health: '돌고 있음',
    handed_to_dept: '재무', handed_to_person: '합성 담당자', handed_at: '2026-01-01', runs: 1, rowsOut: 1,
    failedRuns: 0, recentRuns: 1, daily_limit: 10, max_file_mb: 5 }],
    summary: { total: 1, running: 1, totalRuns: 1, totalFailed: 0, idle: 0, unconfirmed: 1, recentDays: 7 }, failures: [] }
  await show()
  const value = feed()
  const second = value.tools[0].reports.pop()
  value.tools.push({ applicationId: 'app-b', ticket_no: 'AX-BBB-002', dept: '재무', slug: null, toolTitle: '인계 전 기능 B',
    total: 1, open: 1, urgent: 1, fixed: 0, reports: [second] })
  Object.assign(value.tools[0], { total: 204, open: 199, urgent: 199 })
  value.summary.toolsUntrusted = 2
  getReports = () => reply(value)
  fireEvent.click(nav().getByRole('button', { name: '첫 페이지 다시 확인' }))
  await screen.findByText('인계 전 기능 B')
  const tile = screen.getByText('넘긴 도구').closest('.stat-tile')
  expect(within(tile).getByText('1')).toBeTruthy()
  expect(within(tile).getByText('돌고 있는 것 1개')).toBeTruthy()
  expect(within(tile).queryByText(/그중 2개/)).toBeNull()
})

it('a confirmed fix supersedes an already-pending same-page read with fresh first-page GET', async () => {
  await show(); const form = await editFix(), write = deferred(), oldRead = deferred()
  postReply = () => write.promise
  fireEvent.submit(form); await waitFor(() => expect(writes()).toHaveLength(1))
  getReports = () => oldRead.promise
  fireEvent.click(nav().getByRole('button', { name: '첫 페이지 다시 확인' }))
  await waitFor(() => expect(reads()).toHaveLength(2))
  getReports = () => reply(feed(1, { basis: NEXT_BASIS, prefix: '저장 후 최신 원문' }))
  await release(write, reply({ ok: true, id: `dec_${'a'.repeat(20)}`, reportId: 'r1', author: 'AX 담당자' }))
  await screen.findByText('저장 후 최신 원문 1')
  expect(reads()).toHaveLength(3)
  await release(oldRead, reply(feed()))
  expect(screen.queryByText('신고 원문 1')).toBeNull()
  expect(screen.getByText('저장 후 최신 원문 1')).toBeTruthy()
})

it.each(['/reports', '/bugs'])('late confirmed %s write cannot reset a new account feed or toast', async endpoint => {
  await show(endpoint === '/reports' ? '/tools' : '/bug', { gated: true })
  const held = deferred(); postReply = () => held.promise
  if (endpoint === '/reports') fireEvent.submit(await editFix())
  else {
    fireEvent.change(screen.getByLabelText(/어느 기능/), { target: { value: 'app-a' } })
    fireEvent.change(screen.getByLabelText(/무슨 일이/), { target: { value: 'wrong_number' } })
    fireEvent.change(screen.getByLabelText(/자세히/), { target: { value: '원래 계정 신고 내용입니다' } })
    fireEvent.change(screen.getByLabelText(/누구신지/), { target: { value: '합성 작성자' } })
    fireEvent.click(screen.getByRole('button', { name: '신고하기' }))
  }
  await waitFor(() => expect(writes()).toHaveLength(1))
  getReports = () => reply(feed(1, { basis: NEXT_BASIS, prefix: '다른 계정 원문' }))
  await act(async () => { completeAccessCheck(beginAccessCheck(), { ok: true, mode: 'demo', scope: 'b'.repeat(64) }) })
  await screen.findByText('다른 계정 원문 1')
  if (endpoint === '/bugs') fireEvent.change(screen.getByLabelText(/자세히/), { target: { value: '새 계정 보존할 초안' } })
  const before = reads().length
  await release(held, reply({ ok: true, id: `dec_${'a'.repeat(20)}`, ticket_no: 'AX-AAA-001' }))
  expect(successes()).toEqual([]); expect(errors()).toEqual([]); expect(reads()).toHaveLength(before)
  if (endpoint === '/bugs') expect(screen.getByLabelText(/자세히/).value).toBe('새 계정 보존할 초안')
})

it('a confirmed bug write stays successful when the follow-up list GET fails', async () => {
  await show('/bug')
  fireEvent.change(screen.getByLabelText(/어느 기능/), { target: { value: 'app-a' } })
  fireEvent.change(screen.getByLabelText(/무슨 일이/), { target: { value: 'wrong_number' } })
  fireEvent.change(screen.getByLabelText(/자세히/), { target: { value: '금액 오류가 발생했습니다' } })
  fireEvent.change(screen.getByLabelText(/누구신지/), { target: { value: '합성 작성자' } })
  getReports = () => reply({ error: '저장 뒤 조회 불가' }, 503)
  fireEvent.click(screen.getByRole('button', { name: '신고하기' }))
  await screen.findByText('저장 뒤 조회 불가')
  expect(successes()).toHaveLength(1); expect(errors()).toEqual([]); expect(writes()).toHaveLength(1)
  expect(screen.getByLabelText(/자세히/).value).toBe('')
})

it.each(['missing originals', 'duplicate application', 'duplicate original', 'excess page open', 'excess page urgent', 'excess page fixed', 'impossible untrusted tools', 'app counts exceed global', 'missing global warnings'])('rejects %s as an uncertain list rather than a usable partial success', async fault => {
  await show()
  const value = feed()
  if (fault === 'missing originals') value.tools = []
  if (fault === 'duplicate application') value.tools = [{ ...value.tools[0], reports: value.tools[0].reports.slice(0, 50) }, { ...value.tools[0], reports: value.tools[0].reports.slice(50) }]
  if (fault === 'duplicate original') value.tools[0].reports[1] = { ...value.tools[0].reports[0] }
  if (fault === 'excess page open') Object.assign(value.tools[0], { open: 1, urgent: 1, fixed: 204 })
  if (fault === 'excess page urgent') value.tools[0].urgent = 1
  if (fault === 'excess page fixed') value.tools[0].reports = value.tools[0].reports.map(r => ({ ...r, open: false, fix: { how: '고침', why: '근거' } }))
  if (fault === 'impossible untrusted tools') value.summary.toolsUntrusted = value.summary.urgent + 1
  if (fault === 'missing global warnings') value.summary.toolsUntrusted = 0
  if (fault === 'app counts exceed global') value.tools = [
    { ...value.tools[0], reports: value.tools[0].reports.slice(0, 50) },
    { ...value.tools[0], applicationId: 'app-b', reports: value.tools[0].reports.slice(50) },
  ]
  getReports = () => reply(value)
  fireEvent.click(nav().getByRole('button', { name: '첫 페이지 다시 확인' }))
  await screen.findByText('신고 목록 응답을 확인하지 못했습니다. 다시 조회해주세요.')
  expect(document.querySelectorAll('.report-item')).toHaveLength(0)
  expect(screen.queryByText('아직 들어온 신고가 없습니다.')).toBeNull()
  expect(writes()).toHaveLength(0)
})
