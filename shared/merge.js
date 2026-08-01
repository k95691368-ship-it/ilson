// 같은 건이라고 판정한 뒤에 실제로 묶는다.
//
// 나란히 놓고 견주는 화면을 만들면서 "같은 건 / 다른 건"을 판정하게 했다.
// 그런데 판정하고 나서 아무 일도 안 일어난다. 기록에만 남고, 부서는 여전히
// 자기 신청서가 접수 상태로 앉아 있는 것을 본다.
//
// 부서 입장에서 이건 최악이다. 이미 만들고 있는 것과 같은 일인데 그 사실을
// 모른 채 몇 주를 기다린다. 담당자는 판정했으니 끝났다고 생각하고, 부서는
// 아무 소식이 없다고 생각한다. 둘 다 상대가 뭘 하고 있는 줄 안다.
//
// 그래서 묶으면 실제로 상태가 바뀌게 한다. 그리고 그 이유가 부서 화면에
// 그대로 뜨게 한다.

export const MERGE_KIND = '병합'

// 어느 쪽을 남기고 어느 쪽을 묶을 것인가.
//
// 먼저 낸 것을 남긴다. 그쪽이 이미 검토를 받았거나 만들어지고 있을 수 있고,
// 나중 것을 남기면 그 진행이 통째로 끊긴다.
//
// 다만 먼저 낸 것이 반려됐으면 그쪽으로 묶으면 안 된다. 반려된 것에 묶으면
// 부서는 "왜 내 신청서가 반려된 것에 붙었지"가 된다.
const DEAD = ['반려']

export function pickPrimary(a, b) {
  if (!a || !b) return { primary: a ?? b ?? null, merged: null, blocked: '견줄 것이 둘 다 있어야 합니다.' }
  if (a.id === b.id) return { primary: a, merged: null, blocked: '같은 신청서입니다.' }

  const aDead = DEAD.includes(a.status)
  const bDead = DEAD.includes(b.status)
  if (aDead && bDead) {
    return { primary: null, merged: null, blocked: '둘 다 반려된 신청서라 묶을 것이 없습니다.' }
  }
  // 한쪽만 살아 있으면 살아 있는 쪽이 주다.
  if (aDead) return { primary: b, merged: a, blocked: null }
  if (bDead) return { primary: a, merged: b, blocked: null }

  // 둘 다 살아 있으면 먼저 낸 쪽이 주다.
  const aFirst = String(a.created_at) <= String(b.created_at)
  return { primary: aFirst ? a : b, merged: aFirst ? b : a, blocked: null }
}

// 이미 묶여 있는 것을 또 묶지 않는다.
export function alreadyMerged(decisions, applicationId) {
  return (decisions ?? []).some(
    (d) => d.link_kind === MERGE_KIND && d.application_id === applicationId
  )
}

// 부서 화면에 그대로 뜰 문장.
//
// "중복입니다"로 끝내면 부서는 자기 신청서가 버려진 줄 안다. 버린 것이
// 아니라 그쪽에서 함께 처리된다는 것, 그리고 어디를 보면 되는지를 말해야 한다.
export function mergeNotice(primary, mergedInto) {
  return {
    headline: `${primary.ticket_no} 와 같은 건으로 묶었습니다`,
    body: `내주신 것과 같은 병목을 ${primary.dept}에서 먼저 냈습니다(${primary.ticket_no}). 두 번 만들지 않으려고 그쪽에서 함께 처리합니다.`,
    // 버린 것이 아니라는 것을 분명히 한다.
    why: '따로 만들지 않을 뿐이지 안 하는 것이 아닙니다. 그쪽이 다 되면 바로 쓰실 수 있습니다.',
    where: primary.ticket_no,
    mergedTicket: mergedInto?.ticket_no ?? null,
  }
}

export function holdCondition(primary) {
  return `${primary.ticket_no}과 같은 건입니다. 그쪽이 배포되면 함께 쓰실 수 있습니다.`
}

export function validateMerge({ why, author }) {
  const fields = {}
  // 근거 없이 묶으면 나중에 "이거 왜 묶였지"에 답할 수 없다. 부서가
  // 물어보면 답해야 하는 자리다.
  if (String(why ?? '').trim().length < 5) {
    fields.why = '왜 같은 건이라고 보셨는지 적어주세요.'
  }
  if (!String(author ?? '').trim()) fields.author = '누가 판정하시는지 적어주세요.'
  return fields
}
