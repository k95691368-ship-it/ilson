// 합격 기준을 부서가 직접 확인하고 서명한다.
//
// 3단계 협의안 화면은 합격 기준을 "부서와 합의해 정한 것"이라고 말한다.
// 그런데 지금 그 기준을 확정하는 것은 AX 담당자 혼자다. 부서는 그 문장을
// 한 번도 본 적이 없다.
//
// 그래서 무슨 일이 생기냐면, 5단계에서 이 기준으로 통과 판정을 내리고
// 도구를 넘긴다. 부서가 써 보고 "이건 내가 원한 게 아닌데요"라고 하면,
// 담당자는 "합격 기준을 통과했습니다"라고 답할 수밖에 없다. 그 순간
// **합격 기준이 부서를 설득하는 도구가 아니라 부서를 막는 도구가 된다.**
// 이 사이트가 하려는 일과 정확히 반대다.
//
// 여기서 그 서명을 받는다. 다만 서명 버튼 하나를 놓고 "동의합니다"를
// 누르게 하지 않는다. 그건 아무도 안 읽는다.
import { withJosa, listWithJosa } from './korean.js'


export const SIGNOFF_KIND = '기준서명'
export const OBJECTION_KIND = '기준이의'

// 항목마다 부서가 답할 수 있는 것.
export const VERDICTS = {
  ok: { label: '맞습니다', needsReason: false },
  no: { label: '이건 아닙니다', needsReason: true },
}
export const VERDICT_CODES = Object.keys(VERDICTS)

// 이름을 이만큼은 적어야 한다.
//
// 서명인데 누가 했는지 모르면 서명이 아니다. 그렇다고 계정을 만들게 하지는
// 않는다 — 이 사이트는 부서 담당자에게 로그인을 요구하지 않기로 했다.
export const MIN_NAME = 2
export const MIN_REASON = 5

// 서명을 받을 수 있는 상태인가.
//
// 담당자가 아직 확정하지 않은 기준에 서명을 받으면, 나중에 기준이 바뀌는데
// 서명은 그대로 남는다. 그건 서명이 아니라 알리바이다.
export function canAsk(criteria) {
  const list = criteria ?? []
  if (list.length === 0) return { ok: false, why: '아직 합격 기준이 만들어지지 않았습니다.' }
  const unconfirmed = list.filter((c) => !c.confirmed_at).length
  if (unconfirmed > 0) {
    return {
      ok: false,
      why: `담당자가 아직 ${unconfirmed}개를 확정하지 않았습니다. 확정된 뒤에 여쭙겠습니다.`,
    }
  }
  return { ok: true, why: null }
}

// 부서가 적어 낸 것을 확인한다.
export function validateSignoff({ by, dept, requiredDepts, criteria, verdicts, reasons } = {}) {
  const errors = {}
  const list = criteria ?? []
  const v = verdicts ?? {}
  const r = reasons ?? {}
  const need = [...new Set((requiredDepts ?? []).filter(Boolean))]

  if (String(by ?? '').trim().length < MIN_NAME) {
    errors.by = '누가 확인하셨는지 적어주세요. 서명인데 이름이 없으면 서명이 아닙니다.'
  }

  // 걸린 부서가 여럿이면 어느 부서로 확인하시는지 반드시 골라야 한다.
  //
  // 안 고르면 낸 부서로 채워 넣던 때가 있었다. 그러면 손든 부서가 서명한
  // 것이 낸 부서 서명으로 기록되고, 낸 부서가 앞서 단 이의까지 그 서명에
  // 덮여 사라졌다. **서버에서 고쳐 놓은 사고를 화면이 다시 만들었다.**
  //
  // 안 고른 것을 아무 부서로나 채우는 것은, 안 고른 것을 동의로 세는 것과
  // 같은 잘못이다.
  if (need.length > 1 && !need.includes(String(dept ?? ''))) {
    errors.dept = `${need.join(', ')} 중에서 골라주세요. 이 일에는 ${need.length}개 부서가 걸려 있습니다.`
  }

  // 한 항목이라도 안 고르면 막는다. 안 고른 것을 동의로 세면, 안 읽은 것을
  // 읽었다고 기록하는 셈이 된다.
  const undecided = list.filter((c) => !VERDICT_CODES.includes(v[c.id]))
  if (undecided.length > 0) {
    errors.verdicts = `${undecided.length}개 항목을 아직 안 고르셨습니다. 하나씩 봐주셔야 합니다.`
  }

  const missing = list.filter(
    (c) => VERDICTS[v[c.id]]?.needsReason && String(r[c.id] ?? '').trim().length < MIN_REASON
  )
  if (missing.length > 0) {
    errors.reasons = `아니라고 하신 ${missing.length}개에 이유를 적어주세요. 무엇이 다른지 모르면 고칠 수가 없습니다.`
  }

  return errors
}

// 부서가 단 이의를 담당자가 어떻게 푸는가.
//
// 이 자리를 안 만들면 이의가 달린 순간 그 신청서는 영영 "이의 있음"으로
// 남는다. 그러면 담당자는 다음부터 서명을 아예 안 받는다 — 받아 봐야
// 되돌릴 수 없는 표시만 붙기 때문이다. 서명을 받게 하려면 푸는 길이
// 같이 있어야 한다.
//
// **"그대로 갑니다"를 일부러 남겨 뒀다.** 이걸 못 하게 하면 부서가 아무
// 기준이나 영영 막을 수 있다. 대신 그렇게 하면 그 사실이 기록에 남고,
// 통과를 말할 때마다 같이 적힌다. 없앨 수 없게 하는 것이 못 하게 하는
// 것보다 정직하다.
export const RESOLVE_KIND = '이의해소'

export const RESOLUTIONS = [
  {
    code: 'changed',
    label: '부서 말이 맞아 기준을 고쳤습니다',
    reasonLabel: '어떻게 고치셨습니까',
    // 고친 기준에는 다시 확인을 받아야 한다. 앞의 서명은 고치기 전
    // 문장에 한 것이다.
    resign: true,
  },
  {
    code: 'explained',
    label: '왜 그 기준이어야 하는지 설명드렸습니다',
    reasonLabel: '무엇을 설명하셨습니까',
    // 담당자 혼자 "설명했으니 됐다"고 하면 그건 해소가 아니다.
    // 설명을 듣고 부서가 다시 확인해 줘야 끝난다.
    resign: true,
  },
  {
    code: 'kept',
    label: '이의를 알고도 그대로 갑니다',
    reasonLabel: '왜 그대로 가십니까',
    resign: false,
  },
]

export const RESOLUTION_CODES = RESOLUTIONS.map((r) => r.code)
export const RESOLUTION_BY_CODE = Object.fromEntries(RESOLUTIONS.map((r) => [r.code, r]))

export function validateResolve({ code, reason, by } = {}) {
  const errors = {}
  if (!RESOLUTION_CODES.includes(String(code ?? ''))) {
    errors.code = '어떻게 푸셨는지 골라주세요.'
  }
  if (String(reason ?? '').trim().length < MIN_REASON) {
    errors.reason = '무엇을 하셨는지 적어주세요. 이 문장이 그대로 부서에 갑니다.'
  }
  if (String(by ?? '').trim().length < MIN_NAME) {
    errors.by = '누가 푸셨는지 적어주세요.'
  }
  return errors
}

// 지금 서명이 어떤 상태인가.
//
// 서명했다/안 했다 둘로만 나누지 않는다. 그 사이에 네 가지가 더 있다 —
// 이의가 달린 채로 있는 것, 기준이 바뀌어 다시 받아야 하는 것, 이의를
// 알고도 그대로 가기로 한 것, 그리고 아무 이의 없이 확인된 것. 이걸
// 뭉뚱그리면 화면이 "확인됨"이라고 말하는데 실제로는 부서가 반대한
// 기준으로 통과 판정이 나가는 일이 생긴다.
export function signoffState({
  criteria,
  signoff,
  objections,
  resolutions,
  // 이 일에 걸린 부서 전부. 다른 부서가 "우리도 같은 일을 겪는다"고
  // 손들었으면 그 부서도 여기 들어온다.
  requiredDepts,
  // 부서별 서명. 옛 기록에는 부서가 안 붙어 있어서 signoff 하나만 온다.
  signatures,
} = {}) {
  const list = criteria ?? []
  const ask = canAsk(list)
  const byObjection = new Map((resolutions ?? []).map((r) => [r.objection_id, r]))
  const objs = (objections ?? []).map((o) => ({ ...o, resolution: byObjection.get(o.id) ?? null }))

  // 걸린 부서가 여럿이면 한 부서 서명으로는 부족하다.
  //
  // 이건 앞 회차에 만든 구멍이다. 다른 부서가 손들 수 있게 해 놓고,
  // 합격 기준 서명은 여전히 한 명한테만 받고 있었다. 그러면 마케팅과
  // 영업이 걸린 일인데 재무 한 사람이 확인했다고 "확인됨"이 되고,
  // 5단계에서 "합격 기준을 통과했습니다"가 나간다. 나머지 두 부서는
  // 그 기준을 본 적도 없다.
  const need = [...new Set((requiredDepts ?? []).filter(Boolean))]
  const signed = signatures ?? (signoff ? [{ ...signoff, dept: signoff.dept ?? null }] : [])
  const signedDepts = new Set(signed.map((s) => s.dept).filter(Boolean))
  const waiting = need.filter((d) => !signedDepts.has(d))
  const multi = need.length > 1

  // 서명 전과 "기준이 없어진 뒤"가 같은 모양을 써야 화면이 안 깨진다.
  const base0 = () => ({
    by: signoff?.by ?? null,
    at: signoff?.at ?? null,
    why: null,
    objections: [],
    kept: [],
    requiredDepts: need,
    signedDepts: [...signedDepts],
    waitingDepts: waiting,
  })

  if (!signoff) {
    return {
      status: ask.ok ? '아직' : '준비중',
      canSign: ask.ok,
      why: ask.why,
      headline: ask.ok
        ? multi
          ? `이 일에 걸린 ${need.length}개 부서가 각각 확인해주셔야 합니다`
          : '합격 기준을 확인해주세요'
        : '합격 기준이 정해지면 확인을 요청드립니다',
      by: null,
      at: null,
      objections: [],
      kept: [],
      requiredDepts: need,
      signedDepts: [],
      waitingDepts: waiting,
      // 통과 판정에 쓸 수 있는 기준인가. 서명 전에는 아니다.
      binding: false,
    }
  }

  // 기준이 하나도 없으면 서명이 있어도 확인됨이 아니다.
  //
  // 서명을 받은 뒤 담당자가 기준을 전부 지우면, 예전에는 상태가 그대로
  // '확인됨'에 binding=true로 남았다. 화면은 "0개 항목을 모두 확인하셨습니다"
  // 라고 적었고, passCaveat가 null을 돌려줘서 5단계 통과에 아무 단서도
  // 안 붙었다. **아무 기준도 없는 통과가 근거 있는 통과로 나갔다.**
  //
  // 위쪽 canAsk가 이미 "기준이 없으면 서명 못 받는다"고 정해 뒀는데,
  // 서명이 이미 있는 경우에만 그 분기를 건너뛰고 있었다.
  if (list.length === 0) {
    return {
      ...base0(),
      status: '준비중',
      canSign: false,
      why: ask.why,
      headline: '합격 기준이 없습니다. 확인해드릴 것이 없습니다',
      binding: false,
    }
  }

  const open = objs.filter((o) => !o.resolution)
  const kept = objs.filter((o) => o.resolution?.code === 'kept')
  const resign = objs.filter((o) => RESOLUTION_BY_CODE[o.resolution?.code]?.resign)

  // 서명한 뒤에 늘어난 기준.
  //
  // 서명을 받고 나서 담당자가 기준을 하나 더 확정하면, 예전에는 상태가
  // 그대로 '확인됨'으로 남았다. 화면은 "6개 항목을 모두 확인하셨습니다"라고
  // 적는데 부서는 다섯 개만 봤다. 그 여섯 번째로 통과 판정이 나가고,
  // 부서가 "그건 합의한 적 없다"고 하면 화면이 거짓으로 반박한다.
  //
  // 이 파일 위쪽이 "확정 안 된 기준에 서명받으면 알리바이"라고 적어 뒀는데,
  // 늘어나는 방향만 빠져 있었다.
  //
  // 어느 기준에 서명했는지 안 남긴 옛 기록은 전부에 서명한 것으로 본다.
  // 안 그러면 이미 끝난 신청서가 통째로 되돌아간다.
  const covered = new Set()
  let knowsCoverage = false
  for (const s of signed) {
    if (!Array.isArray(s.criterionIds)) continue
    knowsCoverage = true
    for (const id of s.criterionIds) covered.add(id)
  }
  const addedAfter = knowsCoverage ? list.filter((c) => !covered.has(c.id)) : []

  const base = {
    by: signoff.by,
    at: signoff.at,
    why: null,
    objections: open,
    kept,
    requiredDepts: need,
    signedDepts: [...signedDepts],
    waitingDepts: waiting,
  }

  // 기준이 바뀌었거나 설명을 드렸으면 다시 받아야 한다. 이게 가장
  // 먼저다 — 바뀐 기준에 옛 서명을 붙여 두면 서명이 거짓이 된다.
  if (resign.length > 0) {
    return {
      ...base,
      status: '다시 받아야 함',
      canSign: true,
      headline: `${resign.length}개 항목이 바뀌었습니다. 한 번만 더 봐주세요`,
      binding: false,
    }
  }

  // 누가 단 이의인지는 그 이의에 적힌 사람이다. 마지막에 서명한 사람이
  // 아니다 — 부서가 여럿이면 그 둘이 다르고, 그러면 반대한 적 없는 사람이
  // 반대한 것처럼 적힌다.
  const who = (list2) => {
    const names = [...new Set(list2.map((o) => o.dept || o.by).filter(Boolean))]
    return names.length > 0 ? names.join('·') : '부서'
  }

  if (open.length > 0) {
    return {
      ...base,
      status: '이의 있음',
      canSign: waiting.length > 0,
      headline: `${withJosa(who(open), '가')} ${open.length}개 항목에 이의를 다셨습니다`,
      binding: false,
    }
  }

  if (kept.length > 0) {
    return {
      ...base,
      status: '이의 알고 진행',
      canSign: waiting.length > 0,
      headline: `${who(kept)}의 이의 ${kept.length}건을 담당자가 알고도 그대로 가기로 했습니다`,
      binding: false,
    }
  }

  // 서명 뒤에 기준이 늘었으면 다시 받아야 한다.
  //
  // 안 본 기준을 본 것으로 세면, 그 기준으로 낸 통과에 아무 단서도 안 붙는다.
  if (addedAfter.length > 0) {
    return {
      ...base,
      status: '다시 받아야 함',
      canSign: true,
      headline: `확인해주신 뒤에 기준이 ${addedAfter.length}개 늘었습니다. 한 번만 더 봐주세요`,
      addedAfter,
      binding: false,
    }
  }

  // 아직 확인 안 한 부서가 있으면 확인됨이 아니다.
  //
  // 이의가 없는 것과 안 본 것은 다르다. 안 본 부서를 이의 없음으로 세면,
  // 그 부서는 다 만들어진 뒤에 처음 기준을 보게 되고 그때는 늦다.
  if (waiting.length > 0) {
    return {
      ...base,
      status: '일부만 확인',
      canSign: true,
      headline:
        signedDepts.size > 0
          ? `${listWithJosa([...signedDepts], '는')} 확인하셨습니다. ${listWithJosa(waiting, '가')} 아직입니다`
          : // 어느 부서 서명인지 모르는 옛 기록만 있을 때. 앞을 비워 두면
            // "  확인하셨습니다"로 시작하는 깨진 문장이 나온다.
            `${listWithJosa(waiting, '가')} 아직 확인하지 않으셨습니다`,
      binding: false,
    }
  }

  return {
    ...base,
    status: '확인됨',
    canSign: false,
    headline: multi
      ? `${need.length}개 부서가 모두 ${list.length}개 항목을 확인하셨습니다`
      : `${signoff.by}님이 ${list.length}개 항목을 모두 확인하셨습니다`,
    binding: true,
  }
}

// 5단계에서 통과라고 말할 때 뭐라고 덧붙일 것인가.
//
// 서명 없는 통과를 그냥 "통과"라고 적으면, 나중에 부서가 아니라고 할 때
// 근거가 없다. 통과 자체를 막지는 않는다 — 막으면 부서가 답을 안 줄 때
// 아무것도 못 하게 된다. 대신 무엇이 없는 통과인지 적는다.
export function passCaveat(state) {
  const s = state ?? {}
  if (s.binding) return null
  if (s.status === '이의 있음') {
    return `부서가 ${s.objections?.length ?? 0}개 항목에 이의를 단 상태입니다. 이 통과는 그 이의가 풀리기 전까지 반쪽입니다.`
  }
  if (s.status === '이의 알고 진행') {
    // 여기가 이 함수의 핵심이다. 담당자가 "그대로 갑니다"로 넘긴 것을
    // 통과할 때마다 다시 말해 준다. 한 번 넘겼다고 없던 일이 되면,
    // 그대로 가기는 이의를 지우는 버튼이 된다.
    return `부서가 이의를 단 기준 ${s.kept?.length ?? 0}개를 담당자가 알고도 그대로 두기로 했습니다. 이 통과는 그 사실 위에 있습니다.`
  }
  if (s.status === '다시 받아야 함') {
    return '기준이 바뀐 뒤로 부서가 아직 다시 확인하지 않았습니다. 이 통과는 바뀌기 전 확인 위에 있습니다.'
  }
  if (s.status === '일부만 확인') {
    // 이 일에 걸린 부서가 여럿인데 일부만 봤다는 것을 통과할 때마다 말한다.
    // 안 본 부서를 이의 없음으로 세면, 그 부서는 다 만들어진 뒤에 처음
    // 기준을 보게 되고 그때는 늦다.
    return `${listWithJosa(s.waitingDepts ?? [], '가')} 아직 합격 기준을 확인하지 않았습니다. 이 통과는 ${(s.signedDepts ?? []).join('·')}의 확인만으로 낸 것입니다.`
  }
  return '부서가 아직 합격 기준을 확인하지 않았습니다. 이 통과는 담당자 혼자 정한 기준으로 낸 것입니다.'
}
