// 부서가 직접 확인한 것과 담당자가 대신 확인한 것.
//
// 이 사이트는 "넘겼다고 받은 것이 아니다", "만든 사람만 아는 성과는 성과가
// 아니다"를 여러 화면에서 되풀이해 말한다. 그런데 정작 그 확인을 누르는
// 자리가 **담당자 화면에만** 있었다. 담당자가 창을 띄워 부서 사람 이름을
// 대신 타이핑하고, 기록에는 그 부서 사람이 확인한 것으로 남았다.
//
// 부서 사람은 조회 화면에서 "받았다고 눌러주세요"라는 말을 읽고 도구
// 화면으로 갔는데, 거기엔 누를 것이 없었다. 시키는 일을 하러 갔다가
// 막다른 화면에서 끝난다.
//
// 그래서 두 가지를 한다.
//   ① 부서가 직접 누를 자리를 만든다.
//   ② 담당자가 대신 누른 것은 **대신 눌렀다고 적는다.** 지우지 않는다 —
//      전화로 확인받고 대신 눌러야 할 때가 실제로 있다. 다만 그것을
//      부서 확인과 같은 것으로 세지 않는다.

export const ACCEPT_KIND = '수령확인' // 부서가 직접
export const ACCEPT_PROXY_KIND = '수령대리확인' // 담당자가 대신
export const REJECT_KIND = '수령거절' // 부서가 "이건 못 쓰겠습니다"

export const OUTCOME_KIND = '성과확인' // 부서가 직접
export const OUTCOME_PROXY_KIND = '성과대리확인' // 담당자가 대신

export const MIN_NAME = 2
export const MIN_REASON = 5

export function validateAccept({ by } = {}) {
  const errors = {}
  if (String(by ?? '').trim().length < MIN_NAME) {
    // 계정을 만들게 하지는 않는다. 다만 누가 받았는지 모르면 "그런 거 받은
    // 적 없다"가 됐을 때 댈 것이 없다.
    errors.by = '받으신 분 성함을 적어주세요. 나중에 "받은 적 없다"가 되면 댈 것이 있어야 합니다.'
  }
  return errors
}

export function validateReject({ by, reason } = {}) {
  const errors = validateAccept({ by })
  if (String(reason ?? '').trim().length < MIN_REASON) {
    // 못 쓰겠다는 말만 오면 담당자는 무엇을 고쳐야 할지 모른다.
    errors.reason = '무엇이 안 맞는지 한 줄만 적어주세요. 이것만 있으면 고칠 수 있습니다.'
  }
  return errors
}

// 부서가 체감한 것과 담당자가 계산한 것이 얼마나 다른가.
//
// 성과 확인을 "맞습니다" 한 버튼으로 받으면 아무도 안 읽고 누른다.
// 실제로 얼마나 줄었다고 느끼는지를 숫자로 받아, 계산과 다르면 그 차이가
// 그대로 남게 한다.
export function validateOutcomeConfirm({ by, agree, felt } = {}) {
  const errors = validateAccept({ by })
  if (agree !== true && agree !== false) {
    errors.agree = '적어 드린 숫자가 체감과 맞는지 골라주세요.'
  }
  if (agree === false) {
    const n = Number(felt)
    if (!Number.isFinite(n) || n < 0) {
      errors.felt = '그럼 실제로는 한 번에 몇 분쯤 걸리십니까. 숫자로 적어주세요.'
    }
  }
  return errors
}

// 지금 수령이 어떤 상태인가.
export function acceptState({ handover, records } = {}) {
  const list = records ?? []
  // 마지막 것을 본다. 처음 것이 아니다 — 같은 사람이 두 번 누르면 나중
  // 것이 맞다. 성과 확인에서 이것 때문에 부서가 고쳐 준 숫자가 조용히
  // 버려지고 있었다.
  const direct = list.filter((r) => r.kind === ACCEPT_KIND).at(-1) ?? null
  const proxy = list.filter((r) => r.kind === ACCEPT_PROXY_KIND).at(-1) ?? null
  const rejected = list.filter((r) => r.kind === REJECT_KIND)
  // 거절한 뒤에 다시 받았다고 하면 그것이 최신이다.
  const openReject = rejected.filter(
    (r) => !direct || r.at > direct.at
  )

  if (!handover) {
    return { status: '안 넘김', canAccept: false, by: null, at: null, proxy: false, rejects: [] }
  }
  if (handover.rolled_back_at) {
    return { status: '내림', canAccept: false, by: null, at: null, proxy: false, rejects: openReject }
  }
  if (openReject.length > 0) {
    return {
      status: '못 쓰겠다고 하심',
      canAccept: true,
      by: openReject[openReject.length - 1].by,
      at: openReject[openReject.length - 1].at,
      proxy: false,
      rejects: openReject,
    }
  }
  if (direct) {
    return { status: '부서가 확인함', canAccept: false, by: direct.by, at: direct.at, proxy: false, rejects: [] }
  }
  if (proxy || handover.accepted_at) {
    // 담당자가 대신 눌렀거나, 이 기능이 생기기 전에 눌린 것.
    return {
      status: '담당자가 대신 확인함',
      canAccept: true,
      by: proxy?.by ?? handover.accepted_by ?? null,
      at: proxy?.at ?? handover.accepted_at ?? null,
      proxy: true,
      rejects: [],
    }
  }
  return { status: '아직', canAccept: true, by: null, at: null, proxy: false, rejects: [] }
}

// 대리 확인을 어떻게 부를 것인가.
//
// 지우지 않는다. 전화로 확인받고 대신 누르는 일이 실제로 있다. 다만 그것을
// 부서 확인과 같은 것으로 세지 않는다 — 그러면 "부서가 확인해 줘야 성과다"가
// 자기 입으로 한 말이 된다.
export function proxyNote(state) {
  if (!state?.proxy) return null
  return `${state.by ?? '담당자'}가 대신 확인한 것입니다. 부서가 직접 누른 것은 아직 없습니다 — 전화로 들으신 것이라면 그렇게 적어 두시고, 아니면 부서에 한 번 여쭤보세요.`
}
