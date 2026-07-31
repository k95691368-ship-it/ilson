// 성과 계산과 자기 반박.
//
// 자동화 성과가 믿기지 않는 이유는 늘 같다. 만든 사람이 자기 입으로
// "90분이 3분이 됐습니다"라고 말하고, 그 90분이 어디서 나왔는지도, 자동화
// 뒤에 사람이 검토함을 보는 시간도 아무도 안 뺐기 때문이다.
//
// 그래서 여기서 두 가지를 한다.
//   1) 뺄 것을 전부 뺀다. 계산식이 화면에 항상 펼쳐져 있다.
//   2) 그 숫자를 스스로 반박한다. 반박은 규칙으로 고정되어 있다.
//
// 반박을 규칙으로 고정한 이유: 매번 다르게 반박하면 그건 반박이 아니라
// 장식이다. 여덟 가지를 못 박아 두고, 해당되면 반드시 뜨게 한다.

export const HOURLY_WAGE_KRW = 25000

// 얼마나 자주 하는 일인지 → 연 몇 회인지
export const RUNS_PER_YEAR = {
  '하루 여러 번': 750,
  매일: 250,
  '주 2~3회': 130,
  '주 1회': 52,
  격주: 26,
  매월: 12,
  분기: 4,
  비정기: 6,
}

function round(n, digits = 0) {
  const p = 10 ** digits
  return Math.round(n * p) / p
}

// 순절감 = 사람이 하던 시간 − (자동 실행 + 사람 검토 + 다시 하기) − 만든 공수 − 운영비
//
// 자동 실행 시간을 빼는 것은 당연하지만, 나머지 셋을 빼지 않는 곳이 대부분이다.
// 자동화 뒤에도 사람이 검토함을 보고 있으면 그 시간은 절감이 아니다.
export function computeOutcome({
  baseline, // 3단계에서 봉인한 값 { median_seconds, sample_n, people, frequency, hourly_wage_krw }
  runs = [], // 실제 실행 기록 [{ duration_ms, human_review_seconds, rework_seconds }]
  devHours = 0, // 만드는 데 든 시간
  opsCostKrw = 0, // 운영비 (있으면)
  amortizeMonths = 24, // 제작 공수를 몇 달에 나눠 볼 것인가
}) {
  if (!baseline) {
    return {
      status: '산정불가',
      reason: '기준선이 없습니다. 만들기 전에 재 두지 않았으면 절감을 말할 수 없습니다.',
    }
  }

  const wage = baseline.hourly_wage_krw || HOURLY_WAGE_KRW
  const people = baseline.people || 1
  const runCount = runs.length

  if (runCount === 0) {
    return {
      status: '산정불가',
      reason: '아직 한 번도 돌지 않았습니다. 실제로 쓰이기 전에는 절감이 없습니다.',
      baselineSeconds: baseline.median_seconds,
    }
  }

  // 사람이 하던 시간
  const manualSeconds = baseline.median_seconds * people * runCount

  // 자동화 뒤에 실제로 든 시간
  const autoSeconds = runs.reduce((a, r) => a + (r.duration_ms ?? 0) / 1000, 0)
  const reviewSeconds = runs.reduce((a, r) => a + (r.human_review_seconds ?? 0), 0)
  const reworkSeconds = runs.reduce((a, r) => a + (r.rework_seconds ?? 0), 0)
  const afterSeconds = autoSeconds + reviewSeconds + reworkSeconds

  const savedSeconds = manualSeconds - afterSeconds
  const savedKrw = (savedSeconds / 3600) * wage

  // 만든 공수를 한 번에 다 빼면 첫 달은 무조건 적자로 보인다.
  // 24개월에 나눠 보되, 나눴다는 사실을 화면에 적는다.
  const devKrw = devHours * wage
  const devAmortized = devKrw / amortizeMonths

  const netKrw = savedKrw - devAmortized - opsCostKrw

  return {
    status: netKrw > 0 ? '인정' : '아직본전',
    runCount,
    baselineSeconds: baseline.median_seconds,
    baselineSampleN: baseline.sample_n,
    people,
    wage,

    manualSeconds: round(manualSeconds),
    autoSeconds: round(autoSeconds, 1),
    reviewSeconds: round(reviewSeconds),
    reworkSeconds: round(reworkSeconds),
    afterSeconds: round(afterSeconds, 1),

    savedSeconds: round(savedSeconds),
    savedKrw: round(savedKrw),

    devHours,
    devKrw: round(devKrw),
    devAmortized: round(devAmortized),
    amortizeMonths,
    opsCostKrw: round(opsCostKrw),

    netKrw: round(netKrw),

    // 계산식을 그대로 돌려준다. 화면에 항상 펼쳐 두기 위해서다.
    formula: [
      { label: '사람이 하던 시간', value: manualSeconds, note: `${Math.round(baseline.median_seconds / 60)}분 × ${people}명 × ${runCount}회` },
      { label: '− 자동 실행 시간', value: -autoSeconds },
      { label: '− 사람이 검토한 시간', value: -reviewSeconds },
      { label: '− 다시 한 시간', value: -reworkSeconds },
      { label: '= 아낀 시간', value: savedSeconds, strong: true },
    ],
    moneyFormula: [
      { label: '아낀 시간을 돈으로', value: savedKrw, note: `시급 ${wage.toLocaleString()}원` },
      { label: `− 만든 공수 (${devHours}시간을 ${amortizeMonths}개월로 나눔)`, value: -devAmortized },
      { label: '− 운영비', value: -opsCostKrw },
      { label: '= 남는 것', value: netKrw, strong: true },
    ],
  }
}

// ─────────────────────────────────────────────────────────────
// 자기 반박 — 규칙으로 고정된 여덟 가지
// ─────────────────────────────────────────────────────────────
//
// 매번 다르게 반박하면 그건 반박이 아니라 장식이다. 여기 여덟 개를 못 박아
// 두고, 해당되면 반드시 뜬다. 해소하지 못한 반박이 하나라도 있으면 그 금액은
// '보수적 추정'으로 낮춰 부른다.

export const CHALLENGE_RULES = [
  {
    code: 'n_too_small',
    title: '기준선을 몇 번 안 쟀습니다',
    applies: ({ outcome }) => (outcome.baselineSampleN ?? 0) < 5,
    body: ({ outcome }) =>
      `기준선을 ${outcome.baselineSampleN}번만 재고 중앙값을 썼습니다. 세 번 재서 나온 값과 열 번 재서 나온 값은 다릅니다. 이 숫자에 신뢰구간을 붙이지 않는 이유이기도 합니다.`,
  },
  {
    code: 'few_runs',
    title: '실제로 몇 번 안 돌았습니다',
    applies: ({ outcome }) => (outcome.runCount ?? 0) < 4,
    body: ({ outcome }) =>
      `아직 ${outcome.runCount}번 돌았습니다. 이 정도로는 "매주 이만큼 아낀다"고 말하기 이릅니다. 몇 주 더 쌓인 뒤에 다시 계산하세요.`,
  },
  {
    code: 'no_review_time',
    title: '사람이 검토한 시간을 0으로 뒀습니다',
    applies: ({ outcome }) => outcome.reviewSeconds === 0 && outcome.runCount > 0,
    body: () =>
      '자동화 뒤에도 담당자가 검토함을 보고 처리합니다. 그 시간을 재서 넣지 않으면 절감이 부풀려집니다. 실제로 0분이었다면 그렇다고 적어 두세요.',
  },
  {
    code: 'unresolved_quarantine',
    title: '검토함에 남은 줄이 있습니다',
    applies: ({ quarantineLeft }) => (quarantineLeft ?? 0) > 0,
    body: ({ quarantineLeft }) =>
      `처리하지 못한 줄이 ${quarantineLeft}개 남아 있습니다. 그 줄들은 사람이 따로 처리해야 하는데, 그 시간이 위 계산에 들어 있지 않습니다.`,
  },
  {
    code: 'dev_cost_understated',
    title: '만든 공수가 너무 적게 잡혔습니다',
    applies: ({ outcome }) => (outcome.devHours ?? 0) < 8,
    body: ({ outcome }) =>
      `만드는 데 ${outcome.devHours}시간이 들었다고 적혀 있습니다. 회의, 시험, 고치는 시간까지 넣으면 대개 이보다 큽니다. 적게 잡으면 성과가 커 보입니다.`,
  },
  {
    code: 'seasonality',
    title: '이번 기간이 평소와 달랐을 수 있습니다',
    applies: () => true, // 언제나 해당된다. 확인 없이는 아무도 모른다.
    body: () =>
      '이번 기간의 처리량이 평소와 비슷했는지 확인하지 않았습니다. 유난히 바쁜 달이었다면 절감이 커 보이고, 한가한 달이었다면 작아 보입니다.',
  },
  {
    code: 'no_dept_confirm',
    title: '부서가 확인해 주지 않았습니다',
    applies: ({ deptConfirmed }) => !deptConfirmed,
    body: () =>
      '이 숫자를 실제로 쓰는 부서가 "맞다"고 확인해 주지 않았습니다. 만든 사람만 아는 성과는 성과가 아닙니다.',
  },
  {
    code: 'baseline_stale',
    title: '기준선을 잰 지 오래됐습니다',
    applies: ({ baselineAgeDays }) => (baselineAgeDays ?? 0) > 90,
    body: ({ baselineAgeDays }) =>
      `기준선을 잰 지 ${baselineAgeDays}일 지났습니다. 그사이 업무가 바뀌었다면 지금과 비교하는 것이 맞지 않습니다.`,
  },
]

// 해당되는 반박을 전부 만든다.
export function buildChallenges(context) {
  return CHALLENGE_RULES.filter((r) => r.applies(context)).map((r) => ({
    code: r.code,
    title: r.title,
    body: r.body(context),
  }))
}

// 해소하지 못한 반박이 있으면 금액을 '보수적 추정'으로 낮춰 부른다.
// 숫자를 바꾸지는 않는다 — 부르는 이름만 바꾼다. 숫자를 몰래 깎으면
// 그것도 정직하지 않다.
export function labelForOutcome(outcome, unresolvedCount) {
  if (outcome.status === '산정불가') return { label: '산정 불가', tone: 'muted' }
  if (unresolvedCount > 0) {
    return {
      label: '보수적 추정',
      tone: 'warn',
      note: `아직 해소하지 못한 의심이 ${unresolvedCount}개 있습니다. 이 금액을 확정으로 쓰지 마세요.`,
    }
  }
  if (outcome.status === '아직본전') {
    return { label: '아직 본전', tone: 'muted', note: '만든 공수를 아직 못 뽑았습니다.' }
  }
  return { label: '확인됨', tone: 'ok' }
}

// 연 단위로 환산하면 얼마인가. 지금 실행 횟수가 아니라 주기로 계산한다.
export function annualize(outcome, frequency) {
  if (outcome.status === '산정불가' || !frequency) return null
  const perYear = RUNS_PER_YEAR[frequency]
  if (!perYear) return null
  const perRunSaved = outcome.savedSeconds / outcome.runCount
  const seconds = perRunSaved * perYear
  return {
    perYear,
    seconds: round(seconds),
    hours: round(seconds / 3600, 1),
    krw: round((seconds / 3600) * outcome.wage),
    note: `지금까지 ${outcome.runCount}번 돌린 평균으로 연 ${perYear}회를 곱한 값입니다. 실제로 그만큼 돌지 않으면 이 숫자는 틀립니다.`,
  }
}
