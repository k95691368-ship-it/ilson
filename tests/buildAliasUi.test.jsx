// @vitest-environment happy-dom
import { webcrypto } from 'node:crypto'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import BuildPage from '../src/pages/BuildPage.jsx'
import { beginAccessCheck, completeAccessCheck, getAccessSession, revokeAccess } from '../src/lib/accessSession.js'
import { SKUS } from '../shared/master.js'

const notices = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), read: vi.fn() }))
vi.mock('../src/context/ToastContext.jsx', () => ({ useToast: () => notices }))
vi.mock('../src/lib/readFiles.js', () => ({ readLocalFiles: notices.read }))
const CANON = SKUS[0].canonical_code, MASTER = SKUS[0].name_ko
const SCOPE = '8'.repeat(64), OTHER = '9'.repeat(64)
const activate = (scope = SCOPE) => completeAccessCheck(beginAccessCheck(), { ok: true, mode: 'access', scope })
const row = (code = 'UNREGISTERED') => ({ id: 'q-' + code, reason: 'unknown_sku', external_code: code, product_name: '원본의 다른 상품명', source_file: 'same.csv', source_sha256: 'a'.repeat(64), source_ambiguous_name: true, source_sheet: '정산', source_row_no: 2, raw: [] })
const buildData = (runId = 'run-a', code) => ({ runs: [{ id: runId, seq: 1, rows_out: 0, quarantined: 1, duration_ms: 1, files: [] }], rows: [], quarantine: [row(code)], aliases: [] })
const good = (overrides = {}) => Response.json({ ok: true, external_code: 'UNREGISTERED', canonical_code: CANON, already: false, product_name: MASTER, teacher: '검증된 담당자', ...overrides }, { status: 201 })
const failure = (status, extra = {}) => Response.json({ error: '합성 저장 오류', ...extra }, { status })
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
let records, aliasReply, reloadStatus, fetcher
const item = (code = 'UNREGISTERED') => screen.getByText(code, { selector: '.teach-info code' }).closest('.teach-row')
const choose = (code = 'UNREGISTERED') => fireEvent.change(within(item(code)).getByRole('combobox'), { target: { value: CANON } })
const save = (code = 'UNREGISTERED') => fireEvent.click(within(item(code)).getByRole('button', { name: '기억시키기' }))
const aliasCalls = () => fetcher.mock.calls.filter(([, options]) => options.method === 'POST' && JSON.parse(options.body).kind === 'alias')
const open = async () => {
  const view = render(<MemoryRouter><BuildPage /></MemoryRouter>)
  await screen.findByRole('combobox', { name: 'UNREGISTERED에 해당하는 상품' })
  return view
}
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal('crypto', webcrypto); activate()
  records = { a: buildData(), b: buildData('run-b') }; aliasReply = () => good(); reloadStatus = null
  fetcher = vi.fn(async (url, options) => {
    if (String(url) === '/api/applications') return Response.json({ items: ['a', 'b'].map(id => ({ id, status: '진행중', dept: '재무', title: `과제 ${id}` })) })
    const id = String(url).match(/applications\/(a|b)\/build/)?.[1]
    if (!id) throw Error('Unexpected local request: ' + url)
    if (options.method === 'POST') {
      if (JSON.parse(options.body).kind === 'alias') return aliasReply()
      records[id] = buildData('run-next')
      return Response.json({ ok: true })
    }
    return reloadStatus ? failure(reloadStatus, { error: '최신 제작 조회 실패' }) : Response.json(records[id])
  })
  vi.stubGlobal('fetch', fetcher)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('locks same-tick double clicks and confirms the selected canonical/master name, never the source product name', async () => {
  const pending = deferred(); aliasReply = () => pending.promise
  await open(); choose()
  const button = within(item()).getByRole('button', { name: '기억시키기' })
  act(() => { button.click(); button.click() })
  await waitFor(() => expect(aliasCalls()).toHaveLength(1))
  expect(within(item()).getByRole('combobox').disabled).toBe(true)
  expect(within(item()).getByRole('button').disabled).toBe(true)
  expect(JSON.parse(aliasCalls()[0][1].body)).toEqual({ kind: 'alias', external_code: 'UNREGISTERED', canonical_code: CANON })
  await act(async () => pending.resolve(good()))
  await screen.findByText('상품 연결을 저장했습니다.')
  expect(within(item()).getByText(`저장 당시: ${MASTER} (${CANON})`)).toBeTruthy()
  expect(within(item()).getByText(/연결을 다시 조회한 뒤 새로 실행/)).toBeTruthy()
  expect(within(item()).queryByText(/그때의 최신 연결/)).toBeNull()
  expect(within(item()).getByText(/다른 오류/)).toBeTruthy()
  expect(within(item()).getByText('기록된 작성자: 검증된 담당자')).toBeTruthy()
  expect(screen.queryByText(/다시 돌리면 이 줄은 자동/)).toBeNull()
})

it.each(['network', '503'])('retains the draft and exact mutation key after uncertain %s failure', async kind => {
  aliasReply = () => kind === 'network' ? Promise.reject(Error('reply lost')) : failure(503)
  await open(); choose(); save()
  await within(item()).findByRole('alert')
  expect(within(item()).getByRole('combobox').value).toBe(CANON)
  aliasReply = () => good(); save()
  await screen.findByText('상품 연결을 저장했습니다.')
  const calls = aliasCalls()
  expect(calls).toHaveLength(2)
  expect(calls[0][1].headers.get('X-Idempotency-Key')).toBe(calls[1][1].headers.get('X-Idempotency-Key'))
})

it.each([
  {}, { ok: true }, { ok: true, external_code: 'OTHER', canonical_code: CANON, already: true },
  { ok: true, external_code: 'UNREGISTERED', canonical_code: 'OTHER', already: true },
  { ok: true, external_code: 'UNREGISTERED', canonical_code: CANON, already: 'false' },
  { ok: true, external_code: 'UNREGISTERED', canonical_code: CANON, already: false },
  { ok: true, external_code: 'UNREGISTERED', canonical_code: CANON, already: false, product_name: '', teacher: '담당자' },
  { ok: true, external_code: 'UNREGISTERED', canonical_code: CANON, already: true, teacher: 7 },
])('does not retire a retry key or report success for malformed/mismatched receipt %j', async value => {
  aliasReply = () => Response.json(value, { status: 201 })
  await open(); choose(); save()
  await within(item()).findByRole('alert')
  expect(notices.success).not.toHaveBeenCalled()
  aliasReply = () => good(); save()
  await screen.findByText('상품 연결을 저장했습니다.')
  expect(aliasCalls()[0][1].headers.get('X-Idempotency-Key')).toBe(aliasCalls()[1][1].headers.get('X-Idempotency-Key'))
})

it('keeps a conflicting draft, links to explicit correction, and never overwrites or auto-confirms it', async () => {
  aliasReply = () => failure(409, { code: 'CODE_BUILD_ALIAS_CONFLICT' })
  await open(); choose(); save()
  const link = await within(item()).findByRole('link', { name: '기존 코드 확인·정정' })
  expect(link.getAttribute('href')).toBe('/codes')
  expect(within(item()).getByRole('combobox').value).toBe(CANON)
  expect(aliasCalls()).toHaveLength(1)
  expect(notices.success).not.toHaveBeenCalled()
})

it('shows snake-case field errors without clearing the selected SKU', async () => {
  aliasReply = () => failure(400, { fields: { external_code: '80자 이내로 입력해주세요.', canonical_code: '현재 상품 목록을 확인해주세요.' } })
  await open(); choose(); save()
  await screen.findByText('80자 이내로 입력해주세요.')
  expect(screen.getByText('현재 상품 목록을 확인해주세요.')).toBeTruthy()
  expect(within(item()).getByRole('combobox').value).toBe(CANON)
})

it('identifies an already-existing mapping without inventing a new teacher or repairing its legacy name', async () => {
  aliasReply = () => Response.json({ ok: true, external_code: 'UNREGISTERED', canonical_code: CANON, already: true }, { status: 201 })
  await open(); choose(); save()
  await screen.findByText('같은 상품으로 저장된 기록을 확인했습니다.')
  expect(within(item()).getByText(`저장 당시: ${MASTER} (${CANON})`)).toBeTruthy()
  expect(within(item()).queryByText(/기록된 작성자/)).toBeNull()
})

it('keeps confirmed storage visible after a transient reload failure and offers only a read retry', async () => {
  aliasReply = () => { reloadStatus = 503; return good() }
  await open(); choose(); save()
  await screen.findByText('상품 연결을 저장했습니다.')
  await screen.findByText(/최신 제작 조회 실패/)
  expect(within(item()).getByText(/최신 연결 확인 전입니다/)).toBeTruthy()
  expect(within(item()).queryByRole('button', { name: '기억시키기' })).toBeNull()
  reloadStatus = null
  fireEvent.click(screen.getByRole('button', { name: '최신 제작 기록 다시 읽기' }))
  await waitFor(() => expect(screen.queryByText(/최신 제작 조회 실패/)).toBeNull())
  expect(screen.getByText('상품 연결을 저장했습니다.')).toBeTruthy()
  expect(aliasCalls()).toHaveLength(1)
})

it('distinguishes a lost-response receipt replay for A from a later correction to B in the fresh aliases read', async () => {
  aliasReply = () => failure(503)
  await open(); choose(); save()
  await within(item()).findByRole('alert')
  records.a.aliases = [{ external_code: 'UNREGISTERED', canonical_code: SKUS[1].canonical_code, product_name: '레거시 원본명' }]
  aliasReply = () => good(); save()
  await screen.findByText(`현재 조회: ${SKUS[1].name_ko} (${SKUS[1].canonical_code})`)
  expect(within(item()).getByText(`저장 당시: ${MASTER} (${CANON})`)).toBeTruthy()
  expect(within(item()).getByRole('link', { name: '기존 코드 확인·정정' }).getAttribute('href')).toBe('/codes')
  expect(aliasCalls()[0][1].headers.get('X-Idempotency-Key')).toBe(aliasCalls()[1][1].headers.get('X-Idempotency-Key'))
  expect(records.a.aliases[0].canonical_code).toBe(SKUS[1].canonical_code)
  expect(aliasCalls()).toHaveLength(2)
})

it('labels a matching refreshed alias separately from its immutable saved receipt', async () => {
  aliasReply = () => { records.a.aliases = [{ external_code: 'UNREGISTERED', canonical_code: CANON }]; return good() }
  await open(); choose(); save()
  await screen.findByText(`현재 조회: ${MASTER} (${CANON})`)
  expect(within(item()).getByText(`저장 당시: ${MASTER} (${CANON})`)).toBeTruthy()
  expect(within(item()).queryByText(/저장 당시와 현재 조회 결과가 다릅니다/)).toBeNull()
  expect(within(item()).queryByText(/최신 연결 확인 전입니다/)).toBeNull()
})

it.each([403, 404, 410])('does not retain protected source or successful controls after reload denial %s', async status => {
  aliasReply = () => { reloadStatus = status; return good() }
  await open(); choose(); save()
  await screen.findByText('최신 제작 조회 실패')
  expect(screen.queryByText('원본의 다른 상품명')).toBeNull()
  expect(screen.queryByText('상품 연결을 저장했습니다.')).toBeNull()
})

it('ignores a late receipt after application A→B→A navigation, even with the same run ID', async () => {
  const pending = deferred(); aliasReply = () => pending.promise
  await open(); choose(); save(); await waitFor(() => expect(aliasCalls()).toHaveLength(1))
  fireEvent.click(screen.getByRole('button', { name: '재무 · 과제 b' }))
  await screen.findByRole('combobox', { name: 'UNREGISTERED에 해당하는 상품' })
  fireEvent.click(screen.getByRole('button', { name: '재무 · 과제 a' }))
  await screen.findByRole('combobox', { name: 'UNREGISTERED에 해당하는 상품' })
  await act(async () => pending.resolve(good()))
  expect(notices.success).not.toHaveBeenCalled()
  expect(within(item()).getByRole('combobox').value).toBe('')
  expect(screen.queryByText('상품 연결을 저장했습니다.')).toBeNull()
})

it.each(['success', '403'])('ignores a late %s after an account lifetime changes', async response => {
  const pending = deferred(); aliasReply = () => pending.promise
  await open(); choose(); save(); await waitFor(() => expect(aliasCalls()).toHaveLength(1))
  await act(async () => activate(OTHER))
  await screen.findByRole('combobox', { name: 'UNREGISTERED에 해당하는 상품' })
  await act(async () => pending.resolve(response === 'success' ? good() : failure(403)))
  expect(notices.success).not.toHaveBeenCalled(); expect(notices.error).not.toHaveBeenCalled()
  expect(within(item()).getByRole('combobox').value).toBe('')
})

it('hides the form on revocation and ignores its later success', async () => {
  const pending = deferred(); aliasReply = () => pending.promise
  await open(); choose(); save(); await waitFor(() => expect(aliasCalls()).toHaveLength(1))
  await act(async () => revokeAccess(getAccessSession().generation))
  expect(screen.queryByRole('combobox', { name: 'UNREGISTERED에 해당하는 상품' })).toBeNull()
  await act(async () => pending.resolve(good()))
  expect(notices.success).not.toHaveBeenCalled(); expect(notices.error).not.toHaveBeenCalled()
})

it('does not apply an old teaching response to a new build run', async () => {
  const pending = deferred(); aliasReply = () => pending.promise
  notices.read.mockResolvedValue([{ name: 'new.csv', buffer: new TextEncoder().encode('주문일자,상품코드,상품명,수량,판매가,할인액\n2026-06-01,NR-CM-100,가상 상품,1,10000,0') }])
  const view = await open(); choose(); save(); await waitFor(() => expect(aliasCalls()).toHaveLength(1))
  fireEvent.change(view.container.querySelector('input[type=file]'), { target: { files: [new File(['x'], 'new.csv')] } })
  await waitFor(() => expect(records.a.runs[0].id).toBe('run-next'))
  await waitFor(() => expect(within(item()).getByRole('combobox').value).toBe(''))
  notices.success.mockClear()
  await act(async () => pending.resolve(good()))
  expect(notices.success).not.toHaveBeenCalled()
  expect(screen.queryByText('상품 연결을 저장했습니다.')).toBeNull()
})

it('handles prototype-like external codes as independent entries', async () => {
  records.a.quarantine = [row('__proto__'), row('constructor')]
  aliasReply = () => good({ external_code: '__proto__' })
  render(<MemoryRouter><BuildPage /></MemoryRouter>)
  await screen.findByRole('combobox', { name: '__proto__에 해당하는 상품' })
  choose('__proto__'); save('__proto__')
  await within(item('__proto__')).findByText('상품 연결을 저장했습니다.')
  expect(within(item('constructor')).getByRole('combobox').value).toBe('')
})
