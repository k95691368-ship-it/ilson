// 보류해 둔 신청서의 조건이 풀렸다고 부서가 알린다.
//
// 검토에서 보류를 하면 화면은 부서에게 이렇게 말한다 —
// **"보류 조건이 풀리면 알려주세요."**
// 그런데 알릴 자리가 아무 데도 없었다. 조회 화면에도, 부서 화면에도,
// 어디에도 누를 것이 없다. 시키기만 하고 갈 곳이 없는 문장이다.
//
// 이게 이 사이트에서 세 번째로 나온 같은 구멍이다(수령 확인, 시험판 의견,
// 그리고 이것). 앞의 둘과 다른 점이 하나 있는데, 보류는 **아무도 안 움직이면
// 영원히 그대로**라는 것이다. 수령·성과는 담당자가 대신이라도 누를 수
// 있었지만, 조건이 풀렸는지는 부서만 안다. 담당자가 한 달에 한 번 전화를
// 돌리지 않는 한, 보류함은 조용히 무덤이 된다.
//
// 그래서 여기서 받는다. 다만 "풀렸습니다" 버튼 하나로 받지 않는다 —
// 담당자가 다시 판정하려면 **무엇이 달라졌는지**를 알아야 하고, 그건
// 부서만 쓸 수 있다.

export const HOLD_LIFT_KIND = '보류해제요청'
export const HOLD_LIFT_CANCEL_KIND = '보류해제취소'

export const MIN_NAME = 2
export const MIN_BODY = 5

// 무엇이 달라졌는가.
//
// 조건이 그대로여도 상황은 달라질 수 있다. "아직 그 시스템은 안 바뀌었는데
// 사람이 둘 나가서 더 급해졌습니다" 같은 것 말이다. 그걸 받을 자리가 없으면
// 부서는 아무 말도 못 하고 기다리기만 한다.
export const LIFT_KINDS = [
  {
    code: 'met',
    label: '적어 주신 조건이 풀렸습니다',
    hint: '무엇이 어떻게 풀렸는지 한 줄만 적어주세요. 저희가 확인할 수 있어야 합니다.',
    // 담당자가 곧바로 다시 판정할 수 있는 것.
    ready: true,
  },
  {
    code: 'changed',
    label: '조건은 그대로인데 사정이 달라졌습니다',
    hint: '더 급해졌거나, 범위가 줄었거나, 다른 방법이 생겼거나 — 무엇이 달라졌는지 적어주세요.',
    ready: false,
  },
]

export function liftKindOf(code) {
  return LIFT_KINDS.find((k) => k.code === code) ?? null
}

export function validateHoldLift({ by, kind, body } = {}) {
  const errors = {}
  if (String(by ?? '').trim().length < MIN_NAME) {
    errors.by = '알려주시는 분 성함을 적어주세요. 되물을 것이 생기면 그 성함으로 찾습니다.'
  }
  if (!liftKindOf(kind)) {
    errors.kind = '조건이 풀린 것인지, 사정이 달라진 것인지 골라주세요.'
  }
  if (String(body ?? '').trim().length < MIN_BODY) {
    // "풀렸어요" 한 마디만 오면 담당자는 다시 판정할 근거가 없다. 그러면
    // 되물어야 하고, 되묻는 사이에 또 한 달이 간다.
    errors.body = '무엇이 달라졌는지 한 줄만 적어주세요. 이게 있어야 다시 판정할 수 있습니다.'
  }
  return errors
}

// 한 번에 보류한 것의 흔적.
//
// 보류가 두 길로 들어온다. 한 건씩 판정하면 review 표에
// hold_until_condition 이 적히고, 접수함에서 여러 건을 한 번에 미루면
// decision_log 에만 남는다. 한 번에 미루는 화면은 "언제 다시 보시겠습니까"를
// **필수로** 받는데, 그 답이 review 표에는 안 들어간다.
//
// 그래서 담당자가 의무로 적은 조건을 읽는 자리가 전부 비어 있었다 —
// 부서 조회 화면, 부서별 화면, 못 한 것 화면, 그리고 30일 넘김 경보.
// 경보가 특히 나쁘다. 한 달이 지나도 안 켜지니 **한 번에 미룬 건은 영영
// 잊힌다.** 한 번에 미룬다는 것은 원래 급하지 않아서 미루는 것인데, 그게
// 곧 아무도 다시 안 본다는 뜻이 되어 버렸다.
//
// 점수를 지어내서 review 행을 만들지는 않는다. 한 번에 미룬 것은 실제로
// 점수를 매긴 것이 아니고, 이 사이트는 안 한 것을 한 것처럼 적지 않는다.
// 대신 읽는 쪽이 두 자리를 다 본다.
export const BULK_HOLD_KIND = '일괄:hold'

// 앞머리를 떼고 조건만 남긴다. 기록에는 "보류로 미룹니다. {조건}"으로 적힌다.
const BULK_HOLD_PREFIX = '보류로 미룹니다.'

export function bulkHoldFrom(decisions) {
  // append-only 로그다. 여러 번 미뤘으면 **마지막** 것이 지금 상태다.
  // .find()로 첫 줄을 집으면 나중에 고친 값이 버려진다 — 이 저장소에서
  // 이미 두 번 당한 자리다.
  const rows = (decisions ?? [])
    .filter((d) => d?.link_kind === BULK_HOLD_KIND)
    .slice()
    .sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')))
  const last = rows.at(-1)
  if (!last) return null

  const body = String(last.what ?? '').trim()
  const condition = body.startsWith(BULK_HOLD_PREFIX)
    ? body.slice(BULK_HOLD_PREFIX.length).trim()
    : body
  return { condition: condition || null, at: last.created_at ?? null }
}

// 지금 이 보류가 어떤 상태인가.
//
// 담당자가 다시 판정하면 그게 답이다. 따로 "확인했습니다" 버튼을 만들지
// 않는다 — 누르기만 하고 판정은 안 하는 자리가 하나 더 생길 뿐이다.
// 판정이 곧 답이 되게 두면, 답을 안 하면 목록에 계속 남는다.
export function holdState({ application, review, records, decisions, now } = {}) {
  const status = application?.status ?? null
  const held = status === '보류'
  const list = (records ?? []).slice().sort((a, b) => String(a.at).localeCompare(String(b.at)))

  // 취소는 자기 앞의 요청을 지운다. 잘못 눌렀을 때 되돌릴 자리가 없으면
  // 부서는 아예 안 누른다.
  let open = null
  for (const r of list) {
    if (r.kind === HOLD_LIFT_KIND) open = r
    else if (r.kind === HOLD_LIFT_CANCEL_KIND) open = null
  }

  // 요청 뒤에 담당자가 다시 판정했으면 답을 받은 것이다.
  // review 표는 created_at이 아니라 decided_at을 쓴다. 처음에 created_at으로
  // 적었다가 배포하고 나서 500을 봤다.
  const reviewAt = review?.updated_at ?? review?.decided_at ?? null

  // 한 건씩 판정한 것이 먼저다. 그게 더 자세하고, 점수까지 매긴 것이다.
  // 없으면 한 번에 미룬 기록을 본다.
  const bulk = bulkHoldFrom(decisions)
  const judgedAt = reviewAt ?? bulk?.at ?? null
  const answered = Boolean(open && judgedAt && String(judgedAt) > String(open.at))

  return {
    // 보류가 아니면 이 자리는 아무 말도 하지 않는다.
    canTell: held,
    held,
    condition: review?.hold_until_condition ?? bulk?.condition ?? null,
    // 한 번에 미룬 것인지 밝힌다. 부서가 "왜 이건 점수가 없나"를 물을 때
    // 답할 수 있어야 하고, 감춰 두면 다음에 알았을 때 속은 기분이 든다.
    bulk: Boolean(!review?.hold_until_condition && bulk?.condition),
    heldSince: judgedAt,
    heldDays: daysBetween(judgedAt, now),
    pending: Boolean(open) && !answered,
    open: open ? { ...open, answered } : null,
    answered,
    history: list,
  }
}

function daysBetween(from, now) {
  if (!from) return null
  const a = Date.parse(`${String(from).replace(' ', 'T')}Z`)
  const b = typeof now === 'number' ? now : Date.parse(`${String(now ?? '').replace(' ', 'T')}Z`)
  const end = Number.isFinite(b) ? b : Date.now()
  if (!Number.isFinite(a)) return null
  return Math.max(0, Math.floor((end - a) / 86400000))
}

// 부서에게 뭐라고 말할 것인가.
export function holdHeadline(state) {
  if (!state?.canTell) return null
  if (state.pending) {
    return '알려주신 것을 담당자가 아직 못 봤습니다'
  }
  if (state.answered) {
    return '알려주신 뒤에 다시 판정했습니다'
  }
  if (state.heldDays != null && state.heldDays >= 30) {
    // 한 달이 넘도록 아무 말이 없으면 그건 미뤄 둔 것이 아니라 잊힌 것이다.
    return `미뤄 둔 지 ${state.heldDays}일 됐습니다 — 그사이 달라진 것이 있으면 알려주세요`
  }
  return '조건이 풀렸거나 사정이 달라지면 알려주세요'
}

// 왜 부서가 먼저 말해야 하는가.
//
// "기다리세요"로 끝내면 안 되는 이유를 적는다. 이유 없이 시키면 아무도 안 한다.
export function holdWhy(state) {
  if (state?.pending) {
    return '담당자 첫 화면 할 일 목록에 올라가 있습니다. 보시면 다시 판정하고 그 결과가 여기 뜹니다.'
  }
  return '조건이 풀린 것은 그쪽에서만 아십니다. 저희가 모르면 이 신청서는 미뤄 둔 채로 그대로 묻힙니다 — 아무도 안 움직이면 영원히 그대로입니다.'
}
