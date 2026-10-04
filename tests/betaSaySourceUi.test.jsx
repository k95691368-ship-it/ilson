// @vitest-environment happy-dom
// Real client, useApi, action lifetime, session gate; synthetic HTTP only.
import { webcrypto } from 'node:crypto'
import { act, StrictMode } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { BetaSay } from '../src/pages/TrackPage.jsx'
import WorkspaceGate from '../src/components/WorkspaceGate.jsx'
import { beginAccessCheck, completeAccessCheck } from '../src/lib/accessSession.js'
import { validBetaRoundId, validSavedBetaRound } from '../shared/betasay.js'

const reply = (body, status = 200) => Response.json(body, { status })
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
const base = (seq = 1) => ({ state: { canSay: true, round: { id: `legacy-round-${seq}`, seq, overall: '통과' }, total: 0, open: 0, answered: 0, says: [] } })
const saved = (seq = 1, current = seq) => ({ ...base(current), ok: true, savedRound: { id: `legacy-round-${seq}`, seq }, message: `시험판 ${seq}차에 의견을 기록했습니다.` })
let calls, currentData, respond, onDone
const posts = () => calls.filter(x => x.method === 'POST')
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto)
  calls = []; currentData = base(); respond = () => reply(saved()); onDone = vi.fn()
  completeAccessCheck(beginAccessCheck(), { ok: true, mode: 'demo', scope: 'a'.repeat(64) })
  vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
    const path = new URL(String(url), 'https://local.invalid').pathname, method = options.method ?? 'GET'
    calls.push({ path, method, body: options.body, key: new Headers(options.headers).get('X-Idempotency-Key') })
    if (path === '/api/demo/workspace') return reply({ enabled: false })
    if (path === '/api/session') return reply({ ok: true, mode: 'demo', scope: 'a'.repeat(64) })
    if (method === 'POST') return respond(JSON.parse(options.body))
    return reply(currentData)
  }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
function Tree({ ticket = 'AX-A' }) { return <WorkspaceGate><BetaSay key={ticket} ticket={ticket} onDone={onDone} /></WorkspaceGate> }
async function show() {
  const view = render(<StrictMode><Tree /></StrictMode>)
  await screen.findByRole('button', { name: '써 보고 느낀 것 적기' })
  return view
}
function openAndFill() {
  fireEvent.click(screen.getByRole('button', { name: '써 보고 느낀 것 적기' }))
  fireEvent.change(screen.getByLabelText(/^무슨 일이 있었습니까/), { target: { value: '1차 시험에서 정산 숫자가 달랐습니다.' } })
  fireEvent.change(screen.getByLabelText('적어주신 분'), { target: { value: '김직원' } })
  return document.querySelector('.betasay form')
}
async function release(held, response) { await act(async () => { held.resolve(response); await held.promise }) }

it('anchors the original round and describes an older receipt separately from latest state', async () => {
  await show(); const form = openAndFill(); respond = () => reply(saved(1, 2)); fireEvent.submit(form)
  await screen.findByText('시험판 1차에 의견을 기록했습니다.')
  expect(JSON.parse(posts()[0].body).expectedRoundId).toBe('legacy-round-1')
  expect(screen.getByText('시험판 2차')).toBeTruthy(); expect(onDone).toHaveBeenCalledOnce()
})

it('retains body and round through close/reopen and requires explicit discard for the new round', async () => {
  await show(); let form = openAndFill()
  respond = () => reply({ error: '회차가 변경되었습니다.', code: 'BETA_ROUND_CHANGED', notSaved: true }, 409)
  fireEvent.submit(form); await screen.findByText('회차가 변경되었습니다.')
  fireEvent.click(screen.getByRole('button', { name: '그만두기' }))
  fireEvent.click(screen.getByRole('button', { name: '써 보고 느낀 것 적기' }))
  expect(screen.getByLabelText(/^무슨 일이 있었습니까/).value).toContain('1차 시험')
  form = document.querySelector('.betasay form'); fireEvent.submit(form)
  await waitFor(() => expect(posts()).toHaveLength(2))
  expect(JSON.parse(posts()[1].body).expectedRoundId).toBe('legacy-round-1')
  currentData = base(2)
  fireEvent.click(screen.getByRole('button', { name: '초안 버리고 최신 회차 불러오기' }))
  await screen.findByText('시험판 2차')
  fireEvent.click(screen.getByRole('button', { name: '써 보고 느낀 것 적기' }))
  expect(screen.getByLabelText(/^무슨 일이 있었습니까/).value).toBe('')
  fireEvent.change(screen.getByLabelText(/^무슨 일이 있었습니까/), { target: { value: '2차 시험에서 새롭게 확인했습니다.' } })
  respond = () => reply(saved(2)); fireEvent.submit(document.querySelector('.betasay form'))
  await screen.findByText('시험판 2차에 의견을 기록했습니다.')
  expect(JSON.parse(posts()[2].body).expectedRoundId).toBe('legacy-round-2')
})

it.each([{}, { ...saved(), savedRound: null }, saved(2), { ...saved(), ok: false }])('does not clear or retarget a draft for malformed success %#', async response => {
  await show(); const form = openAndFill(); respond = () => reply(response); fireEvent.submit(form)
  await screen.findByRole('alert')
  expect(screen.getByLabelText(/^무슨 일이 있었습니까/).value).toContain('1차 시험')
  expect(onDone).not.toHaveBeenCalled()
  respond = () => reply(saved(1, 2)); fireEvent.submit(form)
  await screen.findByText('시험판 1차에 의견을 기록했습니다.')
  expect(posts()[1].key).toBe(posts()[0].key); expect(posts()[1].body).toBe(posts()[0].body)
})

it('retries response loss against the same round/key without admitting a new draft', async () => {
  await show(); const form = openAndFill(); respond = () => reply({ error: '저장 후 조회 실패' }, 503); fireEvent.submit(form)
  await screen.findByText('저장 후 조회 실패')
  expect(screen.getByLabelText(/^무슨 일이 있었습니까/).closest('fieldset').disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: '그만두기' }))
  fireEvent.click(screen.getByRole('button', { name: '써 보고 느낀 것 적기' }))
  respond = () => reply(saved(1, 2)); fireEvent.submit(document.querySelector('.betasay form'))
  await screen.findByText('시험판 1차에 의견을 기록했습니다.')
  expect(posts()[1].key).toBe(posts()[0].key); expect(posts()[1].body).toBe(posts()[0].body)
})

it('locks native inputs and duplicate submission synchronously', async () => {
  await show(); const form = openAndFill(), held = deferred(); respond = () => held.promise
  act(() => { fireEvent.submit(form); fireEvent.submit(form) })
  await waitFor(() => expect(posts()).toHaveLength(1))
  expect(screen.getByLabelText('적어주신 분').closest('fieldset').disabled).toBe(true)
  expect(screen.getByRole('button', { name: '그만두기' }).disabled).toBe(true)
  await release(held, reply(saved())); await screen.findByText('시험판 1차에 의견을 기록했습니다.')
})

it('allows explicit recovery after response loss followed by the specific not-saved round rejection', async () => {
  await show(); const form = openAndFill(); respond = () => reply({ error: '일시 응답 실패' }, 503); fireEvent.submit(form)
  await screen.findByText('일시 응답 실패')
  respond = () => reply({ error: '이 회차에는 새로 기록하지 않았습니다.', code: 'BETA_ROUND_CHANGED', notSaved: true }, 409)
  fireEvent.submit(form); await screen.findByText('이 회차에는 새로 기록하지 않았습니다.')
  expect(screen.getByLabelText(/^무슨 일이 있었습니까/).closest('fieldset').disabled).toBe(false)
  expect(screen.getByRole('button', { name: '초안 버리고 최신 회차 불러오기' }).disabled).toBe(false)
  expect(screen.getByLabelText(/^무슨 일이 있었습니까/).value).toContain('1차 시험')
})

it('does not unlock an uncertain intent on an unrelated or unconfirmed conflict', async () => {
  await show(); const form = openAndFill(); respond = () => reply({ error: '일시 응답 실패' }, 503); fireEvent.submit(form)
  await screen.findByText('일시 응답 실패')
  respond = () => reply({ error: '다른 충돌입니다.', code: 'BETA_ROUND_CHANGED' }, 409)
  fireEvent.submit(form); await screen.findByText('다른 충돌입니다.')
  expect(screen.getByLabelText(/^무슨 일이 있었습니까/).closest('fieldset').disabled).toBe(true)
  expect(screen.getByRole('button', { name: '초안 버리고 최신 회차 불러오기' }).disabled).toBe(true)
})

it('ignores a prior session save response after WorkspaceGate closes and reopens the work area', async () => {
  await show(); const form = openAndFill(), held = deferred(); respond = () => held.promise; fireEvent.submit(form)
  await waitFor(() => expect(posts()).toHaveLength(1))
  await act(async () => { completeAccessCheck(beginAccessCheck(), { ok: true, mode: 'demo', scope: 'b'.repeat(64) }) })
  await screen.findByRole('button', { name: '써 보고 느낀 것 적기' }); openAndFill()
  await release(held, reply(saved()))
  expect(screen.queryByText('시험판 1차에 의견을 기록했습니다.')).toBeNull()
  expect(screen.getByLabelText(/^무슨 일이 있었습니까/).value).toContain('1차 시험'); expect(onDone).not.toHaveBeenCalled()
})

it('discards late A save effects after A-B-A without clearing the replacement draft', async () => {
  const view = await show(); const form = openAndFill(), held = deferred(); respond = () => held.promise; fireEvent.submit(form)
  await waitFor(() => expect(posts()).toHaveLength(1))
  view.rerender(<Tree ticket="AX-B" />); await screen.findByRole('button', { name: '써 보고 느낀 것 적기' })
  view.rerender(<Tree />); await screen.findByRole('button', { name: '써 보고 느낀 것 적기' }); openAndFill()
  await release(held, reply(saved()))
  expect(screen.getByLabelText(/^무슨 일이 있었습니까/).value).toContain('1차 시험')
  expect(screen.queryByText('시험판 1차에 의견을 기록했습니다.')).toBeNull(); expect(onDone).not.toHaveBeenCalled()
})

it('accepts opaque long/astral IDs but rejects missing, blank and non-PG-storable identities', () => {
  expect(validBetaRoundId('x'.repeat(301))).toBe(true); expect(validBetaRoundId(' 🧪 round ')).toBe(true)
  for (const value of [null, undefined, 1, {}, '', '  ', '\0', '\uD800', '\uDC00']) expect(validBetaRoundId(value)).toBe(false)
  expect(validSavedBetaRound({ id: 'opaque', seq: 1 })).toBe(true)
  for (const seq of [0, -1, 1.5, '1', Infinity]) expect(validSavedBetaRound({ id: 'opaque', seq })).toBe(false)
})
