import { describe, expect, it } from 'vitest'
import { annualize, computeOutcome, runsFromTotals, buildChallenges, labelForOutcome } from '../shared/outcome.js'
import { returnedFor, returnedLine, returnedNote } from '../shared/returned.js'

const baseline = { median_seconds: 600, min_seconds: 600, max_seconds: 600, sample_n: 5, people: 1, hourly_wage_krw: 3600 }
const success = { ok: 1, duration_ms: 1000, human_review_seconds: 30, rework_seconds: 0 }
const failure = { ok: 0, duration_ms: 1000, human_review_seconds: 30, rework_seconds: 60 }
const department = (overrides = {}) => ({ ...baseline, ticket_no: 'A', runs: 1, success_count: 0, failed_count: 1, duration_total_ms: 1000, review_seconds: 30, rework_seconds: 60, dept_confirmed_at: '2026-01-01', currentConfirmed: true, ...overrides })

describe('실패 시도의 비용과 성공 기준선을 구분한다', () => {
  it('실패만 있으면 절감 크레딧 없이 모든 비용을 남긴다', () => {
    const outcome = computeOutcome({ baseline, runs: [failure], devHours: 2, opsCostKrw: 500 })
    expect(outcome).toMatchObject({ attemptCount: 1, runCount: 1, successCount: 0, failedCount: 1, unknownCount: 0, manualSeconds: 0, afterSeconds: 91, savedSeconds: -91, netKrw: -7791, status: '아직본전' })
    expect(outcome.breakEven).toMatchObject({ done: false, perRunKrw: null, runsNeeded: null, neverAtThisRate: true })
    expect(annualize(outcome, '매일')).toBeNull()
    expect(labelForOutcome({ status: '인정' }, 0).label).toBe('성공 확인 없음')
    expect(labelForOutcome(outcome, 0).label).toBe('성공 확인 없음')
    expect(buildChallenges({ outcome }).map(item => item.code)).toEqual(expect.arrayContaining(['unsuccessful_runs', 'slower_than_before']))
  })
  it('성공 1회 실패 1회에서 성공 기준선 600초와 전체 비용 122초를 쓴다', () => {
    const outcome = computeOutcome({ baseline, runs: [success, failure] })
    expect(outcome).toMatchObject({ attemptCount: 2, successCount: 1, failedCount: 1, manualSeconds: 600, autoSeconds: 2, reviewSeconds: 60, reworkSeconds: 60, afterSeconds: 122, savedSeconds: 478 })
    expect(outcome.breakEven.perRunKrw).toBe(478)
    const annual = annualize(outcome, '매일', { opsCostKrw: 10 })
    expect(annual.seconds).toBe(478 * 250)
    expect(annual.laterYearKrw).toBe(478 * 250 - 10 * 250)
  })
  it('성공 상태가 없는 옛 입력은 성공으로 추정하지 않고 비용을 남긴다', () => {
    const outcome = computeOutcome({ baseline, runs: [{ duration_ms: 1000, human_review_seconds: 30, rework_seconds: 60 }] })
    expect(outcome).toMatchObject({ successCount: 0, failedCount: 0, unknownCount: 1, manualSeconds: 0, savedSeconds: -91 })
    expect(annualize(outcome, '매일')).toBeNull()
  })
  it('집계 입력도 성공·실패와 전체 비용을 보존한다', () => {
    const actual = computeOutcome({ baseline, runs: runsFromTotals({ count: 2, successCount: 1, failedCount: 1, durationMs: 2000, reviewSeconds: 60, reworkSeconds: 60 }) })
    expect(actual).toEqual(computeOutcome({ baseline, runs: [success, failure] }))
    expect(computeOutcome({ baseline, runs: runsFromTotals({ count: 2, durationMs: 2000, reviewSeconds: 60, reworkSeconds: 60 }) })).toMatchObject({ successCount: 0, unknownCount: 2, savedSeconds: -122 })
  })
  it('실패가 섞여도 성공 표본 수를 부풀리지 않는다', () => {
    const outcome = computeOutcome({ baseline, runs: [success, ...Array(10).fill(failure)] })
    expect(buildChallenges({ outcome }).some(item => item.code === 'few_runs')).toBe(true)
  })
  it('명시한 문자열·boolean 상태만 해석하고 다른 truthy값은 미확인으로 둔다', () => {
    const outcome = computeOutcome({ baseline, runs: ['1', true, '0', false, 'yes', undefined].map(ok => ({ ok, duration_ms: 1000 })) })
    expect(outcome).toMatchObject({ attemptCount: 6, successCount: 2, failedCount: 2, unknownCount: 2, manualSeconds: 1200, afterSeconds: 6 })
  })
  it('부서의 실패 손실을 숨기지 않으며 양수 항목과도 순합산한다', () => {
    const loss = returnedFor([department()])
    expect(loss).toMatchObject({ show: true, confirmedSeconds: -91 })
    expect(loss.confirmed[0]).toMatchObject({ seconds: -91, runs: 1, successCount: 0, failedCount: 1 })
    expect(returnedLine('검토부서', loss)).toContain('추가로 들었습니다')
    const combined = returnedFor([department(), department({ ticket_no: 'B', success_count: 1, failed_count: 0, rework_seconds: 0 })])
    expect(combined.confirmedSeconds).toBe(478)
    expect(combined.confirmed).toHaveLength(2)
  })
  it('확인 전 손실도 화면에서 확인할 수 있다', () => {
    const result = returnedFor([department({ dept_confirmed_at: null, currentConfirmed: false })])
    expect(result).toMatchObject({ show: true, unconfirmedSeconds: -91 })
    expect(returnedNote(result)).toContain('실패 비용과 손실도 제외하지 않았습니다')
  })
})
