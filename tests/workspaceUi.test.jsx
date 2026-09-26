// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import WorkspaceGate from '../src/components/WorkspaceGate.jsx'
import DemoWorkspaceBar from '../src/components/DemoWorkspaceBar.jsx'
import JourneyPage from '../src/pages/JourneyPage.jsx'
import { ensureWorkspace, readAccessSession, readWorkspace, resetWorkspace, api } from '../src/api/client.ts'
import { useApi } from '../src/hooks/useApi.js'
import { DRAFT_KEY, draftKey } from '../src/lib/draft.js'
import { beginAccessCheck, completeAccessCheck } from '../src/lib/accessSession.js'

vi.mock('../src/api/client.ts', () => ({ ensureWorkspace: vi.fn(), readAccessSession: vi.fn(), readWorkspace: vi.fn(), resetWorkspace: vi.fn(), api: { post: vi.fn() } }))
vi.mock('../src/hooks/useApi.js', () => ({ useApi: vi.fn() }))
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear() })
beforeEach(() => { vi.clearAllMocks(); readWorkspace.mockResolvedValue({enabled:true,active:false}); readAccessSession.mockResolvedValue({ok:true,mode:'demo',scope:'a'.repeat(64)}) })

describe('workspace and journey UI', () => {
  it('does not render business screens before workspace initialization', async () => {
    let resolve
    ensureWorkspace.mockReturnValue(new Promise(done => { resolve = done }))
    render(<WorkspaceGate><p>업무 화면</p></WorkspaceGate>)
    expect(screen.queryByText('업무 화면')).toBeNull()
    expect(ensureWorkspace).not.toHaveBeenCalled()
    fireEvent.click(await screen.findByRole('button',{name:'개인 체험 시작'}))
    resolve({ enabled: true, active: true })
    await waitFor(() => expect(screen.queryByText('업무 화면')).not.toBeNull())
  })
  it('fails closed and offers retry when initialization fails', async () => {
    ensureWorkspace.mockRejectedValueOnce(new Error('연결 실패')).mockResolvedValue({ enabled: true, active: true })
    render(<WorkspaceGate><p>업무 화면</p></WorkspaceGate>)
    fireEvent.click(await screen.findByRole('button',{name:'개인 체험 시작'}))
    await screen.findByRole('alert')
    expect(screen.queryByText('업무 화면')).toBeNull()
    expect(screen.getByRole('heading',{name:'개인 체험',level:1})).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '개인 체험 시작' }))
    await screen.findByText('업무 화면')
  })
  it('requires the second reset click and clears only ILSON local state', async () => {
    const scope = 'a'.repeat(64), other = 'b'.repeat(64)
    completeAccessCheck(beginAccessCheck(), { ok: true, mode: 'demo', scope })
    readWorkspace.mockResolvedValue({ enabled: true, active: true })
    resetWorkspace.mockResolvedValue({ reset: true })
    const navigate = vi.spyOn(window.location, 'assign').mockImplementation(() => {})
    localStorage.setItem(DRAFT_KEY, 'draft')
    localStorage.setItem(draftKey(scope), 'current scoped draft')
    localStorage.setItem(draftKey(other), 'other scoped draft')
    localStorage.setItem(`ilson:who:v2:${scope}:tool`, 'current name')
    localStorage.setItem(`ilson:who:v2:${other}:tool`, 'other name')
    localStorage.setItem('unrelated-app', 'preserve')
    render(<MemoryRouter><DemoWorkspaceBar /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: '내 체험 초기화' }))
    expect(resetWorkspace).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '취소' }))
    expect(resetWorkspace).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '내 체험 초기화' }))
    fireEvent.click(screen.getByRole('button', { name: '내 기록 삭제하고 다시 시작' }))
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/journey'))
    expect(resetWorkspace).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull()
    expect(localStorage.getItem(draftKey(scope))).toBeNull()
    expect(localStorage.getItem(draftKey(other))).toBe('other scoped draft')
    expect(localStorage.getItem(`ilson:who:v2:${scope}:tool`)).toBeNull()
    expect(localStorage.getItem(`ilson:who:v2:${other}:tool`)).toBe('other name')
    expect(localStorage.getItem('unrelated-app')).toBe('preserve')
  })
  it('connects the selected product from the actual journey form', async () => {
    const reload = vi.fn(async () => {})
    const data = { application: { id: 'a', title: '신청', dept: '재무' }, done: { 신청서: true, 제작: false },
      operations: { products: [] }, availableProducts: [{ id: 'p', name: '제품', owner_team: '운영' }], entries: [] }
    useApi.mockReturnValue({ data, reload })
    api.post.mockResolvedValue({ ok: true })
    render(<MemoryRouter initialEntries={['/journey/a']}><Routes><Route path="/journey/:id" element={<JourneyPage />} /></Routes></MemoryRouter>)
    fireEvent.change(screen.getByLabelText('운영 제품'), { target: { value: 'p' } })
    fireEvent.click(screen.getByRole('button', { name: '신청과 연결' }))
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/applications/a/journey', { productId: 'p' }))
    await screen.findByText('운영 제품을 연결했습니다.')
    expect(screen.getByText('기록 없음')).toBeTruthy()
  })
})
