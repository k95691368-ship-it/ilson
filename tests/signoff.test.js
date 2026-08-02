import { describe, it, expect } from 'vitest'
import {
  canAsk,
  validateSignoff,
  signoffState,
  passCaveat,
  VERDICTS,
  VERDICT_CODES,
  MIN_NAME,
  RESOLUTION_CODES,
  validateResolve,
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
      objections: [{ id: 'o1', body: '금액 오차 0원은 과합니다' }],
    })
    expect(s.status).toBe('이의 있음')
    expect(s.binding).toBe(false)
    expect(s.objections).toHaveLength(1)
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

// 이의를 푸는 자리가 없으면, 이의가 달린 순간 그 신청서는 영영 "이의 있음"
// 으로 남는다. 그러면 담당자는 다음부터 서명을 아예 안 받는다 — 받아 봐야
// 되돌릴 수 없는 표시만 붙기 때문이다.
describe('담당자가 이의를 푼다', () => {
  const criteria = [crit('a'), crit('b')]
  const signed = { by: '김대리', at: '2026-08-02 00:00:00' }
  const objection = { id: 'o1', criterion_id: 'a', body: '오차 0원은 과합니다' }
  const state = (code) =>
    signoffState({
      criteria,
      signoff: signed,
      objections: [objection],
      resolutions: [{ objection_id: 'o1', code, body: '무엇을 했다' }],
    })

  it('세 가지 길이 있다', () => {
    expect(RESOLUTION_CODES).toEqual(['changed', 'explained', 'kept'])
  })

  it('기준을 고쳤으면 다시 확인을 받아야 한다', () => {
    // 바뀐 기준에 옛 서명을 붙여 두면 서명이 거짓이 된다.
    const s = state('changed')
    expect(s.status).toBe('다시 받아야 함')
    expect(s.canSign).toBe(true)
    expect(s.binding).toBe(false)
  })

  it('설명드린 것도 다시 확인을 받아야 한다', () => {
    // 담당자 혼자 "설명했으니 됐다"고 하면 그건 해소가 아니다.
    expect(state('explained').canSign).toBe(true)
  })

  it('그대로 가기로 했으면 그렇게 적고 판정 근거로는 안 쓴다', () => {
    const s = state('kept')
    expect(s.status).toBe('이의 알고 진행')
    expect(s.binding).toBe(false)
    expect(s.kept).toHaveLength(1)
  })

  it('그대로 가기는 이의를 지우는 버튼이 아니다', () => {
    // 한 번 넘겼다고 없던 일이 되면, 그대로 가기가 이의 삭제 버튼이 된다.
    const t = passCaveat(state('kept'))
    expect(t).toContain('알고도')
  })

  it('푼 것과 안 푼 것이 섞여 있으면 안 푼 것을 먼저 본다', () => {
    const s = signoffState({
      criteria,
      signoff: signed,
      objections: [objection, { id: 'o2', criterion_id: 'b', body: '이것도' }],
      resolutions: [{ objection_id: 'o1', code: 'kept', body: 'x' }],
    })
    expect(s.status).toBe('이의 있음')
  })

  it('바뀐 것이 있으면 그것이 가장 먼저다', () => {
    // 안 푼 이의보다 "기준이 바뀌었다"가 급하다. 바뀐 기준에 옛 서명이
    // 붙어 있는 상태이기 때문이다.
    const s = signoffState({
      criteria,
      signoff: signed,
      objections: [objection, { id: 'o2', criterion_id: 'b' }],
      resolutions: [{ objection_id: 'o1', code: 'changed', body: 'x' }],
    })
    expect(s.status).toBe('다시 받아야 함')
  })
})

describe('이의 푼 것 확인', () => {
  const good = { code: 'kept', reason: '정산 마감 규정상 오차를 둘 수 없습니다', by: 'AX 담당자' }

  it('제대로 적었으면 통과한다', () => {
    expect(validateResolve(good)).toEqual({})
  })

  it('없는 방법은 막는다', () => {
    expect(validateResolve({ ...good, code: '무시' }).code).toBeTruthy()
  })

  it('무엇을 했는지 안 적으면 막는다', () => {
    // 이 문장이 그대로 부서에 간다.
    expect(validateResolve({ ...good, reason: '' }).reason).toBeTruthy()
  })

  it('누가 풀었는지 안 적으면 막는다', () => {
    expect(validateResolve({ ...good, by: '' }).by).toBeTruthy()
  })

  it('빈 입력에도 터지지 않는다', () => {
    expect(() => validateResolve()).not.toThrow()
  })
})

// 앞 회차에 만든 구멍. 다른 부서가 "우리도 같은 일을 겪는다"고 손들 수
// 있게 해 놓고, 합격 기준 서명은 여전히 한 명한테만 받고 있었다.
//
// 그러면 마케팅과 영업이 걸린 일인데 재무 한 사람이 확인했다고 "확인됨"이
// 되고, 5단계에서 "합격 기준을 통과했습니다"가 나간다. 나머지 두 부서는
// 그 기준을 본 적도 없다.
describe('여러 부서가 걸린 일', () => {
  const criteria = [crit('a'), crit('b')]
  const sig = (dept, by = '김대리') => ({ by, dept, at: '2026-08-02 00:00:00' })

  it('한 부서만 확인했으면 확인됨이 아니다', () => {
    const s = signoffState({
      criteria,
      requiredDepts: ['재무', '마케팅', '영업'],
      signatures: [sig('재무')],
      signoff: sig('재무'),
    })
    expect(s.status).toBe('일부만 확인')
    expect(s.binding).toBe(false)
    expect(s.waitingDepts).toEqual(['마케팅', '영업'])
  })

  it('아직 안 한 부서가 또 확인할 수 있어야 한다', () => {
    const s = signoffState({
      criteria,
      requiredDepts: ['재무', '마케팅'],
      signatures: [sig('재무')],
      signoff: sig('재무'),
    })
    expect(s.canSign).toBe(true)
  })

  it('다 확인하면 확인됨이다', () => {
    const s = signoffState({
      criteria,
      requiredDepts: ['재무', '마케팅'],
      signatures: [sig('재무'), sig('마케팅', '이과장')],
      signoff: sig('마케팅', '이과장'),
    })
    expect(s.status).toBe('확인됨')
    expect(s.binding).toBe(true)
    expect(s.waitingDepts).toEqual([])
  })

  it('안 본 부서를 이의 없음으로 세지 않는다', () => {
    // 이의가 없는 것과 안 본 것은 다르다. 안 본 부서를 이의 없음으로 세면
    // 그 부서는 다 만들어진 뒤에 처음 기준을 보게 되고 그때는 늦다.
    const s = signoffState({
      criteria,
      requiredDepts: ['재무', '마케팅'],
      signatures: [sig('재무')],
      signoff: sig('재무'),
      objections: [],
    })
    expect(s.binding).toBe(false)
  })

  it('통과할 때 어느 부서가 안 봤는지 적는다', () => {
    const t = passCaveat({
      binding: false,
      status: '일부만 확인',
      signedDepts: ['재무'],
      waitingDepts: ['마케팅', '영업'],
    })
    expect(t).toContain('마케팅·영업')
    expect(t).toContain('재무')
  })

  it('이의가 있으면 그것이 먼저다', () => {
    // 안 본 부서보다 반대한 부서가 급하다.
    const s = signoffState({
      criteria,
      requiredDepts: ['재무', '마케팅'],
      signatures: [sig('재무')],
      signoff: sig('재무'),
      objections: [{ id: 'o1', body: '이건 아닙니다' }],
    })
    expect(s.status).toBe('이의 있음')
  })

  it('한 부서짜리 일은 예전과 똑같이 돈다', () => {
    const s = signoffState({
      criteria,
      requiredDepts: ['재무'],
      signatures: [sig('재무')],
      signoff: sig('재무'),
    })
    expect(s.status).toBe('확인됨')
    expect(s.binding).toBe(true)
  })

  it('부서 목록을 안 주면 예전대로 본다', () => {
    // 옛 기록에는 부서가 안 붙어 있다. 그때까지 확인됨을 못 만들면
    // 이미 끝난 신청서가 전부 되돌아간다.
    const s = signoffState({ criteria, signoff: { by: '김대리', at: 'x' } })
    expect(s.status).toBe('확인됨')
    expect(s.binding).toBe(true)
  })
})

// 라이브에서 잡은 사고. 부서가 여럿이 되자마자 터졌다.
//
// 재무가 이의를 달아 둔 신청서에 마케팅이 서명하니, 마케팅 서명이 가장
// 마지막이 되면서 재무의 이의가 통째로 사라지고 상태가 '확인됨'이 됐다.
// 부서가 반대한 기준으로 통과 판정이 나갈 뻔했다.
describe('다른 부서가 서명해도 이의는 안 사라진다', () => {
  const criteria = [crit('a'), crit('b')]

  it('한 부서의 이의는 그 부서가 다시 봐야 지워진다', () => {
    const s = signoffState({
      criteria,
      requiredDepts: ['재무', '마케팅'],
      signatures: [
        { by: '김대리', dept: '재무', at: '2026-08-02 01:00:00' },
        { by: '이과장', dept: '마케팅', at: '2026-08-02 02:00:00' },
      ],
      signoff: { by: '이과장', dept: '마케팅', at: '2026-08-02 02:00:00' },
      // 재무가 단 이의는 마케팅이 서명해도 살아 있어야 한다.
      objections: [{ id: 'o1', dept: '재무', criterion_id: 'a', body: '오차 0원은 과합니다' }],
    })
    expect(s.status).toBe('이의 있음')
    expect(s.binding).toBe(false)
  })

  it('이의가 풀린 상태도 다른 부서 서명에 안 지워진다', () => {
    const s = signoffState({
      criteria,
      requiredDepts: ['재무', '마케팅'],
      signatures: [
        { by: '김대리', dept: '재무', at: '2026-08-02 01:00:00' },
        { by: '이과장', dept: '마케팅', at: '2026-08-02 02:00:00' },
      ],
      signoff: { by: '이과장', dept: '마케팅', at: '2026-08-02 02:00:00' },
      objections: [{ id: 'o1', dept: '재무', criterion_id: 'a', body: '과합니다' }],
      resolutions: [{ objection_id: 'o1', code: 'kept', body: '규정상 못 둡니다' }],
    })
    // 담당자가 알고도 그대로 가기로 한 사실은 계속 붙어 있어야 한다.
    expect(s.status).toBe('이의 알고 진행')
    expect(s.binding).toBe(false)
  })
})
