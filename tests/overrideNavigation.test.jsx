// @vitest-environment happy-dom
// The real App and BrowserRouter exercise menu fragments and anchor behavior.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { BrowserRouter, Link, MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from '../src/App.jsx'

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))
vi.mock('../src/api/client.ts', () => ({ api }))
vi.mock('../src/context/ToastContext.jsx', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }))
vi.mock('../src/components/DemoWorkspaceBar.jsx', () => ({ default: () => null }))
vi.mock('../src/components/PageViewTracker.jsx', () => ({ default: () => null }))
const workspace = { demo_mode: false, current_actor: { role: 'product', label: '담당자' }, events: [], clusters: [], experiments: [], products: [], audit: [], ai_calls: [], integrations: [], actors: [], metrics: {}, graph: { nodes: [], edges: [] }, policy_impact: [], fairness: [], common_issues: [] }
const feedback = { cases: [], batches: [], samples: [], followups: [], unread: 0, nonuse: [], nonuseSummary: [], manager: true, reviewer: true }
function Probe() {
  const location = useLocation()
  return <aside><output data-testid="router-location">{location.pathname + location.hash}</output><Link to="/#quality">루트 품질 직접 이동</Link><Link to="/override#quality">별칭 품질 직접 이동</Link></aside>
}
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); window.scrollTo = vi.fn()
  api.get.mockImplementation(async path => path.startsWith('/feedback') ? feedback : path.startsWith('/override/events') ? { events: [], page: { total: 0, limit: 100, hasMore: false } } : workspace)
})
afterEach(async () => { cleanup(); await act(async () => { await Promise.resolve() }); vi.restoreAllMocks() })
const nav = () => within(screen.getByRole('navigation', { name: 'OverrideLoop 주요 메뉴' }))
const current = () => nav().getAllByRole('button').find(button => button.getAttribute('aria-current') === 'page')?.textContent
async function show(path = '/#events') {
  window.history.replaceState({ idx: 0 }, '', path)
  render(<BrowserRouter><App /><Probe /></BrowserRouter>)
  // This test exercises routing, not lazy chunk compilation speed. The first
  // import can exceed the default 1s while PostgreSQL integration suites run.
  await screen.findByRole('navigation', { name: 'OverrideLoop 주요 메뉴' }, { timeout: 5000 })
}

async function changeAddressFragment(hash) {
  await act(async () => {
    window.location.hash = hash
    // happy-dom's Location.hash setter only emits hashchange. Chromium's
    // same-document address navigation also notifies BrowserRouter through
    // popstate; model that event explicitly (real-browser check is separate).
    window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }))
  })
}

for (const path of ['/', '/override']) {
  it(`reads a valid initial hash and supports internal menu buttons at ${path}`, async () => {
    await show(path + '#events')
    expect(current()).toBe('판단 사건')
    fireEvent.click(nav().getByRole('button', { name: '개선 실험' }))
    await waitFor(() => expect(window.location.hash).toBe('#experiments'))
    expect(current()).toBe('개선 실험')
    expect(window.location.pathname).toBe(path)
  })

  it(`follows an externally changed valid hash at ${path}`, async () => {
    await show(path + '#events')
    await changeAddressFragment('#quality')
    expect(window.location.hash).toBe('#quality')
    expect(current()).toBe('현장 점검')
  })

  it(`restores the previous screen after browser back at ${path}`, async () => {
    await show(path + '#events')
    fireEvent.click(nav().getByRole('button', { name: '개선 실험' }))
    fireEvent.click(nav().getByRole('button', { name: '현장 점검' }))
    await act(async () => { window.history.back() })
    await waitFor(() => expect(window.location.hash).toBe('#experiments'))
    expect(current()).toBe('개선 실험')
  })

  it(`restores an intermediate screen after browser forward at ${path}`, async () => {
    await show(path + '#events')
    fireEvent.click(nav().getByRole('button', { name: '개선 실험' }))
    fireEvent.click(nav().getByRole('button', { name: '현장 점검' }))
    await act(async () => { window.history.back() })
    await waitFor(() => expect(window.location.hash).toBe('#experiments'))
    await act(async () => { window.history.back() })
    await waitFor(() => expect(window.location.hash).toBe('#events'))
    await act(async () => { window.history.forward() })
    await waitFor(() => expect(window.location.hash).toBe('#experiments'))
    expect(current()).toBe('개선 실험')
  })
}

it('accepts a React Router link between aliases without keeping the old view', async () => {
  await show('/#events')
  fireEvent.click(screen.getByRole('link', { name: '별칭 품질 직접 이동' }))
  expect(screen.getByTestId('router-location').textContent).toBe('/override#quality')
  expect(current()).toBe('현장 점검')
})

it('accepts a React Router hash link on the same pathname', async () => {
  await show('/#events')
  fireEvent.click(screen.getByRole('link', { name: '루트 품질 직접 이동' }))
  expect(screen.getByTestId('router-location').textContent).toBe('/#quality')
  expect(current()).toBe('현장 점검')
})

it('falls back for an unknown initial fragment without rewriting or adding history', async () => {
  const initialLength = window.history.length
  await show('/#does-not-exist')
  expect(current()).toBe('운영판')
  expect(window.location.hash).toBe('#does-not-exist')
  expect(window.history.length).toBe(initialLength)
})

it('uses the same safe fallback for an unknown fragment after mounting', async () => {
  await show('/#events')
  await changeAddressFragment('#does-not-exist')
  expect(window.location.hash).toBe('#does-not-exist')
  expect(current()).toBe('운영판')
})

it('keeps the current view and history when the App skip link focuses and scrolls the main content', async () => {
  await show('/#events')
  const main = document.getElementById('main'), initialLength = window.history.length
  const scroll = vi.spyOn(main, 'scrollIntoView')
  fireEvent.click(screen.getByRole('link', { name: '본문으로 건너뛰기' }))
  expect(window.location.hash).toBe('#events')
  expect(current()).toBe('판단 사건')
  expect(document.activeElement).toBe(main)
  expect(scroll).toHaveBeenCalledWith({ block: 'start', behavior: 'instant' })
  expect(window.history.length).toBe(initialLength)
})

it('preserves an initial main anchor instead of rewriting it as a workspace section', async () => {
  await show('/#main')
  expect(current()).toBe('운영판')
  expect(window.location.hash).toBe('#main')
})

it('uses the router location as its source of truth under MemoryRouter', async () => {
  window.history.replaceState({}, '', '/#events')
  render(<MemoryRouter initialEntries={['/override#quality']}><App /><Probe /></MemoryRouter>)
  await screen.findByRole('navigation', { name: 'OverrideLoop 주요 메뉴' })
  expect(screen.getByTestId('router-location').textContent).toBe('/override#quality')
  expect(current()).toBe('현장 점검')
})

it('keeps native anchor keyboard semantics and handles the keyboard-generated click without changing the view', async () => {
  await show('/override#quality')
  const link = screen.getByRole('link', { name: '본문으로 건너뛰기' })
  link.focus()
  expect(link.getAttribute('href')).toBe('#main')
  expect(fireEvent.keyDown(link, { key: 'Enter' })).toBe(true)
  // Browsers activate an anchor with an unmodified click of detail 0 on Enter.
  fireEvent.click(link, { detail: 0 })
  expect(document.activeElement).toBe(document.getElementById('main'))
  expect(window.location.hash).toBe('#quality')
  expect(current()).toBe('현장 점검')
})

it.each(['ctrlKey','metaKey','shiftKey','altKey'])('does not cancel a modified anchor click (%s)', async modifier => {
  await show('/#events')
  const link = screen.getByRole('link', { name: '본문으로 건너뛰기' })
  const focus = vi.spyOn(document.getElementById('main'), 'focus')
  expect(link.getAttribute('href')).toBe('#main')
  expect(fireEvent.click(link, { [modifier]: true })).toBe(true)
  expect(focus).not.toHaveBeenCalled()
})

it('does not add history when selecting the already active menu and preserves query parameters', async () => {
  await show('/override?source=local#events')
  const initialLength = window.history.length
  fireEvent.click(nav().getByRole('button', { name: '판단 사건' }))
  expect(window.history.length).toBe(initialLength)
  fireEvent.click(nav().getByRole('button', { name: '현장 점검' }))
  expect(window.location.pathname).toBe('/override')
  expect(window.location.search).toBe('?source=local')
  expect(window.location.hash).toBe('#quality')
  expect(window.history.length).toBe(initialLength + 1)
})
