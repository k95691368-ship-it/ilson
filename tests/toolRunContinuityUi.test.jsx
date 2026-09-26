// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom'
import ToolPage from '../src/pages/ToolPage.jsx'
import { forgetToolRun, keepToolRun, pendingToolRun } from '../src/lib/pendingToolRuns.js'

const state = vi.hoisted(() => ({ post: vi.fn(), get: vi.fn(), pipeline: vi.fn(), readFiles: vi.fn(), reload: vi.fn(), success: vi.fn(), error: vi.fn(), remaining: 3, loadError: null, runScope: 'scope-a', rolledBack: false }))
vi.mock('../src/api/client.ts', () => ({ api: { post: state.post, get: state.get } }))
vi.mock('../src/context/ToastContext.jsx', () => ({ useToast: () => ({ success: state.success, error: state.error }) }))
vi.mock('../src/lib/readFiles.js', () => ({ readLocalFiles: state.readFiles }))
vi.mock('../shared/pipeline.js', async original => ({ ...await original(), runPipeline: state.pipeline }))
vi.mock('../src/hooks/useApi.js', () => ({ useApi: path => ({ data: ['/tools/tool-local', '/tools/other-tool'].includes(path) ? {
  slug: path.split('/').at(-1), ticket: 'APP-LOCAL', title: path.endsWith('other-tool') ? '다른 정산 도구' : '가상 정산 도구', handedTo: { dept: '재무', person: '가상 담당자' },
  runScope: state.runScope, rolledBack: state.rolledBack, message: state.rolledBack ? '이 도구는 잠시 내려가 있습니다.' : undefined,
  limits: { remainingToday: state.remaining, dailyLimit: 3, maxFileMb: 10 }, recent: [], reports: [], taught: [], aliases: {},
} : null, loading: false, error: state.loadError, reload: state.reload }) }))

beforeEach(() => {
  vi.clearAllMocks()
  clearPending()
  window.localStorage.clear()
  state.remaining = 3
  state.loadError = null
  state.runScope = 'scope-a'
  state.rolledBack = false
  state.get.mockResolvedValue({ notes: {} })
  state.post.mockResolvedValue({ ok: true, id: 'run-local', remainingToday: 2 })
  state.reload.mockResolvedValue(undefined)
  state.readFiles.mockResolvedValue([{ name: 'synthetic.csv', buffer: new ArrayBuffer(0) }])
  state.pipeline.mockResolvedValue({ files: [], rows: [], quarantine: [], stats: { durationMs: 100 }, totals: { byChannel: [] } })
})
function clearPending() {
  for (const scope of ['scope-a', 'scope-b']) for (const slug of ['tool-local', 'other-tool']) forgetToolRun(scope, slug)
}
afterEach(() => { cleanup(); clearPending() })
function shell() {
  return <MemoryRouter initialEntries={['/t/tool-local']}><Routes>
    <Route path="/t/:slug" element={<><Link to="/t/other-tool">다른 도구</Link><ToolPage /></>} />
    <Route path="/track" element={<Link to="/t/tool-local">도구로 돌아가기</Link>} />
  </Routes></MemoryRouter>
}
function renderTool() {
  return render(shell())
}
function startRun() {
  const view = renderTool()
  fireEvent.change(view.container.querySelector('input[type="file"]'), { target: { files: [new File(['column\nvalue'], 'synthetic.csv', { type: 'text/csv' })] } })
  return view
}

describe('도구 계산과 실행 기록의 실패 구분', () => {
  it('실행자 이름은 계정·체험 scope별로 기억하고 다른 계정에는 재사용하지 않는다', async () => {
    const view = renderTool()
    fireEvent.change(screen.getByRole('textbox', { name: '돌리시는 분' }), { target: { value: 'A 비공개 이름' } })
    state.runScope = 'scope-b'; view.rerender(shell())
    expect(screen.getByRole('textbox', { name: '돌리시는 분' }).value).toBe('가상 담당자')
    fireEvent.change(screen.getByRole('textbox', { name: '돌리시는 분' }), { target: { value: 'B 담당자' } })
    state.runScope = 'scope-a'; view.rerender(shell())
    expect(screen.getByRole('textbox', { name: '돌리시는 분' }).value).toBe('A 비공개 이름')
    state.runScope = 'scope-b'; view.rerender(shell())
    expect(screen.getByRole('textbox', { name: '돌리시는 분' }).value).toBe('B 담당자')
    await act(async () => {})
  })
  it('이전 공용 이름은 새 scope로 자동 이관하지 않고 도구별 입력도 분리한다', async () => {
    window.localStorage.setItem('ilson:who:tool-local', '이전 공용 이름')
    renderTool()
    expect(screen.getByRole('textbox', { name: '돌리시는 분' }).value).toBe('가상 담당자')
    fireEvent.change(screen.getByRole('textbox', { name: '돌리시는 분' }), { target: { value: '첫 도구 이름' } })
    fireEvent.click(screen.getByRole('link', { name: '다른 도구' }))
    expect(screen.getByRole('textbox', { name: '돌리시는 분' }).value).toBe('가상 담당자')
    expect(window.localStorage.getItem('ilson:who:tool-local')).toBe('이전 공용 이름')
    await act(async () => {})
  })
  it('계산 성공 뒤 기록 저장만 실패하면 실패 실행을 새로 기록하지 않는다', async () => {
    state.post.mockRejectedValueOnce(new Error('임시 저장 연결 오류'))
    startRun()
    await waitFor(() => expect(state.error).toHaveBeenCalled())
    expect(state.post).toHaveBeenCalledTimes(1)
    expect(state.post.mock.calls[0][1]).not.toHaveProperty('ok', false)
    expect(screen.getByRole('button', { name: '엑셀로 내려받기' })).toBeTruthy()
  })
  it('같은 실행을 재계산 없이 같은 식별자와 내용으로 다시 저장한다', async () => {
    state.post.mockRejectedValueOnce(new Error('응답이 끊겼습니다'))
    startRun()
    const retry = await screen.findByRole('button', { name: '같은 실행 기록 다시 저장' })
    // The pending receipt renders before the enclosing calculation's finally
    // resets its busy label. Check the settled control, not that brief frame.
    expect((await screen.findByRole('button', { name: '정산서 파일 넣기' })).disabled).toBe(true)
    fireEvent.click(retry)
    await waitFor(() => expect(state.post).toHaveBeenCalledTimes(2))
    expect(state.post.mock.calls[1]).toEqual(state.post.mock.calls[0])
    expect(state.post.mock.calls[0][1].run_id).toMatch(/^[a-zA-Z0-9_-]{16,100}$/)
    expect(state.post.mock.calls[0][1].run_scope).toBe(state.runScope)
    expect(state.pipeline).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.queryByRole('region', { name: '실행 기록 저장 상태' })).toBeNull())
  })
  it('실제 계산 실패는 경과 시간과 함께 실패로 한 번만 기록한다', async () => {
    state.pipeline.mockRejectedValueOnce(new Error('지원하지 않는 표입니다'))
    startRun()
    await waitFor(() => expect(state.post).toHaveBeenCalledTimes(1))
    expect(state.post.mock.calls[0][1]).toMatchObject({ ok: false, fail_reason: '지원하지 않는 표입니다' })
    expect(state.post.mock.calls[0][1].duration_ms).toBeGreaterThanOrEqual(0)
    expect(screen.queryByRole('button', { name: '엑셀로 내려받기' })).toBeNull()
  })
  it('저장 뒤 조회 실패를 두 번째 실행 실패로 기록하지 않는다', async () => {
    state.reload.mockRejectedValueOnce(new Error('조회 연결 오류'))
    startRun()
    await waitFor(() => expect(state.reload).toHaveBeenCalled())
    expect(state.post).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: '엑셀로 내려받기' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '같은 실행 기록 다시 저장' })).toBeNull()
  })
  it('마우스로 다시 떨어뜨려도 실행 중인 계산을 중복 시작하지 않는다', async () => {
    let done
    state.readFiles.mockImplementationOnce(() => new Promise(resolve => { done = resolve }))
    const view = startRun()
    fireEvent.drop(view.container.querySelector('.dropzone'), { dataTransfer: { files: [new File(['x'], 'second.csv')] } })
    expect(state.readFiles).toHaveBeenCalledTimes(1)
    done([])
    await waitFor(() => expect(state.post).toHaveBeenCalledTimes(1))
  })
  it('한도를 소진하면 파일 드롭도 계산을 시작하지 않는다', async () => {
    state.remaining = 0
    const view = startRun()
    fireEvent.drop(view.container.querySelector('.dropzone'), { dataTransfer: { files: [new File(['x'], 'second.csv')] } })
    expect(state.readFiles).not.toHaveBeenCalled()
    expect(state.pipeline).not.toHaveBeenCalled()
  })

  it('내부 링크로 이동했다가 돌아와도 같은 실행 번호를 재계산 없이 다시 저장한다', async () => {
    state.post.mockRejectedValueOnce(new Error('응답이 끊겼습니다'))
    startRun()
    await screen.findByRole('button', { name: '같은 실행 기록 다시 저장' })
    const firstCall = state.post.mock.calls[0]
    expect(pendingToolRun('scope-a', 'tool-local').payload).toEqual(firstCall[1])
    fireEvent.click(screen.getByRole('link', { name: '이 도구가 나온 신청서 보기' }))
    expect(screen.queryByRole('region', { name: '실행 기록 저장 상태' })).toBeNull()
    const closing = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(closing)
    expect(closing.defaultPrevented).toBe(true)
    fireEvent.click(screen.getByRole('link', { name: '도구로 돌아가기' }))
    fireEvent.click(await screen.findByRole('button', { name: '같은 실행 기록 다시 저장' }))
    await waitFor(() => expect(state.post).toHaveBeenCalledTimes(2))
    expect(state.post.mock.calls[1]).toEqual(firstCall)
    expect(state.pipeline).toHaveBeenCalledTimes(1)
    expect(state.readFiles).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(pendingToolRun('scope-a', 'tool-local')).toBeNull())
  })

  it('다른 계정 또는 작업공간의 실행은 복원하거나 대신 저장하지 않는다', async () => {
    state.post.mockRejectedValueOnce(new Error('저장 여부 미확인'))
    startRun()
    await screen.findByRole('button', { name: '같은 실행 기록 다시 저장' })
    const original = pendingToolRun('scope-a', 'tool-local')
    fireEvent.click(screen.getByRole('link', { name: '이 도구가 나온 신청서 보기' }))
    state.runScope = 'scope-b'
    fireEvent.click(screen.getByRole('link', { name: '도구로 돌아가기' }))
    expect(screen.queryByRole('region', { name: '실행 기록 저장 상태' })).toBeNull()
    expect(screen.getByRole('button', { name: '정산서 파일 넣기' }).disabled).toBe(false)
    expect(pendingToolRun('scope-b', 'tool-local')).toBeNull()
    expect(pendingToolRun('scope-a', 'tool-local')).toEqual(original)
    expect(state.post).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('link', { name: '이 도구가 나온 신청서 보기' }))
    state.runScope = 'scope-a'
    fireEvent.click(screen.getByRole('link', { name: '도구로 돌아가기' }))
    expect(await screen.findByRole('button', { name: '같은 실행 기록 다시 저장' })).toBeTruthy()
    expect(state.post).toHaveBeenCalledTimes(1)
  })

  it('중단된 도구에서도 이전 미확인 실행의 저장 결과만 다시 확인할 수 있다', async () => {
    state.post.mockRejectedValueOnce(new Error('응답이 끊겼습니다'))
    startRun()
    await screen.findByRole('button', { name: '같은 실행 기록 다시 저장' })
    const original = state.post.mock.calls[0]
    fireEvent.click(screen.getByRole('link', { name: '이 도구가 나온 신청서 보기' }))
    state.rolledBack = true
    fireEvent.click(screen.getByRole('link', { name: '도구로 돌아가기' }))
    const retry = await screen.findByRole('button', { name: '같은 실행 기록 다시 저장' })
    expect(screen.queryByRole('button', { name: '정산서 파일 넣기' })).toBeNull()
    expect(screen.queryByRole('button', { name: '엑셀로 내려받기' })).toBeNull()
    fireEvent.click(retry)
    await waitFor(() => expect(state.post).toHaveBeenCalledTimes(2))
    expect(state.post.mock.calls[1]).toEqual(original)
    expect(state.pipeline).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.queryByRole('region', { name: '실행 기록 저장 상태' })).toBeNull())
    expect(pendingToolRun('scope-a', 'tool-local')).toBeNull()
  })
})

describe('탭 메모리 실행 기록 큐', () => {
  it('다른 scope payload나 실행 ID의 덮어쓰기·삭제를 거절한다', () => {
    const first = { payload: { run_id: 'first-run-00000001', run_scope: 'scope-a' } }
    keepToolRun('scope-a', 'tool-local', first)
    keepToolRun('scope-b', 'tool-local', first)
    expect(pendingToolRun('scope-b', 'tool-local')).toBeNull()
    keepToolRun('scope-a', 'tool-local', { payload: { run_id: 'other-run-00000001', run_scope: 'scope-a' } })
    forgetToolRun('scope-a', 'tool-local', 'other-run-00000001')
    expect(pendingToolRun('scope-a', 'tool-local')).toEqual(first)
    forgetToolRun('scope-a', 'tool-local', first.payload.run_id)
    expect(pendingToolRun('scope-a', 'tool-local')).toBeNull()
  })
  it('같은 도구도 scope별로 구분하고 다른 도구의 기록을 덮어쓰지 않는다', () => {
    const first = { payload: { run_id: 'run-identity-00001' }, error: '미확인' }
    const second = { payload: { run_id: 'run-identity-00002' }, error: null }
    keepToolRun('scope-a', 'tool-local', first)
    keepToolRun('scope-a', 'other-tool', second)
    expect(pendingToolRun('scope-a', 'tool-local')).toEqual(first)
    expect(pendingToolRun('scope-a', 'other-tool')).toEqual(second)
    expect(pendingToolRun('scope-b', 'tool-local')).toBeNull()
    keepToolRun(null, 'tool-local', second)
    expect(pendingToolRun(null, 'tool-local')).toBeNull()
    forgetToolRun('scope-b', 'tool-local')
    expect(pendingToolRun('scope-a', 'tool-local')).toEqual(first)
  })

  it('마지막 미확인 기록이 저장될 때만 탭 종료 경고를 해제한다', () => {
    keepToolRun('scope-a', 'tool-local', { payload: { run_id: 'run-identity-00001' } })
    keepToolRun('scope-b', 'other-tool', { payload: { run_id: 'run-identity-00002' } })
    forgetToolRun('scope-a', 'tool-local')
    const pending = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(pending)
    expect(pending.defaultPrevented).toBe(true)
    forgetToolRun('scope-b', 'other-tool')
    const empty = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(empty)
    expect(empty.defaultPrevented).toBe(false)
  })
})

const calculation = () => ({ files: [{ name: 'A-private.csv', channel: 'A-private-channel', rowsOut: 0 }], rows: [],
  quarantine: [{ reason: 'unknown', source: { file: 'A-private.csv', rowNo: 2 }, raw: ['A-private-original'] }],
  stats: { durationMs: 100 }, totals: { byChannel: [] } })
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function leaveSession(view, transition) {
  if (transition === 'slug') fireEvent.click(screen.getByRole('link', { name: '다른 도구' }))
  else if (transition === 'unmount') fireEvent.click(screen.getByRole('link', { name: '이 도구가 나온 신청서 보기' }))
  else {
    state.runScope = 'scope-b'; view.rerender(shell())
    if (transition === 'A→B→A') { state.runScope = 'scope-a'; view.rerender(shell()) }
  }
}
function expectNoOriginal() {
  expect(screen.queryByRole('button', { name: '엑셀로 내려받기' })).toBeNull()
  expect(screen.queryByText('A-private.csv')).toBeNull()
  expect(screen.queryByText('A-private-original')).toBeNull()
}

describe('계정·도구·화면 수명이 달라진 뒤 도착한 실행 응답', () => {
  const cases = ['A→B', 'A→B→A', 'slug', 'unmount'].flatMap(transition =>
    ['read', 'pipeline'].flatMap(phase => ['success', 'failure'].map(outcome => [transition, phase, outcome])))
  it.each(cases)('%s 전환 뒤 %s의 늦은 %s는 원문·알림·저장을 노출하지 않는다', async (transition, phase, outcome) => {
    const late = deferred()
    state[phase === 'read' ? 'readFiles' : 'pipeline'].mockImplementationOnce(() => late.promise)
    state.pipeline.mockResolvedValue(calculation())
    const view = startRun()
    if (phase === 'pipeline') await waitFor(() => expect(state.pipeline).toHaveBeenCalledTimes(1))
    leaveSession(view, transition)
    await act(async () => {
      if (outcome === 'failure') late.reject(new Error('A-private-original 계산 오류'))
      else late.resolve(phase === 'read' ? [] : calculation())
    })
    expectNoOriginal()
    expect(state.post).not.toHaveBeenCalled()
    expect(state.success).not.toHaveBeenCalled(); expect(state.error).not.toHaveBeenCalled()
    expect(pendingToolRun('scope-a', 'tool-local')).toBeNull()
    expect(pendingToolRun('scope-b', 'tool-local')).toBeNull()
    if (phase === 'read') expect(state.pipeline).not.toHaveBeenCalled()
  })

  it.each(['success', 'failure'])('이전 A 저장의 늦은 %s가 현재 B 기록과 재시도 내용을 바꾸지 않는다', async outcome => {
    const late = deferred()
    state.post.mockImplementationOnce(() => late.promise)
    state.pipeline.mockResolvedValue(calculation())
    const view = startRun()
    await waitFor(() => expect(state.post).toHaveBeenCalledTimes(1))
    const oldPayload = state.post.mock.calls[0][1]
    const ownB = { payload: { run_id: 'scope-b-original-run', run_scope: 'scope-b', ok: true }, error: 'B 대기 기록' }
    act(() => keepToolRun('scope-b', 'tool-local', ownB))
    state.success.mockClear(); state.error.mockClear()
    leaveSession(view, 'A→B')
    await screen.findByText('B 대기 기록')
    await act(async () => outcome === 'success' ? late.resolve({ ok: true }) : late.reject(new Error('A 저장 오류')))
    expectNoOriginal()
    expect(screen.getByText('B 대기 기록')).toBeTruthy()
    expect(pendingToolRun('scope-b', 'tool-local')).toEqual(ownB)
    expect(state.success).not.toHaveBeenCalled(); expect(state.error).not.toHaveBeenCalled()
    expect(state.reload).not.toHaveBeenCalled()
    expect(pendingToolRun('scope-a', 'tool-local')?.payload ?? null).toEqual(outcome === 'success' ? null : oldPayload)
    fireEvent.click(screen.getByRole('button', { name: '같은 실행 기록 다시 저장' }))
    await waitFor(() => expect(state.post).toHaveBeenCalledTimes(2))
    expect(state.post.mock.calls[1][1]).toEqual(ownB.payload)
  })

  it.each(['A→B→A', 'slug', 'unmount'].flatMap(transition => ['success', 'failure'].map(outcome => [transition, outcome])))('%s 뒤 늦은 저장 %s는 원래 큐만 갱신하고 새 화면에 원문/알림을 표시하지 않는다', async (transition, outcome) => {
    const late = deferred(); state.post.mockImplementationOnce(() => late.promise)
    const view = startRun(); await waitFor(() => expect(state.post).toHaveBeenCalledTimes(1))
    const oldPayload = state.post.mock.calls[0][1]
    state.success.mockClear(); leaveSession(view, transition)
    await act(async () => outcome === 'success' ? late.resolve({ ok: true }) : late.reject(new Error('원래 실행의 저장 응답 유실')))
    expectNoOriginal(); expect(state.error).not.toHaveBeenCalled(); expect(state.success).not.toHaveBeenCalled()
    expect(pendingToolRun('scope-a', 'tool-local')?.payload ?? null).toEqual(outcome === 'success' ? null : oldPayload)
    if (transition === 'A→B→A' && outcome === 'failure') expect(screen.getByRole('button', { name: '같은 실행 기록 다시 저장' })).toBeTruthy()
    else expect(screen.queryByRole('region', { name: '실행 기록 저장 상태' })).toBeNull()
  })

  it('같은 도구 재진입 후 이전 저장 성공을 관찰하고 오래된 실패가 큐를 다시 만들지 않는다', async () => {
    const original = deferred(), retry = deferred()
    state.post.mockImplementationOnce(() => original.promise).mockImplementationOnce(() => retry.promise)
    startRun(); await waitFor(() => expect(state.post).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('link', { name: '이 도구가 나온 신청서 보기' }))
    fireEvent.click(screen.getByRole('link', { name: '도구로 돌아가기' }))
    fireEvent.click(await screen.findByRole('button', { name: '같은 실행 기록 다시 저장' }))
    await waitFor(() => expect(state.post).toHaveBeenCalledTimes(2))
    expect(state.post.mock.calls[1]).toEqual(state.post.mock.calls[0])
    await act(async () => retry.resolve({ ok: true }))
    expect(pendingToolRun('scope-a', 'tool-local')).toBeNull()
    state.error.mockClear()
    await act(async () => original.reject(new Error('늦은 원래 요청 실패')))
    expect(pendingToolRun('scope-a', 'tool-local')).toBeNull()
    expect(screen.queryByRole('region', { name: '실행 기록 저장 상태' })).toBeNull()
    expect(state.error).not.toHaveBeenCalled(); expectNoOriginal()
    const closing = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(closing)
    expect(closing.defaultPrevented).toBe(false)
  })

  it('재진입한 화면의 재시도 없이도 이전 POST 성공이 대기 안내를 지운다', async () => {
    const late = deferred(); state.post.mockImplementationOnce(() => late.promise)
    startRun(); await waitFor(() => expect(state.post).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('link', { name: '이 도구가 나온 신청서 보기' }))
    fireEvent.click(screen.getByRole('link', { name: '도구로 돌아가기' }))
    await screen.findByRole('button', { name: '같은 실행 기록 다시 저장' })
    state.success.mockClear()
    await act(async () => late.resolve({ ok: true }))
    expect(screen.queryByRole('region', { name: '실행 기록 저장 상태' })).toBeNull()
    expect(pendingToolRun('scope-a', 'tool-local')).toBeNull()
    expect(state.success).not.toHaveBeenCalled(); expect(state.post).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(state.reload).toHaveBeenCalledTimes(1))
  })

  it('현재 세션이 직접 저장한 경우 큐 구독과 명시 재조회가 중복되지 않는다', async () => {
    const late = deferred(); state.post.mockImplementationOnce(() => late.promise)
    startRun(); await waitFor(() => expect(state.post).toHaveBeenCalledTimes(1))
    await screen.findByRole('region', { name: '실행 기록 저장 상태' })
    await act(async () => late.resolve({ ok: true }))
    await waitFor(() => expect(state.reload).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('region', { name: '실행 기록 저장 상태' })).toBeNull()
  })

  it('다른 scope 큐의 삭제는 현재 화면의 통계 재조회를 일으키지 않는다', async () => {
    const late = deferred(); state.post.mockImplementationOnce(() => late.promise)
    const view = startRun(); await waitFor(() => expect(state.post).toHaveBeenCalledTimes(1))
    leaveSession(view, 'A→B')
    await act(async () => late.resolve({ ok: true }))
    expect(state.reload).not.toHaveBeenCalled()
    expectNoOriginal()
  })

  it.each(['success', 'failure'])('현재 재시도 중 이전 POST가 먼저 성공해도 뒤늦은 재시도 %s 후 조회는 한 번이다', async outcome => {
    const old = deferred(), retry = deferred()
    state.post.mockImplementationOnce(() => old.promise).mockImplementationOnce(() => retry.promise)
    startRun(); await waitFor(() => expect(state.post).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('link', { name: '이 도구가 나온 신청서 보기' }))
    fireEvent.click(screen.getByRole('link', { name: '도구로 돌아가기' }))
    fireEvent.click(await screen.findByRole('button', { name: '같은 실행 기록 다시 저장' }))
    await waitFor(() => expect(state.post).toHaveBeenCalledTimes(2))
    await act(async () => old.resolve({ ok: true }))
    expect(state.reload).not.toHaveBeenCalled()
    await act(async () => outcome === 'success' ? retry.resolve({ ok: true }) : retry.reject(new Error('재시도 응답 유실')))
    expect(state.reload).toHaveBeenCalledTimes(1)
    expect(pendingToolRun('scope-a', 'tool-local')).toBeNull()
    expect(screen.queryByRole('region', { name: '실행 기록 저장 상태' })).toBeNull()
  })

  it('확인된 이전 요청의 늦은 실패가 뒤이어 시작한 새 실행 큐를 덮지 않는다', async () => {
    const old = deferred()
    state.post.mockImplementationOnce(() => old.promise).mockResolvedValueOnce({ ok: true }).mockRejectedValueOnce(new Error('다음 실행 저장 미확인'))
    const view = startRun(); await waitFor(() => expect(state.post).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('link', { name: '이 도구가 나온 신청서 보기' }))
    fireEvent.click(screen.getByRole('link', { name: '도구로 돌아가기' }))
    fireEvent.click(await screen.findByRole('button', { name: '같은 실행 기록 다시 저장' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '정산서 파일 넣기' }).disabled).toBe(false))
    fireEvent.change(view.container.querySelector('input[type="file"]'), { target: { files: [new File(['new'], 'next.csv')] } })
    await screen.findByText('다음 실행 저장 미확인')
    const queued = pendingToolRun('scope-a', 'tool-local')
    expect(queued.payload.run_id).not.toBe(state.post.mock.calls[0][1].run_id)
    state.error.mockClear()
    await act(async () => old.reject(new Error('이전 실행의 늦은 실패')))
    expect(pendingToolRun('scope-a', 'tool-local')).toEqual(queued)
    expect(screen.getByText('다음 실행 저장 미확인')).toBeTruthy()
    expect(state.error).not.toHaveBeenCalled()
  })

  it('저장 후 조회를 기다리다가 scope가 바뀌면 조회 오류 알림도 이전 화면과 함께 끝낸다', async () => {
    const late = deferred(); state.reload.mockImplementationOnce(() => late.promise)
    const view = startRun(); await waitFor(() => expect(state.reload).toHaveBeenCalledTimes(1))
    leaveSession(view, 'A→B'); state.error.mockClear()
    await act(async () => late.reject(new Error('A-private 조회 실패')))
    expect(state.error).not.toHaveBeenCalled(); expectNoOriginal()
  })

  it('떠난 화면의 계산 완료가 재진입 후 새 실행의 미확인 큐를 덮지 않는다', async () => {
    const late = deferred(); state.pipeline.mockImplementationOnce(() => late.promise)
    state.post.mockRejectedValueOnce(new Error('새 실행 저장 응답 유실'))
    const view = startRun(); await waitFor(() => expect(state.pipeline).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('link', { name: '이 도구가 나온 신청서 보기' }))
    fireEvent.click(screen.getByRole('link', { name: '도구로 돌아가기' }))
    fireEvent.change(view.container.querySelector('input[type="file"]'), { target: { files: [new File(['new'], 'new.csv')] } })
    await screen.findByRole('button', { name: '같은 실행 기록 다시 저장' })
    const queued = pendingToolRun('scope-a', 'tool-local')
    await act(async () => late.resolve(calculation()))
    expect(state.post).toHaveBeenCalledTimes(1)
    expect(pendingToolRun('scope-a', 'tool-local')).toEqual(queued)
    expect(screen.getByText('새 실행 저장 응답 유실')).toBeTruthy()
    expect(screen.queryByText('A-private-original')).toBeNull()
  })

  it('StrictMode의 효과 재시작 후에도 실행을 한 번만 저장하고 scope 변경 시 구독을 분리한다', async () => {
    const view = render(<StrictMode>{shell()}</StrictMode>)
    fireEvent.change(view.container.querySelector('input[type="file"]'), { target: { files: [new File(['row'], 'strict.csv')] } })
    await waitFor(() => expect(state.post).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(state.reload).toHaveBeenCalledTimes(1))
    expect(state.pipeline).toHaveBeenCalledTimes(1)
    state.runScope = 'scope-b'; view.rerender(<StrictMode>{shell()}</StrictMode>)
    act(() => keepToolRun('scope-a', 'tool-local', { payload: { run_id: 'old-scope-run-0001', run_scope: 'scope-a' }, error: 'A 비공개 저장 오류' }))
    expect(screen.queryByText('A 비공개 저장 오류')).toBeNull()
    expectNoOriginal()
  })
})
