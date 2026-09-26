// @vitest-environment happy-dom
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import OverridePage from '../src/pages/OverridePage.jsx'

const mocks = vi.hoisted(() => ({ post: vi.fn(), reload: vi.fn(), success: vi.fn(), error: vi.fn() }))
vi.mock('../src/api/client.ts', () => ({ api: { post: mocks.post } }))
vi.mock('../src/hooks/useApi.js', () => ({
  useApi: () => ({ data: { demo_mode: true, events: [], products: [{ id: 'test-product', name: '시험 AI' }] }, loading: false, error: null, reload: mocks.reload }),
}))
vi.mock('../src/context/ToastContext.jsx', () => ({ useToast: () => ({ success: mocks.success, error: mocks.error }) }))

beforeEach(() => {
  vi.clearAllMocks()
  window.location.hash = ''
  window.localStorage.clear()
  mocks.reload.mockResolvedValue(undefined)
  mocks.post.mockResolvedValue({ ok: true })
})
afterEach(cleanup)

function openModal({ strict = false } = {}) {
  const tree = <MemoryRouter><OverridePage /></MemoryRouter>
  const result = render(strict ? <StrictMode>{tree}</StrictMode> : tree)
  const trigger = screen.getByRole('button', { name: '판단 기록', exact: true })
  trigger.focus()
  fireEvent.click(trigger)
  const dialog = screen.getByRole('dialog', { name: '새 판단 기록' })
  return { ...result, trigger, dialog, close: within(dialog).getByRole('button', { name: '닫기' }), submit: within(dialog).getByRole('button', { name: '판단 증거 저장' }) }
}

describe('OverrideLoop 모달 키보드 접근성', () => {
  it('열릴 때 내부로 초점을 옮기고 Escape로 닫으면 열었던 버튼으로 돌아온다', () => {
    const { trigger, dialog, close } = openModal()
    expect(document.activeElement).toBe(close)
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(document.body.classList.contains('ol-modal-open')).toBe(true)
    fireEvent.keyDown(close, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(trigger)
    expect(document.body.classList.contains('ol-modal-open')).toBe(false)
  })

  it('마지막 요소의 Tab과 첫 요소의 Shift+Tab을 모달 안에서 순환시킨다', () => {
    const { close, submit } = openModal()
    submit.focus()
    expect(fireEvent.keyDown(submit, { key: 'Tab' })).toBe(false)
    expect(document.activeElement).toBe(close)
    expect(fireEvent.keyDown(close, { key: 'Tab', shiftKey: true })).toBe(false)
    expect(document.activeElement).toBe(submit)
  })

  it('중간 입력의 기본 Tab 이동은 막지 않는다', () => {
    const { dialog } = openModal()
    dialog.querySelector('details').open = true
    const input = dialog.querySelector('[name="externalRef"]')
    input.focus()
    expect(fireEvent.keyDown(input, { key: 'Tab' })).toBe(true)
    expect(document.activeElement).toBe(input)
  })

  it('동적으로 숨겨지거나 비활성화된 입력을 순환 대상에서 제외한다', () => {
    const { dialog, close, submit } = openModal()
    dialog.querySelector('details').open = true
    submit.disabled = true
    dialog.querySelector('[name="businessOutcome"]').closest('label').hidden = true
    const last = dialog.querySelector('[name="customerOutcome"]')
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)
    fireEvent.keyDown(last, { key: 'Tab' })
    expect(document.activeElement).toBe(close)
  })

  it('배경으로 이동한 초점을 되돌리고 닫힌 뒤에는 배경 탐색을 허용한다', () => {
    const { trigger, close } = openModal()
    trigger.focus()
    expect(document.activeElement).toBe(close)
    fireEvent.click(close)
    expect(document.activeElement).toBe(trigger)
    const background = screen.getByRole('button', { name: '운영판', exact: true })
    background.focus()
    expect(document.activeElement).toBe(background)
  })

  it('초점을 받을 수 있는 입력이 없으면 모달 자체를 유지한다', () => {
    const { dialog } = openModal()
    for (const element of dialog.querySelectorAll('button, input, select, textarea')) element.disabled = true
    dialog.querySelector('summary').tabIndex = -1
    dialog.focus()
    fireEvent.keyDown(dialog, { key: 'Tab' })
    expect(document.activeElement).toBe(dialog)
  })

  it('저장 중 재렌더링은 입력 초점을 초기화하지 않으며 최신 닫기 제한을 따른다', async () => {
    let rejectSave
    mocks.post.mockImplementation(() => new Promise((resolve, reject) => { rejectSave = reject }))
    const { dialog, close } = openModal()
    dialog.querySelector('details').open = true
    const input = dialog.querySelector('[name="externalRef"]')
    input.focus()
    fireEvent.submit(dialog.querySelector('form'))
    expect(document.activeElement).toBe(input)
    expect(within(dialog).getByRole('button', { name: '저장 중…' }).disabled).toBe(true)
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.getByRole('dialog')).toBe(dialog)
    await act(async () => { rejectSave(new Error('시험 저장 오류')) })
    expect(document.activeElement).toBe(input)
    fireEvent.keyDown(close, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('기존 폼 제출은 유지하고 성공 후 초점을 복원한다', async () => {
    const { trigger, dialog } = openModal()
    fireEvent.change(dialog.querySelector('[name="externalRef"]'), { target: { value: 'TEST-123' } })
    fireEvent.submit(dialog.querySelector('form'))
    // DOM removal can precede React's passive-effect cleanup. Wait for the
    // complete close contract, including focus restoration and scroll unlock.
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(document.activeElement).toBe(trigger)
      expect(document.body.classList.contains('ol-modal-open')).toBe(false)
    })
    expect(mocks.post).toHaveBeenCalledWith('/override', expect.objectContaining({ action: 'capture_event', productId: 'test-product', externalRef: 'TEST-123' }))
    expect(mocks.reload).toHaveBeenCalledOnce()
  })

  it('배경 클릭으로 닫아도 초점을 복원한다', () => {
    const { trigger, dialog } = openModal()
    fireEvent.mouseDown(dialog.parentElement)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('StrictMode 효과 재실행 뒤에도 초점과 정리를 유지한다', () => {
    const { trigger, close } = openModal({ strict: true })
    expect(document.activeElement).toBe(close)
    fireEvent.click(close)
    expect(document.activeElement).toBe(trigger)
    expect(document.body.classList.contains('ol-modal-open')).toBe(false)
  })
})
