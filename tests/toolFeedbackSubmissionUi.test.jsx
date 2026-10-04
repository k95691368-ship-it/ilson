// @vitest-environment happy-dom
import { webcrypto } from 'node:crypto'
import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Link, MemoryRouter, Route, Routes, useParams } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ReportForm from '../src/components/ReportForm.jsx'
import ToolPage from '../src/pages/ToolPage.jsx'
import WorkspaceGate from '../src/components/WorkspaceGate.jsx'
import { beginAccessCheck, completeAccessCheck, getAccessSession, revokeAccess } from '../src/lib/accessSession.js'

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('../src/context/ToastContext.jsx', () => ({ useToast: () => toast }))
const SCOPE = '5'.repeat(64), OTHER = '6'.repeat(64), ID = 'dec_' + '1'.repeat(20)
const BODY = '합성 제보: 안내와 실제 결과의 차이를 확인해주세요.'
const failure = (status, more = {}) => Response.json({ error: '합성 제보 오류', ...more }, { status })
const receipt = kind => kind === 'report' ? { ok: true, id: ID, urgent: true, next: '담당자가 제보 기록을 확인합니다.' } : { ok: true, id: ID, message: '제보 기록을 저장했습니다.' }
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const tool = slug => ({ slug, runScope: scope, title: `가상 도구 ${slug}`, ticket: 'AX-DEMO-123', handedTo: { dept: '재무', person: '가상 담당자' },
  limits: { remainingToday: 3, dailyLimit: 3, maxFileMb: 10 }, recent: [], reports: [], taught: [], aliases: {}, manual: { intro: '합성 도구 안내' } })
let mode, scope, postReply, notesReply, fetcher
const posts = () => fetcher.mock.calls.filter(([, options]) => options?.method === 'POST')
const noteReads = () => fetcher.mock.calls.filter(([url, options]) => String(url).endsWith('/unclear') && options?.method !== 'POST')
function ReportRoute() { const { slug } = useParams(); return <ReportForm slug={slug} /> }
function shell(kind, strict = false) {
  const body = <MemoryRouter initialEntries={['/t/a']}><WorkspaceGate><nav><Link to="/t/a">처음 도구</Link><Link to="/t/b">다른 도구</Link></nav><Routes>
    <Route path="/t/:slug" element={kind === 'report' ? <ReportRoute /> : <ToolPage />} />
  </Routes></WorkspaceGate></MemoryRouter>
  return strict ? <StrictMode>{body}</StrictMode> : body
}
async function open(kind, strict = false) {
  const view = render(shell(kind, strict))
  fireEvent.click(await screen.findByRole('button', { name: kind === 'report' ? '이상한 점 알리기' : '이 도구가 무엇인지 — 여기 모르겠습니다' }))
  const form = screen.getByRole('form', { name: kind === 'report' ? '이상한 점 제보' : '이 도구가 무엇인지 제보' })
  if (kind === 'report') fireEvent.click(within(form).getByRole('radio', { name: /숫자가 안 맞습니다/ }))
  fireEvent.change(form.querySelector('textarea'), { target: { value: BODY } })
  if (kind === 'report' && mode === 'demo') fireEvent.change(within(form).getByRole('textbox', { name: /누가 겪으신 일입니까/ }), { target: { value: '가상 재무팀' } })
  return { view, form }
}
const submit = form => fireEvent.submit(form)
const errorShown = form => within(form).findByText(/합성 제보 오류|서버에 연결|서버 응답을 확인/)
const successShown = kind => screen.findByText(kind === 'report' ? '알려주셔서 고맙습니다' : '제보 기록을 저장했습니다.')

beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal('crypto', webcrypto)
  mode = 'demo'; scope = SCOPE
  postReply = (kind) => Response.json(receipt(kind))
  notesReply = () => Response.json({ notes: {} })
  fetcher = vi.fn(async (url, options = {}) => {
    if (url === '/api/demo/workspace') return Response.json(mode === 'demo' ? { enabled: true, active: true } : { enabled: false })
    if (url === '/api/session') return Response.json({ ok: true, mode, scope })
    const match = String(url).match(/^\/api\/tools\/(a|b)(?:\/(report|unclear|accept))?$/)
    if (!match) throw Error('Unexpected synthetic request: ' + url)
    const [, slug, kind] = match
    if (options.method === 'POST') return postReply(kind, JSON.parse(options.body), slug)
    if (kind === 'unclear') return notesReply(slug)
    if (kind === 'accept') return Response.json({ state: { canAccept: false, status: '대기' } })
    return Response.json(tool(slug))
  })
  vi.stubGlobal('fetch', fetcher)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe.each(['report', 'unclear'])('%s actual client / WorkspaceGate submission', kind => {
  it('synchronously blocks duplicate submits and input changes while one frozen command is in flight', async () => {
    const saving = deferred(); postReply = () => saving.promise
    const { form } = await open(kind, true)
    act(() => { submit(form); submit(form) })
    await waitFor(() => expect(posts()).toHaveLength(1))
    const body = JSON.parse(posts()[0][1].body)
    expect(body).toMatchObject({ body: BODY, feedback_scope: SCOPE })
    expect(body.feedback_id).toMatch(/^[a-f0-9-]{36}$/)
    expect(form.querySelector('textarea').disabled).toBe(true)
    fireEvent.change(form.querySelector('textarea'), { target: { value: '무시되어야 할 변경' } })
    expect(form.querySelector('textarea').value).toBe(BODY)
    expect(within(form).getByRole('button', { name: '그만두기' }).disabled).toBe(true)
    await act(async () => saving.resolve(Response.json(receipt(kind))))
    await successShown(kind)
  })

  it.each(['503', 'network', 'malformed'])('retains the exact intent/body after %s and does not save its text in storage', async problem => {
    const { form } = await open(kind)
    const storage = vi.spyOn(Storage.prototype, 'setItem')
    postReply = () => problem === 'network' ? Promise.reject(Error('Synthetic reply lost')) : problem === 'malformed' ? Response.json({ ok: true }) : failure(503)
    submit(form)
    await within(form).findByRole('alert')
    const first = posts()[0][1]
    expect(form.querySelector('textarea').value).toBe(BODY)
    postReply = () => Response.json(receipt(kind)); submit(form)
    await successShown(kind)
    expect(posts()[1][1].body).toBe(first.body)
    expect(posts()[1][1].headers.get('X-Idempotency-Key')).toBe(first.headers.get('X-Idempotency-Key'))
    expect(storage).not.toHaveBeenCalled()
  })

  it.each([null, [], { ok: true, id: 'bad', urgent: true, next: 'next', message: 'message' },
    { ok: true, id: ID, urgent: 'true', next: '', message: '' }, { ok: false, id: ID, urgent: true, next: 'next', message: 'message' },
  ].map(invalid => ({ invalid })))('does not retire the key for an invalid success receipt $invalid', async ({ invalid }) => {
    postReply = () => Response.json(invalid)
    const { form } = await open(kind); submit(form)
    await within(form).findByRole('alert')
    const first = posts()[0][1]
    postReply = () => Response.json(receipt(kind)); submit(form)
    await successShown(kind)
    expect(posts()[1][1].body).toBe(first.body)
    expect(posts()[1][1].headers.get('X-Idempotency-Key')).toBe(first.headers.get('X-Idempotency-Key'))
  })

  it('keeps body intent after the 30-minute transport key expires', async () => {
    const now = Date.now(), clock = vi.spyOn(Date, 'now').mockReturnValue(now)
    postReply = () => failure(503)
    const { form } = await open(kind); submit(form); await errorShown(form)
    const first = posts()[0][1]
    clock.mockReturnValue(now + 31 * 60000)
    postReply = () => Response.json(receipt(kind)); submit(form); await successShown(kind)
    expect(posts()[1][1].body).toBe(first.body)
    expect(posts()[1][1].headers.get('X-Idempotency-Key')).not.toBe(first.headers.get('X-Idempotency-Key'))
  })

  it.each([409, 429])('keeps draft and exact intent after %s instead of automatically creating another', async status => {
    postReply = () => failure(status, { code: status === 409 ? 'FEEDBACK_CONFLICT' : 'RATE_LIMITED' })
    const { form } = await open(kind); submit(form); await errorShown(form)
    expect(within(form).getByText(status === 409 ? /기존 제보와 충돌/ : /요청 횟수 한도/)).toBeTruthy()
    const first = posts()[0][1].body
    expect(form.querySelector('textarea').value).toBe(BODY)
    postReply = () => Response.json(receipt(kind)); submit(form); await successShown(kind)
    expect(posts()[1][1].body).toBe(first)
  })

  it('unlocks a first notSaved validation failure but never unlocks after an earlier uncertain attempt', async () => {
    postReply = () => failure(400, { notSaved: true, fields: { body: '합성 필드 오류' } })
    const { form } = await open(kind); submit(form)
    await within(form).findByText('합성 필드 오류')
    expect(form.querySelector('textarea').disabled).toBe(false)
    const first = JSON.parse(posts()[0][1].body).feedback_id
    postReply = () => failure(503); submit(form); await errorShown(form)
    expect(JSON.parse(posts()[1][1].body).feedback_id).not.toBe(first)
    postReply = () => failure(400, { notSaved: true, fields: { body: '합성 필드 오류' } })
    submit(form); await within(form).findByText('합성 필드 오류')
    expect(form.querySelector('textarea').disabled).toBe(true)
    expect(posts()[2][1].body).toBe(posts()[1][1].body)
  })

  it.each([401, 403, 404, 410])('hides the pending text on denied %s without presenting a false success', async status => {
    postReply = () => failure(status)
    const { form } = await open(kind); submit(form)
    await waitFor(() => expect(posts()).toHaveLength(1))
    await waitFor(() => expect(screen.queryByDisplayValue(BODY)).toBeNull())
    expect(screen.queryByRole('button', { name: '같은 제보 다시 확인' })).toBeNull()
    expect(screen.queryByText('알려주셔서 고맙습니다')).toBeNull()
    expect(screen.queryByText('제보 기록을 저장했습니다.')).toBeNull()
  })

  it('ignores late success after tool A→B→A without clearing a new draft', async () => {
    const saving = deferred(); postReply = () => saving.promise
    const { form } = await open(kind); submit(form); await waitFor(() => expect(posts()).toHaveLength(1))
    fireEvent.click(screen.getByRole('link', { name: '다른 도구' }))
    await screen.findByRole('button', { name: kind === 'report' ? '이상한 점 알리기' : '이 도구가 무엇인지 — 여기 모르겠습니다' })
    fireEvent.click(screen.getByRole('link', { name: '처음 도구' }))
    fireEvent.click(await screen.findByRole('button', { name: kind === 'report' ? '이상한 점 알리기' : '이 도구가 무엇인지 — 여기 모르겠습니다' }))
    const next = screen.getByRole('form', { name: kind === 'report' ? '이상한 점 제보' : '이 도구가 무엇인지 제보' })
    if (kind === 'report') fireEvent.click(within(next).getByRole('radio', { name: /숫자가 안 맞습니다/ }))
    fireEvent.change(next.querySelector('textarea'), { target: { value: '새 화면의 다른 제보 초안' } })
    await act(async () => saving.resolve(Response.json(receipt(kind))))
    expect(screen.getByDisplayValue('새 화면의 다른 제보 초안')).toBeTruthy()
    expect(screen.queryByText('알려주셔서 고맙습니다')).toBeNull()
    expect(screen.queryByText('제보 기록을 저장했습니다.')).toBeNull()
  })

  it('ignores late completion after an account lifetime replacement', async () => {
    const saving = deferred(); postReply = () => saving.promise
    const { form } = await open(kind); submit(form); await waitFor(() => expect(posts()).toHaveLength(1))
    scope = OTHER
    await act(async () => completeAccessCheck(beginAccessCheck(), { ok: true, mode, scope }))
    await act(async () => saving.resolve(Response.json(receipt(kind))))
    expect(screen.queryByDisplayValue(BODY)).toBeNull()
    expect(screen.queryByText('알려주셔서 고맙습니다')).toBeNull()
    expect(screen.queryByText('제보 기록을 저장했습니다.')).toBeNull()
  })

  it('lets an explicit discard preserve editable content, with a new intent only on next submit', async () => {
    postReply = () => failure(503)
    const { form } = await open(kind); submit(form); await errorShown(form)
    expect(within(form).getByText(/서버 저장은 취소되지 않으며/)).toBeTruthy()
    fireEvent.click(within(form).getByRole('button', { name: '보관을 끝내고 현재 내용 수정' }))
    expect(form.querySelector('textarea').disabled).toBe(false)
    expect(form.querySelector('textarea').value).toBe(BODY)
    postReply = () => Response.json(receipt(kind)); submit(form); await successShown(kind)
    expect(JSON.parse(posts()[1][1].body).feedback_id).not.toBe(JSON.parse(posts()[0][1].body).feedback_id)
  })

  it.each(['expired', 'backwards'])('blocks %s replay without changing the intent or deleting the visible draft', async boundary => {
    const now = Date.now(), clock = vi.spyOn(Date, 'now').mockReturnValue(now)
    postReply = () => failure(503)
    const { form } = await open(kind); submit(form); await errorShown(form)
    clock.mockReturnValue(boundary === 'expired' ? now + 7 * 24 * 60 * 60000 : now - 1)
    submit(form)
    expect(await within(form).findByText(/재시도 확인 기간이 지났거나/)).toBeTruthy()
    expect(form.querySelector('textarea').value).toBe(BODY)
    expect(within(form).getByRole('button', { name: '같은 제보 다시 확인' }).disabled).toBe(true)
    expect(posts()).toHaveLength(1)
  })

  it('does not extend the original seven-day window on a retry', async () => {
    const now = Date.now(), clock = vi.spyOn(Date, 'now').mockReturnValue(now)
    postReply = () => failure(503)
    const { form } = await open(kind); submit(form); await errorShown(form)
    clock.mockReturnValue(now + 6 * 24 * 60 * 60000)
    submit(form); await waitFor(() => expect(posts()).toHaveLength(2)); await errorShown(form)
    clock.mockReturnValue(now + 7 * 24 * 60 * 60000)
    submit(form); await within(form).findByText(/재시도 확인 기간이 지났거나/)
    expect(posts()).toHaveLength(2)
  })

  it('rejects oversized text before POST without silently truncating it', async () => {
    const { form } = await open(kind)
    const length = kind === 'report' ? 3000 : 1000
    const field = form.querySelector('textarea')
    expect(field.maxLength).toBe(length)
    fireEvent.change(field, { target: { value: '가'.repeat(length + 1) } })
    submit(form)
    await within(form).findByText(/자 이내로 적어주세요/)
    expect(field.value).toHaveLength(length + 1)
    expect(posts()).toHaveLength(0)
    fireEvent.change(field, { target: { value: '가'.repeat(length) } })
    submit(form); await successShown(kind)
    expect(JSON.parse(posts()[0][1].body).body).toHaveLength(length)
  })

  it('stays editable without POST when a safe client intent cannot be created', async () => {
    const { form } = await open(kind)
    vi.stubGlobal('crypto', { subtle: webcrypto.subtle, randomUUID: () => { throw Error('unavailable') } })
    submit(form); await within(form).findByText(/제보 확인 번호를 만들지 못했습니다/)
    expect(form.querySelector('textarea').disabled).toBe(false)
    expect(posts()).toHaveLength(0)
  })
})

it('report uses the server account in access mode without requesting a reporter name', async () => {
  mode = 'access'
  const { form } = await open('report')
  expect(within(form).queryByRole('textbox', { name: /누가 겪으신 일입니까/ })).toBeNull()
  expect(within(form).getByText(/서버에서 확인한 현재 계정/)).toBeTruthy()
  submit(form); await successShown('report')
  expect(JSON.parse(posts()[0][1].body).reporter).toBe('')
})

it('a successful report permits an intentional identical new report with a new intent', async () => {
  const { form } = await open('report'); submit(form); await successShown('report')
  fireEvent.click(screen.getByRole('button', { name: '하나 더 알리기' }))
  fireEvent.click(screen.getByRole('button', { name: '이상한 점 알리기' }))
  const next = screen.getByRole('form', { name: '이상한 점 제보' })
  fireEvent.click(within(next).getByRole('radio', { name: /숫자가 안 맞습니다/ }))
  fireEvent.change(next.querySelector('textarea'), { target: { value: BODY } })
  submit(next); await successShown('report')
  expect(JSON.parse(posts()[1][1].body).feedback_id).not.toBe(JSON.parse(posts()[0][1].body).feedback_id)
})

it('keeps unclear POST confirmation when notes GET fails, and recovers by GET only', async () => {
  const { form } = await open('unclear')
  notesReply = () => failure(503)
  submit(form); await successShown('unclear')
  await screen.findByText(/안내 상태를 불러오지 못했습니다/)
  expect(screen.queryByRole('button', { name: '같은 제보 다시 확인' })).toBeNull()
  notesReply = () => Response.json({ notes: { intro: { tone: 'open', text: '새로 조회한 안내 상태' } } })
  const before = noteReads().length
  fireEvent.click(screen.getByRole('button', { name: '안내 상태 다시 읽기' }))
  await screen.findByText('새로 조회한 안내 상태')
  expect(noteReads()).toHaveLength(before + 1)
  expect(posts()).toHaveLength(1)
  expect(screen.getByText('제보 기록을 저장했습니다.')).toBeTruthy()
})

it('does not let old notes from another tool overwrite current notes', async () => {
  const old = deferred(); notesReply = slug => slug === 'a' ? old.promise : Response.json({ notes: { intro: { tone: 'open', text: 'B 도구 현재 안내' } } })
  await open('unclear')
  fireEvent.click(screen.getByRole('link', { name: '다른 도구' }))
  await screen.findByText('B 도구 현재 안내')
  await act(async () => old.resolve(Response.json({ notes: { intro: { tone: 'open', text: 'A 도구 오래된 안내' } } })))
  expect(screen.getByText('B 도구 현재 안내')).toBeTruthy()
  expect(screen.queryByText('A 도구 오래된 안내')).toBeNull()
})

it('keeps another section draft while a different section confirms', async () => {
  const old = deferred(); postReply = () => old.promise
  const { form } = await open('unclear'); submit(form); await waitFor(() => expect(posts()).toHaveLength(1))
  fireEvent.click(screen.getByRole('button', { name: '어떤 파일을 올리는지 — 여기 모르겠습니다' }))
  const other = screen.getByRole('form', { name: '어떤 파일을 올리는지 제보' })
  fireEvent.change(other.querySelector('textarea'), { target: { value: '다른 대목의 새 초안입니다' } })
  await act(async () => old.resolve(Response.json(receipt('unclear'))))
  await successShown('unclear')
  expect(screen.getByDisplayValue('다른 대목의 새 초안입니다')).toBeTruthy()
})

it('hides unclear pending content when the session is revoked before reply', async () => {
  const old = deferred(); postReply = () => old.promise
  const { form } = await open('unclear'); submit(form); await waitFor(() => expect(posts()).toHaveLength(1))
  await act(async () => revokeAccess(getAccessSession().generation))
  await act(async () => old.resolve(Response.json(receipt('unclear'))))
  expect(screen.queryByDisplayValue(BODY)).toBeNull()
  expect(screen.queryByText('제보 기록을 저장했습니다.')).toBeNull()
  expect(screen.getByRole('button', { name: '접근 다시 확인' })).toBeTruthy()
})

it.each([403, 404, 410])('hides a pending section after a notes GET denial %s and ignores its later reply', async status => {
  const notes = deferred(), save = deferred(); notesReply = () => notes.promise; postReply = () => save.promise
  const { form } = await open('unclear'); submit(form); await waitFor(() => expect(posts()).toHaveLength(1))
  await act(async () => notes.resolve(failure(status)))
  await screen.findByText(/안내 상태를 불러오지 못했습니다/)
  expect(screen.queryByDisplayValue(BODY)).toBeNull()
  await act(async () => save.resolve(Response.json(receipt('unclear'))))
  expect(screen.queryByText('제보 기록을 저장했습니다.')).toBeNull()
  expect(posts()).toHaveLength(1)
})

it('ignores old-account notes even when the tool slug stays the same', async () => {
  const old = deferred(); notesReply = () => old.promise
  await open('unclear')
  notesReply = () => Response.json({ notes: { intro: { tone: 'open', text: '새 계정 안내' } } })
  scope = OTHER
  await act(async () => completeAccessCheck(beginAccessCheck(), { ok: true, mode, scope }))
  await screen.findByText('새 계정 안내')
  await act(async () => old.resolve(Response.json({ notes: { intro: { tone: 'open', text: '옛 계정 비공개 안내' } } })))
  expect(screen.queryByText('옛 계정 비공개 안내')).toBeNull()
  expect(screen.getByText('새 계정 안내')).toBeTruthy()
})
