// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import SourceReferences, { SourceFile } from '../src/components/SourceReference.jsx'

afterEach(cleanup)
const first = { name: '01_정산.csv', sha256: 'a'.repeat(64), ambiguousName: true }
const second = { ...first, sha256: 'b'.repeat(64) }

it('keeps complete same-name fingerprints behind one native keyboard disclosure', () => {
  const { container } = render(<SourceReferences files={[first, second]} />)
  expect(container.querySelector('details').open).toBe(false)
  expect(screen.getByText('원본 파일 구분 · 2개')).toBeTruthy()
  expect(screen.getByText(first.sha256)).toBeTruthy()
  expect(screen.getByText(second.sha256)).toBeTruthy()
  expect(screen.getByText(/금액의 정확성이나 승인/)).toBeTruthy()
  expect(screen.getByText(/새로고침하면 사라집니다/)).toBeTruthy()
  expect(screen.getByTitle(`SHA-256 ${first.sha256}`)).toBeTruthy()
})

it('preserves exact names while adding no hash decoration to an unambiguous compact reference', () => {
  const { container } = render(<SourceFile source={{ file: first.name, sha256: first.sha256, ambiguousName: false }} />)
  expect(container.textContent).toBe(first.name)
  expect(container.querySelector('small')).toBeNull()
})

it('does not claim a hash exists in historical records, and retains duplicate suppression explanation', () => {
  render(<SourceReferences localOnly={false} files={[
    { name: 'legacy.csv' },
    { ...first, skippedDuplicate: true, duplicateOf: { file: 'original.csv', sha256: first.sha256 } },
  ]} />)
  expect(screen.getByText('이 기록에는 원본 지문이 없습니다.')).toBeTruthy()
  expect(screen.getByText(/기준 파일: original.csv/)).toBeTruthy()
  expect(screen.queryByText(/새로고침하면 사라집니다/)).toBeNull()
})
