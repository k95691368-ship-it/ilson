import { describe, it, expect } from 'vitest'
import { returnedSecondsOf, returnedFor, returnedLine, returnedNote } from '../shared/returned.js'

// 성과는 신청서 한 건씩만 보인다. 부서 단위로 합친 숫자가 아무 데도 없었다.
// 그런데 부서 담당자와 마주 앉을 때 담당자가 할 수 있는 가장 강한 말이
// 그것이다 — "이 부서에 지금까지 N시간을 돌려드렸습니다."
//
// 부서 화면은 "내가 못 준 것"과 "부서가 답해 주셔야 할 것"만 말했다.
// 둘 다 빚 이야기다. 준 것은 한 마디도 안 해서, 만날 때마다 사과만 하는
// 자리가 되어 있었다.

// 90분짜리 일을 1명이 10번 돌렸고, 자동화 뒤 검수에 총 600초가 들었다.
const row = (over = {}) => ({
  ticket_no: 'AX-1',
  title: '매주 정산서를 손으로 붙입니다',
  median_seconds: 5400,
  people: 1,
  runs: 10,
  duration_total_ms: 60000,
  review_seconds: 600,
  rework_seconds: 0,
  open_challenges: 0,
  dept_confirmed_at: '2026-08-01 00:00:00',
  ...over,
})

describe('한 건이 돌려준 시간', () => {
  it('기준선 × 횟수에서 자동화 뒤에도 드는 시간을 뺀다', () => {
    // 검수와 재작업은 없어진 것이 아니라 옮겨간 것이다.
    expect(returnedSecondsOf(row())).toBe(5400 * 10 - 60 - 600)
  })

  it('사람 수를 곱한다', () => {
    // 두 명이 붙는 일이면 두 배로 돌려드린 것이다.
    expect(returnedSecondsOf(row({ people: 2 }))).toBe(5400 * 2 * 10 - 60 - 600)
  })

  it('한 번도 안 돌렸으면 0이다', () => {
    // 넘겨만 놓고 안 쓰는 도구는 아무것도 안 돌려준 것이다.
    expect(returnedSecondsOf(row({ runs: 0 }))).toBe(0)
  })

  it('기준선이 없으면 0이다', () => {
    // 재 두지 않은 것에 절감을 붙이지 않는다.
    expect(returnedSecondsOf(row({ median_seconds: null }))).toBe(0)
    expect(returnedSecondsOf(row({ median_seconds: 0 }))).toBe(0)
  })

  it('자동화가 더 오래 걸렸으면 음수로 안 간다', () => {
    expect(returnedSecondsOf(row({ review_seconds: 999999 }))).toBe(0)
  })

  it('빈 입력에도 터지지 않는다', () => {
    expect(() => returnedSecondsOf()).not.toThrow()
    expect(returnedSecondsOf()).toBe(0)
  })
})

describe('부서가 확인한 것만 성과로 센다', () => {
  it('확인 안 된 것은 따로 센다', () => {
    // 만든 사람만 아는 성과는 성과가 아니다. 합쳐 세면 이 사이트가
    // 자기 입으로 한 말이 된다.
    const r = returnedFor([row(), row({ ticket_no: 'AX-2', dept_confirmed_at: null })])
    expect(r.confirmed).toHaveLength(1)
    expect(r.unconfirmed).toHaveLength(1)
    expect(r.confirmedHours).toBeGreaterThan(0)
    expect(r.unconfirmedHours).toBeGreaterThan(0)
  })

  it('확인된 것이 없으면 성과라고 말하지 않는다', () => {
    const r = returnedFor([row({ dept_confirmed_at: null })])
    expect(returnedLine('재무', r)).toContain('아직 확인해 주신 성과가 없습니다')
  })

  it('확인된 것이 있으면 시간으로 말한다', () => {
    // 금액이 아니라 시간이다. 금액은 시급을 어떻게 잡느냐로 커졌다
    // 작아졌다 하고, 시간은 그 부서가 실제로 겪은 것이다.
    const t = returnedLine('재무', returnedFor([row()]))
    expect(t).toContain('재무에 지금까지')
    expect(t).toContain('시간을 돌려드렸습니다')
    expect(t).not.toContain('원')
  })

  it('확인 못 받은 것도 숨기지 않는다', () => {
    const note = returnedNote(returnedFor([row({ dept_confirmed_at: null })]))
    expect(note).toContain('아직 부서 확인을 못 받았습니다')
    expect(note).toContain('확인 전까지는 성과로 세지 않습니다')
  })
})

describe('반박이 남아 있으면', () => {
  it('보수적으로 잡은 숫자라고 말한다', () => {
    // 성과 화면이 '보수적 추정'으로 내리는데 여기서만 당당하면 두 화면이
    // 다른 말을 한다.
    const r = returnedFor([row({ open_challenges: 2 })])
    expect(r.shaky).toBe(true)
    expect(r.confirmed[0].shaky).toBe(true)
    expect(returnedNote(r)).toContain('보수적으로 잡은 숫자')
  })

  it('반박이 없으면 그 말을 안 꺼낸다', () => {
    expect(returnedNote(returnedFor([row()]))).not.toContain('보수적')
  })
})

describe('할 말이 없을 때', () => {
  it('아무 말도 안 한다', () => {
    // 0시간을 크게 적으면 그 자리는 그다음부터 안 읽힌다.
    const r = returnedFor([])
    expect(r.show).toBe(false)
    expect(returnedLine('재무', r)).toBeNull()
    expect(returnedNote(r)).toBeNull()
  })

  it('돌린 적 없는 건만 있으면 조용하다', () => {
    expect(returnedFor([row({ runs: 0 })]).show).toBe(false)
  })

  it('빈 입력에도 터지지 않는다', () => {
    expect(() => returnedFor()).not.toThrow()
    expect(returnedFor().show).toBe(false)
  })
})
