import { describe, it, expect } from 'vitest'
import {
  validateReport,
  toReports,
  openReports,
  trustLevel,
  REPORT_KIND,
  REPORT_FIX,
  REPORT_CODES,
} from '../shared/report.js'

// 넘긴 뒤 들어온 신고가 이 사이트에서 가장 값진 기록이다. 만들 때 놓친
// 것은 만든 사람이 못 찾는다 — 매일 그 일을 하는 사람만 찾는다.
//
// 그래서 이게 틀리면 제일 나쁘다. 숫자가 틀린다는 신고가 쌓여 있는데
// "잘 돌고 있음"으로 보이면, 틀린 숫자로 대표 보고가 나간다.

const report = (id, code, at, extra = {}) => ({
  id,
  link_kind: REPORT_KIND,
  link_id: code,
  title: '정산 담당자',
  what: '자사몰 순매출이 제가 아는 것보다 25만원 많게 나옵니다.',
  why: '부서가 신고했습니다.',
  created_at: at,
  ...extra,
})

const fix = (id, reportId, at) => ({
  id,
  link_kind: REPORT_FIX,
  link_id: reportId,
  title: 'AX 담당자',
  what: '할인액 컬럼 이름이 바뀐 것을 못 잡고 있었습니다. 고쳤습니다.',
  why: '컬럼이 바뀌면 조용히 빠지던 것이 원인이었습니다.',
  created_at: at,
})

// 결정 기록에는 판정·질문 같은 것도 같이 들어 있다.
const other = {
  id: 'x1',
  link_kind: '질문',
  link_id: 'x1',
  title: 'AX 담당자',
  what: '채널이 몇 개인가요',
  why: '판정에 필요합니다',
  created_at: '2026-07-20 09:00:00',
}

describe('신고할 때 받는 것', () => {
  const good = {
    code: 'wrong_number',
    body: '자사몰 순매출이 25만원 많게 나옵니다.',
    reporter: '정산 담당자',
  }

  it('제대로 적었으면 통과한다', () => {
    expect(validateReport(good)).toEqual({})
  })

  it('무엇이 이상한지 안 고르면 막는다', () => {
    expect(validateReport({ ...good, code: '' }).code).toBeTruthy()
    expect(validateReport({ ...good, code: '아무거나' }).code).toBeTruthy()
  })

  it('"이상해요" 한 줄은 막는다', () => {
    // 이러면 담당자가 다시 물어야 하고 하루가 간다.
    expect(validateReport({ ...good, body: '이상해요' }).body).toBeTruthy()
  })

  it('누가 겪은 일인지 받아 둔다', () => {
    expect(validateReport({ ...good, reporter: '  ' }).reporter).toBeTruthy()
  })

  it('고를 수 있는 유형이 실제로 있다', () => {
    expect(REPORT_CODES.length).toBeGreaterThan(3)
    expect(REPORT_CODES).toContain('wrong_number')
  })
})

describe('신고만 골라내기', () => {
  it('신고가 아닌 기록은 뺀다', () => {
    expect(toReports([other, report('r1', 'wrong_number', '2026-07-21 09:00:00')])).toHaveLength(1)
  })

  it('유형을 사람 말로 바꿔 준다', () => {
    const [r] = toReports([report('r1', 'wrong_number', '2026-07-21 09:00:00')])
    expect(r.label).toContain('숫자')
    expect(r.urgent).toBe(true)
  })

  it('모르는 유형이 와도 터지지 않는다', () => {
    const [r] = toReports([report('r1', '없는유형', '2026-07-21 09:00:00')])
    expect(r.label).toBeTruthy()
  })

  it('빈 값에도 터지지 않는다', () => {
    expect(toReports([])).toEqual([])
    expect(toReports(undefined)).toEqual([])
  })
})

describe('고친 것과 안 고친 것', () => {
  it('처리 기록이 붙으면 닫힌다', () => {
    const [r] = toReports([
      report('r1', 'wrong_number', '2026-07-21 09:00:00'),
      fix('f1', 'r1', '2026-07-22 09:00:00'),
    ])
    expect(r.open).toBe(false)
    expect(r.fix.how).toContain('할인액')
  })

  it('다른 신고에 붙은 처리는 이 신고를 닫지 않는다', () => {
    const rs = toReports([
      report('r1', 'wrong_number', '2026-07-21 09:00:00'),
      report('r2', 'missing_rows', '2026-07-21 10:00:00'),
      fix('f1', 'r2', '2026-07-22 09:00:00'),
    ])
    expect(openReports(rs).map((r) => r.id)).toEqual(['r1'])
  })
})

describe('무엇을 맨 위에 놓는가', () => {
  it('안 고친 것이 고친 것보다 위다', () => {
    const rs = toReports([
      report('r1', 'wrong_number', '2026-07-20 09:00:00'),
      fix('f1', 'r1', '2026-07-20 10:00:00'),
      report('r2', 'hard_to_use', '2026-07-25 09:00:00'),
    ])
    expect(rs[0].id).toBe('r2')
  })

  it('안 고친 것끼리는 급한 것이 위다', () => {
    // 숫자가 틀리는 것과 쓰기 불편한 것을 같은 줄에 세우면 안 된다.
    const rs = toReports([
      report('r1', 'hard_to_use', '2026-07-20 09:00:00'),
      report('r2', 'wrong_number', '2026-07-25 09:00:00'),
    ])
    expect(rs[0].id).toBe('r2')
  })

  it('급한 것끼리는 오래 방치된 것이 위다', () => {
    const rs = toReports([
      report('r1', 'wrong_number', '2026-07-25 09:00:00'),
      report('r2', 'missing_rows', '2026-07-20 09:00:00'),
    ])
    expect(rs[0].id).toBe('r2')
  })
})

describe('이 도구를 지금 믿을 수 있나', () => {
  it('신고가 없으면 이상 없음이다', () => {
    expect(trustLevel([]).level).toBe('이상 없음')
  })

  it('숫자가 틀린다는 신고가 살아 있으면 못 믿는다', () => {
    // 도는 것과 맞는 것은 다르다. "돌고 있음"으로만 적으면 틀린 숫자로
    // 대표 보고가 나간다.
    const rs = toReports([report('r1', 'wrong_number', '2026-07-21 09:00:00')])
    const t = trustLevel(rs)
    expect(t.level).toBe('결과를 믿을 수 없음')
    expect(t.urgent).toBe(1)
  })

  it('고쳤으면 다시 믿을 수 있다', () => {
    const rs = toReports([
      report('r1', 'wrong_number', '2026-07-21 09:00:00'),
      fix('f1', 'r1', '2026-07-22 09:00:00'),
    ])
    expect(trustLevel(rs).level).toBe('이상 없음')
  })

  it('불편하다는 신고는 못 믿을 일이 아니다', () => {
    const rs = toReports([report('r1', 'hard_to_use', '2026-07-21 09:00:00')])
    expect(trustLevel(rs).level).toBe('불편하다는 신고 있음')
    expect(trustLevel(rs).urgent).toBe(0)
  })
})
