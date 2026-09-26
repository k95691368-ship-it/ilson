// @vitest-environment happy-dom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import Thread from '../src/components/Thread.jsx'

const client = vi.hoisted(() => ({ post: vi.fn() }))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('../src/api/client.ts', () => ({ api: client }))
vi.mock('../src/context/ToastContext.jsx', () => ({ useToast: () => toast }))

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
let writes
beforeEach(() => {
  writes = []
  client.post.mockReset(); toast.success.mockReset(); toast.error.mockReset()
  client.post.mockImplementation((path, body) => {
    const write = { ...deferred(), path, body }
    writes.push(write)
    return write.promise
  })
})
afterEach(cleanup)

const variants = [
  { name: '담당자 질문', mode: 'staff', decisions: [], open: '되물어보기', submit: '질문 남기기', path: '/applications/app-A/ask', body: { question: '첫 내용', why: '첫 작성자 또는 사유', author: 'AX 담당자' }, field: 'question' },
  { name: '부서 질문', mode: 'dept', decisions: [], open: '담당자에게 물어보기', submit: '보내기', path: '/track/AX-111-111/ask', body: { question: '첫 내용', author: '첫 작성자 또는 사유' }, field: 'question' },
  { name: '부서 답변', mode: 'dept', decisions: [{ id: 'q', link_kind: '질문', what: '담당자 질문', created_at: '2026-01-01' }], submit: '답 보내기', path: '/track/AX-111-111/answer', body: { answer: '첫 내용', author: '첫 작성자 또는 사유', questionId: 'q' }, field: 'answer' },
  { name: '담당자 답변', mode: 'staff', decisions: [{ id: 'q', link_kind: '부서질문', what: '부서 질문', created_at: '2026-01-01' }], submit: '답하기', path: '/applications/app-A/reply', body: { answer: '첫 내용', author: '첫 작성자 또는 사유', questionId: 'q' }, field: 'answer' },
]
function element(variant, identity = 'A', onChanged = vi.fn()) {
  return <Thread mode={variant.mode} ticket={identity === 'A' ? 'AX-111-111' : 'AX-222-222'} applicationId={`app-${identity}`} decisions={variant.decisions} onChanged={onChanged} />
}
function openForm(variant) {
  if (variant.open) fireEvent.click(screen.getByRole('button', { name: variant.open }))
  return screen.getByRole('button', { name: variant.submit }).closest('form')
}
function fill(form, first = '첫 내용', second = '첫 작성자 또는 사유') {
  const inputs = within(form).getAllByRole('textbox')
  fireEvent.change(inputs[0], { target: { value: first } })
  fireEvent.change(inputs[1], { target: { value: second } })
  return inputs
}

describe('같은 신청서의 질문·답변 전송 중 초안을 보호한다', () => {
  for (const variant of variants) {
    it(`${variant.name}: 완료 전에는 편집·닫기·재열기·중복 전송을 막고 완료 후 새 초안을 작성할 수 있다`, async () => {
      const refreshed = deferred(), onChanged = vi.fn(() => refreshed.promise)
      render(element(variant, 'A', onChanged))
      const form = openForm(variant), inputs = fill(form)
      fireEvent.submit(form)
      expect(writes).toHaveLength(1)
      expect(writes[0]).toMatchObject({ path: variant.path, body: variant.body })
      expect(inputs.every(input => input.disabled)).toBe(true)
      expect(within(form).getByRole('status').textContent).toContain('화면을 이동해도 전송 요청은 취소되지 않습니다.')
      if (variant.open) {
        const close = within(form).getByRole('button', { name: '그만두기' })
        expect(close.disabled).toBe(true)
        fireEvent.click(close)
        expect(screen.queryByRole('button', { name: variant.open })).toBeNull()
        expect(inputs[0].value).toBe('첫 내용')
      }
      fireEvent.submit(form)
      expect(writes).toHaveLength(1)

      await act(async () => { writes[0].resolve({ message: '전송 완료', tellThem: '전송 완료' }) })
      expect(onChanged).toHaveBeenCalledTimes(1)
      if (variant.open) {
        const reopen = screen.getByRole('button', { name: variant.open })
        expect(reopen.disabled).toBe(true)
        fireEvent.click(reopen)
        expect(screen.queryByRole('textbox')).toBeNull()
      } else {
        expect(inputs.every(input => input.disabled)).toBe(true)
      }
      await act(async () => { refreshed.resolve() })
      const freshForm = variant.open ? openForm(variant) : form
      expect(within(freshForm).getAllByRole('textbox').every(input => !input.disabled)).toBe(true)
      const freshInputs = fill(freshForm, '완료 후 새 초안', '새 작성자 또는 사유')
      await act(async () => {})
      expect(freshInputs[0].value).toBe('완료 후 새 초안')
      expect(freshInputs[1].value).toBe('새 작성자 또는 사유')
      expect(toast.success).toHaveBeenCalledTimes(1)
    })

    it(`${variant.name}: 실패하면 원래 입력을 유지하며 편집·닫기·재전송을 다시 허용한다`, async () => {
      render(element(variant))
      const form = openForm(variant), inputs = fill(form)
      fireEvent.submit(form)
      await act(async () => { writes[0].reject(Object.assign(Error('전송 실패'), { fields: { [variant.field]: '내용을 다시 확인해 주세요.' } })) })
      expect(inputs.map(input => input.value)).toEqual(['첫 내용', '첫 작성자 또는 사유'])
      expect(inputs.every(input => !input.disabled)).toBe(true)
      expect(screen.getByText('내용을 다시 확인해 주세요.')).toBeTruthy()
      expect(toast.error).toHaveBeenCalledWith('전송 실패')
      if (variant.open) {
        fireEvent.click(within(form).getByRole('button', { name: '그만두기' }))
        const reopened = openForm(variant)
        expect(within(reopened).getAllByRole('textbox')[0].value).toBe('첫 내용')
        fill(reopened, '고친 내용')
        fireEvent.submit(reopened)
      } else {
        fill(form, '고친 내용')
        fireEvent.submit(form)
      }
      expect(writes).toHaveLength(2)
      expect(writes[1].body[variant.field]).toBe('고친 내용')
    })

    it.each(['success', 'failure'])(`${variant.name}: 다른 신청서로 이동한 뒤 옛 %s가 새 초안을 건드리지 않는다`, async kind => {
      const onChanged = vi.fn()
      const view = render(element(variant, 'A', onChanged))
      const form = openForm(variant); fill(form); fireEvent.submit(form)
      view.rerender(element(variant, 'B', onChanged))
      const freshForm = openForm(variant), inputs = fill(freshForm, 'B 신청서 새 초안', 'B 작성자 또는 사유')
      expect(inputs.every(input => !input.disabled)).toBe(true)
      await act(async () => {
        if (kind === 'success') writes[0].resolve({ message: '옛 전송 완료', tellThem: '옛 전송 완료' })
        else writes[0].reject(Error('옛 전송 실패'))
      })
      expect(inputs.map(input => input.value)).toEqual(['B 신청서 새 초안', 'B 작성자 또는 사유'])
      expect(inputs.every(input => !input.disabled)).toBe(true)
      expect(toast.success).not.toHaveBeenCalled(); expect(toast.error).not.toHaveBeenCalled(); expect(onChanged).not.toHaveBeenCalled()
    })
  }
})
