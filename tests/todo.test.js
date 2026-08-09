import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
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

// 손든 사실은 그 신청서를 열어야만 보인다. 그런데 담당자는 이미 판정한
// 건을 다시 열지 않는다.
describe('다른 부서가 손든 신청서', () => {
  it('첫 화면 할 일 목록에 올라온다', () => {
    const t = buildTodo({ joins: { summary: { needsRepriority: 2 } } })
    expect(t).toHaveLength(1)
    expect(t[0].key).toBe('rejoined')
    expect(t[0].title).toContain('2건')
    expect(t[0].cta).toContain('우선순위')
  })

  it('없으면 안 올린다', () => {
    expect(buildTodo({ joins: { summary: { needsRepriority: 0 } } })).toEqual([])
  })
})

describe('손든 부서 사정이 협의안에 안 들어온 것', () => {
  it('첫 화면에 올라온다', () => {
    const t = buildTodo({ joins: { summary: { notInAgreement: 2 } } })
    expect(t[0].key).toBe('join_not_in_agreement')
    expect(t[0].to).toBe('/agreement')
  })

  it('손든 신청서 줄과 겹치지 않는다', () => {
    // 저건 판정 전, 이건 협의 중. 한 신청서가 두 줄에 동시에 뜨면
    // 목록이 두 배로 길어 보인다.
    const t = buildTodo({ joins: { summary: { needsRepriority: 1, notInAgreement: 1 } } })
    expect(t).toHaveLength(2)
    expect(new Set(t.map((i) => i.key)).size).toBe(2)
  })
})

// 이의는 담당자만 풀 수 있는데, 협의안 화면에서 그 신청서를 골라 아래로
// 내려가야만 보였다. 그러면 부서는 답을 기다리다 "말해 봐야 소용없다"로
// 끝나고, 다음부터 서명 자체를 안 한다.
describe('부서가 단 합격 기준 이의', () => {
  it('첫 화면에 올라온다', () => {
    const t = buildTodo({ signoffs: { summary: { applications: 2 } } })
    expect(t[0].key).toBe('open_objections')
    expect(t[0].title).toContain('2건')
    expect(t[0].to).toBe('/agreement')
  })

  it('사람을 기다리게 하는 일로 센다', () => {
    // 이의가 있다고 숫자가 틀리지는 않는다. 다만 사람이 답을 기다린다.
    expect(buildTodo({ signoffs: { summary: { applications: 1 } } })[0].kind).toBe('대기')
  })

  it('다 풀었으면 안 올린다', () => {
    expect(buildTodo({ signoffs: { summary: { applications: 0, openObjections: 0 } } })).toEqual([])
  })

  it('무엇을 보고 없다고 하는지에 들어 있다', () => {
    expect(NOTHING_CHECKED.join()).toContain('이의')
  })
})

// 부서가 직접 말한 것이 담당자에게 닿는가.
//
// 이 사이트는 "부서가 확인해 줘야 성과다"라고 여러 화면에서 말한다.
// 그런데 부서가 실제로 아니라고 했을 때 그 말이 그 화면 안에만 남으면,
// 담당자는 그 화면을 열 때까지 모른다. 그 사이에 금액은 보고에 올라간다.
describe('부서가 한 말이 첫 화면까지 오는가', () => {
  it('부서가 성과 숫자를 다르다고 하면 금액 급으로 올라온다', () => {
    const items = buildTodo({ overview: { deptDisagrees: 2 } })
    const x = items.find((i) => i.key === 'dept_disagrees')
    expect(x).toBeTruthy()
    expect(x.kind).toBe('금액')
    expect(x.title).toContain('2건')
    expect(x.to).toBe('/result')
  })

  it('아무 말도 없으면 안 올라온다', () => {
    expect(buildTodo({ overview: { deptDisagrees: 0 } }).some((i) => i.key === 'dept_disagrees')).toBe(false)
    expect(buildTodo({ overview: {} }).some((i) => i.key === 'dept_disagrees')).toBe(false)
  })

  it('시험판 의견에 답을 안 했으면 대기 급으로 올라온다', () => {
    const x = buildTodo({ overview: { betaUnanswered: 3 } }).find((i) => i.key === 'beta_unanswered')
    expect(x).toBeTruthy()
    expect(x.kind).toBe('대기')
    expect(x.to).toBe('/beta')
  })

  it('부서가 다르다고 한 것이 시험판 의견보다 위에 온다', () => {
    // 금액이 틀리는 것이 사람을 기다리게 하는 것보다 급하다.
    const items = buildTodo({ overview: { deptDisagrees: 1, betaUnanswered: 9 } })
    const a = items.findIndex((i) => i.key === 'dept_disagrees')
    const b = items.findIndex((i) => i.key === 'beta_unanswered')
    expect(a).toBeGreaterThanOrEqual(0)
    expect(b).toBeGreaterThan(a)
  })
})

// 보류는 이 사이트에서 아무도 안 움직이면 영원히 그대로인 유일한 상태다.
// 반려는 끝난 것이고 진행 중인 것은 다음 단계가 있는데, 보류는 누가 먼저
// 말하지 않으면 그냥 묻힌다.
describe('보류 조건이 풀렸다는 알림', () => {
  it('알려 오면 할 일에 올라온다', () => {
    const x = buildTodo({ overview: { holdLiftWaiting: 2 } }).find((i) => i.key === 'hold_lifted')
    expect(x).toBeTruthy()
    expect(x.title).toContain('2건')
    expect(x.to).toBe('/review')
  })

  it('없으면 안 올라온다', () => {
    expect(buildTodo({ overview: {} }).some((i) => i.key === 'hold_lifted')).toBe(false)
    expect(buildTodo({ overview: { holdLiftWaiting: 0 } }).some((i) => i.key === 'hold_lifted')).toBe(false)
  })

  it('금액이 틀리는 것보다는 뒤에 온다', () => {
    const items = buildTodo({ overview: { holdLiftWaiting: 9, deptDisagrees: 1 } })
    const a = items.findIndex((i) => i.key === 'dept_disagrees')
    const b = items.findIndex((i) => i.key === 'hold_lifted')
    expect(b).toBeGreaterThan(a)
  })
})

// 순서를 안 정하는 것 자체는 잘못이 아니다. 다만 여럿이 기다리는데 안 정하면
// 부서 조회 화면에 "아직 순서를 정하지 않았습니다"가 그대로 적힌다.
describe('순서 없이 기다리는 것', () => {
  it('여럿이 기다리면 할 일에 올라온다', () => {
    const x = buildTodo({ overview: { unranked: 4 } }).find((i) => i.key === 'unranked_queue')
    expect(x).toBeTruthy()
    expect(x.title).toContain('4건')
    expect(x.to).toBe('/priority')
  })

  it('없으면 안 올라온다', () => {
    expect(buildTodo({ overview: { unranked: 0 } }).some((i) => i.key === 'unranked_queue')).toBe(false)
    expect(buildTodo({ overview: {} }).some((i) => i.key === 'unranked_queue')).toBe(false)
  })

  it('부서가 무엇을 읽게 되는지를 이유로 댄다', () => {
    const x = buildTodo({ overview: { unranked: 4 } }).find((i) => i.key === 'unranked_queue')
    expect(x.why).toContain('부서 조회 화면')
  })
})

// 부서가 쓰던 것을 내렸다는 것은 그 부서가 지금 일을 못 하고 있다는 뜻이다.
// 그런데 내린 도구는 넘긴 목록에서도 빠져서 화면 어디에도 안 보인다.
describe('내려 둔 채 잊은 도구', () => {
  it('사흘 넘으면 금액 급으로 올라온다', () => {
    const x = buildTodo({ tools: { summary: { downStale: 2 } } }).find((i) => i.key === 'tool_down_stale')
    expect(x).toBeTruthy()
    expect(x.kind).toBe('금액')
    expect(x.to).toBe('/tools')
  })

  it('없으면 안 올라온다', () => {
    expect(buildTodo({ tools: { summary: { downStale: 0 } } }).some((i) => i.key === 'tool_down_stale')).toBe(false)
    expect(buildTodo({}).some((i) => i.key === 'tool_down_stale')).toBe(false)
  })

  it('왜 안 보이는지를 이유로 댄다', () => {
    const x = buildTodo({ tools: { summary: { downStale: 1 } } }).find((i) => i.key === 'tool_down_stale')
    expect(x.why).toContain('넘긴 목록에서도 빠져서')
  })
})

// 이 사이트는 부서에게 "안 맞으면 안 맞는다고 눌러주셔도 됩니다"라고 적어
// 뒀다. 부서가 그대로 했는데 그 말이 담당자 화면 어디에도 안 왔다.
describe('부서가 못 쓰겠다고 한 도구', () => {
  it('금액 급으로 올라온다', () => {
    // 도구가 그냥 안 쓰이는 것과 못 쓴다고 말까지 해 준 것은 다르다.
    const x = buildTodo({ tools: { summary: { rejected: 1 } } }).find((i) => i.key === 'tool_rejected')
    expect(x).toBeTruthy()
    expect(x.kind).toBe('금액')
    expect(x.why).toContain('무엇이 안 맞는지까지 적어')
  })

  it('없으면 안 올라온다', () => {
    expect(buildTodo({ tools: { summary: { rejected: 0 } } }).some((i) => i.key === 'tool_rejected')).toBe(false)
    expect(buildTodo({}).some((i) => i.key === 'tool_rejected')).toBe(false)
  })

  it('그냥 안 쓰는 것보다 위에 온다', () => {
    const items = buildTodo({ tools: { summary: { rejected: 1, idle: 5 } } })
    const a = items.findIndex((i) => i.key === 'tool_rejected')
    const b = items.findIndex((i) => i.key === 'idle_tools')
    expect(a).toBeGreaterThanOrEqual(0)
    expect(b).toBeGreaterThan(a)
  })
})

// 담당자가 막혀서 되물었던 건이다. 답이 오면 막고 있던 것이 없어졌는데,
// 지금까지는 "답 기다리는 중" 배지가 조용히 사라지는 것이 전부였다.
describe('되물은 것에 답이 왔을 때', () => {
  it('판정하라고 할 일에 올라온다', () => {
    const x = buildTodo({ overview: { answered: 2 } }).find((i) => i.key === 'answered_ready')
    expect(x).toBeTruthy()
    expect(x.to).toBe('/review')
    expect(x.why).toContain('이제 판정하실 수 있습니다')
  })

  it('부서가 기다리고 있다는 것을 이유로 댄다', () => {
    // 놓치면 다음부터 "답해 봐야 소용없다"를 배운다.
    const x = buildTodo({ overview: { answered: 1 } }).find((i) => i.key === 'answered_ready')
    expect(x.why).toContain('답해 놓고 기다리고')
  })

  it('없으면 안 올라온다', () => {
    expect(buildTodo({ overview: { answered: 0 } }).some((i) => i.key === 'answered_ready')).toBe(false)
    expect(buildTodo({}).some((i) => i.key === 'answered_ready')).toBe(false)
  })
})

// 같은 신청서가 한 화면에 두 번 뜨면 담당자는 두 가지 일인 줄 안다.
// 이 목록의 값어치는 짧다는 데 있고, 겹치는 것이 있으면 나머지도 못 믿는다.
describe('같은 것을 두 번 세지 않는다', () => {
  it('답이 온 것은 "못 본 신청서"에서 뺀다', () => {
    const items = buildTodo({ overview: { counts: { stale: 4 }, answered: 1 } })
    expect(items.find((i) => i.key === 'stale_applications').title).toContain('3건')
    expect(items.find((i) => i.key === 'answered_ready').title).toContain('1건')
  })

  it('전부 답이 온 것이면 "못 본 신청서"는 안 뜬다', () => {
    const items = buildTodo({ overview: { counts: { stale: 2 }, answered: 2 } })
    expect(items.some((i) => i.key === 'stale_applications')).toBe(false)
    expect(items.some((i) => i.key === 'answered_ready')).toBe(true)
  })

  it('답이 더 많아도 음수가 안 된다', () => {
    const items = buildTodo({ overview: { counts: { stale: 1 }, answered: 3 } })
    expect(items.some((i) => i.key === 'stale_applications')).toBe(false)
  })
})

// 눌러도 엉뚱한 건 앞에 떨어졌다.
//
// "부서가 합격 기준에 이의를 단 신청서 3건 → 이의 보기"를 누르면 협의안
// 화면이 열리는데, 그 화면은 수용된 것 중 **첫 번째**를 골라 놓는다.
// 이의가 달린 건이 목록 아래쪽에 있으면 담당자는 칩을 하나씩 눌러 찾아야
// 했다. 할 일 목록이 "여기 볼 것이 있습니다"까지만 말하고 "어디를 보세요"는
// 안 말한 셈이다.
//
// 서버는 어느 신청서인지 이미 알고 있었다. /joins 와 /signoffs 가
// applicationIds 를 내려보내는데 아무도 안 읽었다.
describe('할 일이 어느 건인지까지 알려주는가', () => {
  it('이의가 달린 그 건으로 보낸다', () => {
    const items = buildTodo({
      signoffs: { summary: { applications: 2 }, applicationIds: ['app_b', 'app_c'] },
    })
    const x = items.find((i) => i.key === 'open_objections')
    expect(x.to).toBe('/agreement?id=app_b')
  })

  it('손든 건도 그 건으로 보낸다', () => {
    const items = buildTodo({
      joins: {
        summary: {
          needsRepriority: 1,
          notInAgreement: 1,
          repriorityIds: ['app_z'],
          notInAgreementIds: ['app_y'],
        },
        applicationIds: ['app_z'],
      },
    })
    expect(items.find((i) => i.key === 'rejoined').to).toBe('/review?id=app_z')
    // 두 항목이 세는 신청서가 다르다. 위는 아직 판정 전이고 이건 협의
    // 중인 건이다. 같은 목록을 쓰면 문제가 없는 건 앞으로 데려간다 —
    // 조용히 틀리는 쪽이라 눌러 보기 전엔 아무도 모른다.
    expect(items.find((i) => i.key === 'join_not_in_agreement').to).toBe('/agreement?id=app_y')
  })

  it('두 목록이 서버가 주는 이름과 같다', () => {
    // 이름이 갈라지면 조용히 빈 값이 되어 링크가 그냥 화면만 연다.
    // 목록을 만드는 곳은 shared/join.js 다. 라우트는 그것을 그대로 싣는다.
    const src = readFileSync(join(ROOT, 'shared', 'join.js'), 'utf8')
    expect(src).toContain('repriorityIds')
    expect(src).toContain('notInAgreementIds')
  })

  it('id 를 못 받으면 화면만 연다', () => {
    // 옛 배포가 잠깐 섞여 있을 때 "?id=undefined" 로 보내면 그 화면은
    // 아무것도 못 고르고 빈 채로 남는다.
    const items = buildTodo({ signoffs: { summary: { applications: 1 } } })
    expect(items.find((i) => i.key === 'open_objections').to).toBe('/agreement')

    const empty = buildTodo({
      signoffs: { summary: { applications: 1 }, applicationIds: [] },
    })
    expect(empty.find((i) => i.key === 'open_objections').to).toBe('/agreement')

    const nully = buildTodo({
      signoffs: { summary: { applications: 1 }, applicationIds: [null, 'app_d'] },
    })
    expect(nully.find((i) => i.key === 'open_objections').to).toBe('/agreement?id=app_d')
  })

  it('주소에 넣을 수 없는 글자를 그대로 안 붙인다', () => {
    const items = buildTodo({
      signoffs: { summary: { applications: 1 }, applicationIds: ['a b&c'] },
    })
    expect(items.find((i) => i.key === 'open_objections').to).toBe('/agreement?id=a%20b%26c')
  })

  it('받는 화면이 그 값을 실제로 읽는다', () => {
    // 보내기만 하고 받는 쪽이 안 읽으면 아무것도 안 바뀐다. 이 저장소에서
    // 되풀이된 모양이다.
    for (const f of ['AgreementPage.jsx', 'ReviewPage.jsx']) {
      const src = readFileSync(join(ROOT, 'src', 'pages', f), 'utf8')
      expect(src, f).toContain('useSearchParams')
      expect(src, f).toMatch(/params\.get\('id'\)/)
    }
  })
})

// 도구 화면으로 보내는 할 일도 어느 카드인지 짚어 준다.
//
// 첫 화면 할 일 다섯 줄 중 셋이 도구 화면을 가리킨다. 눌러서 오면 카드가
// 늘어서 있고, 담당자는 "못 쓰겠다고 한 게 어느 거지"를 다시 찾아야 했다.
// 세 줄이면 세 번 찾는다. 그러다 다른 걸 열게 되고, 결국 그 목록을 안 쓴다.
describe('도구 할 일이 어느 카드인지 알려주는가', () => {
  const tools = (over = {}) => ({
    summary: {
      rejected: 1,
      rejectedIds: ['app_r'],
      untrusted: 1,
      untrustedIds: ['app_u'],
      idle: 1,
      idleIds: ['app_i'],
      downStale: 1,
      downStaleIds: ['app_d'],
      ...over,
    },
  })

  it('항목마다 자기 목록을 쓴다', () => {
    // 한 목록을 돌려쓰면 문제가 없는 카드 앞으로 데려간다. 화면은 열리고
    // 카드도 그려지니 눌러 보기 전엔 아무도 모른다.
    const items = buildTodo({
      tools: tools(),
      reports: { summary: { urgent: 1, open: 1 } },
    })
    expect(items.find((i) => i.key === 'tool_rejected').to).toBe('/tools?id=app_r')
    expect(items.find((i) => i.key === 'untrusted_tool').to).toBe('/tools?id=app_u')
    expect(items.find((i) => i.key === 'idle_tools').to).toBe('/tools?id=app_i')
    expect(items.find((i) => i.key === 'tool_down_stale').to).toBe('/tools?id=app_d')
  })

  it('목록이 없으면 화면만 연다', () => {
    const items = buildTodo({ tools: { summary: { rejected: 1 } } })
    expect(items.find((i) => i.key === 'tool_rejected').to).toBe('/tools')
  })

  it('세는 것과 짚는 것이 같은 조건에서 나온다', () => {
    // 따로 뽑으면 "3개"라고 해 놓고 두 개만 짚어 준다.
    const src = readFileSync(join(ROOT, 'functions', 'api', 'tools', 'index.js'), 'utf8')
    for (const [count, ids] of [
      ["i.rejected).length", "i.rejected).map"],
      ["i.health === '안 쓰임').length", "i.health === '안 쓰임').map"],
    ]) {
      expect(src, count).toContain(count)
      expect(src, ids).toContain(ids)
    }
  })

  it('받는 화면이 그 값을 읽고 그 자리로 데려간다', () => {
    // 색만 칠하면 화면 밖에 있을 때 아무 도움이 안 된다.
    const page = readFileSync(join(ROOT, 'src', 'pages', 'ToolsPage.jsx'), 'utf8')
    expect(page).toMatch(/params\.get\('id'\)/)
    expect(page).toContain('scrollIntoView')
    expect(page).toContain('할 일에서 짚어 드린 도구입니다')
  })
})

describe('사용법서 할 일도 어느 건인지 알려주는가', () => {
  it('막힌 자리와 없는 사용법서가 서로 다른 목록을 쓴다', () => {
    // 한 목록을 돌려쓰면 "막힌 곳 보기"를 눌렀는데 아무도 안 짚은 사용법서
    // 앞에 떨어진다. 화면은 열리니 눌러 보기 전엔 모른다.
    const items = buildTodo({
      tools: {
        summary: {
          unclear: 1,
          unclearIds: ['app_stuck'],
          noManual: 1,
          noManualIds: ['app_none'],
        },
      },
    })
    expect(items.find((i) => i.key === 'unclear_manual').to).toBe('/manual?id=app_stuck')
    expect(items.find((i) => i.key === 'no_manual').to).toBe('/manual?id=app_none')
  })

  it('받는 화면이 그 값을 읽는다', () => {
    const page = readFileSync(join(ROOT, 'src', 'pages', 'ManualPage.jsx'), 'utf8')
    expect(page).toContain('useSearchParams')
    expect(page).toMatch(/params\.get\('id'\)/)
  })
})

// 중앙값만 보이면 폭이 안 보인다.
//
// 셋 다 열흘쯤 걸린 것과, 사흘짜리 하나에 스무날짜리 하나가 섞여 중앙이
// 열흘인 것은 완전히 다른 이야기인데 화면에서는 같은 숫자다. 서버는
// 최단·최장을 계산해 내려보내는데 읽는 곳이 없었다.
describe('접수부터 넘기기까지의 폭', () => {
  it('서버가 어느 건이었는지까지 준다', () => {
    // 숫자만 놓으면 "그래서 뭐"로 끝난다. 그 기록으로 갈 수 있어야
    // "이건 왜 스무날이나 걸렸지"를 눌러 볼 수 있다.
    const src = readFileSync(join(ROOT, 'functions', 'api', 'overview.js'), 'utf8')
    expect(src).toContain('ticket_no: h.ticket_no')
    expect(src).toContain('a.ticket_no')
  })

  it('화면이 최단·최장을 그린다', () => {
    const page = readFileSync(join(ROOT, 'src', 'pages', 'FlowPage.jsx'), 'utf8')
    expect(page).toContain('lead.fastest')
    expect(page).toContain('lead.slowest')
    expect(page).toContain('가장 빨랐던 것과 가장 오래 걸린 것')
  })

  it('한 건뿐이면 폭을 말하지 않는다', () => {
    // 최단과 최장이 같은 건이면 두 번 적는 것이 된다.
    const page = readFileSync(join(ROOT, 'src', 'pages', 'FlowPage.jsx'), 'utf8')
    expect(page).toContain('data.lead.count > 1')
  })
})

// 사용법서로 보내는 할 일도 어느 건인지 짚어 준다.
//
// 그 화면은 늘 첫 건을 골라 놓는다. "막힌 자리를 보세요"를 눌러 왔는데
// 막힌 것과 상관없는 건이 열려 있으면, 담당자는 칩을 하나씩 눌러 찾는다.
describe('사용법서 할 일이 어느 건인지 알려주는가', () => {
  it('항목마다 자기 목록을 쓴다', () => {
    const items = buildTodo({
      tools: {
        summary: {
          unclear: 2,
          unclearIds: ['app_u1'],
          noManual: 1,
          noManualIds: ['app_m1'],
        },
      },
    })
    expect(items.find((i) => i.key === 'unclear_manual').to).toBe('/manual?id=app_u1')
    expect(items.find((i) => i.key === 'no_manual').to).toBe('/manual?id=app_m1')
  })

  it('목록이 없으면 화면만 연다', () => {
    const items = buildTodo({ tools: { summary: { noManual: 1 } } })
    expect(items.find((i) => i.key === 'no_manual').to).toBe('/manual')
  })

  it('받는 화면이 그 값을 읽는다', () => {
    const page = readFileSync(join(ROOT, 'src', 'pages', 'ManualPage.jsx'), 'utf8')
    expect(page).toMatch(/params\.get\('id'\)/)
    // 주소로 온 건이 목록에 없으면 빈 화면 대신 첫 건으로 떨어져야 한다.
    expect(page).toContain('targets[0].id')
  })
})
