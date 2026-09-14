import { describe, it, expect } from 'vitest'
import { findSimilar, corpusOf, similarity } from '../shared/similar.js'

const words = ['정산서 채널 매출', '고객문의 반품 환불', '발주 재고 소진일', '', '매주 확인합니다', '숫자 엑셀 보고서']
const make = n => Array.from({ length: n }, (_, i) => ({ id: `a${i}`, title: words[i % 6], bottleneck: words[(i * 3 + 1) % 6], problem: words[(i * 5 + 2) % 6], dept: ['재무', '운영', ''][i % 3], created_at: String(i % 7) }))
function reference(draft, list, threshold, limit) {
  const corpus = corpusOf(list)
  return list.filter(other => !(draft?.id && draft.id === other?.id))
    .map(other => ({ ...other, ...similarity(draft, other, corpus) }))
    .filter(hit => hit.score >= threshold)
    .map(hit => ({ ...hit, same: hit.score >= 0.55 }))
    .sort((a, b) => b.score - a.score || String(a.created_at).localeCompare(String(b.created_at)))
    .slice(0, limit)
}

describe('prepared similarity preserves ranking and explanations', () => {
  it.each([0, 1, 3, 4, 37, 1200])('matches independent pairwise evaluation for %i applications', n => {
    const list = make(n)
    for (const draft of [{}, list[0], { ...list[1], id: 'new' }]) {
      for (const threshold of [0, 0.34, 0.55, 1]) {
        expect(findSimilar(draft, list, { threshold, limit: 7 })).toEqual(reference(draft, list, threshold, 7))
      }
    }
  })
  it('does not reuse stale tokens or mutate input between workspaces/calls', () => {
    const list = make(8)
    const draft = { title: '정산서 채널 매출', dept: '재무' }
    const before = structuredClone(list)
    findSimilar(draft, list)
    expect(list).toEqual(before)
    list[0].title = '완전히 다른 보안 점검'
    expect(findSimilar(draft, list)).toEqual(reference(draft, list, 0.34, 3))
  })
})
