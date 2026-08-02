import { describe, it, expect } from 'vitest'
import { buildTodo, todoSummary, URGENCY, NOTHING_CHECKED } from '../shared/todo.js'

// 담당자가 아침에 앉으면 여섯 화면을 돌아다녀야 오늘 뭘 할지 안다. 그러면
// 안 돌아다닌다. 늘 열던 한 화면만 열고 나머지는 쌓인다.
//
// 그렇다고 아무거나 다 올리면 안 된다. 스무 개가 올라온 목록은 아무것도
// 안 올라온 것과 같다. 그리고 순서가 틀리면 더 나쁘다 — 숫자가 틀리는
// 일보다 사용법서 쓰는 일이 위에 있으면 그 목록은 쓸모가 없다.

const full = {
  overview: { counts: { stale: 3 } },
  reports: { summary: { urgent: 1, open: 4 } },
  codes: { summary: { needsCheck: 2 } },
  tools: { summary: { idle: 1, unconfirmed: 1, noManual: 1 } },
}

describe('무엇을 올리는가', () => {
  it('아무 일도 없으면 빈 목록이다', () => {
    expect(buildTodo({})).toEqual([])
    expect(buildTodo()).toEqual([])
  })

  it('0은 올리지 않는다', () => {
    const none = {
      overview: { counts: { stale: 0 } },
      reports: { summary: { urgent: 0, open: 0 } },
      codes: { summary: { needsCheck: 0 } },
      tools: { summary: { idle: 0, unconfirmed: 0, noManual: 0 } },
    }
    expect(buildTodo(none)).toEqual([])
  })

  it('일이 있으면 그것만 올린다', () => {
    const only = { codes: { summary: { needsCheck: 2 } } }
    const t = buildTodo(only)
    expect(t).toHaveLength(1)
    expect(t[0].key).toBe('unchecked_codes')
  })

  it('건수를 제목에 적는다', () => {
    expect(buildTodo(full).find((i) => i.key === 'stale_applications').title).toContain('3건')
  })

  it('왜 해야 하는지를 같이 준다', () => {
    // 이유 없이 시키면 아무도 안 한다.
    for (const i of buildTodo(full)) {
      expect(i.why.length).toBeGreaterThan(10)
      expect(i.to).toBeTruthy()
      expect(i.cta).toBeTruthy()
    }
  })
})

describe('무엇을 먼저 올리는가', () => {
  it('금액이 틀릴 수 있는 것이 맨 위다', () => {
    // 숫자가 틀리는 일보다 사용법서 쓰는 일이 위에 있으면 그 목록은
    // 쓸모가 없다.
    const t = buildTodo(full)
    expect(t[0].kind).toBe('금액')
  })

  it('금액 다음이 사람을 기다리게 하는 것', () => {
    const kinds = buildTodo(full).map((i) => i.kind)
    const firstWait = kinds.indexOf('대기')
    const firstTidy = kinds.indexOf('정리')
    const lastMoney = kinds.lastIndexOf('금액')
    expect(lastMoney).toBeLessThan(firstWait)
    expect(firstWait).toBeLessThan(firstTidy)
  })

  it('급한 정도가 뒤집히지 않았는지', () => {
    expect(URGENCY['금액']).toBeGreaterThan(URGENCY['대기'])
    expect(URGENCY['대기']).toBeGreaterThan(URGENCY['정리'])
  })

  it('같은 급함끼리는 순서가 흔들리지 않는다', () => {
    // 열 때마다 순서가 바뀌면 담당자가 방금 본 것을 놓친다.
    const a = buildTodo(full).map((i) => i.key)
    const b = buildTodo({ ...full }).map((i) => i.key)
    expect(a).toEqual(b)
  })
})

describe('숫자를 여기서 다시 세지 않는다', () => {
  it('각 화면이 세어 둔 값을 그대로 쓴다', () => {
    // 두 군데서 세면 두 숫자가 달라지고, 그러면 둘 다 못 믿는다.
    const t = buildTodo({ overview: { counts: { stale: 7 } } })
    expect(t[0].title).toContain('7건')
  })

  it('급한 신고는 불편 신고 수에서 뺀다', () => {
    // 같은 신고를 두 줄에 세면 담당자가 두 배로 밀린 줄 안다.
    const t = buildTodo({ reports: { summary: { urgent: 3, open: 5 } } })
    expect(t.find((i) => i.key === 'open_reports').title).toContain('2건')
  })

  it('접수함이 이미 세는 앞 단계는 막힌 곳에서 안 받는다', () => {
    // 같은 건을 "하루 넘게 못 본 신청서"와 "중간에서 멈춘 것" 두 줄에
    // 올리면 담당자는 두 배로 밀린 줄 안다.
    const t = buildTodo({ stalls: { summary: { mine: 5, mineLater: 2 } } })
    expect(t.find((i) => i.key === 'stalled').title).toContain('2건')
  })

  it('급한 신고만 있으면 불편 신고 줄은 안 올린다', () => {
    const t = buildTodo({ reports: { summary: { urgent: 3, open: 3 } } })
    expect(t.find((i) => i.key === 'open_reports')).toBeUndefined()
  })
})

describe('빠진 값', () => {
  it('일부만 와도 터지지 않는다', () => {
    expect(() => buildTodo({ overview: null, reports: undefined })).not.toThrow()
    expect(buildTodo({ tools: {} })).toEqual([])
  })

  it('모양이 다른 값이 와도 터지지 않는다', () => {
    expect(() => buildTodo({ overview: { counts: null } })).not.toThrow()
  })
})

describe('할 일이 없다고 말할 때', () => {
  it('무엇을 보고 없다고 하는지 밝힌다', () => {
    // "할 일이 없습니다"로 끝내면 정말 없는 것인지 못 세고 있는 것인지 모른다.
    expect(NOTHING_CHECKED.length).toBeGreaterThan(3)
  })
})

describe('요약', () => {
  it('급한 정도별로 센다', () => {
    const s = todoSummary(buildTodo(full))
    expect(s.money).toBe(2)
    expect(s.waiting).toBe(2)
    expect(s.tidy).toBe(3)
    expect(s.total).toBe(7)
  })

  it('빈 목록에서도 터지지 않는다', () => {
    expect(todoSummary([]).total).toBe(0)
    expect(todoSummary(undefined).money).toBe(0)
  })
})

// 짚힌 곳은 사용법서 화면을 열어야만 보였다. 그런데 담당자는 다 쓴 뒤로
// 그 화면을 안 연다 — 쓸 일이 끝났다고 생각하기 때문이다.
describe('사용법서에서 짚힌 곳', () => {
  it('첫 화면 할 일 목록에 올라온다', () => {
    const t = buildTodo({ tools: { summary: { unclear: 3 } } })
    expect(t).toHaveLength(1)
    expect(t[0].key).toBe('unclear_manual')
    expect(t[0].title).toContain('3곳')
    expect(t[0].to).toBe('/manual')
  })

  it('없으면 안 올린다', () => {
    expect(buildTodo({ tools: { summary: { unclear: 0 } } })).toEqual([])
  })

  it('사람을 기다리게 하는 일로 센다', () => {
    // 읽는 분이 막힌 자리다. 정리할 일이 아니라 지금 막고 있는 일이다.
    expect(buildTodo({ tools: { summary: { unclear: 1 } } })[0].kind).toBe('대기')
  })
})
