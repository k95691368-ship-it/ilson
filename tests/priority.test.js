import { describe, it, expect } from 'vitest'
import {
  quadrantOf,
  boardItems,
  boardNotes,
  validatePick,
  pickedState,
  QUADRANTS,
  MID,
  MIN_WHY,
} from '../shared/priority.js'

// 판정은 한 건씩 한다. 그런데 수용이 여러 건 쌓이면 그다음 질문이 온다 —
// 이 중에 무엇부터 하나. 지금은 그걸 정하는 자리가 없어서, 담당자는 목록을
// 위에서부터 하거나 마지막에 들어온 것부터 한다.
//
// 여기서 지켜야 할 것은 "순서를 잘 정해 주는가"가 아니라
// **"규칙이 사람 대신 정하지 않는가"**다.

const app = (o = {}) => ({
  id: 'a1',
  ticket_no: 'AX-001',
  dept: '재무',
  title: '정산 합치기',
  status: '수용',
  impact_score: 4,
  difficulty_score: 2,
  ...o,
})

describe('어느 자리에 놓이나', () => {
  it('크게 걸리고 쉬우면 quick', () => {
    expect(quadrantOf(5, 1)).toBe('quick')
    expect(quadrantOf(3, 3)).toBe('quick')
  })

  it('크게 걸리고 어려우면 heavy', () => {
    expect(quadrantOf(5, 5)).toBe('heavy')
  })

  it('적게 걸리고 쉬우면 small', () => {
    expect(quadrantOf(1, 1)).toBe('small')
  })

  it('적게 걸리고 어려우면 avoid', () => {
    expect(quadrantOf(1, 5)).toBe('avoid')
  })

  it('가운데를 평균으로 자르지 않는다', () => {
    // 그날 들어온 것이 다 쉬우면 그중 제일 어려운 것이 "어려운 것"이 된다.
    // 판이 흔들리면 어제 본 것과 오늘 본 것이 달라진다.
    expect(MID).toBe(3)
  })

  it('점수가 없으면 자리를 안 정한다', () => {
    expect(quadrantOf(null, 2)).toBeNull()
    expect(quadrantOf(3, undefined)).toBeNull()
    expect(quadrantOf('높음', 2)).toBeNull()
    expect(quadrantOf()).toBeNull()
  })

  it('자리마다 무엇인지와 무엇을 보라는지가 적혀 있다', () => {
    for (const q of QUADRANTS) {
      expect(q.label.length).toBeGreaterThan(5)
      expect(q.hint.length).toBeGreaterThan(15)
    }
  })

  it('자리 이름이 순서를 정해 주지 않는다', () => {
    // "먼저 한다"고 이름 붙이면 규칙이 순서를 정한 것이 되고,
    // 담당자는 그 이름을 따라가게 된다.
    const names = QUADRANTS.map((q) => q.label).join()
    expect(names).not.toContain('먼저 한다')
    expect(names).not.toContain('나중에')
    expect(names).not.toContain('1순위')
  })
})

describe('판에 올릴 수 있는 것', () => {
  it('판정이 끝난 것만 올린다', () => {
    const { items, off } = boardItems({
      applications: [app(), app({ id: 'b', status: '접수' })],
    })
    expect(items.map((i) => i.id)).toEqual(['a1'])
    expect(off[0].why).toContain('판정 전')
  })

  it('점수가 없으면 0,0에 안 찍는다', () => {
    // 0,0에 찍으면 "안 걸리고 쉬운 것"으로 읽히는데 실제로는 안 매긴 것이다.
    const { items, off } = boardItems({
      applications: [app({ impact_score: null, difficulty_score: null })],
    })
    expect(items).toEqual([])
    expect(off[0].why).toContain('안 매기셨습니다')
  })

  it('반려·보류·완료는 왜 안 올라오는지 말한다', () => {
    const { off } = boardItems({
      applications: [
        app({ id: 'r', status: '반려' }),
        app({ id: 'h', status: '보류' }),
        app({ id: 'd', status: '완료' }),
      ],
    })
    expect(off.map((o) => o.why).join()).toContain('반려한 건')
    expect(off.map((o) => o.why).join()).toContain('보류한 건')
    expect(off.map((o) => o.why).join()).toContain('끝난 건')
  })

  it('손든 부서까지 더한 시간을 점 크기로 쓴다', () => {
    const { items } = boardItems({ applications: [app()], joins: { a1: 182 } })
    expect(items[0].annualHours).toBe(182)
  })

  it('시간을 모르면 null이다 — 0으로 안 그린다', () => {
    const { items } = boardItems({ applications: [app({ annual_hours: null })] })
    expect(items[0].annualHours).toBeNull()
  })

  it('빈 입력에도 터지지 않는다', () => {
    expect(boardItems({}).items).toEqual([])
    expect(() => boardItems()).not.toThrow()
  })
})

describe('판 위에서 짚어 주는 것', () => {
  it('크게 걸리고 쉬운 것이 있으면 짚는다', () => {
    const n = boardNotes([{ quadrant: 'quick', deptCount: 1, annualHours: 100 }])
    expect(n.find((x) => x.key === 'quick_waiting')).toBeTruthy()
  })

  it('여러 부서가 걸린 것은 점수보다 크다고 말한다', () => {
    // 임팩트 점수는 한 부서 기준으로 매긴 것이다.
    const n = boardNotes([{ quadrant: 'small', deptCount: 3, annualHours: 100 }])
    expect(n.find((x) => x.key === 'multi_dept').text).toContain('그 점수보다 큽니다')
  })

  it('시간을 모르는 것이 있으면 크기를 못 믿는다고 말한다', () => {
    const n = boardNotes([{ quadrant: 'small', deptCount: 1, annualHours: null }])
    expect(n.find((x) => x.key === 'no_hours').text).toContain('작아 보이는 것이 작은 것은 아닙니다')
  })

  it('순서를 정해 주지 않는다', () => {
    const n = boardNotes([{ quadrant: 'quick', deptCount: 1, annualHours: 100 }])
    expect(n.map((x) => x.text).join()).not.toContain('먼저 하세요')
  })

  it('빈 목록이면 아무 말도 안 한다', () => {
    expect(boardNotes([])).toEqual([])
    expect(() => boardNotes()).not.toThrow()
  })
})

describe('먼저 할 것을 정할 때', () => {
  it('왜 먼저 하는지 안 적으면 막는다', () => {
    // 이유 없이 고른 순서는 다음 주에 자기도 왜 그랬는지 모른다.
    // 그리고 뒤로 밀린 부서가 물으면 답할 것이 없다.
    expect(validatePick({ why: '' }).why).toBeTruthy()
    expect(validatePick({ why: '급해서' }).why).toBeTruthy()
    expect(validatePick({ why: 'ㅇ'.repeat(MIN_WHY) }).why).toBeUndefined()
  })

  it('빈 입력에도 터지지 않는다', () => {
    expect(() => validatePick()).not.toThrow()
  })
})

describe('지금 무엇을 먼저 하기로 해 뒀나', () => {
  const items = [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }]

  it('정한 것을 보여준다', () => {
    const s = pickedState({ items, picks: [{ application_id: 'a', why: '금액이 틀립니다' }] })
    expect(s.picked).toHaveLength(1)
    expect(s.pickedIds.has('a')).toBe(true)
  })

  it('취소한 것은 안 보여준다', () => {
    const s = pickedState({
      items,
      picks: [
        { application_id: 'a', why: 'x' },
        { application_id: 'a', cancelled: true },
      ],
    })
    expect(s.picked).toHaveLength(0)
  })

  it('취소했다가 다시 정할 수 있다', () => {
    const s = pickedState({
      items,
      picks: [
        { application_id: 'a', why: 'x' },
        { application_id: 'a', cancelled: true },
        { application_id: 'a', why: '다시 정합니다' },
      ],
    })
    expect(s.picked).toHaveLength(1)
  })

  it('판에서 내려간 것은 안 보여준다', () => {
    // 반려되거나 끝난 것을 "먼저 할 것"에 계속 두면 목록이 안 줄어든다.
    const s = pickedState({ items, picks: [{ application_id: '없는것', why: 'x' }] })
    expect(s.picked).toHaveLength(0)
  })

  it('아무것도 안 정했으면 그렇게 말한다', () => {
    expect(pickedState({ items, picks: [] }).line).toContain('정하지 않으셨습니다')
  })

  it('빈 입력에도 터지지 않는다', () => {
    expect(() => pickedState()).not.toThrow()
  })
})
