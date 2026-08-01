import { describe, it, expect } from 'vitest'
import {
  weekStart,
  weekLabel,
  weekRelative,
  compareWeeks,
  rollup,
  byDept,
  reportLine,
  MIN_FOR_TREND,
} from '../shared/weekly.js'

// 이 화면은 담당자가 위에 보고할 때 그대로 쓴다. 그래서 틀리면 틀린 숫자가
// 대표에게 간다. 특히 조심할 것 둘 —
//   하나, 주 경계를 UTC로 자르면 월요일 새벽 신청서가 지난주로 밀린다
//   둘, 두 건이 세 건이 된 것을 "50% 증가"라고 적으면 거짓말에 가깝다

// 2026-08-01은 토요일. 그 주 월요일은 7월 27일.
const NOW = new Date('2026-08-01T12:00:00Z').getTime()

describe('주 경계를 우리 시각으로 자른다', () => {
  it('월요일 새벽에 낸 것이 그 주로 들어간다', () => {
    // 8월 3일(월) 오전 1시 KST = 8월 2일(일) 오후 4시 UTC.
    // 그대로 자르면 지난주 것이 된다. 부서 사람은 월요일 아침에 낸 것이
    // 지난주 실적에 들어가 있는 이유를 알 길이 없다.
    expect(weekStart('2026-08-02 16:00:00')).toBe('2026-08-03')
  })

  it('일요일 늦은 밤은 그 주에 남는다', () => {
    // 8월 2일(일) 오후 11시 KST = 8월 2일 오후 2시 UTC
    expect(weekStart('2026-08-02 14:00:00')).toBe('2026-07-27')
  })

  it('같은 주 안이면 무슨 요일이든 같은 월요일이 나온다', () => {
    const mon = weekStart('2026-07-27 03:00:00')
    for (const t of ['2026-07-28 03:00:00', '2026-07-31 03:00:00', '2026-08-02 03:00:00']) {
      expect(weekStart(t)).toBe(mon)
    }
  })

  it('월요일 자체도 그 주 월요일이다', () => {
    expect(weekStart('2026-07-27 03:00:00')).toBe('2026-07-27')
  })

  it('빈 값이나 이상한 값에도 터지지 않는다', () => {
    expect(weekStart(null)).toBeNull()
    expect(weekStart('아무 말')).toBeNull()
  })
})

describe('주 이름 붙이기', () => {
  it('월요일부터 일요일까지로 적는다', () => {
    expect(weekLabel('2026-07-27')).toBe('7월 27일 ~ 8월 2일')
  })

  it('달을 넘어가도 맞게 적는다', () => {
    expect(weekLabel('2026-08-31')).toBe('8월 31일 ~ 9월 6일')
  })

  it('이번 주 · 지난주로도 부른다', () => {
    expect(weekRelative('2026-07-27', NOW)).toBe('이번 주')
    expect(weekRelative('2026-07-20', NOW)).toBe('지난주')
    expect(weekRelative('2026-07-06', NOW)).toBe('3주 전')
  })

  it('아직 안 온 주는 이름을 안 붙인다', () => {
    expect(weekRelative('2026-08-10', NOW)).toBeNull()
  })
})

describe('적은 표본으로 추세인 척하지 않는다', () => {
  it('둘 다 적으면 늘었다 줄었다를 말하지 않는다', () => {
    // 두 건이 세 건이 된 것은 누가 그 주에 휴가를 갔느냐로 갈린다.
    const c = compareWeeks(3, 2)
    expect(c.enough).toBe(false)
    expect(c.text).toContain('표본이 적어')
  })

  it('충분히 많으면 말한다', () => {
    const c = compareWeeks(9, MIN_FOR_TREND + 1)
    expect(c.enough).toBe(true)
    expect(c.text).toContain('늘었습니다')
  })

  it('줄어든 것도 말한다', () => {
    expect(compareWeeks(6, 9).text).toContain('3건 줄었습니다')
  })

  it('같으면 같다고 한다', () => {
    expect(compareWeeks(7, 7).text).toBe('지난주와 같습니다')
  })

  it('견줄 지난주가 없으면 아무 말도 안 한다', () => {
    expect(compareWeeks(9, null).text).toBeNull()
  })
})

const ROWS = [
  // 이번 주(7/27~8/2)에 들어온 것 둘
  { id: 'a', dept: '재무', status: '접수', created_at: '2026-07-28 09:00:00', annual_hours: 84 },
  { id: 'b', dept: '재무', status: '접수', created_at: '2026-07-30 09:00:00', annual_hours: null },
  // 지난주에 들어와 이번 주에 판정한 것
  {
    id: 'c',
    dept: '마케팅',
    status: '반려',
    created_at: '2026-07-21 09:00:00',
    decided_at: '2026-07-29 09:00:00',
    verdict: '반려',
    annual_hours: 40,
  },
  // 지난주에 들어와 지난주에 판정한 것
  {
    id: 'd',
    dept: '영업',
    status: '수용',
    created_at: '2026-07-22 09:00:00',
    decided_at: '2026-07-23 09:00:00',
    verdict: '수용',
    annual_hours: 120,
  },
]

describe('주별로 묶기', () => {
  const weeks = rollup(ROWS, { now: NOW, weeks: 4 })

  it('최근 주가 맨 앞이다', () => {
    expect(weeks[0].key).toBe('2026-07-27')
    expect(weeks[1].key).toBe('2026-07-20')
  })

  it('들어온 주와 판정한 주를 따로 센다', () => {
    // 지난주에 들어온 것을 이번 주에 판정했으면, 들어온 것은 지난주에
    // 세고 판정한 것은 이번 주에 센다. 한 주에 몰면 그 주에 일을 얼마나
    // 했는지가 안 보인다.
    expect(weeks[0].arrived).toBe(2) // a, b
    expect(weeks[0].decided).toBe(1) // c를 이번 주에 판정
    expect(weeks[1].arrived).toBe(2) // c, d
    expect(weeks[1].decided).toBe(1) // d
  })

  it('반려는 따로 센다', () => {
    expect(weeks[0].refused).toBe(1)
    expect(weeks[1].refused).toBe(0)
  })

  it('아직 판정 안 한 것을 센다', () => {
    expect(weeks[0].stillOpen).toBe(2)
    expect(weeks[1].stillOpen).toBe(0)
  })

  it('부서별로 나눈다', () => {
    expect(weeks[0].byDept).toEqual({ 재무: 2 })
    expect(weeks[1].byDept).toEqual({ 마케팅: 1, 영업: 1 })
  })

  it('소요를 안 적은 건은 0으로 치지 않고 따로 센다', () => {
    expect(weeks[0].hours).toBe(84)
    expect(weeks[0].hoursMissing).toBe(1)
  })

  it('신청서가 없는 주도 자리를 만든다', () => {
    // 빠뜨리면 그래프에서 조용한 주가 사라져서 꾸준히 들어오는 것처럼 보인다.
    expect(weeks).toHaveLength(4)
    expect(weeks[2].arrived).toBe(0)
    expect(weeks[3].arrived).toBe(0)
  })

  it('요청한 주 수만큼만 준다', () => {
    expect(rollup(ROWS, { now: NOW, weeks: 2 })).toHaveLength(2)
  })

  it('빈 입력에도 터지지 않는다', () => {
    expect(rollup([], { now: NOW, weeks: 3 })).toHaveLength(3)
    expect(rollup(undefined, { now: NOW, weeks: 3 })[0].arrived).toBe(0)
  })
})

describe('부서별 합계', () => {
  it('많이 낸 부서부터', () => {
    const d = byDept(ROWS)
    expect(d[0].dept).toBe('재무')
    expect(d[0].total).toBe(2)
  })

  it('아직 안 본 것과 반려한 것을 나눠 센다', () => {
    const d = byDept(ROWS)
    expect(d.find((x) => x.dept === '재무').open).toBe(2)
    expect(d.find((x) => x.dept === '마케팅').refused).toBe(1)
  })

  it('건수가 같으면 이름 순으로 — 순서가 흔들리지 않게', () => {
    const a = byDept(ROWS).map((x) => x.dept)
    const b = byDept([...ROWS].reverse()).map((x) => x.dept)
    expect(a).toEqual(b)
  })

  it('빈 입력에도 터지지 않는다', () => {
    expect(byDept([])).toEqual([])
    expect(byDept(undefined)).toEqual([])
  })
})

describe('보고할 때 그대로 읽는 한 줄', () => {
  it('이번 주 상황을 문장으로 만든다', () => {
    // 보고할 때 필요한 것은 표가 아니라 문장이다.
    const line = reportLine(rollup(ROWS, { now: NOW, weeks: 4 }))
    expect(line).toContain('이번 주에 2건이 들어왔고 1건을 판정했습니다')
    expect(line).toContain('2건이 판정을 기다립니다')
  })

  it('표본이 적으면 늘었다 줄었다를 문장에 안 넣는다', () => {
    const line = reportLine(rollup(ROWS, { now: NOW, weeks: 4 }))
    expect(line).not.toContain('늘었')
    expect(line).not.toContain('줄었')
  })

  it('아무것도 없으면 아무 말도 안 한다', () => {
    expect(reportLine([])).toBeNull()
    expect(reportLine(undefined)).toBeNull()
  })
})
