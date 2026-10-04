// @vitest-environment happy-dom
// Real client/useApi/session gate and tab queue; only HTTP and unrelated UI are synthetic.
import { webcrypto } from 'node:crypto'
import { act, StrictMode } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import BetaPage from '../src/pages/BetaPage.jsx'
import WorkspaceGate from '../src/components/WorkspaceGate.jsx'
import { beginAccessCheck, completeAccessCheck } from '../src/lib/accessSession.js'
import { forgetBetaRound, keepBetaRound, pendingBetaRound } from '../src/lib/pendingBetaRounds.js'
import { betaRoundPayload } from '../functions/_lib/betaRound.js'

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }))
vi.mock('../src/context/ToastContext.jsx', () => ({ useToast: () => toast }))
vi.mock('../src/components/HandoverPanel.tsx', () => ({ default: () => null }))
const SCOPE = 'a'.repeat(64), APP = 'beta-receipt-app'
const confirmed = overall => ({ ok: true, round_id: `bta_${'a'.repeat(32)}`, seq: 1, overall: overall ?? '통과' })
const reply = (body, status = 200) => Response.json(body, { status })
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
let payload, calls, respond, readResponse, serverScope
const posts = () => calls.filter(call => call.method === 'POST')
const reads = () => calls.filter(call => call.method === 'GET' && call.path.endsWith('/beta'))
const data = () => ({ application: { id: APP, dept: '합성 부서' }, canTest: true, runScope: serverScope, criteriaRevision: 1,
  criteria: [{ id: 'criterion', body: '확인할 기준' }], rounds: [], latestResults: [], feedback: [], latestBuild: null, signoff: {} })
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal('crypto', webcrypto)
  serverScope = SCOPE; calls = []; readResponse = () => reply(data()); respond = () => reply(confirmed())
  completeAccessCheck(beginAccessCheck(), { ok: true, mode: 'demo', scope: SCOPE })
  payload = { kind: 'round', run_id: crypto.randomUUID(), run_scope: SCOPE, criteria_revision: 1,
    graded: [{ id: 'criterion', ord: 0, body: '확인할 기준', kind: 'rule', check_key: null, is_required_safety: 1, verdict: '판정불가', evidence: '대조 근거 없음', samples: [] }],
    summary: { overall: '조건부', durationMs: 123 }, fixed_what: '보존해야 할 채점 근거' }
  expect(betaRoundPayload(payload)).not.toBeNull()
  keepBetaRound(SCOPE, APP, { payload, error: '앞선 응답 유실', criteriaChanged: false })
  vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
    const path = new URL(String(url), 'https://local.invalid').pathname, method = options.method ?? 'GET'
    calls.push({ path, method, body: options.body, key: new Headers(options.headers).get('X-Idempotency-Key') })
    if (method === 'POST') return respond()
    if (path === '/api/demo/workspace') return reply({ enabled: false })
    if (path === '/api/session') return reply({ ok: true, mode: 'demo', scope: serverScope })
    if (path === '/api/applications') return reply({ items: [{ id: APP, status: '수용', dept: '합성 부서', title: '합성 채점' }] })
    if (path === `/api/applications/${APP}/beta`) return readResponse()
    throw Error('Unexpected synthetic path ' + path)
  }))
})
afterEach(() => { cleanup(); forgetBetaRound(SCOPE, APP); forgetBetaRound('b'.repeat(64), APP); vi.unstubAllGlobals() })
async function show() {
  const view = render(<StrictMode><MemoryRouter><WorkspaceGate><BetaPage /></WorkspaceGate></MemoryRouter></StrictMode>)
  await screen.findByRole('button', { name: '같은 채점 기록 다시 저장' })
  return view
}
function submit() { fireEvent.click(screen.getByRole('button', { name: '같은 채점 기록 다시 저장' })) }

it.each([
  ['null', null], ['empty object', {}], ['array', []], ['false ok', { ...confirmed(), ok: false }],
  ['missing id', { ...confirmed(), round_id: undefined }], ['legacy id', { ...confirmed(), round_id: 'legacy-round' }],
  ['short id', { ...confirmed(), round_id: `bta_${'a'.repeat(20)}` }], ['zero seq', { ...confirmed(), seq: 0 }],
  ['fractional seq', { ...confirmed(), seq: 1.5 }], ['string seq', { ...confirmed(), seq: '1' }],
  ['unsafe seq', { ...confirmed(), seq: Number.MAX_SAFE_INTEGER + 1 }], ['missing verdict', { ...confirmed(), overall: undefined }],
  ['unknown verdict', { ...confirmed(), overall: '성공' }],
])('keeps the exact pending judgement and retry for malformed success: %s', async (_name, malformed) => {
  await show(); const before = reads().length
  respond = () => reply(malformed); submit()
  await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1))
  expect(pendingBetaRound(SCOPE, APP)?.payload).toBe(payload)
  expect(screen.getByRole('button', { name: '파일 넣고 시험 시작' }).disabled).toBe(true)
  expect(reads()).toHaveLength(before)
  expect(toast.success).not.toHaveBeenCalled(); expect(toast.info).not.toHaveBeenCalled()
  respond = () => reply(confirmed('조건부')); submit()
  await waitFor(() => expect(pendingBetaRound(SCOPE, APP)).toBeNull())
  expect(posts()).toHaveLength(2)
  expect(posts()[1].body).toBe(posts()[0].body)
  expect(posts()[1].key).toBe(posts()[0].key)
  expect(JSON.parse(posts()[1].body).run_id).toBe(payload.run_id)
  expect(toast.info).toHaveBeenCalledWith('일부 기준이 통과하지 못했습니다.')
})

it.each(['통과', '조건부', '차단'])('accepts the authoritative server verdict %s without comparing the local claim', async overall => {
  await show(); respond = () => reply(confirmed(overall)); submit()
  await waitFor(() => expect(pendingBetaRound(SCOPE, APP)).toBeNull())
  expect(posts()).toHaveLength(1)
  expect(screen.queryByRole('button', { name: '같은 채점 기록 다시 저장' })).toBeNull()
  expect(toast.success.mock.calls.length + toast.error.mock.calls.length + toast.info.mock.calls.length).toBe(1)
})

it('keeps transport failure pending and never treats it as a failed judgement', async () => {
  await show(); respond = () => reply({ error: '합성 503' }, 503); submit()
  await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1))
  expect(pendingBetaRound(SCOPE, APP)?.payload).toBe(payload)
  expect(toast.info).not.toHaveBeenCalled()
})

it('only explicit unsaved criteria changes permit forgetting the prior judgement', async () => {
  await show(); respond = () => reply({ error: '기준 변경', code: 'BETA_CRITERIA_CHANGED', notSaved: true }, 409); submit()
  fireEvent.click(await screen.findByRole('button', { name: '현재 기준으로 다시 준비' }))
  await waitFor(() => expect(pendingBetaRound(SCOPE, APP)).toBeNull())
  expect(posts()).toHaveLength(1); expect(toast.success).not.toHaveBeenCalled()
})

it('keeps confirmed storage distinct from a failed GET and retries only GET', async () => {
  await show(); readResponse = () => reply({ error: '확정 후 조회 실패' }, 503); submit()
  await screen.findByText(/확정 후 조회 실패/)
  expect(pendingBetaRound(SCOPE, APP)).toBeNull(); expect(posts()).toHaveLength(1)
  readResponse = () => reply(data())
  fireEvent.click(screen.getByRole('button', { name: '상태 다시 확인' }))
  await waitFor(() => expect(screen.queryByText(/확정 후 조회 실패/)).toBeNull())
  expect(posts()).toHaveLength(1)
})

it('does not impose the new POST receipt identity on legacy GET round records', async () => {
  readResponse = () => reply({ ...data(), rounds: [{ id: 'old-beta-reference', seq: 1, overall: '조건부', failed: 1,
    passed: 0, safety_failed: 0, human_needed: 0, fixed_what: '기존 판정의 참고 기록', duration_ms: 1, created_at: '2026-01-01 00:00:00' }] })
  await show()
  expect(screen.getByText('기존 판정의 참고 기록')).toBeTruthy()
  expect(posts()).toHaveLength(0)
  expect(pendingBetaRound(SCOPE, APP)?.payload).toBe(payload)
})

it('does not clear the old account queue or show its late success in a different account', async () => {
  await show(); const held = deferred(); respond = () => held.promise; submit()
  await waitFor(() => expect(posts()).toHaveLength(1))
  await act(async () => { serverScope = 'b'.repeat(64); completeAccessCheck(beginAccessCheck(), { ok: true, mode: 'demo', scope: serverScope }) })
  await act(async () => { held.resolve(reply(confirmed())); await held.promise })
  expect(pendingBetaRound(SCOPE, APP)?.payload).toBe(payload)
  expect(toast.success).not.toHaveBeenCalled(); expect(toast.info).not.toHaveBeenCalled()
  expect(screen.queryByRole('button', { name: '같은 채점 기록 다시 저장' })).toBeNull()
})
