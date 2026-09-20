// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import OverridePage from '../src/pages/OverridePage.jsx'

const workspace = vi.hoisted(() => ({ events: [] }))
vi.mock('../src/hooks/useApi.js', () => ({
  useApi: () => ({ data: { demo_mode: true, events: workspace.events, products: [] }, loading: false, error: null, reload: vi.fn() }),
}))
vi.mock('../src/context/ToastContext.jsx', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }))

beforeEach(() => {
  window.location.hash = ''
  window.localStorage.clear()
  workspace.events = []
})
afterEach(cleanup)

function LocationProbe() {
  return <output data-testid="workspace-location">{useLocation().hash}</output>
}

describe('간소화한 OverrideLoop 첫 화면', () => {
  it('지목된 네 영역을 숨기지 않고 DOM에서 제거한다', () => {
    const { container } = render(<MemoryRouter><OverridePage /></MemoryRouter>)
    for (const text of ['지금, 확인할 것들.', '전체 운영 측정 보기', '지금 봐야 할 문제', '안전 신호', '운영 중인 AI', '제품 추가 +']) {
      expect(screen.queryByText(text)).toBeNull()
    }
    expect(container.querySelector('.ol-hero')).toBeNull()
    expect(screen.queryByRole('list', { name: 'OverrideLoop 전체 흐름' })).toBeNull()
    expect(screen.queryByText(/AI의 답에/)).toBeNull()
    expect(screen.queryByText(/바꾸기 전에 시험하고/)).toBeNull()
    expect(screen.getByRole('heading', { name: '운영판' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '개선 실험 보기' })).toBeTruthy()
    expect(screen.getByText('가상의 회사·부서·데이터로 구성된 포트폴리오입니다.')).toBeTruthy()
  })

  it('최근 사건의 원문·판단 근거·시연 표시를 유지한다', () => {
    workspace.events = [{ id: 'event-preview', product_name: '상담 도구', is_override: 1, ai_decision: '원래 답변', human_decision: '수정한 답변', reason_detail: '수정 근거', validity: 'pending' }]
    render(<MemoryRouter><OverridePage /></MemoryRouter>)
    const preview = screen.getByRole('region', { name: '최근 판단 사건 미리보기' })
    for (const text of ['최근 판단 · 시연 사건', '상담 도구', '원래 답변', '수정한 답변', '수정 근거', '검토 대기']) {
      expect(within(preview).getByText(text)).toBeTruthy()
    }
  })

  it('판단 사건 진입은 유지한다', () => {
    render(<MemoryRouter><OverridePage /><LocationProbe /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: '판단 사건 살펴보기' }))
    expect(screen.getByTestId('workspace-location').textContent).toBe('#events')
    expect(screen.queryByRole('list', { name: 'OverrideLoop 전체 흐름' })).toBeNull()
    expect(screen.getAllByRole('button', { name: '판단 기록' })).toHaveLength(2)
  })

  it('확대한 메뉴에서도 전체 항목과 Escape 복귀를 유지한다', () => {
    render(<MemoryRouter><OverridePage /></MemoryRouter>)
    const toggle = screen.getByRole('button', { name: 'OverrideLoop 메뉴' })
    fireEvent.click(toggle)
    const menu = screen.getByRole('navigation', { name: 'OverrideLoop 전체 메뉴' })
    expect(within(menu).getAllByRole('button')).toHaveLength(9)
    expect(within(menu).getByRole('button', { name: '내 피드백' })).toBeTruthy()
    expect(within(menu).getByRole('button', { name: '현장 점검' })).toBeTruthy()
    fireEvent.keyDown(menu, { key: 'Escape' })
    expect(screen.queryByRole('navigation', { name: 'OverrideLoop 전체 메뉴' })).toBeNull()
    expect(document.activeElement).toBe(toggle)
  })
})
