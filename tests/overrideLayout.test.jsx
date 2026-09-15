// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import OverridePage from '../src/pages/OverridePage.jsx'

vi.mock('../src/hooks/useApi.js', () => ({
  useApi: () => ({ data: { demo_mode: true, events: [], products: [] }, loading: false, error: null, reload: vi.fn() }),
}))
vi.mock('../src/context/ToastContext.jsx', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }))

beforeEach(() => {
  window.location.hash = ''
  window.localStorage.clear()
})
afterEach(cleanup)

describe('간소화한 OverrideLoop 첫 화면', () => {
  it('지목된 네 영역을 숨기지 않고 DOM에서 제거한다', () => {
    const { container } = render(<MemoryRouter><OverridePage /></MemoryRouter>)
    for (const text of ['지금, 확인할 것들.', '전체 운영 측정 보기', '지금 봐야 할 문제', '안전 신호', '운영 중인 AI', '제품 추가 +']) {
      expect(screen.queryByText(text)).toBeNull()
    }
    expect(container.querySelectorAll('.ol-overview > section')).toHaveLength(2)
    expect(screen.getByRole('list', { name: 'OverrideLoop 전체 흐름' }).children).toHaveLength(6)
  })

  it('판단 사건 진입은 유지한다', () => {
    render(<MemoryRouter><OverridePage /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: '판단 사건 살펴보기' }))
    expect(window.location.hash).toBe('#events')
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
