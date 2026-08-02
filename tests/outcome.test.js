import { describe, it, expect } from 'vitest'
import {
  computeOutcome,
  buildChallenges,
  labelForOutcome,
  annualize,
  CHALLENGE_RULES,
  RUNS_PER_YEAR,
  HOURLY_WAGE_KRW,
} from '../shared/outcome.js'

// 이 파일에 시험이 없었다. 그래서 단위가 안 맞는 뺄셈이 살아남았다.
//
// 이 프로젝트에서 가장 크게 틀릴 수 있는 자리가 여기다. 다른 화면이
// 틀리면 불편하지만, 여기가 틀리면 **없는 성과를 보고에 쓴다.**

const baseline = {
  median_seconds: 5400, // 90분
  sample_n: 6,
  people: 2,
  frequency: '주 1회',
  hourly_wage_krw: 20000,
}

// 한 번 돌 때 자동 60초 + 검토 300초 + 재작업 0
const run = (o = {}) => ({ duration_ms: 60000, human_review_seconds: 300, rework_seconds: 0, ...o })

describe('아낀 시간', () => {
  it('사람이 하던 시간은 중앙값 × 사람 수 × 횟수다', () => {
    const o = computeOutcome({ baseline, runs: [run(), run()] })
    expect(o.manualSeconds).toBe(5400 * 2 * 2)
  })

  it('자동 실행만 빼지 않는다 — 검토와 재작업도 뺀다', () => {
    // 자동화 뒤에도 사람이 검토함을 보고 있으면 그 시간은 절감이 아니다.
    const o = computeOutcome({ baseline, runs: [run({ rework_seconds: 120 })] })
    expect(o.autoSeconds).toBe(60)
    expect(o.reviewSeconds).toBe(300)
    expect(o.reworkSeconds).toBe(120)
    expect(o.afterSeconds).toBe(480)
    expect(o.savedSeconds).toBe(5400 * 2 - 480)
  })

  it('빠진 값은 0으로 본다', () => {
    const o = computeOutcome({ baseline, runs: [{ duration_ms: 1000 }] })
    expect(o.reviewSeconds).toBe(0)
    expect(o.afterSeconds).toBe(1)
  })
})

describe('만든 공수는 전부 뺀다', () => {
  // 처음에는 24개월로 나눠 한 달치만 뺐다. 위의 아낀 금액은 지금까지
  // 돌린 것을 다 더한 누적값인데 거기서 한 달치만 빼면 단위가 안 맞는다.
  const runs = [run(), run(), run(), run()]

  it('누적 절감에서 누적 공수를 뺀다', () => {
    const o = computeOutcome({ baseline, runs, devHours: 10 })
    expect(o.devKrw).toBe(10 * 20000)
    expect(o.netKrw).toBe(o.savedKrw - o.devKrw)
  })

  it('상각 개월수를 바꿔도 순절감은 안 바뀐다', () => {
    // 바뀌면 그건 상각으로 순절감을 내고 있다는 뜻이다.
    const a = computeOutcome({ baseline, runs, devHours: 10, amortizeMonths: 24 })
    const b = computeOutcome({ baseline, runs, devHours: 10, amortizeMonths: 6 })
    expect(a.netKrw).toBe(b.netKrw)
  })

  it('달로 나눈 값은 참고로만 남긴다', () => {
    const o = computeOutcome({ baseline, runs, devHours: 12, amortizeMonths: 24 })
    expect(o.devPerMonth).toBe(round1((12 * 20000) / 24))
  })

  it('운영비도 뺀다', () => {
    const o = computeOutcome({ baseline, runs, devHours: 1, opsCostKrw: 50000 })
    expect(o.netKrw).toBe(o.savedKrw - o.devKrw - 50000)
  })
})

describe('본전을 넘었나', () => {
  const runs = [run()]

  it('넘었으면 넘었다고 한다', () => {
    const o = computeOutcome({ baseline, runs, devHours: 0 })
    expect(o.status).toBe('인정')
    expect(o.breakEven.done).toBe(true)
  })

  it('못 넘었으면 얼마가 남았는지 말한다', () => {
    // "아직 본전"이라고만 하면 곧 넘어설 것인지 영영 아닌지 알 수 없다.
    const o = computeOutcome({ baseline, runs, devHours: 100 })
    expect(o.status).toBe('아직본전')
    expect(o.breakEven.shortfallKrw).toBeGreaterThan(0)
    expect(o.breakEven.runsNeeded).toBeGreaterThan(0)
  })

  it('몇 번 더 돌리면 되는지 지금 속도로 센다', () => {
    const o = computeOutcome({ baseline, runs, devHours: 10 })
    const need = Math.ceil(o.breakEven.shortfallKrw / o.breakEven.perRunKrw)
    expect(o.breakEven.runsNeeded).toBe(need)
  })

  it('돌릴수록 손해면 횟수를 안 내놓는다', () => {
    // 큰 수를 적어 두면 언젠가는 된다는 뜻으로 읽힌다.
    const slow = [run({ human_review_seconds: 99999 })]
    const o = computeOutcome({ baseline, runs: slow, devHours: 10 })
    expect(o.breakEven.neverAtThisRate).toBe(true)
    expect(o.breakEven.runsNeeded).toBeNull()
  })
})

describe('잴 수 없는 것은 잴 수 없다고 한다', () => {
  it('기준선이 없으면 산정불가다', () => {
    const o = computeOutcome({ baseline: null, runs: [run()] })
    expect(o.status).toBe('산정불가')
    expect(o.reason).toContain('기준선')
  })

  it('한 번도 안 돌았으면 산정불가다', () => {
    // 실제로 쓰이기 전에는 절감이 없다.
    expect(computeOutcome({ baseline, runs: [] }).status).toBe('산정불가')
  })

  it('시급이 없으면 기본값을 쓴다', () => {
    const o = computeOutcome({ baseline: { ...baseline, hourly_wage_krw: null }, runs: [run()] })
    expect(o.wage).toBe(HOURLY_WAGE_KRW)
  })
})

describe('연 단위로 환산할 때', () => {
  const runs = [run(), run(), run(), run()]

  it('아무것도 안 뺀 값과 뺀 값을 따로 준다', () => {
    // 순절감은 공수를 빼는데 연 환산만 안 빼면, 화면에 나란히 놓인 두
    // 숫자가 다른 기준으로 잰 값이 된다. 읽는 사람은 큰 쪽을 기억한다.
    const o = computeOutcome({ baseline, runs, devHours: 10 })
    const a = annualize(o, '주 1회', { devKrw: o.devKrw })
    expect(a.grossKrw).toBeGreaterThan(a.firstYearKrw)
    expect(a.laterYearKrw).toBe(a.grossKrw)
  })

  it('첫 해에서만 만든 공수를 뺀다', () => {
    // 만든 공수는 첫 해에 한 번만 든다.
    const o = computeOutcome({ baseline, runs, devHours: 10 })
    const a = annualize(o, '주 1회', { devKrw: o.devKrw })
    expect(a.firstYearKrw).toBe(a.grossKrw - o.devKrw)
  })

  it('운영비는 해마다 든다', () => {
    // 돌릴 때마다 드는 것이라 그다음 해에도 든다.
    const o = computeOutcome({ baseline, runs, opsCostKrw: 4000 })
    const a = annualize(o, '주 1회', { opsCostKrw: 4000 })
    const perYearOps = (4000 / 4) * RUNS_PER_YEAR['주 1회']
    expect(a.laterYearKrw).toBe(Math.round(a.grossKrw - perYearOps))
  })

  it('주기를 모르면 아무 숫자도 안 준다', () => {
    const o = computeOutcome({ baseline, runs })
    expect(annualize(o, null)).toBeNull()
    expect(annualize(o, '가끔')).toBeNull()
  })

  it('산정불가면 연 환산도 없다', () => {
    expect(annualize({ status: '산정불가' }, '주 1회')).toBeNull()
  })
})

describe('스스로 반박하기', () => {
  const ctx = (over = {}) => ({
    outcome: computeOutcome({ baseline, runs: [run(), run(), run(), run()], devHours: 20 }),
    quarantineLeft: 0,
    deptConfirmed: true,
    baselineAgeDays: 10,
    ...over,
  })

  it('반박마다 언제 뜨는지와 무슨 말을 할지가 있다', () => {
    for (const r of CHALLENGE_RULES) {
      expect(typeof r.applies).toBe('function')
      expect(r.title.length).toBeGreaterThan(5)
    }
  })

  it('계절성은 언제나 뜬다', () => {
    // 확인하지 않으면 아무도 모른다.
    expect(buildChallenges(ctx()).some((c) => c.code === 'seasonality')).toBe(true)
  })

  it('자동화 뒤가 더 오래 걸리면 따로 말한다', () => {
    // "아직 본전"으로만 부르면 곧 넘어설 것처럼 읽힌다. 실제로는 돌릴수록
    // 손해가 커지는 상태다.
    const slow = computeOutcome({ baseline, runs: [run({ human_review_seconds: 99999 })] })
    const c = buildChallenges({ ...ctx(), outcome: slow })
    expect(c.some((x) => x.code === 'slower_than_before')).toBe(true)
  })

  it('빨라졌으면 그 반박은 안 뜬다', () => {
    expect(buildChallenges(ctx()).some((c) => c.code === 'slower_than_before')).toBe(false)
  })

  it('검토 시간을 0으로 뒀으면 짚는다', () => {
    const zero = computeOutcome({ baseline, runs: [run({ human_review_seconds: 0 })] })
    expect(buildChallenges({ ...ctx(), outcome: zero }).some((c) => c.code === 'no_review_time')).toBe(true)
  })

  it('부서 확인이 없으면 짚는다', () => {
    expect(buildChallenges(ctx({ deptConfirmed: false })).some((c) => c.code === 'no_dept_confirm')).toBe(true)
  })

  it('반박이 남아 있으면 보수적 추정으로 낮춰 부른다', () => {
    // 숫자는 안 바꾼다. 부르는 이름만 바꾼다 — 몰래 깎는 것도 정직하지 않다.
    const l = labelForOutcome({ status: '인정' }, 3)
    expect(l.label).toBe('보수적 추정')
    expect(l.note).toContain('3개')
  })

  it('반박이 없으면 확인됨이다', () => {
    expect(labelForOutcome({ status: '인정' }, 0).label).toBe('확인됨')
  })
})

function round1(n) {
  return Math.round(n)
}

// 같은 표가 두 파일에 따로 박혀 있다. 지금은 값이 같지만, 한쪽만 고치면
// 접수함에 적힌 연간 시간과 성과 화면의 연 환산이 서로 다른 횟수로
// 계산된다. 그러면 두 숫자가 다른데 아무도 그 이유를 모른다.
describe('두 곳에 있는 같은 표', () => {
  it('연간 횟수 표가 어긋나지 않았다', async () => {
    const { PER_YEAR } = await import('../functions/_lib/applications.js')
    expect(PER_YEAR).toEqual(RUNS_PER_YEAR)
  })

  it('시급도 어긋나지 않았다', async () => {
    const master = await import('../shared/master.js')
    expect(master.HOURLY_WAGE_KRW).toBe(HOURLY_WAGE_KRW)
  })
})
