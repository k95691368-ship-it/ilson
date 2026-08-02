import { describe, it, expect } from 'vitest'
import {
  canAsk,
  validateSignoff,
  signoffState,
  passCaveat,
  VERDICTS,
  VERDICT_CODES,
  MIN_NAME,
} from '../shared/signoff.js'

// 협의안 화면은 합격 기준을 "부서와 합의해 정한 것"이라고 말한다. 그런데
// 확정하는 것은 담당자 혼자고 부서는 그 문장을 본 적이 없다.
//
// 그래서 5단계에서 "합격 기준을 통과했습니다"라고 말하면, 부서는
// "나는 그런 거 합의한 적 없다"고 답할 수 있다. 그 순간 합격 기준은
// 부서를 설득하는 도구가 아니라 부서를 막는 도구가 된다.

const crit = (id, confirmed = '2026-08-01 00:00:00') => ({
  id,
  body: `기준 ${id}`,
  confirmed_at: confirmed,
})

describe('언제 서명을 받을 수 있나', () => {
  it('기준이 없으면 못 받는다', () => {
    expect(canAsk([]).ok).toBe(false)
    expect(canAsk().ok).toBe(false)
  })

  it('담당자가 아직 확정 안 한 것이 있으면 못 받는다', () => {
    // 확정 안 된 기준에 서명받으면, 나중에 기준이 바뀌는데 서명은 남는다.
    // 그건 서명이 아니라 알리바이다.
    const r = canAsk([crit('a'), crit('b', null)])
    expect(r.ok).toBe(false)
    expect(r.why).toContain('1개')
  })

  it('전부 확정됐으면 받는다', () => {
    expect(canAsk([crit('a'), crit('b')]).ok).toBe(true)
  })
})

describe('부서가 적어 낸 것 확인', () => {
  const criteria = [crit('a'), crit('b')]
  const good = { by: '김대리', criteria, verdicts: { a: 'ok', b: 'ok' } }

  it('제대로 적었으면 통과한다', () => {
    expect(validateSignoff(good)).toEqual({})
  })

  it('이름이 없으면 막는다', () => {
    // 서명인데 누가 했는지 모르면 서명이 아니다.
    expect(validateSignoff({ ...good, by: '' }).by).toBeTruthy()
    expect(validateSignoff({ ...good, by: 'ㄱ'.repeat(MIN_NAME - 1) }).by).toBeTruthy()
  })

  it('한 항목이라도 안 고르면 막는다', () => {
    // 안 고른 것을 동의로 세면, 안 읽은 것을 읽었다고 기록하는 셈이다.
    const r = validateSignoff({ ...good, verdicts: { a: 'ok' } })
    expect(r.verdicts).toContain('1개')
  })

  it('없는 답을 보내도 안 고른 것으로 본다', () => {
    expect(validateSignoff({ ...good, verdicts: { a: 'ok', b: '아마도' } }).verdicts).toBeTruthy()
  })

  it('아니라고 했으면 이유를 받는다', () => {
    // 무엇이 다른지 모르면 고칠 수가 없다.
    const bad = { ...good, verdicts: { a: 'ok', b: 'no' } }
    expect(validateSignoff(bad).reasons).toBeTruthy()
    expect(validateSignoff({ ...bad, reasons: { b: '금액 오차 0원은 과합니다' } }).reasons).toBeUndefined()
  })

  it('맞다고 한 것에는 이유를 안 묻는다', () => {
    expect(VERDICTS.ok.needsReason).toBe(false)
    expect(validateSignoff(good).reasons).toBeUndefined()
  })

  it('빈 입력에도 터지지 않는다', () => {
    expect(() => validateSignoff()).not.toThrow()
  })
})

describe('지금 서명이 어떤 상태인가', () => {
  const criteria = [crit('a'), crit('b')]
  const signed = { by: '김대리', at: '2026-08-02 00:00:00' }

  it('아직 안 받았으면 그렇게 말한다', () => {
    const s = signoffState({ criteria })
    expect(s.status).toBe('아직')
    expect(s.canSign).toBe(true)
    expect(s.binding).toBe(false)
  })

  it('아직 준비가 안 됐으면 서명을 권하지 않는다', () => {
    const s = signoffState({ criteria: [crit('a', null)] })
    expect(s.status).toBe('준비중')
    expect(s.canSign).toBe(false)
  })

  it('전부 맞다고 하셨으면 확인됨이다', () => {
    const s = signoffState({ criteria, signoff: signed, objections: [] })
    expect(s.status).toBe('확인됨')
    expect(s.binding).toBe(true)
    expect(s.headline).toContain('김대리')
  })

  it('이의가 있으면 서명했어도 따로 센다', () => {
    // 서명했다/안 했다 둘로만 나누면, 이의를 달고 서명한 것이 그냥
    // 동의로 읽힌다.
    const s = signoffState({
      criteria,
      signoff: signed,
      objections: [{ id: 'o1', body: '금액 오차 0원은 과합니다', resolved_at: null }],
    })
    expect(s.status).toBe('이의 있음')
    expect(s.binding).toBe(false)
    expect(s.objections).toHaveLength(1)
  })

  it('풀린 이의는 안 센다', () => {
    const s = signoffState({
      criteria,
      signoff: signed,
      objections: [{ id: 'o1', resolved_at: '2026-08-02 01:00:00' }],
    })
    expect(s.status).toBe('확인됨')
    expect(s.binding).toBe(true)
  })

  it('빈 입력에도 터지지 않는다', () => {
    expect(() => signoffState()).not.toThrow()
  })
})

describe('통과라고 말할 때 덧붙이는 것', () => {
  it('서명이 있으면 덧붙이지 않는다', () => {
    expect(passCaveat({ binding: true })).toBeNull()
  })

  it('서명이 없으면 담당자 혼자 정한 기준이라고 적는다', () => {
    // 서명 없는 통과를 그냥 "통과"라고 적으면, 나중에 부서가 아니라고 할 때
    // 근거가 없다.
    expect(passCaveat({ binding: false, status: '아직' })).toContain('혼자')
  })

  it('이의가 남아 있으면 반쪽이라고 적는다', () => {
    const t = passCaveat({ binding: false, status: '이의 있음', objections: [{}, {}] })
    expect(t).toContain('2개')
    expect(t).toContain('반쪽')
  })

  it('빈 값에도 터지지 않는다', () => {
    expect(() => passCaveat()).not.toThrow()
  })
})

describe('답의 종류', () => {
  it('맞다와 아니다 둘뿐이다', () => {
    // "잘 모르겠다"를 넣으면 전부 거기로 몰린다.
    expect(VERDICT_CODES).toEqual(['ok', 'no'])
  })
})
