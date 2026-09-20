// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import FieldFeedbackView from '../src/components/FieldFeedbackView.jsx'
import { beginAccessCheck, completeAccessCheck } from '../src/lib/accessSession.js'

// The production gate verifies a session before mounting this protected view.
beforeEach(() => {
  expect(completeAccessCheck(beginAccessCheck(), { ok: true, mode: 'access', scope: 'a'.repeat(64) })).toBe(true)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
it('removes old employee evidence and manager forms when a refresh loses permission', async () => {
  const original = { manager: true, unread: 0, batches: [], samples: [], followups: [], nonuse: [], cases: [
    { id: 'case-a', event_id: 'event-a', product_name: '가상 AI', reason_detail: '다른 직원의 비공개 제보 원문', updates: [], followups: [] },
  ] }
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json(original))
    .mockResolvedValueOnce(Response.json({ error: '현재 계정에는 열람 권한이 없습니다.' }, { status: 403 }))
    .mockResolvedValueOnce(Response.json({ ...original, manager: false, cases: [] }))
  vi.stubGlobal('fetch', fetcher)
  render(<FieldFeedbackView mode="feedback" role="product" products={[]} onCapture={() => {}} />)
  expect(await screen.findByText('다른 직원의 비공개 제보 원문')).toBeTruthy()
  expect(screen.getByText('담당자 안내 작성')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '새로고침' }))
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', '현재 계정에는 열람 권한이 없습니다.')
  expect(screen.queryByText('다른 직원의 비공개 제보 원문')).toBeNull()
  expect(screen.queryByText('담당자 안내 작성')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '새로고침' }))
  expect(await screen.findByText(/내가 남긴 피드백/)).toBeTruthy()
  expect(screen.queryByText('다른 직원의 비공개 제보 원문')).toBeNull()
  expect(screen.queryByRole('alert')).toBeNull()
})
