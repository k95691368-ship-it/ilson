// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Joined } from '../src/pages/ReviewPage.jsx'

const state = vi.hoisted(() => ({ data: null, post: vi.fn(), reload: vi.fn(), success: vi.fn(), error: vi.fn() }))
vi.mock('../src/hooks/useApi.js', () => ({ useApi: () => ({ data: state.data, reload: state.reload }) }))
vi.mock('../src/api/client.ts', () => ({ api: { post: state.post } }))
vi.mock('../src/context/ToastContext.jsx', () => ({ useToast: () => ({ success: state.success, error: state.error }) }))
beforeEach(() => {
  vi.clearAllMocks()
  state.data = { joins: [{ id: 'join-marketing', dept: '마케팅', story: '같은 문제를 겪고 있습니다.', at: '2026-01-01', accessVerified: false }], summary: { deptCount: 2 }, capabilities: { canAuthorizeParticipation: true } }
  state.post.mockResolvedValue({ ok: true, message: '참여 권한을 확인했습니다.' })
  state.reload.mockResolvedValue(undefined)
})
afterEach(cleanup)

describe('참여 부서 권한의 명시적 확인 화면', () => {
  it('관리자도 부서와 공유 범위를 직접 확인한 뒤에만 요청한다', async () => {
    render(<Joined id="app-test" />)
    fireEvent.click(screen.getByRole('button', { name: '참여 부서 권한 확인' }))
    const form = screen.getByRole('button', { name: '확인한 범위로 참여 허용' }).closest('form')
    fireEvent.submit(form)
    expect(state.post).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('확인한 참여 부서'), { target: { value: '마케팅' } })
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.submit(form)
    await waitFor(() => expect(state.post).toHaveBeenCalledWith('/applications/app-test/join', { kind: 'authorize', join_id: 'join-marketing', dept: '마케팅' }))
    await waitFor(() => expect(state.reload).toHaveBeenCalled())
    expect(state.success).toHaveBeenCalledWith('참여 권한을 확인했습니다.')
  })
  it('일반 담당자에게 관리자 권한 부여 버튼을 노출하지 않는다', () => {
    state.data.capabilities.canAuthorizeParticipation = false
    render(<Joined id="app-test" />)
    expect(screen.queryByRole('button', { name: '참여 부서 권한 확인' })).toBeNull()
    expect(screen.getByText('관리자의 참여 부서 확인이 필요합니다.')).toBeTruthy()
  })
  it('이미 확인되었거나 demo인 기록에는 추가 승인 동작을 만들지 않는다', () => {
    state.data.joins[0].accessVerified = true
    const view = render(<Joined id="app-test" />)
    expect(screen.getByText('참여 부서 조회·서명 권한 확인됨')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '참여 부서 권한 확인' })).toBeNull()
    delete state.data.joins[0].accessVerified
    view.rerender(<Joined id="app-test" />)
    expect(screen.queryByText(/참여 권한 확인 대기/)).toBeNull()
  })
  it('서버의 소유자 확인 오류를 숨기지 않고 재시도할 입력을 유지한다', async () => {
    state.post.mockRejectedValue(new Error('관리자가 먼저 이 신청서의 소유 계정을 확인해야 합니다.'))
    render(<Joined id="app-test" />)
    fireEvent.click(screen.getByRole('button', { name: '참여 부서 권한 확인' }))
    fireEvent.change(screen.getByLabelText('확인한 참여 부서'), { target: { value: '마케팅' } })
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.submit(screen.getByRole('button', { name: '확인한 범위로 참여 허용' }).closest('form'))
    await waitFor(() => expect(state.error).toHaveBeenCalledWith('관리자가 먼저 이 신청서의 소유 계정을 확인해야 합니다.'))
    expect(screen.getByLabelText('확인한 참여 부서').value).toBe('마케팅')
    expect(state.reload).not.toHaveBeenCalled()
    expect(state.success).not.toHaveBeenCalled()
  })
})
