import { describe, it, expect } from 'vitest'
import {
  validateHoldLift,
  holdState,
  holdHeadline,
  holdWhy,
  liftKindOf,
  LIFT_KINDS,
  HOLD_LIFT_KIND,
  HOLD_LIFT_CANCEL_KIND,
} from '../shared/holdlift.js'

// 검토에서 보류를 하면 화면은 "보류 조건이 풀리면 알려주세요"라고 적는다.
// 그런데 알릴 자리가 아무 데도 없었다. 수령 확인·시험판 의견과 다른 점은,
// 저 둘은 담당자가 대신이라도 누를 수 있었는데 조건이 풀렸는지는 부서만
// 안다는 것이다.

const held = { status: '보류' }
const review = {
  verdict: '보류',
  hold_until_condition: 'SAP 이관이 끝나면 다시 봅니다',
  updated_at: '2026-07-01 00:00:00',
  decided_at: '2026-07-01 00:00:00',
}
const rec = (kind, at, over = {}) => ({ id: at, kind, by: '김대리', body: '이관 끝났습니다', at, ...over })
const NOW = Date.parse('2026-08-05T00:00:00Z')

describe('알려 주실 때 받는 것', () => {
  const good = { by: '김대리', kind: 'met', body: 'SAP 이관이 지난주에 끝났습니다' }

  it('성함을 받는다', () => {
    expect(validateHoldLift({ ...good, by: '' }).by).toBeTruthy()
    expect(validateHoldLift(good)).toEqual({})
  })

  it('무엇이 달라졌는지 한 줄이라도 받는다', () => {
    // "풀렸어요" 한 마디만 오면 담당자는 다시 판정할 근거가 없다.
    // 그러면 되물어야 하고, 되묻는 사이에 또 한 달이 간다.
    expect(validateHoldLift({ ...good, body: '' }).body).toBeTruthy()
    expect(validateHoldLift({ ...good, body: '풀림' }).body).toBeTruthy()
  })

  it('조건이 풀린 것인지 사정이 달라진 것인지 고르게 한다', () => {
    expect(validateHoldLift({ ...good, kind: '' }).kind).toBeTruthy()
    expect(validateHoldLift({ ...good, kind: 'aaa' }).kind).toBeTruthy()
    expect(validateHoldLift({ ...good, kind: 'changed' })).toEqual({})
  })

  it('조건이 그대로여도 말할 자리가 있다', () => {
    // "아직 그 시스템은 안 바뀌었는데 사람이 둘 나가서 더 급해졌습니다"를
    // 받을 자리가 없으면 부서는 아무 말도 못 하고 기다리기만 한다.
    expect(liftKindOf('changed')).toBeTruthy()
    expect(liftKindOf('changed').ready).toBe(false)
    expect(liftKindOf('met').ready).toBe(true)
  })

  it('빈 입력에도 터지지 않는다', () => {
    expect(() => validateHoldLift()).not.toThrow()
    expect(liftKindOf()).toBeNull()
  })
})

describe('지금 이 보류가 어떤 상태인가', () => {
  it('보류가 아니면 아무 말도 안 한다', () => {
    const s = holdState({ application: { status: '수용' }, review, records: [] })
    expect(s.canTell).toBe(false)
    expect(holdHeadline(s)).toBeNull()
  })

  it('보류면 알릴 수 있고 조건을 다시 보여준다', () => {
    // 몇 주 전에 읽은 문장을 기억해 내라고 하면 대개 기억 못 한다.
    const s = holdState({ application: held, review, records: [], now: NOW })
    expect(s.canTell).toBe(true)
    expect(s.condition).toBe('SAP 이관이 끝나면 다시 봅니다')
    expect(s.pending).toBe(false)
  })

  it('알리면 담당자 답을 기다리는 상태가 된다', () => {
    const s = holdState({
      application: held,
      review,
      records: [rec(HOLD_LIFT_KIND, '2026-08-01 00:00:00')],
      now: NOW,
    })
    expect(s.pending).toBe(true)
    expect(holdHeadline(s)).toContain('아직 못 봤습니다')
  })

  it('거두면 없던 일이 된다', () => {
    // 잘못 눌렀을 때 되돌릴 자리가 없으면 부서는 아예 안 누른다.
    const s = holdState({
      application: held,
      review,
      records: [
        rec(HOLD_LIFT_KIND, '2026-08-01 00:00:00'),
        rec(HOLD_LIFT_CANCEL_KIND, '2026-08-02 00:00:00'),
      ],
      now: NOW,
    })
    expect(s.pending).toBe(false)
    expect(s.open).toBeNull()
  })

  it('거둔 뒤 다시 알리면 다시 기다리는 상태다', () => {
    const s = holdState({
      application: held,
      review,
      records: [
        rec(HOLD_LIFT_KIND, '2026-08-01 00:00:00'),
        rec(HOLD_LIFT_CANCEL_KIND, '2026-08-02 00:00:00'),
        rec(HOLD_LIFT_KIND, '2026-08-03 00:00:00'),
      ],
      now: NOW,
    })
    expect(s.pending).toBe(true)
  })

  it('알린 뒤에 다시 판정했으면 답을 받은 것이다', () => {
    // 따로 "확인했습니다" 버튼을 만들지 않는다. 누르기만 하고 판정은 안 하는
    // 자리가 하나 더 생길 뿐이다. 판정이 곧 답이다.
    const s = holdState({
      application: held,
      review: { ...review, updated_at: '2026-08-04 00:00:00' },
      records: [rec(HOLD_LIFT_KIND, '2026-08-01 00:00:00')],
      now: NOW,
    })
    expect(s.answered).toBe(true)
    expect(s.pending).toBe(false)
    expect(holdHeadline(s)).toContain('다시 판정했습니다')
  })

  it('판정이 알림보다 앞서면 답이 아니다', () => {
    // 보류 판정 그 자체를 "답했다"로 세면, 알림은 영원히 안 읽힌 채로 끝난다.
    const s = holdState({
      application: held,
      review,
      records: [rec(HOLD_LIFT_KIND, '2026-08-01 00:00:00')],
      now: NOW,
    })
    expect(s.answered).toBe(false)
    expect(s.pending).toBe(true)
  })

  it('오래 묵으면 먼저 말을 건다', () => {
    // 한 달이 넘도록 아무 말이 없으면 그건 미뤄 둔 것이 아니라 잊힌 것이다.
    const s = holdState({ application: held, review, records: [], now: NOW })
    expect(s.heldDays).toBeGreaterThanOrEqual(30)
    expect(holdHeadline(s)).toContain('미뤄 둔 지')
  })

  it('빈 입력에도 터지지 않는다', () => {
    expect(() => holdState()).not.toThrow()
    expect(holdState().canTell).toBe(false)
  })
})

describe('왜 부서가 먼저 말해야 하는지', () => {
  it('아무도 안 움직이면 그대로라는 것을 말한다', () => {
    const t = holdWhy({ pending: false })
    expect(t).toContain('그쪽에서만 아십니다')
    expect(t).toContain('영원히 그대로')
  })

  it('알린 뒤에는 어디로 갔는지 말한다', () => {
    // 보냈는데 어디로 갔는지 모르면 다음부터 안 보낸다.
    expect(holdWhy({ pending: true })).toContain('할 일 목록')
  })
})

describe('고를 수 있는 것', () => {
  it('조건이 풀린 쪽이 먼저다', () => {
    // 화면에서 기본 선택으로 쓴다.
    expect(LIFT_KINDS[0].code).toBe('met')
  })

  it('종류마다 무엇을 적어야 하는지 알려준다', () => {
    for (const k of LIFT_KINDS) {
      expect(k.hint.length).toBeGreaterThan(10)
      expect(k.label.length).toBeGreaterThan(4)
    }
  })
})
