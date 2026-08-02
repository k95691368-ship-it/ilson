import { describe, it, expect } from 'vitest'
import {
  validateJoin,
  annualHoursOf,
  joinSummary,
  joinLine,
  joinReceipt,
  FREQUENCIES,
  MIN_STORY,
  pendingJoinDepts,
  joinAsRequirement,
  joinTrackPath,
  joinCounts,
} from '../shared/join.js'

// 신청서를 내려는데 비슷한 것이 이미 있으면 화면이 알려 준다. 그런데
// 알려 주기만 하고 부서가 거기서 할 수 있는 일이 없었다.
//
// 그래서 둘 중 하나가 된다. 그냥 똑같이 내거나(담당자가 두 번 판정한다),
// 아니면 그만두거나. 그만두면 더 나쁘다 — 그 부서도 같은 일로 시간을
// 쓰고 있다는 사실이 어디에도 안 남고, 담당자는 한 부서 일인 줄 알고
// 우선순위를 낮게 매긴다.

const good = {
  dept: '마케팅',
  by: '이과장',
  minutes: 60,
  people: 2,
  frequency: '주 1회',
  story: '저희도 매주 채널별로 숫자를 옮겨 적습니다',
}

describe('손들 때 받는 것', () => {
  it('제대로 적었으면 통과한다', () => {
    expect(validateJoin(good)).toEqual({})
  })

  it('부서와 이름은 받는다', () => {
    expect(validateJoin({ ...good, dept: '' }).dept).toBeTruthy()
    expect(validateJoin({ ...good, by: '  ' }).by).toBeTruthy()
  })

  it('그쪽 사정을 한 줄이라도 받는다', () => {
    // 부서 이름만 받으면 "세 부서가 겪습니다"까지밖에 못 말한다.
    expect(validateJoin({ ...good, story: '' }).story).toBeTruthy()
    expect(validateJoin({ ...good, story: '같아요' }).story).toBeTruthy()
    expect(validateJoin({ ...good, story: 'ㅇ'.repeat(MIN_STORY) }).story).toBeUndefined()
  })

  it('걸리는 시간을 안 적으면 막는다', () => {
    // 얼마나 겪는지를 받아야 담당자가 우선순위를 다시 매길 수 있다.
    expect(validateJoin({ ...good, minutes: null }).minutes).toBeTruthy()
    expect(validateJoin({ ...good, minutes: 0 }).minutes).toBeTruthy()
    expect(validateJoin({ ...good, minutes: '몰라요' }).minutes).toBeTruthy()
  })

  it('없는 주기는 막는다', () => {
    expect(validateJoin({ ...good, frequency: '가끔' }).frequency).toBeTruthy()
    expect(FREQUENCIES).toContain('주 1회')
  })

  it('사람 수는 안 적어도 된다', () => {
    expect(validateJoin({ ...good, people: '' }).people).toBeUndefined()
    expect(validateJoin({ ...good, people: 0 }).people).toBeTruthy()
  })

  it('빈 입력에도 터지지 않는다', () => {
    expect(() => validateJoin()).not.toThrow()
  })
})

describe('한 부서가 이 일에 쓰는 연간 시간', () => {
  it('분 × 사람 × 연 횟수를 시간으로 센다', () => {
    // 60분 × 2명 × 52회 = 6240분 = 104시간
    expect(annualHoursOf(good)).toBe(104)
  })

  it('사람 수를 안 적었으면 한 명으로 본다', () => {
    expect(annualHoursOf({ ...good, people: null })).toBe(52)
  })

  it('셀 수 없으면 null이다 — 0으로 안 센다', () => {
    // 0으로 세면 시간을 안 적은 부서가 "안 걸린다"로 읽힌다.
    expect(annualHoursOf({ ...good, frequency: null })).toBeNull()
    expect(annualHoursOf({ ...good, minutes: null })).toBeNull()
    expect(annualHoursOf()).toBeNull()
  })
})

describe('이 병목이 실제로 얼마나 큰가', () => {
  const application = { dept: '재무', current_minutes: 90, current_people: 1, current_frequency: '주 1회' }
  const joins = [
    { dept: '마케팅', minutes: 60, people: 2, frequency: '주 1회' },
    { dept: '영업', minutes: 30, people: 1, frequency: '매월' },
  ]

  it('낸 부서와 손든 부서를 다 센다', () => {
    const s = joinSummary({ application, joins })
    expect(s.deptCount).toBe(3)
    expect(s.depts).toContain('재무')
    expect(s.joinCount).toBe(2)
  })

  it('시간을 합쳐 준다', () => {
    const s = joinSummary({ application, joins })
    expect(s.ownHours).toBe(78) // 90분 × 1명 × 52회
    expect(s.totalHours).toBe(Math.round((78 + 104 + 6) * 10) / 10)
  })

  it('시간을 못 센 부서가 있으면 합계를 안 내놓는다', () => {
    // 일부만 더한 값을 "이 병목의 크기"라고 부르면 실제보다 작게 보인다.
    const s = joinSummary({ application, joins: [...joins, { dept: '운영', minutes: null }] })
    expect(s.totalHours).toBeNull()
    expect(s.missing).toBe(1)
  })

  it('푼 것은 안 센다', () => {
    const s = joinSummary({ application, joins: [{ ...joins[0], released: true }] })
    expect(s.joinCount).toBe(0)
    expect(s.deptCount).toBe(1)
  })

  it('손든 부서가 있으면 우선순위를 다시 보라고 한다', () => {
    // 처음 판정할 때는 한 부서 일인 줄 알고 매긴 점수다.
    expect(joinSummary({ application, joins }).needsRepriority).toBe(true)
    expect(joinSummary({ application, joins: [] }).needsRepriority).toBe(false)
  })

  it('더한 값을 실측인 척하지 않는다', () => {
    // 부서마다 일하는 방식이 달라 같은 병목이라도 걸리는 시간이 다르고,
    // 여기 적힌 것은 전부 스스로 말한 체감값이다.
    expect(joinSummary({ application, joins }).caveat).toContain('재 본 값이 아닙니다')
  })

  it('빈 입력에도 터지지 않는다', () => {
    expect(() => joinSummary()).not.toThrow()
    expect(joinSummary().joinCount).toBe(0)
  })
})

describe('담당자에게 뭐라고 말하나', () => {
  it('손든 부서가 없으면 아무 말도 안 한다', () => {
    expect(joinLine({ joinCount: 0 })).toBeNull()
    expect(joinLine()).toBeNull()
  })

  it('몇 부서가 손들었고 다 합치면 얼마인지 말한다', () => {
    const t = joinLine({ joinCount: 2, totalHours: 188 })
    expect(t).toContain('2개 부서')
    expect(t).toContain('188시간')
  })

  it('합계를 못 내면 왜 못 내는지 말한다', () => {
    const t = joinLine({ joinCount: 2, totalHours: null, missing: 1 })
    expect(t).toContain('1개 부서는 시간을')
  })
})

describe('손든 부서에게 뭐라고 답하나', () => {
  it('새로 안 내도 된다는 것을 분명히 말한다', () => {
    // 이 말이 없으면 부서는 손들고도 불안해서 또 낸다.
    const t = joinReceipt({ ticket: 'AX-A-1', dept: '마케팅', deptCount: 3 })
    expect(t).toContain('새로 신청서를 내지 않으셔도 됩니다')
    expect(t).toContain('3개 부서')
  })

  it('혼자면 부서 수를 안 적는다', () => {
    expect(joinReceipt({ ticket: 'AX-A-1', dept: '마케팅', deptCount: 1 })).not.toContain('개 부서가 이 일에')
  })
})

// 손든 부서의 사정은 다 적혀 있는데, 그 한 줄이 협의 자리로 건너오지
// 않았다. 담당자는 낸 부서하고만 합의하고, 손든 부서는 다 만들어진 뒤에
// 처음 기준을 본다. 그때는 늦다.
describe('손든 한 줄을 협의 자리로', () => {
  const j = (id, dept, extra = {}) => ({
    id,
    dept,
    by: '이과장',
    story: `${dept}도 매주 같은 일을 손으로 합니다`,
    minutes: 60,
    people: 1,
    frequency: '주 1회',
    at: '2026-08-02 01:00:00',
    ...extra,
  })

  it('요구가 없는 부서만 올린다', () => {
    const p = pendingJoinDepts({ joins: [j('j1', '마케팅'), j('j2', '영업')], requirements: [{ dept: '영업' }] })
    expect(p.map((x) => x.dept)).toEqual(['마케팅'])
  })

  it('푼 손들기는 안 올린다', () => {
    // 손들기를 풀면 이해관계자 줄에서도 한꺼번에 빠져야 한다.
    const p = pendingJoinDepts({ joins: [j('j1', '마케팅', { released: true })], requirements: [] })
    expect(p).toEqual([])
  })

  it('기각된 요구도 들어온 것으로 센다', () => {
    // 판단이 끝난 것을 다시 조르면 담당자는 이 목록을 통째로 무시한다.
    const p = pendingJoinDepts({ joins: [j('j1', '마케팅')], requirements: [{ dept: '마케팅', status: '기각' }] })
    expect(p).toEqual([])
  })

  it('부서 이름 표기가 조금 달라도 같게 본다', () => {
    // "운영"과 "운영팀"은 같은 부서다.
    const p = pendingJoinDepts({ joins: [j('j1', '운영팀')], requirements: [{ dept: '운영' }] })
    expect(p).toEqual([])
  })

  it('다른 부서를 같은 부서로 뭉개지 않는다', () => {
    // 접미사를 여러 개 떼기 시작하면 서로 다른 부서가 하나가 된다.
    const p = pendingJoinDepts({ joins: [j('j1', '영업지원')], requirements: [{ dept: '영업' }] })
    expect(p.map((x) => x.dept)).toEqual(['영업지원'])
  })

  it('그 부서가 얼마나 겪는지를 같이 준다', () => {
    // 담당자가 요구 문장을 다듬을 때 크기를 알아야 한다.
    expect(pendingJoinDepts({ joins: [j('j1', '마케팅')], requirements: [] })[0].annualHours).toBe(52)
  })

  it('빈 입력에도 터지지 않는다', () => {
    expect(pendingJoinDepts({})).toEqual([])
    expect(() => pendingJoinDepts()).not.toThrow()
  })
})

describe('요구로 올릴 모양', () => {
  const join = { dept: '마케팅', story: '광고비까지 같이 봅니다' }

  it('손든 사정이 본문에 들어간다', () => {
    expect(joinAsRequirement(join).body).toBe('광고비까지 같이 봅니다')
    expect(joinAsRequirement(join).dept).toBe('마케팅')
  })

  it('회의록 인용은 비운다', () => {
    // 회의에서 나온 말이 아니라, 채우면 "회의록에서 못 찾음"이 잘못 붙는다.
    expect(joinAsRequirement(join).quote).toBe('')
  })

  it('가정으로 올린다', () => {
    // 아직 그 부서와 마주 앉기 전이라 확정이 아니다.
    expect(joinAsRequirement(join).req_kind).toBe('가정')
  })

  it('빈 입력에도 터지지 않는다', () => {
    expect(() => joinAsRequirement()).not.toThrow()
  })
})

describe('손든 부서 전용 조회 주소', () => {
  it('부서를 주소에 실어 준다', () => {
    // 손든 부서는 접수번호가 없다. 낸 부서 시점 화면만 보면 자기가 적어
    // 낸 한 줄이 어떻게 됐는지 못 찾는다.
    expect(joinTrackPath({ ticket: 'AX-A-1', dept: '재무' })).toContain('as=')
    expect(joinTrackPath({ ticket: 'AX-A-1', dept: '재무' })).toContain('no=AX-A-1')
  })

  it('부서가 없으면 접수번호만 준다', () => {
    expect(joinTrackPath({ ticket: 'AX-A-1' })).toBe('/track?no=AX-A-1')
  })

  it('접수번호가 없으면 조회 화면만 준다', () => {
    expect(joinTrackPath({})).toBe('/track')
    expect(() => joinTrackPath()).not.toThrow()
  })
})

describe('첫 화면에 몇 건으로 세나', () => {
  const live = [{ id: 'j1', dept: '마케팅', story: 'x' }]

  it('판정 전이면 우선순위 다시 보기로 센다', () => {
    const c = joinCounts({ joinsByApp: { a: live }, apps: [{ id: 'a', status: '접수' }] })
    expect(c.needsRepriority).toBe(1)
    expect(c.notInAgreement).toBe(0)
  })

  it('협의 중이면 협의안에 넣기로 센다', () => {
    const c = joinCounts({
      joinsByApp: { a: live },
      apps: [{ id: 'a', status: '진행중' }],
      requirementsByApp: { a: [] },
    })
    expect(c.needsRepriority).toBe(0)
    expect(c.notInAgreement).toBe(1)
  })

  it('한 신청서가 두 줄에 동시에 안 뜬다', () => {
    const c = joinCounts({ joinsByApp: { a: live }, apps: [{ id: 'a', status: '진행중' }], requirementsByApp: { a: [] } })
    expect(c.needsRepriority + c.notInAgreement).toBe(1)
  })

  it('요구가 들어왔으면 안 센다', () => {
    const c = joinCounts({
      joinsByApp: { a: live },
      apps: [{ id: 'a', status: '진행중' }],
      requirementsByApp: { a: [{ dept: '마케팅' }] },
    })
    expect(c.notInAgreement).toBe(0)
  })

  it('끝나거나 접힌 건은 어느 쪽에도 안 센다', () => {
    for (const status of ['완료', '반려', '보류']) {
      const c = joinCounts({ joinsByApp: { a: live }, apps: [{ id: 'a', status }], requirementsByApp: { a: [] } })
      expect(c.needsRepriority + c.notInAgreement).toBe(0)
    }
  })

  it('푼 것은 안 센다', () => {
    const c = joinCounts({
      joinsByApp: { a: [{ id: 'j1', dept: '마케팅', released: true }] },
      apps: [{ id: 'a', status: '진행중' }],
    })
    expect(c.joinCount).toBe(0)
    expect(c.releasedCount).toBe(1)
  })

  it('빈 입력에도 터지지 않는다', () => {
    expect(joinCounts({}).joinCount).toBe(0)
    expect(() => joinCounts()).not.toThrow()
  })
})
