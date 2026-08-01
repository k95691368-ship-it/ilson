import { describe, it, expect } from 'vitest'
import {
  applyQuery,
  facetCounts,
  matchesQuery,
  isStale,
  describeQuery,
  isFiltered,
  sumAnnualHours,
  presentStatuses,
  queueStats,
  EMPTY_QUERY,
  STALE_HOURS,
} from '../src/lib/inbox.js'

// 이 규칙이 틀리면 담당자가 잘못된 것을 먼저 보게 된다. 순서가 흔들리거나,
// 칩에 적힌 숫자와 눌렀을 때 나오는 건수가 다르거나, 미기재를 0으로 취급하는
// 것 전부 "화면이 거짓말을 한 것"이다. 여기서 못 박는다.

const ITEMS = [
  {
    id: 'a',
    ticket_no: 'AX-AAA-001',
    dept: '재무',
    applicant_label: '정산 담당자',
    title: '매주 채널 정산서를 손으로 붙입니다',
    bottleneck: '다섯 채널 정산서를 하나로 합칩니다',
    problem: '한 줄 밀리면 금액이 틀립니다',
    status: '접수',
    created_at: '2026-07-20 09:00:00',
    hours_since: 200,
    annual_hours: 84,
    file_count: 3,
  },
  {
    id: 'b',
    ticket_no: 'AX-BBB-002',
    dept: '마케팅',
    applicant_label: '퍼포먼스 담당자',
    title: '광고비 리포트를 매일 만듭니다',
    bottleneck: '채널별 광고비를 시트에 옮깁니다',
    problem: '옮기다 빠뜨립니다',
    status: '접수',
    created_at: '2026-07-30 09:00:00',
    hours_since: 4,
    annual_hours: 120,
    file_count: 0,
  },
  {
    id: 'c',
    ticket_no: 'AX-CCC-003',
    dept: '재무',
    applicant_label: '회계 담당자',
    title: 'ERP에 결과를 다시 타이핑합니다',
    bottleneck: '취합한 엑셀을 보며 한 줄씩 옮깁니다',
    problem: '숫자가 어긋나면 반나절이 갑니다',
    status: '반려',
    created_at: '2026-07-10 09:00:00',
    hours_since: 500,
    annual_hours: null, // 소요를 안 적은 신청서
    file_count: 1,
  },
  {
    id: 'd',
    ticket_no: 'AX-DDD-004',
    dept: '영업',
    applicant_label: '영업 지원',
    title: '거래처별 단가표를 손으로 맞춥니다',
    bottleneck: '단가표가 매달 바뀝니다',
    problem: '틀린 단가로 견적이 나갑니다',
    status: '수용',
    created_at: '2026-07-25 09:00:00',
    hours_since: 120,
    annual_hours: 40,
    file_count: 0,
  },
]

const ids = (list) => list.map((i) => i.id)

describe('묵었다는 판정', () => {
  it('아직 판정 안 했고 하루가 넘었으면 묵은 것이다', () => {
    expect(isStale(ITEMS[0])).toBe(true)
  })

  it('방금 들어온 것은 묵은 것이 아니다', () => {
    expect(isStale(ITEMS[1])).toBe(false)
  })

  it('판정이 끝난 것은 아무리 오래돼도 묵은 것이 아니다', () => {
    // 500시간 지났지만 반려로 답을 이미 줬다. 담당자가 지금 할 일이 아니다.
    expect(ITEMS[2].hours_since).toBeGreaterThan(STALE_HOURS)
    expect(isStale(ITEMS[2])).toBe(false)
  })
})

describe('말로 찾기', () => {
  it('제목이 아니라 본문에 있어도 찾는다', () => {
    // 담당자가 기억하는 것은 제목이 아니라 본문 한 조각인 경우가 많다
    expect(matchesQuery(ITEMS[0], '한 줄 밀리면')).toBe(true)
  })

  it('접수번호로도 찾는다', () => {
    expect(matchesQuery(ITEMS[1], 'AX-BBB-002')).toBe(true)
  })

  it('부서 이름으로도 찾는다', () => {
    expect(matchesQuery(ITEMS[0], '재무')).toBe(true)
  })

  it('낱말이 떨어져 있어도 둘 다 있으면 찾는다', () => {
    // "재무"는 dept에, "정산서"는 title에 있다. 어순을 외우게 하지 않는다.
    expect(matchesQuery(ITEMS[0], '재무 정산서')).toBe(true)
  })

  it('한 낱말이라도 없으면 못 찾은 것이다', () => {
    expect(matchesQuery(ITEMS[0], '재무 광고비')).toBe(false)
  })

  it('빈 검색어는 전부 통과시킨다', () => {
    expect(matchesQuery(ITEMS[0], '')).toBe(true)
    expect(matchesQuery(ITEMS[0], '   ')).toBe(true)
  })

  it('접수번호를 대시 없이 쳐도 찾는다', () => {
    // 메신저로 받아 붙여 넣으면 대시가 있지만, 전화로 듣고 치면 없다.
    expect(matchesQuery(ITEMS[0], 'axaaa001')).toBe(true)
    expect(matchesQuery(ITEMS[0], 'AXAAA001')).toBe(true)
  })

  it('접수번호 뒷자리만 쳐도 찾는다', () => {
    expect(matchesQuery(ITEMS[1], 'BBB')).toBe(true)
  })

  it('대시를 떼도 다른 신청서까지 걸리지는 않는다', () => {
    expect(matchesQuery(ITEMS[1], 'axaaa001')).toBe(false)
  })

  it('대시를 떼는 것이 두 낱말 검색을 망가뜨리지 않는다', () => {
    // 뗀 것만 뒤지면 "재무 정산서"가 "재무정산서" 한 덩어리가 되어 안 걸린다.
    expect(matchesQuery(ITEMS[0], '재무 정산서')).toBe(true)
    expect(matchesQuery(ITEMS[0], '재무 광고비')).toBe(false)
  })
})

describe('기본 정렬 — 묵은 순', () => {
  it('아직 판정 안 한 것이 판정 끝난 것보다 언제나 위다', () => {
    const out = applyQuery(ITEMS, EMPTY_QUERY)
    // a, b가 '접수' / c는 '반려', d는 '수용'
    expect(out.slice(0, 2).map((i) => i.status)).toEqual(['접수', '접수'])
  })

  it('판정 안 한 것끼리는 오래된 것이 위다', () => {
    const out = applyQuery(ITEMS, EMPTY_QUERY)
    expect(ids(out).slice(0, 2)).toEqual(['a', 'b'])
  })
})

describe('연 환산 시간 순 정렬', () => {
  it('큰 것부터 나온다', () => {
    const out = applyQuery(ITEMS, { sort: 'hours' })
    expect(ids(out).slice(0, 3)).toEqual(['b', 'a', 'd'])
  })

  it('소요를 안 적은 것은 0시간이 아니라 맨 뒤로 간다', () => {
    // 미기재를 0으로 치면 "안 적었다"와 "0시간이다"가 같아진다. 다르다.
    const out = applyQuery(ITEMS, { sort: 'hours' })
    expect(out[out.length - 1].id).toBe('c')
    expect(out[out.length - 1].annual_hours).toBeNull()
  })
})

describe('순서가 흔들리지 않는다', () => {
  it('같은 조건이면 몇 번을 돌려도 같은 순서다', () => {
    const a = ids(applyQuery(ITEMS, { sort: 'dept' }))
    const b = ids(applyQuery([...ITEMS].reverse(), { sort: 'dept' }))
    // 입력 순서가 달라도 결과 순서는 같아야 한다. 목록이 흔들리면
    // 담당자가 방금 본 것이 어디 있었는지 놓친다.
    expect(a).toEqual(b)
  })

  it('원본 배열을 건드리지 않는다', () => {
    const before = ids(ITEMS)
    applyQuery(ITEMS, { sort: 'hours' })
    expect(ids(ITEMS)).toEqual(before)
  })
})

describe('조건 걸기', () => {
  it('부서로 좁힌다', () => {
    expect(ids(applyQuery(ITEMS, { dept: '재무' }))).toEqual(['a', 'c'])
  })

  it('상태로 좁힌다', () => {
    expect(ids(applyQuery(ITEMS, { status: '반려' }))).toEqual(['c'])
  })

  it('첨부가 있는 것만', () => {
    expect(ids(applyQuery(ITEMS, { onlyWithFiles: true }))).toEqual(['a', 'c'])
  })

  it('묵은 것만', () => {
    expect(ids(applyQuery(ITEMS, { onlyStale: true }))).toEqual(['a'])
  })

  it('조건이 여럿이면 전부 만족하는 것만 (AND)', () => {
    expect(ids(applyQuery(ITEMS, { dept: '재무', onlyWithFiles: true }))).toEqual(['a', 'c'])
    expect(ids(applyQuery(ITEMS, { dept: '재무', status: '접수' }))).toEqual(['a'])
  })

  it('검색과 조건을 같이 걸 수 있다', () => {
    expect(ids(applyQuery(ITEMS, { q: '엑셀', dept: '재무' }))).toEqual(['c'])
  })
})

describe('칩에 적히는 숫자', () => {
  it('아무 조건이 없으면 전체 기준으로 센다', () => {
    const f = facetCounts(ITEMS, EMPTY_QUERY)
    expect(f.byDept).toEqual({ 재무: 2, 마케팅: 1, 영업: 1 })
    expect(f.byStatus).toEqual({ 접수: 2, 반려: 1, 수용: 1 })
    expect(f.stale).toBe(1)
    expect(f.withFiles).toBe(2)
  })

  it('부서 칩의 숫자는 다른 조건을 반영하되 부서 조건 자체는 빼고 센다', () => {
    // 첨부 있는 것만 걸어 둔 상태. 이때 각 부서 칩에 적힐 숫자는
    // "첨부 있는 것 중 그 부서" 건수여야 한다. 첨부 없는 마케팅·영업은 빠진다.
    const f = facetCounts(ITEMS, { onlyWithFiles: true })
    expect(f.byDept).toEqual({ 재무: 2 })
  })

  it('눌러서 0건이 나올 칩은 0이라고 적힌다 — 눌러 보기 전에 알 수 있어야 한다', () => {
    const f = facetCounts(ITEMS, { onlyWithFiles: true })
    // 마케팅(b)은 첨부가 없다. 그러니 '마케팅' 칩은 아예 0이거나 목록에 없다.
    expect(f.byDept['마케팅'] ?? 0).toBe(0)
    expect(f.byDept['재무']).toBe(2)
  })

  it('검색어는 모든 칩 숫자에 반영된다', () => {
    const f = facetCounts(ITEMS, { q: '재무' })
    expect(f.byDept).toEqual({ 재무: 2 })
  })

  it('이미 고른 부서를 바꿔 보려 할 때 다른 부서 숫자도 보인다', () => {
    // 재무를 고른 상태에서도 마케팅 칩에 1이 보여야 갈아탈 수 있다.
    const f = facetCounts(ITEMS, { dept: '재무' })
    expect(f.byDept['마케팅']).toBe(1)
    expect(f.byDept['재무']).toBe(2)
  })

  it('부서를 고르면 상태 칩 숫자는 그 부서 기준으로 줄어든다', () => {
    const f = facetCounts(ITEMS, { dept: '재무' })
    expect(f.byStatus).toEqual({ 접수: 1, 반려: 1 })
  })
})

describe('지금 무엇을 보고 있는지 한 줄로', () => {
  it('조건이 없으면 전체라고 적는다', () => {
    expect(describeQuery(EMPTY_QUERY, 4, 4)).toBe('전체 4건')
  })

  it('건 조건을 전부 말로 적는다', () => {
    const s = describeQuery({ dept: '재무', onlyStale: true }, 1, 4)
    expect(s).toContain('4건 중 1건')
    expect(s).toContain('재무 부서')
    expect(s).toContain('24시간 넘게 안 본 것')
  })

  it('검색어도 적는다', () => {
    expect(describeQuery({ q: '정산' }, 1, 4)).toContain('"정산"가 들어간 것')
  })
})

describe('조건이 걸려 있는지', () => {
  it('빈 조건은 안 걸린 것이다', () => {
    expect(isFiltered(EMPTY_QUERY)).toBe(false)
    expect(isFiltered({})).toBe(false)
  })

  it('정렬만 바꾼 것은 조건을 건 것이 아니다', () => {
    // 정렬은 무엇을 보느냐가 아니라 어떤 순서로 보느냐다. '조건 지우기'
    // 버튼이 정렬까지 되돌리면 사용자가 놀란다.
    expect(isFiltered({ sort: 'hours' })).toBe(false)
  })

  it('하나라도 걸리면 걸린 것이다', () => {
    expect(isFiltered({ dept: '재무' })).toBe(true)
    expect(isFiltered({ q: '정산' })).toBe(true)
    expect(isFiltered({ onlyStale: true })).toBe(true)
  })
})

describe('걸린 조건 안에서의 합계', () => {
  it('미기재는 더하지 않고 따로 센다', () => {
    const s = sumAnnualHours(ITEMS)
    expect(s.hours).toBe(244) // 84 + 120 + 40
    expect(s.missing).toBe(1) // c
  })

  it('필터를 걸면 합계도 따라 움직인다', () => {
    const s = sumAnnualHours(applyQuery(ITEMS, { dept: '재무' }))
    expect(s.hours).toBe(84)
    expect(s.missing).toBe(1)
  })

  it('빈 목록에서도 터지지 않는다', () => {
    expect(sumAnnualHours([])).toEqual({ hours: 0, missing: 0 })
    expect(sumAnnualHours(undefined)).toEqual({ hours: 0, missing: 0 })
  })
})

describe('상태 칩에 낼 것', () => {
  it('실제로 그 상태인 것이 있는 것만 낸다', () => {
    expect(presentStatuses(ITEMS)).toEqual(['접수', '수용', '반려'])
  })

  it('진행 순서대로 늘어놓는다', () => {
    // 순서가 곧 일이 흘러가는 방향이라, 왼쪽에서 오른쪽으로 읽힌다.
    const mixed = [{ status: '완료' }, { status: '접수' }, { status: '진행중' }]
    expect(presentStatuses(mixed)).toEqual(['접수', '진행중', '완료'])
  })

  it('네 개만 박아 두면 못 고르던 상태를 이제 고를 수 있다', () => {
    // '진행중'인 신청서가 있는데 칩이 없으면, 화면에 보이는데 좁힐 방법이 없다.
    expect(presentStatuses([{ status: '진행중' }])).toContain('진행중')
  })

  it('빈 목록이면 아무것도 안 낸다', () => {
    expect(presentStatuses([])).toEqual([])
    expect(presentStatuses(undefined)).toEqual([])
  })
})

describe('지금 보고 있는 것 안의 대기', () => {
  it('아직 판정 안 한 것과 그중 묵은 것을 센다', () => {
    expect(queueStats(ITEMS)).toEqual({ waiting: 2, stale: 1 })
  })

  it('조건을 건 결과에 대고 세면 그만큼만 센다', () => {
    expect(queueStats(applyQuery(ITEMS, { dept: '마케팅' }))).toEqual({ waiting: 1, stale: 0 })
  })

  it('빈 목록에서도 터지지 않는다', () => {
    expect(queueStats([])).toEqual({ waiting: 0, stale: 0 })
    expect(queueStats(undefined)).toEqual({ waiting: 0, stale: 0 })
  })
})

describe('빈 입력', () => {
  it('목록이 없어도 터지지 않는다', () => {
    expect(applyQuery(undefined, EMPTY_QUERY)).toEqual([])
    expect(facetCounts(undefined, EMPTY_QUERY).byDept).toEqual({})
  })
})
