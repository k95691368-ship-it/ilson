import { describe, it, expect } from 'vitest'
import { compare, splitField, valueDiffs, TEXT_FIELDS } from '../shared/compare.js'

// 담당자가 "같은 건인가"를 판정하려면 두 글을 번갈아 읽어야 한다. 그게
// 어려워서 여기서 미리 갈라 준다. 잘못 가르면 담당자가 다른 건을 합치거나
// 같은 건을 두 번 만들게 된다.

const A = {
  id: 'a',
  ticket_no: 'AX-AAA-001',
  dept: '재무',
  applicant_label: '정산 담당자',
  title: '매주 채널 정산서를 손으로 붙입니다',
  bottleneck: '다섯 채널 정산서를 엑셀에 하나로 합칩니다.',
  problem: '한 줄 밀리면 금액이 틀어집니다.',
  wish: '자동으로 합쳐지면 좋겠습니다.',
  impact_if_wrong: '',
  status: '접수',
  current_minutes: 90,
  current_people: 1,
  current_frequency: '주 1회',
}

const B = {
  id: 'b',
  ticket_no: 'AX-BBB-002',
  dept: '재무',
  applicant_label: '회계 담당자',
  title: '채널 정산서 취합을 매주 손으로 합니다',
  bottleneck: '채널 다섯 곳 정산 내역을 엑셀에 모읍니다.',
  problem: '옮기다 놓치면 합계가 안 맞습니다.',
  wish: '',
  impact_if_wrong: '',
  status: '진행중',
  current_minutes: 120,
  current_people: 1,
  current_frequency: '주 1회',
}

describe('한 칸을 갈라 본다', () => {
  it('양쪽에 다 있는 말과 한쪽에만 있는 말을 나눈다', () => {
    const r = splitField('채널 정산서를 엑셀에 붙입니다', '채널 정산서를 시트에 붙입니다')
    expect(r.both).toContain('채널')
    expect(r.both).toContain('정산서')
    expect(r.onlyA).toContain('엑셀')
    expect(r.onlyB).toContain('시트')
    expect(r.onlyA).not.toContain('시트')
  })

  it('조각은 빼고 온전한 낱말만 보여 준다', () => {
    // 견줄 때는 두 글자 조각이 필요하지만, 사람에게 "이 말이 다릅니다"라고
    // 할 때 "산서"·"정산"을 들이밀면 읽을 수가 없다.
    const r = splitField('정산서를 봅니다', '정산서를 봅니다')
    expect(r.both).toContain('정산서')
    expect(r.both).not.toContain('산서')
    expect(r.both).not.toContain('정산')
  })

  it('한쪽이 비어 있으면 나머지가 전부 한쪽에만 있는 말이다', () => {
    const r = splitField('정산서 취합', '')
    expect(r.both).toEqual([])
    expect(r.onlyB).toEqual([])
    expect(r.onlyA.length).toBeGreaterThan(0)
  })

  it('둘 다 비어 있어도 터지지 않는다', () => {
    expect(splitField('', '')).toEqual({ both: [], onlyA: [], onlyB: [] })
    expect(splitField(null, undefined)).toEqual({ both: [], onlyA: [], onlyB: [] })
  })

  it('가나다순으로 정렬해서 순서가 흔들리지 않는다', () => {
    const x = splitField('채널 엑셀 정산서', '채널 엑셀 정산서')
    const y = splitField('정산서 채널 엑셀', '엑셀 정산서 채널')
    expect(x.both).toEqual(y.both)
  })
})

describe('값이 다른 칸 골라내기', () => {
  it('같은 값과 다른 값을 가른다', () => {
    const v = valueDiffs(A, B)
    const by = Object.fromEntries(v.map((x) => [x.key, x]))
    expect(by.dept.same).toBe(true)
    expect(by.current_frequency.same).toBe(true)
    expect(by.current_minutes.same).toBe(false)
    expect(by.status.same).toBe(false)
    expect(by.applicant_label.same).toBe(false)
  })

  it('둘 다 비어 있는 것은 다른 것이 아니다', () => {
    const v = valueDiffs({ dept: '재무' }, { dept: '재무' })
    const minutes = v.find((x) => x.key === 'current_minutes')
    expect(minutes.same).toBe(true)
    expect(minutes.bothEmpty).toBe(true)
  })

  it('한쪽만 비어 있으면 다른 것이다', () => {
    const v = valueDiffs({ current_minutes: 90 }, { current_minutes: null })
    expect(v.find((x) => x.key === 'current_minutes').same).toBe(false)
  })

  it('숫자와 문자를 섞어 놔도 같으면 같다고 한다', () => {
    // D1에서 오면 숫자, 폼에서 오면 문자열인 경우가 있다.
    const v = valueDiffs({ current_minutes: 90 }, { current_minutes: '90' })
    expect(v.find((x) => x.key === 'current_minutes').same).toBe(true)
  })
})

describe('두 신청서 견주기', () => {
  it('모든 글 칸을 갈라서 돌려준다', () => {
    const r = compare(A, B, [A, B])
    expect(r.fields).toHaveLength(TEXT_FIELDS.length)
    expect(r.fields.map((f) => f.key)).toEqual(TEXT_FIELDS.map((f) => f.key))
  })

  it('겹치는 말이 실제로 겹친 것이다', () => {
    const r = compare(A, B, [A, B])
    const title = r.fields.find((f) => f.key === 'title')
    expect(title.both).toContain('채널')
    expect(title.both).toContain('정산서')
    expect(title.both).toContain('매주')
  })

  it('한쪽만 적은 칸은 "다르다"가 아니라 "한쪽만 적었다"로 표시한다', () => {
    // A는 바라는 해결을 적었고 B는 안 적었다. 이걸 "다르다"고 하면
    // 담당자가 다른 건이라고 잘못 판단한다. 안 적은 것뿐이다.
    const r = compare(A, B, [A, B])
    const wish = r.fields.find((f) => f.key === 'wish')
    expect(wish.onlyOneSide).toBe(true)
    expect(wish.bothEmpty).toBe(false)
  })

  it('둘 다 안 적은 칸은 표시할 것이 없다', () => {
    const r = compare(A, B, [A, B])
    const impact = r.fields.find((f) => f.key === 'impact_if_wrong')
    expect(impact.bothEmpty).toBe(true)
    expect(impact.onlyOneSide).toBe(false)
  })

  it('요약이 실제 개수와 맞는다', () => {
    const r = compare(A, B, [A, B])
    const sharedFromFields = r.fields.reduce((s, f) => s + f.both.length, 0)
    expect(r.summary.sharedWords).toBe(sharedFromFields)
    expect(r.summary.differentValues).toBe(r.values.filter((v) => !v.same).length)
  })

  it('점수를 함께 준다', () => {
    const r = compare(A, B, [A, B])
    expect(r.score).toBeGreaterThan(0)
    expect(r.score).toBeLessThanOrEqual(1)
  })

  it('자기 자신과 견주면 다른 말이 하나도 없다', () => {
    const r = compare(A, A, [A])
    expect(r.summary.onlyAWords).toBe(0)
    expect(r.summary.onlyBWords).toBe(0)
    expect(r.summary.differentValues).toBe(0)
  })

  it('좌우를 바꿔도 겹치는 말은 같다', () => {
    const ab = compare(A, B, [A, B])
    const ba = compare(B, A, [A, B])
    expect(ab.summary.sharedWords).toBe(ba.summary.sharedWords)
    expect(ab.summary.onlyAWords).toBe(ba.summary.onlyBWords)
  })

  it('빈 신청서에도 터지지 않는다', () => {
    const r = compare({}, {}, [])
    expect(r.score).toBe(0)
    expect(r.fields.every((f) => f.bothEmpty)).toBe(true)
  })
})
