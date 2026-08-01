// 알려 준 상품코드를 담당자가 확인하고 정정한다.
//
// 부서가 "이 코드는 이 상품입니다"를 알려주면 다음 실행부터 그대로 쓰인다.
// 편하지만 위험하다 — 코드 하나를 잘못 이어 두면 그 코드로 팔린 것이 전부
// 엉뚱한 상품 매출로 잡힌다. 금액이 틀리는데 아무도 안 틀렸다고 생각한다.
// 격리된 줄은 눈에 띄지만 잘못 이어진 줄은 조용히 섞인다.
//
// 그렇다고 담당자 승인을 받아야 쓰이게 하면, 부서가 알려주고 나서 며칠씩
// 기다리게 된다. 그러면 알려주지 않는다.
//
// 그래서 이렇게 한다. 부서가 알려준 것은 바로 쓴다. 대신 담당자 화면에
// "아직 확인 안 한 것"으로 쌓아 두고, 담당자가 나중에 훑어보게 한다.
// 빠르되 눈감지는 않는다.

export const CONFIRM_KIND = '코드확인'
export const CORRECT_KIND = '코드정정'

// 누가 알려 줬는가.
//
// 담당자가 제작 단계에서 넣은 것과 부서가 도구를 쓰다가 알려준 것은
// 무게가 다르다. 담당자 것은 표를 보고 넣은 것이고, 부서 것은 화면에서
// 골라 넣은 것이다. 부서 것을 더 봐야 한다.
export function taughtBySide(alias, staffLabels = ['AX 담당자']) {
  const who = String(alias?.taught_by ?? '').trim()
  if (!who) return '알 수 없음'
  return staffLabels.includes(who) ? '담당자' : '부서'
}

// 결정 기록에서 확인·정정 이력을 뽑아 코드에 붙인다.
export function annotate(aliases, decisions, { staffLabels } = {}) {
  const confirmed = new Map()
  const corrected = new Map()

  for (const d of decisions ?? []) {
    if (d.link_kind === CONFIRM_KIND) {
      // 같은 코드를 여러 번 확인했으면 마지막 것만 본다.
      const prev = confirmed.get(d.link_id)
      if (!prev || String(prev.at) < String(d.created_at)) {
        confirmed.set(d.link_id, { by: d.title, at: d.created_at })
      }
    }
    if (d.link_kind === CORRECT_KIND) {
      const list = corrected.get(d.link_id) ?? []
      list.push({ by: d.title, at: d.created_at, what: d.what, why: d.why })
      corrected.set(d.link_id, list)
    }
  }

  return (aliases ?? []).map((a) => {
    const side = taughtBySide(a, staffLabels)
    const check = confirmed.get(a.external_code) ?? null
    const fixes = (corrected.get(a.external_code) ?? []).sort((x, y) =>
      String(y.at).localeCompare(String(x.at))
    )

    // 확인한 뒤에 누가 또 고쳤으면 그 확인은 낡은 것이다.
    const staleCheck = Boolean(
      check && String(a.created_at) > String(check.at)
    )

    return {
      ...a,
      side,
      confirmed: check,
      corrections: fixes,
      // 담당자가 봐야 하는 것 — 부서가 알려줬는데 아직 확인 안 한 것.
      // 담당자가 직접 넣은 것은 넣을 때 이미 본 것이라 다시 안 묻는다.
      needsCheck: side !== '담당자' && (!check || staleCheck),
      staleCheck,
    }
  })
}

// 담당자가 훑어봐야 할 것부터.
export function sortForReview(annotated) {
  return [...(annotated ?? [])].sort((a, b) => {
    if (a.needsCheck !== b.needsCheck) return a.needsCheck ? -1 : 1
    // 그중에서는 최근 것부터. 방금 들어온 것이 아직 안 쓰였을 가능성이 크고,
    // 그때 잡아야 잘못 섞인 정산을 되돌리는 일이 안 생긴다.
    return String(b.created_at).localeCompare(String(a.created_at))
  })
}

export function summarize(annotated) {
  const list = annotated ?? []
  return {
    total: list.length,
    byDept: list.filter((a) => a.side === '부서').length,
    byStaff: list.filter((a) => a.side === '담당자').length,
    needsCheck: list.filter((a) => a.needsCheck).length,
    corrected: list.filter((a) => a.corrections.length > 0).length,
  }
}

export function validateCorrection({ canonicalCode, why, author, knownCodes }) {
  const fields = {}
  const canon = String(canonicalCode ?? '').trim().toUpperCase()
  if (!canon) {
    fields.canonicalCode = '어느 상품으로 바꿀지 골라주세요.'
  } else if (knownCodes && !knownCodes.includes(canon)) {
    fields.canonicalCode = '저희 목록에 없는 상품코드입니다.'
  }
  // 왜 바꾸는지가 없으면, 몇 달 뒤 정산 숫자가 달라진 이유를 못 찾는다.
  // 코드를 바꾸는 것은 지난 숫자까지 같이 움직이는 일이다.
  if (String(why ?? '').trim().length < 5) {
    fields.why = '왜 바꾸시는지 적어주세요. 지난 정산 숫자가 함께 움직입니다.'
  }
  if (!String(author ?? '').trim()) fields.author = '누가 정정하시는지 적어주세요.'
  return fields
}
