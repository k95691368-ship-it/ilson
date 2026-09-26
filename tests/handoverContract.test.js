import { describe, expect, it } from 'vitest'
import { isHandoverEvidence, readHandoverEvidence } from '../shared/contracts/handover.ts'
import { onRequestGet } from '../functions/api/applications/[id]/handover.ts'

const valid = () => ({
  application: { id: 'application-contract', title: '계약 검증', dept: '재무' },
  expectedEvidence: 'a'.repeat(64), blockers: [], humanCriteria: [],
  scope: '고정 기간의 브라우저 정산 도구', handover: null, manual: null,
})
const handed = () => ({
  slug: 'settlement-contract', title: '계약 검증', handed_to_dept: '재무', handed_to_person: '검증 담당자',
  daily_limit: 20, max_file_mb: 10, rolled_back_at: null,
})

describe('handover unknown-to-client contract', () => {
  it('accepts the actual GET handler response projection without asserting extra server evidence', async () => {
    const sample = valid()
    const rows = {
      application: { ...sample.application, ticket_no: 'AX-CON-001', status: '수용', beta_criteria_revision: 0 },
      handover: handed(), manual: { when_to_run: null, what_to_do_after: null, contact: null },
    }
    const DB = { prepare(sql) {
      const statement = {
        bind: () => statement,
        first: async () => {
          const table = /FROM\s+(application|handover|manual)\b/i.exec(sql)?.[1]
          return table ? rows[table] : null
        },
        all: async () => ({ results: [] }),
      }
      return statement
    } }
    const response = await onRequestGet({ env: { DB }, params: { id: sample.application.id } })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(readHandoverEvidence(body)).toBe(body)
    expect(body.signoff.binding).toBe(false)
    expect(body).not.toHaveProperty('proof')
    expect(body).not.toHaveProperty('baseline')
  })

  it('accepts null historical instruction columns and stopped handovers', () => {
    const sample = { ...valid(), handover: { ...handed(), rolled_back_at: '2026-09-26 00:00:00' },
      manual: { when_to_run: null, what_to_do_after: null, contact: null },
      humanCriteria: [{ id: 'human-check', body: '직접 사용 확인' }] }
    expect(readHandoverEvidence(sample)).toBe(sample)
    expect(isHandoverEvidence(valid())).toBe(true)
  })

  it.each([null, undefined, [], true, 'response', 123, {}])('rejects malformed top-level JSON %j', value => {
    expect(isHandoverEvidence(value)).toBe(false)
    expect(() => readHandoverEvidence(value)).toThrow('서버 응답을 확인하지 못했습니다.')
  })

  it.each([
    { application: { id: 'x', title: 1, dept: '재무' } },
    { expectedEvidence: 'a'.repeat(63) },
    { expectedEvidence: 'z'.repeat(64) },
    { blockers: [null] },
    { humanCriteria: [{ id: 'x', body: ['not text'] }] },
    { handover: { ...handed(), daily_limit: '20' } },
    { handover: { ...handed(), max_file_mb: NaN } },
    { handover: { ...handed(), rolled_back_at: false } },
    { manual: { when_to_run: null, what_to_do_after: null, contact: {} } },
    { manual: {} },
    { scope: {} },
  ])('rejects malformed nested consumed values %j', patch => {
    expect(isHandoverEvidence({ ...valid(), ...patch })).toBe(false)
  })
})
