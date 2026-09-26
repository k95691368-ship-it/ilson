// @vitest-environment happy-dom
import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WorkspaceGate from '../src/components/WorkspaceGate.jsx'
import { ToastProvider, useToast } from '../src/context/ToastContext.jsx'
import { api } from '../src/api/client.ts'
import { useApi } from '../src/hooks/useApi.js'
import { beginAccessCheck, completeAccessCheck, failAccessCheck, getAccessSession } from '../src/lib/accessSession.js'
import { keepToolRun, pendingToolRun, forgetToolRun } from '../src/lib/pendingToolRuns.js'
import { keepBetaRound, pendingBetaRound, forgetBetaRound } from '../src/lib/pendingBetaRounds.js'

const A = 'a'.repeat(64), B = 'b'.repeat(64)
const session = (scope = A) => ({ ok: true, mode: 'access', scope })
const defer = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
let oldToast
function active(scope = A) { const generation = beginAccessCheck(); completeAccessCheck(generation, session(scope)); return generation }
beforeEach(() => { active(); oldToast = null })
afterEach(() => {
  cleanup()
  for (const scope of [A, B]) { forgetToolRun(scope, 'peer-tool'); forgetBetaRound(scope, 'peer-app') }
  vi.unstubAllGlobals()
})
function Probe({ name }) {
  const resource = useApi('/peer-' + name)
  const toast = useToast()
  return <section aria-label={name}>
    <p>{resource.data?.text}</p>
    {resource.error && <p>{resource.error}</p>}
    <input aria-label={name + ' 초안'} defaultValue="" />
    <button onClick={resource.reload}>{name} 재조회</button>
    <button onClick={() => { oldToast = () => toast.success('늦은 옛 계정 알림'); toast.success('이전 계정 알림') }}>{name} 알림</button>
  </section>
}
const tree = strict => {
  const app = <WorkspaceGate><ToastProvider><Probe name="parent" /><Probe name="child" /></ToastProvider></WorkspaceGate>
  return strict ? <StrictMode>{app}</StrictMode> : app
}
function transport({ strict = false } = {}) {
  let scope = A, denied = null
  const fetcher = vi.fn(async url => {
    if (url === '/api/demo/workspace') return Response.json({ enabled: false })
    if (url === '/api/session') return Response.json(session(scope))
    if (url === '/api/peer-child' && denied) return Response.json({ error: '접근 응답 ' + denied }, { status: denied })
    return Response.json({ text: scope === A ? `이전 자료 ${String(url).split('-').at(-1)}` : `새 자료 ${String(url).split('-').at(-1)}` })
  })
  vi.stubGlobal('fetch', fetcher)
  render(tree(strict))
  return { fetcher, deny: value => { denied = value }, switch: value => { scope = value; denied = null } }
}

describe('independent session-lifetime review', () => {
  it.each([401, 428])('child %s hides parent, draft and toast; new scope remounts without erasing old uncertain receipts', async code => {
    keepToolRun(A, 'peer-tool', { payload: { run_id: 'peer-tool-run', run_scope: A } })
    keepBetaRound(A, 'peer-app', { payload: { run_id: 'peer-beta-run', run_scope: A } })
    const wire = transport()
    await screen.findByText('이전 자료 parent')
    fireEvent.change(screen.getByLabelText('parent 초안'), { target: { value: '이전 계정 비공개 초안' } })
    fireEvent.click(screen.getByRole('button', { name: 'parent 알림' }))
    expect(screen.getByText('이전 계정 알림')).toBeTruthy()
    wire.deny(code)
    fireEvent.click(screen.getByRole('button', { name: 'child 재조회' }))
    await screen.findByRole('button', { name: '접근 다시 확인' })
    expect(screen.queryByText('이전 자료 parent')).toBeNull()
    expect(screen.queryByText('이전 계정 알림')).toBeNull()
    expect(screen.queryByLabelText('parent 초안')).toBeNull()
    expect(getAccessSession().status).toBe('blocked')
    wire.switch(B)
    fireEvent.click(screen.getByRole('button', { name: '접근 다시 확인' }))
    await screen.findByText('새 자료 parent')
    await act(async () => oldToast())
    expect(screen.queryByText('늦은 옛 계정 알림')).toBeNull()
    expect(screen.getByLabelText('parent 초안').value).toBe('')
    expect(pendingToolRun(A, 'peer-tool')?.payload.run_id).toBe('peer-tool-run')
    expect(pendingBetaRound(A, 'peer-app')?.payload.run_id).toBe('peer-beta-run')
    expect(pendingToolRun(B, 'peer-tool')).toBeNull()
    expect(pendingBetaRound(B, 'peer-app')).toBeNull()
  })
  it.each([403, 404, 503])('resource %s does not globally revoke the active account', async code => {
    const wire = transport()
    await screen.findByText('이전 자료 parent')
    await screen.findByText('이전 자료 child')
    const generation = getAccessSession().generation
    wire.deny(code)
    fireEvent.click(screen.getByRole('button', { name: 'child 재조회' }))
    await screen.findByText('접근 응답 ' + code)
    expect(getAccessSession()).toMatchObject({ generation, status: 'active', scope: A })
    expect(screen.getByText('이전 자료 parent')).toBeTruthy()
    expect(Boolean(screen.queryByText('이전 자료 child'))).toBe(code === 503)
    expect(screen.queryByRole('button', { name: '접근 다시 확인' })).toBeNull()
  })
  it.each([200, 401])('late %s JSON body cannot restore or revoke a newly verified scope', async status => {
    const body = defer()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: status === 200, status, json: () => body.promise })))
    const request = api.get('/peer-old').catch(error => error)
    await Promise.resolve()
    active(B)
    body.resolve(status === 200 ? { text: '이전 계정 원문' } : { error: '옛 계정 회수' })
    const result = await request
    expect(result.code).toBe('ACCESS_CHANGED')
    expect(result).not.toHaveProperty('text')
    expect(getAccessSession()).toMatchObject({ status: 'active', scope: B })
  })
  it.each(['fetch', 'json'])('a cancelled request receiving 401 during %s does not revoke current access', async stage => {
    const deferred = defer(), controller = new AbortController()
    vi.stubGlobal('fetch', vi.fn(() => stage === 'fetch' ? deferred.promise : Promise.resolve({ status: 401, ok: false, json: () => deferred.promise })))
    const request = api.get('/peer-cancelled', { signal: controller.signal }).catch(error => error)
    await Promise.resolve()
    controller.abort()
    deferred.resolve(stage === 'fetch' ? Response.json({ error: '취소된 회수' }, { status: 401 }) : { error: '취소된 회수' })
    await request
    expect(getAccessSession()).toMatchObject({ status: 'active', scope: A })
  })
  it('StrictMode checks do not leave a duplicate gate or reopen an aborted generation', async () => {
    const wire = transport({ strict: true })
    await screen.findByText('이전 자료 parent')
    expect(screen.getAllByRole('region', { name: 'parent' })).toHaveLength(1)
    expect(getAccessSession()).toMatchObject({ status: 'active', scope: A })
    expect(wire.fetcher.mock.calls.filter(([url]) => url === '/api/session')).toHaveLength(1)
  })
  it('failed and stale probes cannot complete the gate generation', () => {
    const old = beginAccessCheck()
    const current = beginAccessCheck()
    expect(completeAccessCheck(old, session(A))).toBe(false)
    expect(failAccessCheck(old, '옛 실패')).toBe(false)
    expect(failAccessCheck(current, '현재 실패')).toBe(true)
    expect(completeAccessCheck(current, session(B))).toBe(false)
    expect(getAccessSession()).toMatchObject({ status: 'blocked', scope: null, error: '현재 실패' })
  })
  it('a failed protected probe leaves business requests and forms locked', async () => {
    const fetcher = vi.fn(async url => url === '/api/demo/workspace' ? Response.json({ enabled: false }) : Response.json({ error: '권한 확인 불가' }, { status: 503 }))
    vi.stubGlobal('fetch', fetcher)
    render(tree(false))
    await screen.findByRole('button', { name: '접근 다시 확인' })
    expect(getAccessSession().status).toBe('blocked')
    expect(screen.queryByLabelText('parent 초안')).toBeNull()
    await expect(api.get('/peer-parent')).rejects.toMatchObject({ status: 401 })
    expect(fetcher.mock.calls.some(([url]) => url === '/api/peer-parent')).toBe(false)
  })
  it.each([200, 401])('an unmounted old gate returning %s cannot activate or revoke its replacement', async status => {
    const oldProbe = defer()
    let probes = 0
    vi.stubGlobal('fetch', vi.fn(async url => {
      if (url === '/api/demo/workspace') return Response.json({ enabled: false })
      if (url === '/api/session') return ++probes === 1 ? oldProbe.promise : Response.json(session(B))
      return Response.json({ text: '현재 계정 자료' })
    }))
    const old = render(tree(false))
    await waitFor(() => expect(probes).toBe(1))
    old.unmount()
    render(tree(false))
    await waitFor(() => expect(getAccessSession()).toMatchObject({ status: 'active', scope: B }))
    await act(async () => { oldProbe.resolve(Response.json(status === 200 ? session(A) : { error: '옛 계정 접근 거절' }, { status })); await Promise.resolve() })
    expect(getAccessSession()).toMatchObject({ status: 'active', scope: B })
    expect(screen.queryByRole('button', { name: '접근 다시 확인' })).toBeNull()
  })
})
