// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import App from '../src/App.jsx'
import StageHeader from '../src/components/StageHeader.jsx'
import WorkspaceGate from '../src/components/WorkspaceGate.jsx'
import { STAGES } from '../src/lib/stages.js'
import { DEPTS } from '../shared/depts.js'

vi.mock('../src/pages/OverridePage.jsx', () => ({ default: () => <h1>운영판 경로 확인</h1> }))
vi.mock('../src/pages/ApplyPage.jsx', () => ({ default: () => <h1>신청 경로 확인</h1> }))
vi.mock('../src/hooks/useApi.js', () => ({ useApi: () => ({ data: null, loading: false }) }))
vi.mock('../src/components/PageViewTracker.jsx', () => ({ default: () => null }))
vi.mock('../src/api/client.js', () => ({
  readWorkspace: vi.fn(async () => ({ enabled: true, active: false })),
  readAccessSession: vi.fn(), ensureWorkspace: vi.fn(), resetWorkspace: vi.fn(),
}))
afterEach(cleanup)

function RouteProbe() {
  const location = useLocation()
  const navigate = useNavigate()
  return <aside><output data-testid="route-location">{location.pathname + location.search + location.hash}</output><button type="button" onClick={() => navigate(-1)}>이전 주소</button></aside>
}

describe('minimal interface without losing navigation or essential notices', () => {
  it('keeps the stage title and ownership once without a duplicate stage menu', () => {
    const stage = STAGES[0]
    const { container } = render(<MemoryRouter><StageHeader stageKey={stage.key} /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: stage.title })).toBeTruthy()
    expect(screen.getByText(new RegExp(stage.owner))).toBeTruthy()
    expect(container.querySelector('.stage-progress')).toBeNull()
    expect(container.querySelector('.stage-kicker')).toBeNull()
    expect(container.querySelector('.page-sub')).toBeNull()
  })
  it('redirects the retired page and keeps workflow and department navigation without data', async () => {
    const { container } = render(<MemoryRouter initialEntries={['/portfolio']}><App /><RouteProbe /></MemoryRouter>)
    await screen.findByRole('heading', { name: '운영판 경로 확인' })
    expect(screen.getByTestId('route-location').textContent).toBe('/')
    expect(screen.queryByRole('heading', { name: '업무 현황' })).toBeNull()
    expect(container.querySelector('.product-subnav')).toBeNull()
    expect(container.querySelector('.settlement-preview')).toBeNull()
    expect(container.querySelector('.flow-feature')).toBeNull()
    expect(container.querySelector('.footer-menu').open).toBe(false)
    for (const stage of STAGES) expect(container.querySelector(`a[href="${stage.path}"]`)).toBeTruthy()
    for (const path of ['/journey', '/tools', '/log', '/honesty', '/bug']) {
      expect(container.querySelector(`a[href="${path}"]`)).toBeTruthy()
    }
    const topbar = within(screen.getByRole('navigation', { name: '전체 사이트' }))
    const topbarLinks = topbar.getAllByRole('link')
    expect(topbarLinks[0].textContent).toBe('AI 운영')
    expect(topbarLinks.filter(link => link.getAttribute('href') === '/')).toHaveLength(1)
    expect(topbar.queryByRole('link', { name: '일손' })).toBeNull()
    expect(screen.getByRole('link', { name: 'OverrideLoop 운영판' }).getAttribute('href')).toBe('/')
    expect(container.querySelector('a[href="/portfolio"]')).toBeNull()
    fireEvent.click(screen.getByText('운영 메뉴', { selector: 'summary' }))
    const departments = within(screen.getByRole('navigation', { name: '부서별 기록' }))
    for (const dept of DEPTS) {
      expect(departments.getByRole('link', { name: dept }).getAttribute('href')).toBe(`/dept/${encodeURIComponent(dept)}`)
    }
  })
  it('replaces the retired history entry and drops obsolete query and section fragments', async () => {
    render(<MemoryRouter initialEntries={['/apply', '/portfolio?legacy=1#process']}><App /><RouteProbe /></MemoryRouter>)
    await screen.findByRole('heading', { name: '운영판 경로 확인' })
    expect(screen.getByTestId('route-location').textContent).toBe('/')
    fireEvent.click(screen.getByRole('button', { name: '이전 주소' }))
    await waitFor(() => expect(screen.getByTestId('route-location').textContent).toBe('/apply'))
    await screen.findByRole('heading', { name: '신청 경로 확인' })
    expect(screen.queryByRole('heading', { name: '운영판 경로 확인' })).toBeNull()
  })
  it('keeps the demo lifetime, isolation and no-external-execution notice before entry', async () => {
    render(<WorkspaceGate><p>업무 화면</p></WorkspaceGate>)
    await screen.findByRole('heading', { name: '개인 체험', level: 1 })
    expect(screen.getByText(/다른 방문자와 분리된 공간/)).toBeTruthy()
    expect(screen.getByText(/7일 후 만료/)).toBeTruthy()
    expect(screen.getByText(/외부 AI 호출이나 실제 배포는 실행하지 않습니다/)).toBeTruthy()
    expect(screen.getByRole('button', { name: '개인 체험 시작' })).toBeTruthy()
    expect(screen.queryByText('업무 화면')).toBeNull()
  })
})
