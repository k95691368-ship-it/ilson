// @vitest-environment happy-dom
// Actual client, useApi and access gate; all HTTP evidence is synthetic.
import { webcrypto } from 'node:crypto'
import { act, StrictMode } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom'
import ToolsPage from '../src/pages/ToolsPage.jsx'
import WorkspaceGate from '../src/components/WorkspaceGate.jsx'
import { ToastProvider } from '../src/context/ToastContext.jsx'
import { beginAccessCheck, completeAccessCheck } from '../src/lib/accessSession.js'

const VERSION = 'c'.repeat(64), CHANGED = 'd'.repeat(64), ID = 'legacy-report-1'
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
const reply = (body, status = 200) => Response.json(body, { status })
const receipt = () => ({ ok: true, id: `dec_${'a'.repeat(20)}`, reportId: ID, author: '서버 작성자' })
function feed({ version = VERSION, basis = 'a'.repeat(64), fixed = false, body = '확인해야 하는 원신고' } = {}) {
  return { tools: [{ applicationId: 'app-a', ticket_no: 'AX-AAA-001', dept: '재무', toolTitle: '도구 A', slug: null,
    total: 1, open: fixed ? 0 : 1, urgent: fixed ? 0 : 1, fixed: fixed ? 1 : 0,
    reports: [{ id: ID, version, code: 'wrong_number', label: '숫자가 다름', body, reporter: '원신고 작성자', at: '2026-01-01', open: !fixed, urgent: true,
      fix: fixed ? { how: '다른 담당자의 수정', why: '다른 담당자의 원인', at: '2026-10-04' } : null }] }],
  summary: { total: 1, open: fixed ? 0 : 1, urgent: fixed ? 0 : 1, fixed: fixed ? 1 : 0, toolsUntrusted: fixed ? 0 : 1 },
  page: { number: 1, size: 100, total: 1, totalPages: 1, hasPrevious: false, hasMore: false, basis } }
}
let calls, response, readResponse
const writes = () => calls.filter(c => c.method === 'POST')
const reads = () => calls.filter(c => c.path === '/api/reports' && c.method === 'GET')
const success = () => document.querySelectorAll('.toast-success')
beforeEach(() => {
  calls = []; response = () => reply(receipt()); readResponse = () => reply(feed())
  vi.stubGlobal('crypto', webcrypto)
  completeAccessCheck(beginAccessCheck(), { ok: true, mode: 'demo', scope: 'a'.repeat(64) })
  vi.stubGlobal('fetch', vi.fn(async (input, options = {}) => {
    const path = new URL(String(input), 'https://local.invalid').pathname, method = options.method ?? 'GET'
    calls.push({ path, method, body: options.body, key: new Headers(options.headers).get('X-Idempotency-Key') })
    if (method === 'POST') return response()
    if (path === '/api/demo/workspace') return reply({ enabled: false })
    if (path === '/api/session') return reply({ ok: true, mode: 'demo', scope: 'a'.repeat(64) })
    if (path === '/api/tools') return reply({ items: [], summary: { total: 0 }, failures: [] })
    if (path === '/api/codes') return reply({ summary: { needsCheck: 0 } })
    if (path === '/api/reports') return readResponse()
    throw Error('Unexpected synthetic request ' + path)
  }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
async function show() {
  render(<StrictMode><MemoryRouter initialEntries={['/tools']}><WorkspaceGate><ToastProvider>
    <Link to="/other">다른 화면</Link><Routes><Route path="/tools" element={<ToolsPage />} /><Route path="/other" element={<p>다른 화면 본문</p>} /></Routes>
  </ToastProvider></WorkspaceGate></MemoryRouter></StrictMode>)
  await screen.findByText('확인해야 하는 원신고')
}
function edit() {
  fireEvent.click(screen.getByRole('button', { name: '처리했다고 남기기' }))
  const how = screen.getByLabelText(/무엇을 하셨습니까/), why = screen.getByLabelText(/왜 그랬던 것입니까/)
  fireEvent.change(how, { target: { value: '컬럼 누락 검사를 고쳤습니다' } })
  fireEvent.change(why, { target: { value: '필수 컬럼 검증이 빠져 있었습니다' } })
  return { how, why, form: how.closest('form') }
}
async function settle(held, value) { await act(async () => { held.resolve(value); await held.promise }) }
async function failed() { await waitFor(() => expect(document.querySelector('.toast-error')).not.toBeNull()) }

it('freezes the GET source version and one UUID/body with synchronous native pending lock', async () => {
  await show(); const { how, why, form } = edit(), held = deferred(); response = () => held.promise
  expect(how.maxLength).toBe(2000); expect(why.maxLength).toBe(2000)
  act(() => { fireEvent.submit(form); fireEvent.submit(form) })
  await waitFor(() => expect(writes()).toHaveLength(1))
  expect(form.querySelector('fieldset').disabled).toBe(true)
  expect(how.matches(':disabled')).toBe(true)
  expect(JSON.parse(writes()[0].body)).toMatchObject({ reportId: ID, expectedVersion: VERSION, how: how.value, why: why.value })
  expect(writes()[0].key).toMatch(/^[a-f0-9-]{36}$/)
  await settle(held, reply(receipt()))
  await waitFor(() => expect(success()).toHaveLength(1))
})

it.each(['network','503','malformed'])('keeps the exact intent after %s and 31 minutes instead of recalculating a key', async failure => {
  await show(); const { how, why, form } = edit()
  response = () => { if (failure === 'network') throw Error('lost reply'); return reply(failure === '503' ? { error: 'temporarily unavailable' } : {}, failure === '503' ? 503 : 200) }
  fireEvent.submit(form); await failed()
  expect(how.matches(':disabled')).toBe(true); expect(why.matches(':disabled')).toBe(true)
  const first = writes()[0], before = reads().length, now = Date.now()
  vi.spyOn(Date, 'now').mockReturnValue(now + 31 * 60000)
  response = () => reply(receipt())
  fireEvent.submit(form)
  await waitFor(() => expect(success()).toHaveLength(1))
  expect(writes()).toHaveLength(2)
  expect(writes()[1].body).toBe(first.body); expect(writes()[1].key).toBe(first.key)
  expect(reads()).toHaveLength(before + 1)
})

it('keeps a conflict draft with no automatic GET, rebase, retry or new intent', async () => {
  await show(); const { how, form } = edit(), before = reads().length
  response = () => reply({ error: '신고 내용이 바뀌었습니다.', code: 'REPORT_SOURCE_CHANGED' }, 409)
  fireEvent.submit(form); await failed()
  expect(how.value).toBe('컬럼 누락 검사를 고쳤습니다')
  expect(how.matches(':disabled')).toBe(true)
  const link = screen.getByRole('link', { name: '현재 기록 보기 (새 탭)' })
  expect(link.getAttribute('href')).toBe('/record/AX-AAA-001'); expect(link.getAttribute('target')).toBe('_blank')
  expect(link.getAttribute('rel')).toContain('noopener')
  fireEvent.submit(form)
  expect(writes()).toHaveLength(1); expect(reads()).toHaveLength(before)
  expect(success()).toHaveLength(0)
})

it('allows correction after a first definitive 400 but never reuses the invalid command key', async () => {
  await show(); const { how, form } = edit()
  response = () => reply({ error: '내용을 확인해주세요.', fields: { how: '구체적으로 적어주세요.' }, notSaved: true }, 400)
  fireEvent.submit(form); await failed()
  expect(how.matches(':disabled')).toBe(false)
  const first = writes()[0]
  fireEvent.change(how, { target: { value: '다시 확인한 구체적인 수정 내용' } })
  response = () => reply(receipt()); fireEvent.submit(form)
  await waitFor(() => expect(success()).toHaveLength(1))
  expect(writes()[1].key).not.toBe(first.key)
  expect(JSON.parse(writes()[1].body)).toMatchObject({ expectedVersion: VERSION, how: '다시 확인한 구체적인 수정 내용' })
})

it('does not discard an earlier uncertain intent merely because a retry returns notSaved 400', async () => {
  await show(); const { how, form } = edit()
  response = () => reply({ error: 'lost confirmation' }, 503)
  fireEvent.submit(form); await failed()
  response = () => reply({ error: 'later validation', fields: { how: 'later field message' }, notSaved: true }, 400)
  fireEvent.submit(form); await screen.findByText('later field message')
  expect(how.matches(':disabled')).toBe(true)
  response = () => reply(receipt()); fireEvent.submit(form)
  await waitFor(() => expect(success()).toHaveLength(1))
  expect(writes()).toHaveLength(3)
  expect(new Set(writes().map(x => x.key)).size).toBe(1)
  expect(new Set(writes().map(x => x.body)).size).toBe(1)
})

it.each([{ ok: true, id: `dec_${'a'.repeat(20)}`, reportId: 'other', author: 'server' },
  { ok: true, id: `dec_${'a'.repeat(20)}`, reportId: ID, author: {} }, { ok: true, id: 'bad', reportId: ID, author: 'server' }])('does not confirm a mismatched receipt %j', async value => {
  await show(); const { form } = edit(), before = reads().length
  response = () => reply(value); fireEvent.submit(form); await failed()
  expect(success()).toHaveLength(0); expect(reads()).toHaveLength(before)
})

it.each([false,true])('retains original source/draft and blocks late effects when the current source/fix changes: %s', async fixed => {
  await show(); const { how, form } = edit(), held = deferred(); response = () => held.promise
  fireEvent.submit(form); await waitFor(() => expect(writes()).toHaveLength(1))
  readResponse = () => reply(feed({ body: '새롭게 바뀐 원문', basis: 'b'.repeat(64), version: fixed ? VERSION : CHANGED, fixed }))
  fireEvent.click(screen.getByRole('button', { name: '첫 페이지 다시 확인' }))
  await screen.findByText(/작성 중인 신고 기록이 바뀌었습니다/)
  expect(screen.getByText('확인해야 하는 원신고')).toBeTruthy()
  expect(screen.queryByText('새롭게 바뀐 원문')).toBeNull()
  expect(how.value).toBe('컬럼 누락 검사를 고쳤습니다')
  const count = reads().length
  await settle(held, reply(receipt()))
  expect(success()).toHaveLength(0); expect(reads()).toHaveLength(count)
  expect(screen.getByLabelText(/무엇을 하셨습니까/).value).toBe(how.value)
  fireEvent.submit(form); expect(writes()).toHaveLength(1)
})

it('keeps confirmed POST separate from a failing refresh and cannot post it again', async () => {
  await show(); const { form } = edit()
  readResponse = () => reply({ error: '저장 후 조회 실패' }, 503)
  fireEvent.submit(form)
  await screen.findByText('저장 후 조회 실패')
  expect(success()).toHaveLength(1)
  expect(document.querySelectorAll('.toast-error')).toHaveLength(0)
  expect(screen.getByText(/처리 기록 저장 확인/)).toBeTruthy()
  readResponse = () => reply(feed())
  fireEvent.click(screen.getByRole('button', { name: '신고 목록 다시 조회' }))
  await waitFor(() => expect(screen.queryByText('저장 후 조회 실패')).toBeNull())
  expect(screen.queryByRole('button', { name: '처리했다고 남기기' })).toBeNull()
  expect(writes()).toHaveLength(1)
})

it('does not present a past receipt as confirmation of a newly changed original', async () => {
  await show(); const { form } = edit()
  readResponse = () => reply(feed({ version: CHANGED, basis: 'b'.repeat(64), body: '저장 확인 뒤 달라진 신고 원문' }))
  fireEvent.submit(form)
  await screen.findByText('저장 확인 뒤 달라진 신고 원문')
  expect(screen.getByText('이전 판본의 처리 기록 저장 확인 · 서버 작성자')).toBeTruthy()
  expect(screen.queryByText('처리 기록 저장 확인 · 서버 작성자')).toBeNull()
  expect(screen.getByRole('link', { name: '현재 기록 보기 (새 탭)' }).getAttribute('target')).toBe('_blank')
  expect(writes()).toHaveLength(1)
})

it.each(['route','account'])('suppresses a late confirmed reply after %s changes', async change => {
  await show(); const { form } = edit(), held = deferred(); response = () => held.promise
  fireEvent.submit(form); await waitFor(() => expect(writes()).toHaveLength(1))
  if (change === 'route') fireEvent.click(screen.getByRole('link', { name: '다른 화면' }))
  else {
    readResponse = () => reply(feed({ body: '다른 계정 원문' }))
    await act(async () => { completeAccessCheck(beginAccessCheck(), { ok: true, mode: 'demo', scope: 'b'.repeat(64) }) })
    await screen.findByText('다른 계정 원문')
  }
  const count = reads().length
  await settle(held, reply(receipt()))
  expect(success()).toHaveLength(0); expect(reads()).toHaveLength(count)
  expect(screen.queryByText('확인해야 하는 원신고')).toBeNull()
})

it.each([undefined, '', 'A'.repeat(64), 'x'.repeat(64), VERSION + '\n', 123])('fails closed when report version is not a lowercase hash: %j', async version => {
  const value = feed(); value.tools[0].reports[0].version = version
  readResponse = () => reply(value)
  render(<MemoryRouter><ToastProvider><ToolsPage /></ToastProvider></MemoryRouter>)
  await screen.findByText('신고 목록 응답을 확인하지 못했습니다. 다시 조회해주세요.')
  expect(screen.queryByRole('button', { name: '처리했다고 남기기' })).toBeNull()
  expect(writes()).toHaveLength(0)
})
