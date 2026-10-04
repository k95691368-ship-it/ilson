import { describe, it, expect } from 'vitest'
import { buildJourney } from '../shared/journey.js'

describe('unified journey', () => {
  it('orders evidence without inventing unrecorded stages', () => {
    const entries = buildJourney({ application: { id: 'a', title: '신청', created_at: '2026-01-01' } }, {
      products: [{ id: 'p', name: '제품', linked_at: '2026-03-01' }],
      events: [{ id: 'e', human_decision: '수정', occurred_at: '2026-02-01' }],
    })
    expect(entries.map(e => e.kind)).toEqual(['신청', '판단 사건', '운영 연결'])
    expect(entries.some(e => e.kind === '성과')).toBe(false)
  })
  it('uses the existing outcome label, retaining uncertainty', () => {
    const entries = buildJourney({ application: { id: 'a' }, outcome: { id: 'o' }, moneyLabel: { label: '보수적 추정' } }, {})
    expect(entries.find(e => e.kind === '성과').detail).toBe('보수적 추정')
  })
  it('keeps exact source identities without putting source text into links', () => {
    const entries = buildJourney({ application: { id: 'a' } }, {
      events: [{ id: 'old event', human_decision: 'PRIVATE ORIGINAL' }],
      experiments: [{ id: 'x/old', title: 'PRIVATE PLAN' }],
      runs: [{ id: 'run-old', experiment_id: 'x/old' }],
      decisions: [{ id: 'decision-old', experiment_id: 'x/old' }],
    })
    const link = kind => new URL(entries.find(entry => entry.kind === kind).href, 'https://local.invalid')
    expect(link('판단 사건').searchParams.get('eventId')).toBe('old event')
    expect(link('개선 실험').searchParams.get('experimentId')).toBe('x/old')
    expect(link('실험 결과').searchParams.get('experimentId')).toBe('x/old')
    expect(link('실험 결과').searchParams.get('runId')).toBe('run-old')
    expect(link('운영 결정').searchParams.get('decisionId')).toBe('decision-old')
    expect(entries.map(entry => entry.href).join(' ')).not.toContain('PRIVATE')
  })
})
