import { describe, it, expect } from 'vitest'
import { pendingText, sortPending, pendingHeadline, pendingWhy, PENDING_TEXT } from '../shared/pending.js'
import { ASKS } from '../shared/response.js'

// 부서 화면은 통째로 담당자 시점이다. 맨 위 제목부터가 "내가 이 부서에 못
// 준 것"이다. 그런데 그 반대쪽이 아무 데도 없어서, 부서 사람이 "우리가
// 답해야 할 것"을 보려면 신청서를 하나씩 열어 봐야 했다.

const p = (code, ticket = 'AX-1', since = '2026-08-01 00:00:00') => ({
  code,
  ticket_no: ticket,
  title: '매주 정산서를 손으로 붙입니다',
  since,
})

describe('부서 눈높이의 말이 붙는다', () => {
  it('다섯 가지 부탁 전부에 말이 있다', () => {
    // 부탁을 하나 만들고 여기 안 넣으면 그 줄은 코드 이름이 그대로 화면에 뜬다.
    for (const a of ASKS) {
      expect(PENDING_TEXT[a.key]).toBeTruthy()
      expect(PENDING_TEXT[a.key].label.length).toBeGreaterThan(5)
      expect(PENDING_TEXT[a.key].text.length).toBeGreaterThan(20)
    }
  })

  it('담당자에게 하는 말과 부서에게 하는 말이 다르다', () => {
    // 같은 부탁이라도 세는 쪽과 답하는 쪽에게 할 말이 다르다.
    for (const a of ASKS) {
      expect(PENDING_TEXT[a.key].label).not.toBe(a.label)
    }
  })

  it('모르는 코드는 없다고 답한다', () => {
    expect(pendingText('없는것')).toBeNull()
    expect(pendingText()).toBeNull()
  })
})

describe('급한 차례', () => {
  it('넘겨받은 것을 못 쓰고 있는 것이 가장 급하다', () => {
    // 그건 부서가 지금 일을 못 하고 있다는 뜻이다.
    const sorted = sortPending([p('outcome'), p('beta'), p('accept'), p('signoff')])
    expect(sorted[0].code).toBe('accept')
  })

  it('기록을 정확하게 만드는 것은 뒤로 간다', () => {
    const sorted = sortPending([p('outcome'), p('accept'), p('hold')])
    expect(sorted.map((x) => x.code)).toEqual(['accept', 'hold', 'outcome'])
  })

  it('같은 종류면 오래 기다린 것부터', () => {
    const sorted = sortPending([
      p('accept', 'AX-2', '2026-08-03 00:00:00'),
      p('accept', 'AX-1', '2026-07-20 00:00:00'),
    ])
    expect(sorted[0].ticket_no).toBe('AX-1')
  })

  it('빈 입력에도 터지지 않는다', () => {
    expect(() => sortPending()).not.toThrow()
    expect(sortPending()).toEqual([])
  })
})

describe('부서에게 뭐라고 말하는가', () => {
  it('몇 가지인지 먼저 말한다', () => {
    expect(pendingHeadline('재무', [p('accept'), p('beta')])).toContain('재무에서 답해 주셔야 진행되는 것 2가지')
  })

  it('없으면 없다고 말하고 이 주소를 저장하라고 한다', () => {
    // 신청서를 하나씩 열어 보지 않아도 된다는 것이 이 화면의 값어치다.
    expect(pendingHeadline('재무', [])).toContain('답해 주실 것은 없습니다')
    expect(pendingWhy([])).toContain('이 주소를 저장')
  })

  it('재촉하지 않는다', () => {
    // 왜 막혀 있는지만 말한다. 그 사실 자체가 재촉보다 강하다.
    const t = pendingWhy([p('accept')])
    expect(t).toContain('더 못 나갑니다')
    expect(t).not.toMatch(/빨리|서둘러|급히|부탁드립니다만/)
  })
})
