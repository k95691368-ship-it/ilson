// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import WorkspaceGate from '../src/components/WorkspaceGate.jsx'
import OverridePage from '../src/pages/OverridePage.jsx'
import { ToastProvider } from '../src/context/ToastContext.jsx'
import { getAccessSession } from '../src/lib/accessSession.js'

const scopeFor = account => (account === 'A' ? 'a' : 'b').repeat(64)
function workspace(account) {
  const email = `${account.toLowerCase()}@local.invalid`
  return {
    demo_mode: false, current_actor: { email, label: `${account} 계정 담당자`, role: 'product', is_admin: false },
    products: [{ id: `product-${account}`, name: `${account} AI` }], events: [], experiments: [], integrations: [], audit: [], ai_calls: [], actors: [], assignment_candidates: [],
    clusters: [{ id: `cluster-${account}`, title: `${account} 전용 반복 문제`, summary: `${account}-PRIVATE-CLUSTER-SUMMARY`, cause_code: 'model', cause_status: 'candidate', owner_team: `${account} 담당 조직`, status: 'open', priority_score: 20, recurrence_count: 1, cause_candidates: [], assignee_email: email, next_response_on: '2030-01-01' }],
  }
}
function feedback(account) {
  return {
    manager: true, reviewer: true, unread: 0, batches: [], samples: [], followups: [], nonuse: [], nonuseSummary: [],
    cases: [{ id: `case-${account}`, event_id: `event-${account}`, product_name: `${account} AI`, reason_detail: `${account}-PRIVATE-FEEDBACK`, is_mine: true, updates: [], followups: [] }],
  }
}
function eventEvidence(account) {
  return { id: `event-${account}`, product_name: `${account} AI`, decision_action: 'modify', validity: 'valid', ai_decision: `${account}-PRIVATE-AI-ORIGINAL`, human_decision: `${account}-PRIVATE-HUMAN-JUDGEMENT`, reason_detail: `${account}-PRIVATE-EVENT-REASON`, policy_refs: [], changed_fields: [], data_refs: [] }
}
function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

beforeEach(() => { window.localStorage.clear(); window.location.hash = '' })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

// Do not mock useApi, client, authentication state, the gate, or either screen.
// This regression exercises the real parent/child cache and modal lifetimes.
function setup() {
  const state = { account: 'A', workspaceStatus: 200, sessionStatus: 200, pendingFeedback: null, feedbackStatus: 200 }
  const fetcher = vi.fn(async (url, options = {}) => {
    const path = String(url)
    const method = options.method ?? 'GET'
    if (path === '/api/demo/workspace') {
      expect(method).toBe('GET')
      return state.workspaceStatus === 200 ? Response.json({ enabled: false }) : Response.json({ error: '작업공간 확인 실패' }, { status: state.workspaceStatus })
    }
    if (path === '/api/session') {
      expect(method).toBe('GET')
      expect(options.signal).toBeInstanceOf(AbortSignal)
      return state.sessionStatus === 200
        ? Response.json({ ok: true, mode: 'access', scope: scopeFor(state.account) })
        : Response.json({ error: '세션 재확인 실패' }, { status: state.sessionStatus })
    }
    if (path === '/api/override' && method === 'GET') return Response.json(workspace(state.account))
    if (path === '/api/override' && method === 'POST') {
      expect(JSON.parse(options.body).action).toBe('acknowledge_cluster')
      return Response.json({ error: 'A-PRIVATE-TOAST' }, { status: 400 })
    }
    if (path.startsWith('/api/feedback?') && method === 'GET') {
      if (state.pendingFeedback) return state.pendingFeedback.promise
      return state.feedbackStatus === 200 ? Response.json(feedback(state.account)) : Response.json({ error: '피드백 열람 권한이 없습니다.' }, { status: state.feedbackStatus })
    }
    if (path.startsWith('/api/override/events?') && method === 'GET') {
      const params = new URL(path, 'https://local.invalid').searchParams
      return Response.json({ events: params.has('eventId') ? [eventEvidence(state.account)] : [], page: { total: params.has('eventId') ? 1 : 0, hasMore: false } })
    }
    throw new Error(`Unexpected local request: ${method} ${path}`)
  })
  vi.stubGlobal('fetch', fetcher)
  render(<MemoryRouter initialEntries={['/#clusters']}>
    <WorkspaceGate><ToastProvider><OverridePage /></ToastProvider></WorkspaceGate>
  </MemoryRouter>)
  const count = path => fetcher.mock.calls.filter(([url, options]) => String(url) === path && (!options.method || options.method === 'GET')).length
  return { state, fetcher, count }
}

async function openPrivateFeedbackWithToast() {
  expect(await screen.findByText('A-PRIVATE-CLUSTER-SUMMARY')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '담당 접수 확인' }))
  expect(await screen.findByRole('button', { name: /A-PRIVATE-TOAST/ })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '내 피드백', exact: true }))
  expect(await screen.findByText('A-PRIVATE-FEEDBACK')).toBeTruthy()
}
function expectPrivateViewHidden() {
  expect(document.querySelector('.ol-shell')).toBeNull()
  expect(screen.queryByRole('navigation', { name: 'OverrideLoop 주요 메뉴' })).toBeNull()
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(document.body.textContent).not.toMatch(/A-PRIVATE-|A 계정 담당자/)
  expect(getAccessSession().status).toBe('blocked')
}

describe('OverrideLoop 자식 401 이후 전체 세션 화면의 수명', () => {
  it.each([401, 503])('원문 모달·토스트·부모 캐시를 숨기며 재확인 %s는 잠금을 유지하고 scope B만 새로 연다', async sessionFailure => {
    const { state, count } = setup()
    await openPrivateFeedbackWithToast()
    expect(getAccessSession().scope).toBe(scopeFor('A'))
    expect(count('/api/override')).toBe(1)

    // A refresh can still be pending while the user opens its already visible
    // source record. The denial must remove both independently loaded trees.
    const late = deferred()
    state.pendingFeedback = late
    fireEvent.click(screen.getByRole('button', { name: '새로고침' }))
    fireEvent.click(screen.getByRole('button', { name: '원 사건 보기' }))
    const modal = await screen.findByRole('dialog', { name: '판단 사건 원문' })
    expect(await within(modal).findByText('A-PRIVATE-AI-ORIGINAL')).toBeTruthy()
    expect(within(modal).getByText('A-PRIVATE-HUMAN-JUDGEMENT')).toBeTruthy()
    await act(async () => late.resolve(Response.json({ error: '세션이 만료되었습니다.' }, { status: 401 })))
    await screen.findByRole('button', { name: '접근 다시 확인' })
    await waitFor(expectPrivateViewHidden)
    expect(document.body.classList.contains('ol-modal-open')).toBe(false)
    expect(count('/api/override')).toBe(1)

    // Neither workspace discovery failure nor a rejected protected probe is
    // permission to display the parent's old snapshot again.
    state.pendingFeedback = null
    state.workspaceStatus = 503
    fireEvent.click(screen.getByRole('button', { name: '접근 다시 확인' }))
    await screen.findByText('체험 공간을 확인하지 못했습니다. 소개는 계속 보실 수 있습니다.')
    expectPrivateViewHidden()
    expect(count('/api/session')).toBe(1)
    expect(count('/api/override')).toBe(1)

    state.workspaceStatus = 200
    state.sessionStatus = sessionFailure
    fireEvent.click(screen.getByRole('button', { name: '접근 다시 확인' }))
    await screen.findByText('세션 재확인 실패')
    expectPrivateViewHidden()
    expect(count('/api/session')).toBe(2)
    expect(count('/api/override')).toBe(1)

    state.account = 'B'
    state.sessionStatus = 200
    fireEvent.click(screen.getByRole('button', { name: '접근 다시 확인' }))
    expect(await screen.findByText('B-PRIVATE-FEEDBACK')).toBeTruthy()
    expect(getAccessSession()).toMatchObject({ status: 'active', scope: scopeFor('B') })
    expect(count('/api/demo/workspace')).toBe(4)
    expect(count('/api/session')).toBe(3)
    expect(count('/api/override')).toBe(2)
    expect(document.body.textContent).not.toMatch(/A-PRIVATE-|A 계정 담당자/)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.querySelector('.toast')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '반복 문제', exact: true }))
    expect(await screen.findByText('B-PRIVATE-CLUSTER-SUMMARY')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/A-PRIVATE-|A 계정 담당자/)
    fireEvent.click(screen.getByRole('button', { name: '내 피드백', exact: true }))
    fireEvent.click(await screen.findByRole('button', { name: '원 사건 보기' }))
    expect(await within(screen.getByRole('dialog')).findByText('B-PRIVATE-AI-ORIGINAL')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/A-PRIVATE-|A 계정 담당자/)
  })

  it('피드백의 403은 그 원문만 숨기며 허용된 부모 자료와 현재 세션은 유지한다', async () => {
    const { state, count } = setup()
    await openPrivateFeedbackWithToast()
    const generation = getAccessSession().generation
    state.feedbackStatus = 403
    fireEvent.click(screen.getByRole('button', { name: '새로고침' }))
    expect(await screen.findByText('피드백 열람 권한이 없습니다.')).toBeTruthy()
    expect(screen.queryByText('A-PRIVATE-FEEDBACK')).toBeNull()
    expect(screen.queryByText('담당자 안내 작성')).toBeNull()
    expect(screen.queryByRole('button', { name: '접근 다시 확인' })).toBeNull()
    expect(getAccessSession()).toMatchObject({ generation, status: 'active', scope: scopeFor('A') })
    fireEvent.click(screen.getByRole('button', { name: '반복 문제', exact: true }))
    expect(await screen.findByText('A-PRIVATE-CLUSTER-SUMMARY')).toBeTruthy()
    expect(screen.getByRole('button', { name: '원인·담당 확정' })).toBeTruthy()
    expect(count('/api/override')).toBe(1)
    expect(count('/api/session')).toBe(1)
  })
})
