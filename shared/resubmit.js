// 반려당한 신청서를 부서가 고쳐서 다시 내기.
//
// 지금은 반려가 막다른 길이다. 부서는 조회 화면에서 "그건 원래 안 됩니다"와
// 대안 한 줄을 읽고 끝난다. 그 대안대로 다시 내려면 신청서를 처음부터 새로
// 써야 하고, 그러면 앞 신청서와 이어지지 않아 담당자는 같은 이야기를 처음
// 듣는 것처럼 받는다.
//
// 그런데 **다시 내기를 그냥 열어 두면 반려가 뜻이 없어진다.** 같은 것을
// 그대로 다시 내는 일이 생기고, 담당자는 같은 판정을 두 번 한다. 세 번째가
// 오면 그때부터는 아무도 반려 사유를 안 읽는다.
//
// 그래서 두 가지를 건다.
//   ① 반려 사유마다 다시 내서 될 일인지를 미리 말한다. 안 될 것은 안 된다고
//      한다 — 헛수고를 시키지 않는 것이 이 화면의 핵심이다.
//   ② 다시 낼 때 무엇을 바꿨는지 반드시 적게 한다.

// 반려 사유별로 다시 내면 어떻게 되는가.
//
//   reshape — 범위를 대안에 맞춰 줄이면 받는다. 대부분이 여기다.
//   later   — 지금은 안 되지만 조건이 갖춰지면 된다.
//   never   — 다시 내도 같은 답이다. 여기서 할 일이 아니다.
//   ask     — 규칙으로 정할 수 없다. 담당자에게 먼저 물어야 한다.
export const RETRY_KINDS = {
  reshape: {
    canRetry: true,
    headline: '범위를 줄여서 다시 내시면 받습니다',
    cta: '고쳐서 다시 내기',
  },
  later: {
    canRetry: true,
    headline: '조건이 갖춰지면 다시 내실 수 있습니다',
    cta: '조건이 갖춰졌습니다 — 다시 내기',
  },
  never: {
    canRetry: false,
    headline: '다시 내셔도 같은 답이 나옵니다',
    cta: null,
  },
  ask: {
    canRetry: false,
    headline: '다시 내시기 전에 담당자에게 물어보세요',
    cta: null,
  },
}

// 사유마다 무엇을 어떻게 바꾸면 되는지.
//
// 여기 적힌 말은 반려 사유의 '대안'을 부서가 할 일로 옮겨 놓은 것이다.
// 대안을 읽는 것과 그 대안대로 신청서를 고치는 것은 다른 일이고, 그
// 사이를 메우지 않으면 대안은 읽히기만 하고 아무 일도 안 일어난다.
export const RETRY_ADVICE = {
  external_write: {
    kind: 'reshape',
    change:
      '"등록까지 해 달라"를 "등록할 파일까지 만들어 달라"로 바꿔 주세요. 올리는 버튼은 담당자분이 누르시는 것으로 하면 받습니다.',
  },
  auth_crawl: {
    kind: 'reshape',
    change:
      '"긁어 와 달라"를 "내가 내려받아 올리면 그다음을 해 달라"로 바꿔 주세요. 파일을 어디서 어떻게 내려받는지도 같이 적어 주시면 좋습니다.',
  },
  realtime: {
    kind: 'reshape',
    change:
      '"바뀌는 즉시"를 "하루 몇 번" 또는 "매주 언제"로 바꿔 주세요. 얼마나 늦어도 괜찮은지를 적어 주시면 그 주기로 맞춥니다.',
  },
  human_judgment: {
    kind: 'reshape',
    change:
      '"판단해 달라"를 "판단에 필요한 자료를 한 장으로 모아 달라"로 바꿔 주세요. 무엇을 보고 결정하시는지를 적어 주시면 그것만 모읍니다.',
  },
  media_gen: {
    kind: 'never',
    change:
      '이미지나 영상은 여기서 만들지 않습니다. 다만 거기 들어갈 정보를 표로 정리하는 일이라면 그것만 따로 내 주세요 — 그건 받습니다.',
  },
  no_input: {
    kind: 'later',
    change:
      '자동화할 자료가 아직 없어서 반려된 것입니다. 그 자료가 실제로 쌓이기 시작하면, 파일 한두 건을 붙여서 다시 내 주세요.',
  },
  other: {
    kind: 'ask',
    change:
      '정해진 목록에 없는 사유라 규칙으로 말씀드릴 수 없습니다. 조회 화면에서 담당자에게 먼저 물어보시고, 답을 받은 뒤에 다시 내 주세요.',
  },
}

// 몇 번까지 다시 낼 수 있나.
//
// 두 번이면 충분하다. 세 번째까지 왔다는 것은 글로 오가서는 안 풀린다는
// 뜻이라, 다시 내는 것보다 담당자와 한 번 이야기하는 편이 빠르다.
export const MAX_RESUBMIT = 2

// 다시 낸 것을 앞 신청서와 잇는 표시. decision_log의 link_kind로 쓴다.
export const RESUBMIT_KIND = '재신청'

// 이 반려 건을 부서가 어떻게 할 수 있는가.
export function retryPlan({ refuseCode, refuseAlternative, timesResubmitted } = {}) {
  const advice = RETRY_ADVICE[refuseCode] ?? RETRY_ADVICE.other
  const kind = RETRY_KINDS[advice.kind]
  const used = Math.max(0, Number(timesResubmitted) || 0)

  // 횟수를 다 쓴 것은 사유와 상관없이 막는다. 두 번을 고쳐 냈는데도
  // 반려됐으면 글로는 안 풀리는 것이다.
  if (kind.canRetry && used >= MAX_RESUBMIT) {
    return {
      kind: 'ask',
      canRetry: false,
      headline: `이미 ${used}번 고쳐서 내셨습니다`,
      change:
        '여기까지 왔다는 것은 글로 주고받아서는 안 풀린다는 뜻입니다. 조회 화면에서 담당자에게 물어보시거나, 한 번 자리를 잡아 이야기하시는 편이 빠릅니다.',
      cta: null,
      used,
      left: 0,
    }
  }

  return {
    kind: advice.kind,
    canRetry: kind.canRetry,
    headline: kind.headline,
    change: advice.change,
    // 담당자가 직접 적은 대안이 있으면 그것을 앞세운다. 규칙이 만든
    // 일반론보다 이 건을 보고 쓴 한 줄이 언제나 낫다.
    fromReviewer: String(refuseAlternative ?? '').trim() || null,
    cta: kind.cta,
    used,
    left: kind.canRetry ? MAX_RESUBMIT - used : 0,
  }
}

// 다시 낼 때 적어야 하는 것.
//
// 바꾼 것을 안 적으면 같은 신청서가 그대로 다시 온다. 담당자는 앞 판정을
// 찾아 대조해야 무엇이 달라졌는지 알 수 있고, 그 일을 시키는 순간
// 다시 내기는 담당자에게 짐이 된다.
export const MIN_CHANGED = 10

export function validateResubmit({ changed, title, bottleneck, problem } = {}) {
  const errors = {}
  const t = (v) => String(v ?? '').trim()

  if (t(changed).length < MIN_CHANGED) {
    errors.changed = '앞 신청서에서 무엇을 바꾸셨는지 적어주세요. 담당자가 그것부터 봅니다.'
  }
  if (!t(title)) errors.title = '제목을 적어주세요.'
  if (!t(bottleneck)) errors.bottleneck = '무엇이 병목인지 적어주세요.'
  if (!t(problem)) errors.problem = '그래서 지금 무슨 일이 벌어지는지 적어주세요.'

  return errors
}

// 앞 신청서에서 그대로 가져올 것.
//
// 부서·신청자·연락처는 다시 묻지 않는다. 같은 사람이 같은 일로 다시 내는
// 것이라 물어볼 이유가 없고, 물으면 그것만으로 그만두는 사람이 생긴다.
export function carryOver(previous) {
  const p = previous ?? {}
  return {
    dept: p.dept ?? '',
    applicant_label: p.applicant_label ?? '',
    contact: p.contact ?? null,
    title: p.title ?? '',
    bottleneck: p.bottleneck ?? '',
    problem: p.problem ?? '',
    wish: p.wish ?? '',
    current_minutes: p.current_minutes ?? null,
    current_people: p.current_people ?? null,
    current_frequency: p.current_frequency ?? null,
    impact_if_wrong: p.impact_if_wrong ?? null,
  }
}

// 담당자가 접수함에서 보게 될 한 줄.
//
// 다시 낸 것이 새 신청서처럼 섞여 들어오면, 담당자는 앞에서 자기가 반려한
// 것인 줄 모르고 처음부터 다시 읽는다.
export function resubmitNote({ previousTicket, changed, times }) {
  return [
    `${previousTicket}을 반려당한 뒤 고쳐서 다시 낸 것입니다`,
    times > 1 ? ` (${times}번째)` : '',
    '. 부서가 밝힌 바뀐 점: ',
    String(changed ?? '').trim(),
  ].join('')
}
