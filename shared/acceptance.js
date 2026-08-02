// 합격 기준 목록.
//
// 3단계에서 부서와 합의해 고르고, 5단계 베타 테스트에서 이 항목들로 채점한다.
// **만들기 전에 정한다**는 것이 핵심이다. 만든 뒤에 정하면 결과에 맞춰 기준이
// 움직이고, 그러면 통과는 아무 뜻이 없어진다.
//
// check_kind가 'rule'인 것은 기계가 자동으로 판정한다. 시험 파일을 만들 때
// 정답도 같이 만들어 두었기 때문에, 사람이 눈으로 맞춰 볼 필요가 없다.
// 'human'인 것은 사람이 직접 봐야 한다.

export const CRITERION_CATALOG = [
  {
    key: 'amount_exact',
    body: '정답 대비 채널별 순매출 합계 오차가 0원이어야 한다.',
    why: '대표 보고에 들어가는 숫자다. 마감을 넘기면 정정 공시까지 간다.',
    kind: 'rule',
    safetyDefault: true,
  },
  {
    key: 'quarantine_complete',
    body: '검토해야 할 줄(합계 줄·모르는 코드·다른 달)을 빠짐없이 골라내야 한다.',
    why: '모르는 줄을 조용히 버리면 합계가 조용히 틀린다.',
    kind: 'rule',
    safetyDefault: true,
  },
  {
    key: 'quarantine_precise',
    body: '멀쩡한 줄을 검토함으로 보내면 안 된다.',
    why: '검토할 것이 너무 많으면 담당자가 결국 전부 통과시켜 버린다.',
    kind: 'rule',
    safetyDefault: true,
  },
  {
    key: 'currency_converted',
    body: '외화 매출은 반드시 원화로 바뀐 뒤 합산되어야 한다.',
    why: '달러 금액이 그대로 더해지면 매출이 1300분의 1로 보인다.',
    kind: 'rule',
    safetyDefault: true,
  },
  {
    key: 'idempotent',
    body: '같은 파일을 두 번 올려도 합계가 변하지 않아야 한다.',
    why: '담당자는 "아까 올린 게 맞나?" 싶으면 반드시 다시 올린다.',
    kind: 'rule',
    safetyDefault: true,
  },
  {
    key: 'period_scoped',
    body: '다른 달 시트를 이번 정산 합계에 넣으면 안 된다.',
    why: '분기 파일 하나에 세 달치가 들어 있다. 다 더하면 매출이 세 배가 된다.',
    kind: 'rule',
    safetyDefault: false,
  },
  {
    key: 'returns_separated',
    body: '반품은 매출이 아니라 반품으로 세어야 한다.',
    why: '부호를 무시하고 더하면 매출이 부풀려지고, 반품률이 0으로 나온다.',
    kind: 'rule',
    safetyDefault: false,
  },
  {
    key: 'alias_learned',
    body: '한 번 알려 준 상품코드는 다음 실행에서 사람 손 없이 처리되어야 한다.',
    why: '같은 판단을 매주 다시 하게 만들면 안 하느니만 못하다.',
    kind: 'rule',
    safetyDefault: false,
  },
  {
    key: 'header_change_detected',
    body: '머리글이 이전과 다르면 자동으로 맞추지 말고 사람에게 물어야 한다.',
    why: '"양식은 안 바뀐다"는 대개 확인되지 않은 가정이다.',
    kind: 'rule',
    safetyDefault: false,
  },
  {
    key: 'traceable',
    body: '결과의 모든 줄이 원본 파일의 몇 번째 줄에서 왔는지 되짚어져야 한다.',
    why: '회의에서 "이 숫자 어디서 나왔냐"는 질문이 반드시 나온다.',
    kind: 'rule',
    safetyDefault: false,
  },
  {
    key: 'contribution_order',
    body: '기여이익이 순매출 → 수수료 → 원가 → 물류 → 광고 순으로 계산되어야 한다.',
    why: '순서를 바꾸면 금액이 달라진다. 매출이 아니라 남는 돈을 봐야 한다.',
    kind: 'rule',
    safetyDefault: false,
  },
  {
    key: 'deadline',
    body: '월요일 오전 회의 전에 결과가 나와야 한다.',
    why: '늦게 나오면 지난주 숫자로 회의를 한다.',
    kind: 'human',
    safetyDefault: false,
  },
  {
    key: 'usable_by_dept',
    body: '담당자가 사용법서만 보고 혼자 돌릴 수 있어야 한다.',
    why: '만든 사람이 없으면 못 쓰는 도구는 인수인계가 아니다.',
    kind: 'human',
    safetyDefault: false,
  },
]

export const CRITERION_BY_KEY = Object.fromEntries(CRITERION_CATALOG.map((c) => [c.key, c]))

export const CONFLICT_VERDICTS = ['A우선', 'B우선', '절충', '충돌아님']
export const REQUIREMENT_KINDS = ['요구', '제약', '미결', '가정']
export const REQUIREMENT_STATUSES = ['초안', '채택', '수정채택', '기각']
export const PRIORITIES = ['필수', '보통', '있으면좋음']

// 회의록에 그 말이 실제로 있었는지 대조한다.
//
// 띄어쓰기와 따옴표 모양만 다른 것까지 "없는 말"로 몰면 멀쩡한 인용이 전부
// 미확인으로 뜬다. 눈으로 같은 문장이면 같은 것으로 본다.
export function quoteFound(minutes, quote) {
  if (!quote || !minutes) return false
  const clean = (s) =>
    String(s)
      .replace(/[\s　]+/g, '')
      .replace(/["'""'']/g, '')
      .toLowerCase()
  return clean(minutes).includes(clean(quote))
}

// 이 과제가 다음 단계로 넘어갈 수 있는지.
//
// 서버가 판단한다. 화면에서만 막으면 요청을 직접 보내 우회할 수 있고,
// 무엇보다 "왜 다음으로 못 가는지"를 한 곳에서 설명할 수 있어야 한다.
export function agreementGate({ requirements, conflicts, criteria, baseline, pendingJoins = [] }) {
  const blockers = []

  // 손든 부서의 사정이 아직 협의안에 안 들어왔으면 만들기 시작하면 안 된다.
  //
  // 이걸 안 막으면 담당자는 낸 부서하고만 합의하고 넘어간다. 손든 부서는
  // 다 만들어진 뒤에 처음 기준을 보고, 그때 아니라고 해도 되돌리기엔 늦다.
  // 가장 먼저 막는다 — 뒤의 것들이 이 부서 요구 위에서 정해져야 한다.
  if (pendingJoins.length > 0) {
    const names = pendingJoins.map((p) => p.dept)
    const label = names.slice(0, 3).join('·') + (names.length > 3 ? ` 외 ${names.length - 3}곳` : '')
    blockers.push(
      `${label}의 사정이 아직 협의안에 없습니다. 그 부서 문장을 요구로 올리시거나, "이건 다른 건입니다"로 손들기를 푸셔야 합니다.`
    )
  }

  const drafts = requirements.filter((r) => r.status === '초안')
  if (drafts.length > 0) {
    blockers.push(`아직 판단하지 않은 요구 ${drafts.length}건이 있습니다.`)
  }

  const undecided = conflicts.filter((c) => !c.verdict)
  if (undecided.length > 0) {
    blockers.push(
      `판정하지 않은 충돌 ${undecided.length}건이 있습니다. 무엇을 통과로 볼지가 이 판정에 달려 있습니다.`
    )
  }

  const confirmed = criteria.filter((c) => c.confirmed_at)
  if (confirmed.length === 0) {
    blockers.push('합격 기준을 아직 확정하지 않았습니다.')
  }

  if (!baseline) {
    blockers.push('기준선을 아직 재지 않았습니다. 만들고 나서 재면 근거가 되지 못합니다.')
  }

  return { ready: blockers.length === 0, blockers }
}
