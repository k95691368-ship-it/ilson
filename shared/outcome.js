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
// 합계만 있을 때 실행 기록을 되돌린다.
//
// computeOutcome 은 실행을 한 줄씩 받는다. 그런데 부서 화면과 정직 화면은
// 신청서를 여러 건 훑기 때문에 실행 줄을 다 가져오지 않고 합계만 갖고
// 온다. 그때 이 함수로 되돌린다.
//
// **값을 0으로 지어내면 안 된다.** 처음에 그렇게 했더니 "사람이 검토한
// 시간을 0으로 뒀습니다"라는 반박이 실제로는 쟀는데도 붙었다. 성과 화면은
// 다섯 건인데 정직 화면은 여섯 건이 되었다. 지어낸 값을 계산에 넣으면
// 그 계산은 지어낸 답을 낸다.
//
// 합계를 첫 줄에 몰아 준다. 총합이 맞고, 반박 규칙은 전부 총합만 본다.
//
// 이 함수를 여기 두는 이유는 쓰는 곳이 둘이기 때문이다. 각자 복사해 두면
// 한쪽만 고쳐지고, 그러면 두 화면이 같은 건을 두고 다른 말을 한다 —
// 이 저장소에서 실제로 네 번 일어난 일이다.
export function runsFromTotals({ count, durationMs, reviewSeconds, reworkSeconds } = {}) {
  const n = Math.max(0, Number(count) || 0)
  return Array.from({ length: n }, (_, i) => ({
    duration_ms: i === 0 ? Number(durationMs) || 0 : 0,
    human_review_seconds: i === 0 ? Number(reviewSeconds) || 0 : 0,
    rework_seconds: i === 0 ? Number(reworkSeconds) || 0 : 0,
  }))
}

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

  const devKrw = devHours * wage

  // 만든 공수는 **전부** 뺀다.
  //
  // 처음에는 24개월로 나눠서 한 달치만 뺐다. 틀렸다. 위의 아낀 금액은
  // 지금까지 돌린 것을 전부 더한 누적값인데, 거기서 한 달치 상각만 빼면
  // 단위가 안 맞는다. 석 달을 돌렸으면 석 달치 절감에서 한 달치 공수만
  // 빠지고, 일주일 돌렸으면 일주일치 절감에서 한 달치가 빠진다. 앞의
  // 경우는 성과가 부풀고 뒤의 경우는 깎인다.
  //
  // 게다가 이 함수는 그 결과에 '아직본전'이라는 이름을 붙이고 있었다.
  // 본전이라는 말은 만든 공수를 다 뽑았다는 뜻인데, 다 빼지도 않고
  // 그렇게 부르고 있었던 것이다.
  //
  // 달로 나눈 값은 참고로만 남긴다 — 계산에는 안 쓴다.
  const devPerMonth = devKrw / Math.max(1, amortizeMonths)

  const netKrw = savedKrw - devKrw - opsCostKrw

  // 아직 못 뽑았으면 얼마가 남았고 몇 번 더 돌리면 되는가.
  //
  // "아직 본전"이라고만 하면 담당자는 그게 곧 넘어설 것인지 영영 아닌지를
  // 알 수 없다. 지금 속도로 몇 번인지까지 말해야 판단이 된다.
  const perRunKrw = savedKrw / runCount
  const shortfall = Math.max(0, devKrw + opsCostKrw - savedKrw)
  const breakEven = {
    done: netKrw > 0,
    shortfallKrw: round(shortfall),
    perRunKrw: round(perRunKrw),
    // 한 번 돌려서 아끼는 것이 0 이하면 영영 못 뽑는다. 그때는 횟수를
    // 내놓지 않는다 — 큰 수를 적어 두면 언젠가 된다는 뜻으로 읽힌다.
    runsNeeded: perRunKrw > 0 && shortfall > 0 ? Math.ceil(shortfall / perRunKrw) : null,
    neverAtThisRate: perRunKrw <= 0,
  }

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
    // 계산에는 안 쓰는 참고값이다. "달로 나눠 보면 얼마"를 알고 싶어 하는
    // 사람이 있어서 남겨 두되, 이 값으로 순절감을 내지 않는다.
    devPerMonth: round(devPerMonth),
    amortizeMonths,
    opsCostKrw: round(opsCostKrw),

    netKrw: round(netKrw),
    breakEven,

    // 계산식을 그대로 돌려준다. 화면에 항상 펼쳐 두기 위해서다.
    formula: [
      { label: '사람이 하던 시간', value: manualSeconds, note: `${Math.round(baseline.median_seconds / 60)}분 × ${people}명 × ${runCount}회` },
      { label: '− 자동 실행 시간', value: -autoSeconds },
      { label: '− 사람이 검토한 시간', value: -reviewSeconds },
      { label: '− 다시 한 시간', value: -reworkSeconds },
      { label: '= 아낀 시간', value: savedSeconds, strong: true },
    ],
    moneyFormula: [
      {
        label: '아낀 시간을 돈으로',
        value: savedKrw,
        note: `시급 ${wage.toLocaleString()}원 · 지금까지 ${runCount}회를 다 더한 값`,
      },
      {
        label: `− 만든 공수 (${devHours}시간)`,
        value: -devKrw,
        // 왜 나눠서 안 빼는지 화면에 적어 둔다. 나눠 빼는 것이 더 흔한
        // 방식이라, 안 그런 이유를 안 적으면 틀린 줄 안다.
        note: '위가 누적이라 여기도 누적으로 뺍니다. 달로 나눠 빼면 단위가 안 맞습니다.',
      },
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
    code: 'slower_than_before',
    title: '자동화한 뒤가 더 오래 걸렸습니다',
    // 이걸 '아직 본전'으로만 부르면 곧 넘어설 것처럼 읽힌다. 실제로는
    // 돌릴수록 손해가 커지는 상태다. 반드시 따로 말해야 한다.
    applies: ({ outcome }) => (outcome.savedSeconds ?? 0) <= 0 && (outcome.runCount ?? 0) > 0,
    body: ({ outcome }) =>
      `사람이 하던 시간보다 자동 실행·검토·재작업을 더한 시간이 더 깁니다(${Math.abs(outcome.savedSeconds)}초 더 듦). 돌릴수록 손해입니다. 검토 시간이 왜 이렇게 드는지부터 보셔야 합니다.`,
  },
  {
    code: 'seasonality',
    title: '이번 기간이 평소와 달랐을 수 있습니다',
    applies: () => true, // 언제나 해당된다. 확인 없이는 아무도 모른다.
    body: () =>
      '이번 기간의 처리량이 평소와 비슷했는지 확인하지 않았습니다. 유난히 바쁜 달이었다면 절감이 커 보이고, 한가한 달이었다면 작아 보입니다.',
  },
  {
    code: 'dept_disagrees',
    title: '부서가 재 본 값과 다르다고 했습니다',
    // 물어봐 놓고 답이 계산에 아무 영향이 없으면, 묻는 것 자체가 연기다.
    // 부서가 다르다고 한 순간 이 금액은 확정이 아니게 된다.
    //
    // `Number.isFinite(Number(deptFelt))`만으로는 안 된다. **Number(null)은
    // NaN이 아니라 0이다.** 그래서 안 물어본 것이 "0분이라고 하셨다"로
    // 읽혀 반박이 늘 붙었다. 이 프로젝트에서 이 덫에 걸린 것이 세 번째다
    // (Number(undefined)는 NaN이라 ?? 로 안 걸러지는 것, 우선순위 판에서
    // 점수 없는 신청서가 0점으로 찍힌 것, 그리고 여기).
    applies: ({ deptFelt, outcome }) => {
      if (deptFelt == null || deptFelt === '') return false
      const felt = Number(deptFelt)
      const base = Number(outcome.baselineSeconds)
      if (!Number.isFinite(felt) || !Number.isFinite(base) || base <= 0) return false
      // 체감은 원래 조금씩 다르다. 20% 안쪽은 흔들림으로 본다.
      return Math.abs(felt * 60 - base) >= base * 0.2
    },
    body: ({ deptFelt, outcome }) => {
      const measured = Math.round(Number(outcome.baselineSeconds) / 60)
      const gap = Math.round(((Number(deptFelt) - measured) / measured) * 100)
      return `저희는 ${measured}분으로 재 두었는데, 실제로 하시는 분은 ${deptFelt}분쯤 걸린다고 하십니다(${
        gap > 0 ? `${gap}% 더` : `${Math.abs(gap)}% 덜`
      }). 이 금액은 저희가 잰 값 위에 서 있습니다. 다시 재기 전까지는 부서 말이 맞다고 보는 편이 안전합니다.`
    },
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
//
// 여기가 두 번째로 틀렸던 자리다. 위의 순절감은 만든 공수와 운영비를 빼는데,
// 이 연 환산값은 아무것도 안 뺐다. 그런데 화면에서는 두 숫자가 위아래로
// 나란히 놓인다. 읽는 사람은 같은 기준으로 잰 값인 줄 알고, 큰 쪽을 기억한다.
//
// 그래서 뺀 것과 안 뺀 것을 따로 준다. 하나로 합치지 않는 이유는, 첫 해와
// 그다음 해가 실제로 다르기 때문이다 — 만든 공수는 첫 해에 한 번만 든다.
export function annualize(outcome, frequency, { devKrw = 0, opsCostKrw = 0 } = {}) {
  if (outcome.status === '산정불가' || !frequency) return null
  const perYear = RUNS_PER_YEAR[frequency]
  if (!perYear) return null

  const perRunSaved = outcome.savedSeconds / outcome.runCount
  const seconds = perRunSaved * perYear
  const grossKrw = (seconds / 3600) * outcome.wage

  // 지금까지 쓴 운영비를 회당으로 나눠 연 횟수만큼 다시 곱한다. 운영비는
  // 돌릴 때마다 드는 것이라 해마다 든다.
  const opsPerYear = (opsCostKrw / outcome.runCount) * perYear
  const dev = devKrw || outcome.devKrw || 0

  return {
    perYear,
    seconds: round(seconds),
    hours: round(seconds / 3600, 1),
    // 아무것도 안 뺀 값. 이름에 그렇게 적어 둔다.
    grossKrw: round(grossKrw),
    // 첫 해 — 만든 공수가 여기 들어간다.
    firstYearKrw: round(grossKrw - dev - opsPerYear),
    // 그다음 해부터 — 만든 공수는 다시 안 든다.
    laterYearKrw: round(grossKrw - opsPerYear),
    note: `지금까지 ${outcome.runCount}번 돌린 평균으로 연 ${perYear}회를 곱한 값입니다. 실제로 그만큼 돌지 않으면 이 숫자는 틀립니다.`,
    caveat:
      dev > 0
        ? '첫 해에는 만든 공수가 들어갑니다. 그다음 해부터는 안 듭니다 — 그래서 두 해를 따로 적었습니다.'
        : null,
  }
}
