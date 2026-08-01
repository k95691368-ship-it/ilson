import { describe, it, expect } from 'vitest'
import {
  annotateRuns,
  parseFiles,
  usersOf,
  summarizeRuns,
  MIN_HISTORY,
  DROP_ALERT,
} from '../shared/history.js'

// 가장 흔한 사고는 파일 하나를 빠뜨리고 돌리는 것이다. 다섯 채널 중 넷만
// 올려도 도구는 아무 불평 없이 돌고, 결과는 그냥 좀 적을 뿐이다. 그 상태로
// 정산이 마감되면 한 채널 매출이 통째로 빠진다.
//
// 그런데 함부로 경고하면 더 나쁘다. 명절 주간에 매번 "빠뜨리셨습니다"가
// 뜨면 진짜 빠뜨렸을 때도 안 읽는다.

const run = (id, at, rows, extra = {}) => ({
  id,
  used_at: at,
  actor_label: '정산 담당자',
  rows_out: rows,
  quarantined: 0,
  ok: 1,
  files_json: JSON.stringify(['자사몰.csv', '올리브영.xlsx', '쿠팡.csv', 'amazon.csv', 'qoo10.xlsx']),
  ...extra,
})

// 최근 것이 앞에 오는 목록
const normal = [
  run('r4', '2026-07-27 09:00:00', 550),
  run('r3', '2026-07-20 09:00:00', 560),
  run('r2', '2026-07-13 09:00:00', 545),
  run('r1', '2026-07-06 09:00:00', 555),
]

describe('올린 파일 읽기', () => {
  it('이름 배열을 읽는다', () => {
    expect(parseFiles(JSON.stringify(['a.csv', 'b.csv']))).toEqual([{ name: 'a.csv' }, { name: 'b.csv' }])
  })

  it('객체 배열도 읽는다', () => {
    expect(parseFiles(JSON.stringify([{ name: 'a.csv', size: 10 }]))[0].size).toBe(10)
  })

  it('깨진 값에도 터지지 않는다', () => {
    expect(parseFiles('{이건 JSON이 아닙니다')).toEqual([])
    expect(parseFiles(null)).toEqual([])
    expect(parseFiles('"문자열"')).toEqual([])
  })
})

describe('파일을 빠뜨리고 돌린 것 잡기', () => {
  it('여느 때보다 크게 적으면 짚어 준다', () => {
    // 다섯 채널 중 넷만 올린 상황. 도구는 아무 불평 없이 돌았다.
    const withMiss = [
      run('r5', '2026-08-03 09:00:00', 300, {
        files_json: JSON.stringify(['자사몰.csv', '올리브영.xlsx', '쿠팡.csv', 'amazon.csv']),
      }),
      ...normal,
    ]
    const [latest] = annotateRuns(withMiss)
    const flag = latest.flags.find((f) => f.kind === 'fewer_rows')
    expect(flag).toBeTruthy()
    expect(flag.text).toContain('빠뜨리고')
  })

  it('파일 개수가 줄어든 것도 따로 짚는다', () => {
    // 줄 수는 그대로인데 파일이 하나 빠진 경우가 있다 — 그 채널이 원래 작을 때.
    const withMiss = [
      run('r5', '2026-08-03 09:00:00', 540, {
        files_json: JSON.stringify(['자사몰.csv', '올리브영.xlsx', '쿠팡.csv', 'amazon.csv']),
      }),
      ...normal,
    ]
    const [latest] = annotateRuns(withMiss)
    expect(latest.flags.find((f) => f.kind === 'fewer_files')).toBeTruthy()
  })

  it('여느 때만큼 나왔으면 조용하다', () => {
    // 함부로 경고하면 진짜 빠뜨렸을 때도 안 읽는다.
    const [latest] = annotateRuns([run('r5', '2026-08-03 09:00:00', 548), ...normal])
    expect(latest.flags).toEqual([])
  })

  it('조금 줄어든 것으로는 경고하지 않는다', () => {
    // 20%는 명절 주간이나 프로모션으로도 나온다.
    const [latest] = annotateRuns([run('r5', '2026-08-03 09:00:00', 460), ...normal])
    expect(latest.flags.find((f) => f.kind === 'fewer_rows')).toBeUndefined()
  })

  it('견줄 것이 적으면 아무 말도 안 한다', () => {
    // 한 번 돌린 것과 견주면 그 한 번이 이상했을 때 이번 것이 이상하다고 나온다.
    const few = [run('r2', '2026-08-03 09:00:00', 100), run('r1', '2026-07-27 09:00:00', 550)]
    const [latest] = annotateRuns(few)
    expect(latest.flags).toEqual([])
    expect(latest.comparable).toBe(false)
  })

  it('견줄 것이 충분해지면 그때부터 본다', () => {
    const enough = [run('x', '2026-08-03 09:00:00', 100), ...normal]
    expect(annotateRuns(enough)[0].comparable).toBe(true)
    expect(MIN_HISTORY).toBeLessThanOrEqual(normal.length)
  })

  it('실패한 실행은 견주는 기준에 안 넣는다', () => {
    // 멈춘 실행의 0줄을 평소치에 섞으면 기준이 통째로 내려간다.
    const withFail = [
      run('r5', '2026-08-03 09:00:00', 300),
      run('f1', '2026-08-01 09:00:00', 0, { ok: 0, fail_reason: '파일을 못 읽었습니다' }),
      ...normal,
    ]
    expect(annotateRuns(withFail)[0].flags.find((f) => f.kind === 'fewer_rows')).toBeTruthy()
  })
})

describe('멈춘 실행', () => {
  it('왜 멈췄는지 적어 준다', () => {
    const [latest] = annotateRuns([
      run('f1', '2026-08-03 09:00:00', 0, { ok: 0, fail_reason: '어느 채널인지 알 수 없음' }),
      ...normal,
    ])
    expect(latest.flags[0].kind).toBe('failed')
    expect(latest.flags[0].text).toContain('어느 채널인지')
  })

  it('이유가 안 남아 있어도 멈췄다는 것은 말한다', () => {
    const [latest] = annotateRuns([run('f1', '2026-08-03 09:00:00', 0, { ok: 0 }), ...normal])
    expect(latest.flags[0].text).toContain('멈췄습니다')
  })
})

describe('밀려난 줄이 많은 것', () => {
  it('비율이 높으면 양식이 바뀐 것으로 의심한다', () => {
    const [latest] = annotateRuns([
      run('r5', '2026-08-03 09:00:00', 400, { quarantined: 150 }),
      ...normal,
    ])
    expect(latest.flags.find((f) => f.kind === 'many_quarantined')).toBeTruthy()
  })

  it('몇 줄 밀려난 것으로는 말하지 않는다', () => {
    const [latest] = annotateRuns([
      run('r5', '2026-08-03 09:00:00', 550, { quarantined: 5 }),
      ...normal,
    ])
    expect(latest.flags.find((f) => f.kind === 'many_quarantined')).toBeUndefined()
  })
})

describe('누가 쓰고 있나', () => {
  it('많이 쓴 사람부터', () => {
    const u = usersOf([
      run('a', '2026-08-03 09:00:00', 1, { actor_label: '정산 담당자' }),
      run('b', '2026-07-27 09:00:00', 1, { actor_label: '정산 담당자' }),
      run('c', '2026-07-20 09:00:00', 1, { actor_label: '회계 담당자' }),
    ])
    expect(u[0].who).toBe('정산 담당자')
    expect(u[0].runs).toBe(2)
  })

  it('마지막으로 쓴 때를 기억한다', () => {
    const u = usersOf([
      run('a', '2026-08-03 09:00:00', 1),
      run('b', '2026-07-20 09:00:00', 1),
    ])
    expect(u[0].lastAt).toBe('2026-08-03 09:00:00')
  })

  it('이름이 없어도 터지지 않는다', () => {
    expect(usersOf([run('a', '2026-08-03 09:00:00', 1, { actor_label: '' })])[0].who).toBe('이름 없음')
  })

  it('빈 입력에도 터지지 않는다', () => {
    expect(usersOf([])).toEqual([])
    expect(usersOf(undefined)).toEqual([])
  })
})

describe('요약', () => {
  it('성공한 것만 합산한다', () => {
    const runs = annotateRuns([
      run('f', '2026-08-03 09:00:00', 0, { ok: 0 }),
      run('a', '2026-07-27 09:00:00', 500, { quarantined: 10 }),
      run('b', '2026-07-20 09:00:00', 500, { quarantined: 5 }),
    ])
    const s = summarizeRuns(runs)
    expect(s.total).toBe(3)
    expect(s.failed).toBe(1)
    expect(s.rows).toBe(1000)
    expect(s.quarantined).toBe(15)
  })

  it('빈 목록에서도 터지지 않는다', () => {
    expect(summarizeRuns([]).total).toBe(0)
    expect(summarizeRuns(undefined).rows).toBe(0)
  })

  it('경고 임계값이 뒤집히지 않았는지', () => {
    // 이 값이 0에 가까워지면 모든 실행에 경고가 붙고, 1에 가까워지면
    // 아무것도 안 잡힌다. 둘 다 쓸모없다.
    expect(DROP_ALERT).toBeGreaterThan(0.2)
    expect(DROP_ALERT).toBeLessThan(0.8)
  })
})
