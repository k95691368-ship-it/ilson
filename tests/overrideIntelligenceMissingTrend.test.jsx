// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import OverridePage from '../src/pages/OverridePage.jsx'

const state = vi.hoisted(() => ({ data: null }))
vi.mock('../src/hooks/useApi.js', () => ({
  useApi: () => ({ data: state.data, loading: false, error: null, reload: vi.fn() }),
}))
vi.mock('../src/context/ToastContext.jsx', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }))

beforeEach(() => {
  window.location.hash = '#intelligence'
  window.localStorage.clear()
  state.data = {
    demo_mode: true, products: [], events: [], clusters: [], policy_impact: [], fairness: [],
    common_issues: [], graph: { nodes: [], edges: [] },
  }
})
afterEach(cleanup)

function cluster(id, trend) {
  return { id, title: `반복 문제 ${id}`, owner_team: '운영팀', priority_score: 30, ...(trend === undefined ? {} : { trend }) }
}

function renderIntelligence() {
  const result = render(<MemoryRouter initialEntries={['/#intelligence']}><OverridePage /></MemoryRouter>)
  return { ...result, signals: result.container.querySelector('.ol-signal-list') }
}

describe('조직 인사이트의 누락된 추세', () => {
  it('원본 자료의 집계 범위를 함께 표시한다', () => {
    state.data.metrics = { totals_scope: '계정에 열람이 허용된 전체 이력' }
    renderIntelligence()
    expect(screen.getByText('원본 자료 집계 범위: 계정에 열람이 허용된 전체 이력')).toBeTruthy()
  })
  it.each([undefined, null, {}, { direction: 'flat' }, { direction: 'flat', change: null }, { direction: 'surge', change: NaN }, { change: 0 }])('추세가 유효하지 않으면 화면을 유지하고 자료 없음을 표시한다: %j', (trend) => {
    state.data.clusters = [cluster('old', trend)]
    const { signals } = renderIntelligence()
    expect(screen.getByRole('heading', { name: '조직 인사이트' })).toBeTruthy()
    expect(within(signals).getByText('반복 문제 old')).toBeTruthy()
    expect(within(signals).getByText('자료 없음')).toBeTruthy()
    expect(signals.textContent).not.toMatch(/0%|undefined|NaN/)
    expect(signals.querySelector('.ol-trend').className).toBe('ol-trend unavailable')
  })

  it('정상적인 상승·하락·변화 없음·신규 신호는 원래 값으로 표시한다', () => {
    state.data.clusters = [
      cluster('up', { direction: 'surge', change: 50 }),
      cluster('down', { direction: 'down', change: -30 }),
      cluster('flat', { direction: 'flat', change: 0 }),
      cluster('new', { direction: 'new', change: 100 }),
    ]
    const { signals } = renderIntelligence()
    expect([...signals.children].map(row => row.querySelector('strong').textContent)).toEqual(['+50%', '-30%', '0%', '+100%'])
    expect([...signals.querySelectorAll('.ol-trend')].map(label => label.textContent)).toEqual(['↑', '↓', '–', 'NEW'])
    expect(within(signals).queryByText('자료 없음')).toBeNull()
  })

  it('측정된 변화 없음과 측정 자료가 없는 문제를 같은 목록에서 구분한다', () => {
    state.data.clusters = [cluster('missing'), cluster('measured', { direction: 'flat', change: 0 })]
    const { signals } = renderIntelligence()
    expect(signals.children[0].querySelector('strong').textContent).toBe('자료 없음')
    expect(signals.children[1].querySelector('strong').textContent).toBe('0%')
  })

  it('반복 문제가 없는 상태에서도 조직 인사이트를 열 수 있다', () => {
    const { signals } = renderIntelligence()
    expect(screen.getByRole('heading', { name: '새 예외·증가 신호' })).toBeTruthy()
    expect(signals.children).toHaveLength(0)
  })
})
