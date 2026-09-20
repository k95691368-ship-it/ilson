// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import App from '../src/App.jsx'
import StageHeader from '../src/components/StageHeader.jsx'
import WorkspaceGate from '../src/components/WorkspaceGate.jsx'
import { STAGES } from '../src/lib/stages.js'

vi.mock('../src/hooks/useApi.js', () => ({ useApi: () => ({ data: null, loading: false }) }))
vi.mock('../src/components/PageViewTracker.jsx', () => ({ default: () => null }))
vi.mock('../src/api/client.js', () => ({
  readWorkspace: vi.fn(async () => ({ enabled: true, active: false })),
  readAccessSession: vi.fn(), ensureWorkspace: vi.fn(), resetWorkspace: vi.fn(),
}))
afterEach(cleanup)

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
  it('removes promotional blocks and the repeated subnav while keeping all destinations', async () => {
    const { container } = render(<MemoryRouter initialEntries={['/portfolio']}><App /></MemoryRouter>)
    await screen.findByRole('heading', { name: '업무 현황' })
    expect(container.querySelector('.product-subnav')).toBeNull()
    expect(container.querySelector('.settlement-preview')).toBeNull()
    expect(container.querySelector('.flow-feature')).toBeNull()
    expect(container.querySelector('.footer-menu').open).toBe(false)
    for (const stage of STAGES) expect(container.querySelector(`a[href="${stage.path}"]`)).toBeTruthy()
    for (const path of ['/journey', '/tools', '/log', '/honesty', '/bug']) {
      expect(container.querySelector(`a[href="${path}"]`)).toBeTruthy()
    }
  })
  it('keeps the demo lifetime, isolation and no-external-execution notice before entry', async () => {
    render(<WorkspaceGate><p>업무 화면</p></WorkspaceGate>)
    await screen.findByRole('heading', { name: '일손 체험' })
    expect(screen.getByText(/다른 방문자와 분리된 공간/)).toBeTruthy()
    expect(screen.getByText(/7일 후 만료/)).toBeTruthy()
    expect(screen.getByText(/외부 AI 호출이나 실제 배포는 실행하지 않습니다/)).toBeTruthy()
    expect(screen.getByRole('button', { name: '개인 체험 시작' })).toBeTruthy()
    expect(screen.queryByText('업무 화면')).toBeNull()
  })
})
