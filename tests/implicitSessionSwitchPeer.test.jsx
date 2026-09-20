// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import WorkspaceGate from '../src/components/WorkspaceGate.jsx'
import Thread from '../src/components/Thread.jsx'
import { ToastProvider } from '../src/context/ToastContext.jsx'
import { useApi } from '../src/hooks/useApi.js'
import { getAccessSession } from '../src/lib/accessSession.js'

const A = 'a'.repeat(64), B = 'b'.repeat(64)
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
function Child() {
  const { data, reload } = useApi('/peer-child')
  return <section><p>{data?.text}</p><button onClick={reload}>하위 기록 새로고침</button></section>
}
function Page() {
  const { data } = useApi('/applications/shared')
  return <><h1>{data?.title}</h1>{data && <Thread mode="staff" applicationId="shared" decisions={[]} onChanged={() => {}} />}<Child /></>
}

describe('server scope precondition after valid cookie replacement', () => {
  it.each(['read', 'write'])('%s detects a different cookie scope and removes A data before a B write', async action => {
    let cookieScope = A
    const writes = []
    vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
      if (url === '/api/demo/workspace') return Response.json({ enabled: true, active: true })
      if (url === '/api/session') return Response.json({ ok: true, mode: 'demo', scope: cookieScope })
      if (options.headers?.get('X-Ilson-Scope') !== cookieScope) {
        return Response.json({ error: '접근 계정이 변경됐습니다.', code: 'SESSION_SCOPE_CHANGED' }, { status: 409 })
      }
      if (url === '/api/applications/shared/ask') {
        writes.push({ scope: cookieScope, body: JSON.parse(options.body) })
        return Response.json({ ok: true, tellThem: '질문이 저장됐습니다.' })
      }
      if (url === '/api/applications/shared') return Response.json({ title: cookieScope === A ? 'A 공간의 신청서' : 'B 공간의 신청서' })
      return Response.json({ text: cookieScope === A ? 'A 하위 기록' : 'B 하위 기록' })
    }))
    render(<WorkspaceGate><ToastProvider><Page /></ToastProvider></WorkspaceGate>)
    await screen.findByRole('heading', { name: 'A 공간의 신청서' })
    await screen.findByText('A 하위 기록')
    const generation = getAccessSession().generation
    fireEvent.click(screen.getByRole('button', { name: '되물어보기' }))
    fireEvent.change(screen.getByLabelText(/무엇이 궁금하십니까/), { target: { value: 'A 공간에서만 문의하려던 비공개 내용입니다.' } })
    fireEvent.change(screen.getByLabelText(/이걸 알아야 무엇을 정할 수 있습니까/), { target: { value: 'A 신청서의 제작 여부를 확인하려고 작성했습니다.' } })
    cookieScope = B // same-origin cookie replacement outside this React tree
    fireEvent.click(screen.getByRole('button', { name: action === 'read' ? '하위 기록 새로고침' : '질문 남기기' }))
    await screen.findByRole('button', { name: '접근 다시 확인' })
    expect(writes).toHaveLength(0)
    expect(screen.queryByRole('heading', { name: 'A 공간의 신청서' })).toBeNull()
    expect(screen.queryByText('B 하위 기록')).toBeNull()
    expect(screen.queryByLabelText(/무엇이 궁금하십니까/)).toBeNull()
    expect(getAccessSession()).toMatchObject({ generation: generation + 1, status: 'blocked', scope: null })
    fireEvent.click(screen.getByRole('button', { name: '접근 다시 확인' }))
    await screen.findByRole('heading', { name: 'B 공간의 신청서' })
    await screen.findByText('B 하위 기록')
    expect(screen.queryByText('A 공간에서만 문의하려던 비공개 내용입니다.')).toBeNull()
    await waitFor(() => expect(getAccessSession()).toMatchObject({ status: 'active', scope: B }))
    expect(writes).toHaveLength(0)
  })
})
