import { describe, it, expect } from 'vitest'
import { agreementGate } from '../shared/acceptance.js'

// 만들기 시작해도 되는지를 정하는 문. 여기가 헐거우면 협의 없이 만든 것이
// 협의한 것처럼 기록에 남는다.

const ok = {
  requirements: [{ status: '채택' }],
  conflicts: [{ verdict: '가' }],
  criteria: [{ confirmed_at: 'x' }],
  baseline: { median_seconds: 100 },
}

describe('만들기 시작해도 되는가', () => {
  it('다 됐으면 연다', () => {
    expect(agreementGate(ok).ready).toBe(true)
  })

  it('판단 안 한 요구가 있으면 막는다', () => {
    const g = agreementGate({ ...ok, requirements: [{ status: '초안' }] })
    expect(g.ready).toBe(false)
    expect(g.blockers.join()).toContain('판단하지 않은 요구')
  })

  it('판정 안 한 충돌이 있으면 막는다', () => {
    expect(agreementGate({ ...ok, conflicts: [{ verdict: null }] }).ready).toBe(false)
  })

  it('합격 기준을 안 확정했으면 막는다', () => {
    expect(agreementGate({ ...ok, criteria: [{ confirmed_at: null }] }).ready).toBe(false)
  })

  it('기준선을 안 쟀으면 막는다', () => {
    // 만들고 나서 재면 근거가 되지 못한다.
    expect(agreementGate({ ...ok, baseline: null }).ready).toBe(false)
  })
})

// 손든 부서 사정이 협의안에 안 들어왔는데 만들기 시작하면, 그 부서는
// 다 만들어진 뒤에 처음 기준을 본다. 그때 아니라고 해도 되돌리기엔 늦다.
describe('손든 부서 사정이 안 들어왔으면', () => {
  it('만들기 시작 못 하게 막는다', () => {
    const g = agreementGate({ ...ok, pendingJoins: [{ dept: '마케팅' }] })
    expect(g.ready).toBe(false)
    expect(g.blockers[0]).toContain('마케팅')
  })

  it('무엇을 하면 되는지 두 길을 다 말한다', () => {
    // 요구로 올리거나, 이건 다른 건이라고 손들기를 풀거나.
    const g = agreementGate({ ...ok, pendingJoins: [{ dept: '마케팅' }] })
    expect(g.blockers[0]).toContain('요구로 올리')
    expect(g.blockers[0]).toContain('손들기를 푸')
  })

  it('가장 먼저 막는다', () => {
    // 뒤의 것들이 이 부서 요구 위에서 정해져야 한다.
    const g = agreementGate({
      requirements: [{ status: '초안' }],
      conflicts: [],
      criteria: [],
      baseline: null,
      pendingJoins: [{ dept: '마케팅' }],
    })
    expect(g.blockers[0]).toContain('마케팅')
  })

  it('많으면 줄여서 적는다', () => {
    // 부서 이름 열 개를 늘어놓으면 그 줄을 아무도 안 읽는다.
    const many = ['재무', '마케팅', '영업', '운영', 'SCM'].map((dept) => ({ dept }))
    const g = agreementGate({ ...ok, pendingJoins: many })
    expect(g.blockers[0]).toContain('외 2곳')
  })

  it('안 넘기면 예전대로 돈다', () => {
    // 이 값을 안 주는 옛 호출자가 깨지면 안 된다.
    expect(agreementGate(ok).ready).toBe(true)
  })
})

// 확정된 기준이 하나만 있어도 통과시켰다. 그러면 화면이 "합격 기준을
// 확정했고"라고 단정하는데 바로 아래에 '미확정' 기준이 그대로 떠 있다.
//
// 더 나쁜 것은 부서 서명이 전부 확정돼야 받을 수 있다는 것이다
// (shared/signoff.js의 canAsk). 만들기는 시작할 수 있는데 부서 확인은
// 영영 못 받는 상태가 된다 — 두 문이 서로 다른 말을 했다.
describe('확정 안 된 합격 기준이 남아 있으면', () => {
  const base = {
    requirements: [{ status: '채택' }],
    conflicts: [],
    baseline: { median_seconds: 100 },
  }

  it('만들기 시작 못 하게 막는다', () => {
    const g = agreementGate({
      ...base,
      criteria: [{ confirmed_at: 'x' }, { confirmed_at: null }],
    })
    expect(g.ready).toBe(false)
    expect(g.blockers.join()).toContain('1개가 아직 미확정')
  })

  it('전부 확정했으면 연다', () => {
    expect(agreementGate({ ...base, criteria: [{ confirmed_at: 'x' }, { confirmed_at: 'y' }] }).ready).toBe(true)
  })

  it('하나도 없으면 예전 문구 그대로 막는다', () => {
    const g = agreementGate({ ...base, criteria: [] })
    expect(g.blockers.join()).toContain('아직 확정하지 않았습니다')
  })

  it('부서 서명 조건과 같은 기준으로 막는다', async () => {
    // canAsk는 전부 확정돼야 서명을 받는다. 게이트도 같아야 한다.
    const { canAsk } = await import('../shared/signoff.js')
    const criteria = [{ confirmed_at: 'x' }, { confirmed_at: null }]
    expect(canAsk(criteria).ok).toBe(false)
    expect(agreementGate({ ...base, criteria }).ready).toBe(false)
  })
})
