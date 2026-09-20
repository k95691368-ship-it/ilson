// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom'
import BetaPage from '../src/pages/BetaPage.jsx'
import { forgetBetaRound, pendingBetaRound } from '../src/lib/pendingBetaRounds.js'

const state = vi.hoisted(() => ({ post: vi.fn(), get: vi.fn(), grade: vi.fn(), read: vi.fn(), reload: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn(), scope: 'beta-scope-a', revision: 2, loadError: null }))
vi.mock('../src/api/client.js', () => ({ api: { post: state.post, get: state.get } }))
vi.mock('../src/context/ToastContext.jsx', () => ({ useToast: () => ({ success: state.success, error: state.error, info: state.info }) }))
vi.mock('../src/lib/readFiles.js', () => ({ readLocalFiles: state.read }))
vi.mock('../shared/grade.js', () => ({ gradeAll: state.grade }))
vi.mock('../src/hooks/useApi.js', () => ({ useApi: path => ({ data: path === '/applications' ? { items: [{ id: 'beta-app', status: '진행중', dept: '재무', title: '가상 베타 검증' }] } : {
  application: { id: 'beta-app', dept: '재무' }, canTest: true, runScope: state.scope, criteriaRevision: state.revision,
  criteria: [{ id: 'criterion-a', body: '현재 기준', check_kind: 'rule', is_required_safety: 1 }], latestBuild: { id: 'build-a' }, rounds: [], latestResults: [], feedback: [],
}, error: path === '/applications' ? null : state.loadError, loading: false, reload: state.reload }) }))

function clearQueue() { for (const scope of ['beta-scope-a', 'beta-scope-b']) forgetBetaRound(scope, 'beta-app') }
beforeEach(() => {
  vi.clearAllMocks(); clearQueue()
  state.scope = 'beta-scope-a'; state.revision = 2; state.loadError = null
  state.post.mockResolvedValue({ ok: true, overall: '통과', round_id: 'local-beta-1' })
  state.get.mockResolvedValue({ aliases: [] }); state.reload.mockResolvedValue(undefined)
  state.read.mockResolvedValue([])
  state.grade.mockResolvedValue({ graded: [{ id: 'criterion-a', body: '현재 기준', kind: 'rule', verdict: '통과', is_required_safety: 1 }], summary: { overall: '통과', durationMs: 123 } })
})
afterEach(() => { cleanup(); clearQueue() })
function shell() {
  return <MemoryRouter initialEntries={['/beta']}><Routes>
    <Route path="/beta" element={<><Link to="/elsewhere">다른 화면</Link><BetaPage /></>} />
    <Route path="/elsewhere" element={<Link to="/beta">베타로 돌아가기</Link>} />
  </Routes></MemoryRouter>
}
async function start() {
  const view = render(shell())
  await screen.findByRole('button', { name: '파일 넣고 시험 시작' })
  fireEvent.change(view.container.querySelector('input[type="file"]'), { target: { files: [new File(['value'], 'synthetic.csv')] } })
  return view
}

describe('베타 판정 저장의 연속성', () => {
  it('저장 응답 유실은 동일 판정·revision·scope·실행 ID로 재확인한다', async () => {
    state.post.mockRejectedValueOnce(new Error('응답 유실'))
    await start()
    const retry = await screen.findByRole('button', { name: '같은 채점 기록 다시 저장' })
    expect(screen.getByRole('button', { name: '파일 넣고 시험 시작' }).disabled).toBe(true)
    expect(state.success).not.toHaveBeenCalled()
    const original = state.post.mock.calls[0]
    expect(original[1]).toMatchObject({ criteria_revision: 2, run_scope: 'beta-scope-a', summary: { durationMs: 123 } })
    expect(original[1].run_id).toMatch(/^[0-9a-f-]{36}$/)
    fireEvent.click(retry)
    await waitFor(() => expect(state.success).toHaveBeenCalledTimes(1))
    expect(state.post.mock.calls[1]).toEqual(original)
    expect(state.grade).toHaveBeenCalledTimes(1); expect(state.read).toHaveBeenCalledTimes(1)
    expect(pendingBetaRound('beta-scope-a', 'beta-app')).toBeNull()
  })

  it('새 화면을 거쳐 돌아와도 미확인 판정만 복원하고 다른 scope에는 노출하지 않는다', async () => {
    state.post.mockRejectedValueOnce(new Error('응답 유실'))
    await start(); await screen.findByRole('button', { name: '같은 채점 기록 다시 저장' })
    const original = state.post.mock.calls[0]
    fireEvent.click(screen.getByRole('link', { name: '다른 화면' }))
    const closing = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(closing)
    expect(closing.defaultPrevented).toBe(true)
    state.scope = 'beta-scope-b'
    fireEvent.click(screen.getByRole('link', { name: '베타로 돌아가기' }))
    await screen.findByRole('button', { name: '파일 넣고 시험 시작' })
    expect(screen.queryByRole('region', { name: '채점 기록 저장 상태' })).toBeNull()
    fireEvent.click(screen.getByRole('link', { name: '다른 화면' })); state.scope = 'beta-scope-a'
    fireEvent.click(screen.getByRole('link', { name: '베타로 돌아가기' }))
    fireEvent.click(await screen.findByRole('button', { name: '같은 채점 기록 다시 저장' }))
    await waitFor(() => expect(state.post).toHaveBeenCalledTimes(2))
    expect(state.post.mock.calls[1]).toEqual(original); expect(state.grade).toHaveBeenCalledTimes(1)
  })

  it('서버가 저장하지 않았음을 확정한 기준 변경만 새 시험 준비를 허용한다', async () => {
    state.post.mockRejectedValueOnce(Object.assign(new Error('기준이 바뀌었습니다'), { code: 'BETA_CRITERIA_CHANGED', notSaved: true, status: 409 }))
    await start()
    fireEvent.click(await screen.findByRole('button', { name: '현재 기준으로 다시 준비' }))
    await waitFor(() => expect(state.reload).toHaveBeenCalledTimes(1))
    expect(pendingBetaRound('beta-scope-a', 'beta-app')).toBeNull()
    expect(screen.getByRole('button', { name: '파일 넣고 시험 시작' }).disabled).toBe(false)
    expect(state.grade).toHaveBeenCalledTimes(1)
  })

  it('scope 충돌 등 저장 불확실 409에서는 기존 실행을 버리지 않는다', async () => {
    state.post.mockRejectedValueOnce(Object.assign(new Error('현재 계정이 다릅니다'), { status: 409 }))
    await start(); await screen.findByRole('button', { name: '같은 채점 기록 다시 저장' })
    expect(screen.queryByRole('button', { name: '현재 기준으로 다시 준비' })).toBeNull()
    expect(pendingBetaRound('beta-scope-a', 'beta-app')).not.toBeNull()
  })

  it('조회 갱신 오류가 저장된 판정을 미확인으로 되돌리거나 다시 저장하지 않는다', async () => {
    state.reload.mockRejectedValueOnce(new Error('조회 오류'))
    await start(); await waitFor(() => expect(state.reload).toHaveBeenCalledTimes(1))
    expect(state.post).toHaveBeenCalledTimes(1); expect(state.success).toHaveBeenCalledTimes(1)
    expect(pendingBetaRound('beta-scope-a', 'beta-app')).toBeNull()
    expect(screen.queryByRole('button', { name: '같은 채점 기록 다시 저장' })).toBeNull()
  })

  it('채점 중 중복 파일 선택을 막고 실제 채점 실패는 회차로 쓰지 않는다', async () => {
    let fail
    state.grade.mockImplementationOnce(() => new Promise((_, reject) => { fail = reject }))
    const view = await start(); await waitFor(() => expect(state.grade).toHaveBeenCalledTimes(1))
    fireEvent.change(view.container.querySelector('input[type="file"]'), { target: { files: [new File(['again'], 'again.csv')] } })
    await act(async () => fail(new Error('채점할 수 없는 형식')))
    expect(state.grade).toHaveBeenCalledTimes(1); expect(state.post).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '파일 넣고 시험 시작' }).disabled).toBe(false)
  })

  it('기록 응답이 늦는 동안 scope가 바뀌면 이전 판정 오류를 새 계정에 표시하지 않는다', async () => {
    let fail
    state.post.mockImplementationOnce(() => new Promise((_, reject) => { fail = reject }))
    const view = await start(); await waitFor(() => expect(state.post).toHaveBeenCalledTimes(1))
    state.scope = 'beta-scope-b'; view.rerender(shell())
    await act(async () => fail(new Error('이전 계정의 저장 오류')))
    expect(screen.queryByRole('region', { name: '채점 기록 저장 상태' })).toBeNull()
    expect(pendingBetaRound('beta-scope-a', 'beta-app').payload.run_scope).toBe('beta-scope-a')
    expect(pendingBetaRound('beta-scope-b', 'beta-app')).toBeNull()
    expect(state.error).not.toHaveBeenCalled()
  })

  it('채점 중 화면을 떠나면 이전 채점은 새 회차를 저장하거나 대기 큐를 지우지 않는다', async () => {
    let finishOld
    const result = { graded: [{ id: 'criterion-a' }], summary: { overall: '통과', durationMs: 123 } }
    state.grade.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve }))
    state.post.mockRejectedValueOnce(new Error('새 회차 응답 유실'))
    const view = await start(); await waitFor(() => expect(state.grade).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('link', { name: '다른 화면' }))
    fireEvent.click(screen.getByRole('link', { name: '베타로 돌아가기' }))
    await screen.findByRole('button', { name: '파일 넣고 시험 시작' })
    fireEvent.change(view.container.querySelector('input[type="file"]'), { target: { files: [new File(['new'], 'new.csv')] } })
    await screen.findByRole('button', { name: '같은 채점 기록 다시 저장' })
    const savedQueue = pendingBetaRound('beta-scope-a', 'beta-app')
    await act(async () => finishOld(result))
    expect(state.post).toHaveBeenCalledTimes(1)
    expect(pendingBetaRound('beta-scope-a', 'beta-app')).toEqual(savedQueue)
  })

  it('A→B→A 재진입도 이전 파일 읽기 실패나 POST를 되살리지 않는다', async () => {
    let failOld
    state.read.mockImplementationOnce(() => new Promise((_, reject) => { failOld = reject }))
    const view = await start(); await waitFor(() => expect(state.read).toHaveBeenCalledTimes(1))
    state.scope = 'beta-scope-b'; view.rerender(shell())
    state.scope = 'beta-scope-a'; view.rerender(shell())
    await act(async () => failOld(new Error('이전 읽기 실패')))
    expect(state.post).not.toHaveBeenCalled(); expect(state.error).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '파일 넣고 시험 시작' }).disabled).toBe(false)
  })

  it('재진입 화면에서 원래 POST의 저장 확인을 받아 대기 안내와 최신 회차를 갱신한다', async () => {
    let finishOld
    state.post.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve }))
    await start(); await waitFor(() => expect(state.post).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('link', { name: '다른 화면' }))
    fireEvent.click(screen.getByRole('link', { name: '베타로 돌아가기' }))
    await screen.findByRole('button', { name: '같은 채점 기록 다시 저장' })
    await act(async () => finishOld({ overall: '통과' }))
    expect(screen.queryByRole('region', { name: '채점 기록 저장 상태' })).toBeNull()
    expect(screen.getByRole('button', { name: '파일 넣고 시험 시작' }).disabled).toBe(false)
    expect(state.reload).toHaveBeenCalledTimes(1)
    expect(state.success).not.toHaveBeenCalled()
  })

  it.each([false, true])('다른 세션의 재시도 성공 후 늦은 실패가 확인된 큐를 되살리지 않는다 (새 실행 %s)', async newRun => {
    let failOld
    state.post.mockImplementationOnce(() => new Promise((_, reject) => { failOld = reject }))
    const view = await start(); await waitFor(() => expect(state.post).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('link', { name: '다른 화면' }))
    fireEvent.click(screen.getByRole('link', { name: '베타로 돌아가기' }))
    fireEvent.click(await screen.findByRole('button', { name: '같은 채점 기록 다시 저장' }))
    await waitFor(() => expect(state.success).toHaveBeenCalledTimes(1))
    if (newRun) {
      state.post.mockRejectedValueOnce(new Error('새 실행 응답 유실'))
      fireEvent.change(view.container.querySelector('input[type="file"]'), { target: { files: [new File(['new'], 'new.csv')] } })
      await screen.findByText('새 실행 응답 유실')
    }
    const savedQueue = pendingBetaRound('beta-scope-a', 'beta-app')
    const errorCount = state.error.mock.calls.length
    await act(async () => failOld(new Error('이미 확인된 원래 요청의 늦은 실패')))
    expect(pendingBetaRound('beta-scope-a', 'beta-app')).toEqual(savedQueue)
    expect(state.error).toHaveBeenCalledTimes(errorCount)
    if (!newRun) expect(screen.queryByRole('region', { name: '채점 기록 저장 상태' })).toBeNull()
  })

  it.each([false, true])('원래 저장과 재시도 응답이 교차해도 최신 회차는 한 번만 조회한다 (재시도 실패 %s)', async retryFails => {
    let finishOld, finishRetry, failRetry
    state.post.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve }))
      .mockImplementationOnce(() => new Promise((resolve, reject) => { finishRetry = resolve; failRetry = reject }))
    await start(); await waitFor(() => expect(state.post).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('link', { name: '다른 화면' }))
    fireEvent.click(screen.getByRole('link', { name: '베타로 돌아가기' }))
    fireEvent.click(await screen.findByRole('button', { name: '같은 채점 기록 다시 저장' }))
    await waitFor(() => expect(state.post).toHaveBeenCalledTimes(2))
    await act(async () => finishOld({ overall: '통과' }))
    await act(async () => retryFails ? failRetry(new Error('재시도 응답 유실')) : finishRetry({ overall: '통과' }))
    expect(pendingBetaRound('beta-scope-a', 'beta-app')).toBeNull()
    expect(state.reload).toHaveBeenCalledTimes(1)
    expect(state.error).not.toHaveBeenCalled()
  })
})
