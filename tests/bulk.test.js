import { describe, it, expect } from 'vitest'
import {
  validateBulk,
  partition,
  resultText,
  BULK_ACTIONS,
  BULK_CODES,
  NEVER_BULK,
  MAX_AT_ONCE,
} from '../shared/bulk.js'

// 일괄 처리는 위험하다. 한 번에 여러 건을 판정하게 하면 사람은 안 읽고
// 누른다. 그러면 밀린 채로 두는 것보다 나쁘다 — 읽지도 않고 반려된
// 신청서가 생기고, 부서는 그걸 알아챈다.
//
// 그래서 여기서 지켜야 할 것은 "빠르게 처리되는가"가 아니라
// "읽지 않아도 되는 것만 되는가"다.

const app = (id, status = '접수') => ({ id, ticket_no: `AX-${id}`, status, title: '무엇' })

describe('한 번에 할 수 있는 일의 범위', () => {
  it('수용·반려는 한 번에 못 한다', () => {
    // 이게 뚫리면 이 기능은 있으나 마나가 아니라 해롭다.
    for (const forbidden of NEVER_BULK) {
      expect(BULK_ACTIONS.some((a) => a.label.includes(forbidden))).toBe(false)
      expect(BULK_CODES).not.toContain(forbidden)
    }
  })

  it('할 수 있는 일마다 왜 읽지 않아도 되는지가 적혀 있다', () => {
    // 이 이유를 못 대는 조작은 여기 넣으면 안 된다.
    for (const a of BULK_ACTIONS) {
      expect(a.why.length).toBeGreaterThan(15)
      expect(a.detail.length).toBeGreaterThan(10)
    }
  })

  it('봤다고 알리는 것은 상태를 바꾸지 않는다', () => {
    // '검토중'으로 바꾸면 판정 절차에 들어간 것인데, 실제로는 목록에서
    // 눈으로 훑기만 한 것이다.
    expect(BULK_ACTIONS.find((a) => a.code === 'ack').changesStatus).toBe(false)
  })
})

describe('고른 것 확인', () => {
  const good = { action: 'ack', ids: ['a', 'b'] }

  it('제대로 골랐으면 통과한다', () => {
    expect(validateBulk(good)).toEqual({})
  })

  it('아무것도 안 골랐으면 막는다', () => {
    expect(validateBulk({ action: 'ack', ids: [] }).ids).toBeTruthy()
    expect(validateBulk({ action: 'ack' }).ids).toBeTruthy()
  })

  it('너무 많이 고르면 막는다', () => {
    // 스무 건을 한 번에 처리하게 하면 그건 이미 안 읽고 누르는 것이다.
    const many = Array.from({ length: MAX_AT_ONCE + 3 }, (_, i) => `x${i}`)
    expect(validateBulk({ action: 'ack', ids: many }).ids).toContain(`${MAX_AT_ONCE}건까지`)
  })

  it('같은 것을 여러 번 골라도 한 번으로 센다', () => {
    const dup = Array.from({ length: MAX_AT_ONCE + 3 }, () => 'same')
    expect(validateBulk({ action: 'ack', ids: dup }).ids).toBeUndefined()
  })

  it('없는 조작은 막는다', () => {
    expect(validateBulk({ action: '반려', ids: ['a'] }).action).toBeTruthy()
    expect(validateBulk({ action: '', ids: ['a'] }).action).toBeTruthy()
  })

  it('이유가 필요한 조작은 이유 없이 못 한다', () => {
    expect(validateBulk({ action: 'hold', ids: ['a'] }).reason).toBeTruthy()
    expect(validateBulk({ action: 'hold', ids: ['a'], reason: '9월에 다시 봅니다' }).reason).toBeUndefined()
  })

  it('이유가 필요 없는 조작은 안 물어본다', () => {
    expect(validateBulk({ action: 'ack', ids: ['a'] }).reason).toBeUndefined()
  })
})

describe('처리할 수 있는 것과 없는 것 가르기', () => {
  const items = [app('a'), app('b', '반려'), app('c', '보류'), app('d', '완료')]

  it('이미 판정 끝난 것은 건너뛴다', () => {
    const r = partition(items, ['a', 'b', 'd'], 'ack')
    expect(r.ok.map((x) => x.id)).toEqual(['a'])
    expect(r.skipped.map((x) => x.id)).toEqual(['b', 'd'])
  })

  it('왜 건너뛰었는지 적어 준다', () => {
    // 여덟을 골랐는데 다섯만 처리되고 아무 말이 없으면 나머지 셋이
    // 어떻게 됐는지 모른다.
    const r = partition(items, ['b'], 'ack')
    expect(r.skipped[0].reason).toContain('반려')
  })

  it('이미 그 상태인 것도 건너뛴다', () => {
    const r = partition(items, ['c'], 'hold')
    expect(r.ok).toHaveLength(0)
    expect(r.skipped[0].reason).toContain('이미 보류')
  })

  it('보류인 것을 봤다고 알리는 것은 된다', () => {
    // 상태를 안 바꾸는 조작이라 막을 이유가 없다.
    expect(partition(items, ['c'], 'ack').ok.map((x) => x.id)).toEqual(['c'])
  })

  it('목록에 없는 것을 골랐으면 따로 알려 준다', () => {
    const r = partition(items, ['a', '없는것'], 'ack')
    expect(r.missing).toEqual(['없는것'])
  })

  it('빈 입력에도 터지지 않는다', () => {
    expect(partition([], ['a'], 'ack').ok).toEqual([])
    expect(partition(undefined, undefined, 'ack').ok).toEqual([])
  })
})

describe('처리하고 나서 뭐라고 말하는가', () => {
  it('몇 건 했는지 말한다', () => {
    expect(resultText({ action: 'ack', ok: 3, skipped: 0 })).toContain('3건')
  })

  it('건너뛴 것이 있으면 그것도 말한다', () => {
    const t = resultText({ action: 'ack', ok: 3, skipped: 2 })
    expect(t).toContain('3건')
    expect(t).toContain('2건은 이미')
  })

  it('건너뛴 것이 없으면 그 말은 안 한다', () => {
    expect(resultText({ action: 'ack', ok: 3, skipped: 0 })).not.toContain('건너뛰')
  })
})
