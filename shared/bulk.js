// 접수함에서 여러 건을 한 번에 처리한다.
//
// 신청서가 밀리는 이유는 판정이 어려워서가 아니다. 대부분은 한 건 열고,
// 읽고, 판정하고, 닫고, 다음 것 열고를 반복하는 것이 지겨워서다. 여섯 건이
// 밀려 있으면 여섯 번 그 일을 해야 한다.
//
// 그런데 일괄 처리는 위험하다. **한 번에 여러 건을 판정하게 하면 사람은
// 안 읽고 누른다.** 그러면 밀린 채로 두는 것보다 나쁘다 — 읽지도 않고
// 반려된 신청서가 생기고, 부서는 그걸 알아챈다. 그 뒤로 아무도 신청서를
// 제대로 안 쓴다.
//
// 그래서 여기서는 **읽지 않아도 되는 것만** 한 번에 할 수 있게 한다.

// 한 번에 할 수 있는 일.
//
// 각각에 "왜 이건 읽지 않고 해도 되는가"를 붙여 뒀다. 이 이유를 못 대는
// 조작은 여기 넣으면 안 된다.
export const BULK_ACTIONS = [
  {
    code: 'ack',
    label: '봤다고 알리기',
    detail: '아직 판정은 안 했지만 읽었다는 것을 부서에 알립니다.',
    why: '판정이 아니라서 내용을 다 읽지 않아도 됩니다. 부서 입장에서는 아무 소식이 없는 것보다 낫습니다.',
    // 상태를 바꾸지 않는다. '검토중'으로 바꾸면 판정 절차에 들어간 것인데,
    // 실제로는 목록에서 눈으로 훑기만 한 것이다.
    changesStatus: false,
    needsReason: false,
  },
  {
    code: 'hold',
    label: '보류로 미루기',
    detail: '지금은 못 하는 것으로 미룹니다. 언제 다시 볼지 조건을 함께 적습니다.',
    why: '"지금은 못 한다"는 판단은 내용을 깊이 안 봐도 설 때가 있습니다 — 분기 마감이라 손이 없다든지.',
    changesStatus: '보류',
    needsReason: true,
    reasonLabel: '언제 다시 보시겠습니까',
    reasonPlaceholder: '9월 정산 마감이 끝나면 다시 봅니다. 지금은 손이 없습니다.',
  },
]

export const BULK_CODES = BULK_ACTIONS.map((a) => a.code)
export const BULK_BY_CODE = Object.fromEntries(BULK_ACTIONS.map((a) => [a.code, a]))

// 한 번에 몇 건까지.
//
// 스무 건을 한 번에 처리하게 하면 그건 이미 안 읽고 누르는 것이다.
// 여덟이면 목록이 한 화면에 들어오고, 무엇을 고른 건지 눈으로 확인할 수 있다.
export const MAX_AT_ONCE = 8

// 판정은 여기서 안 한다.
//
// 이걸 지우고 수용·반려를 넣고 싶어질 때가 온다. 그때 이 주석을 읽으라고
// 남겨 둔다.
export const NEVER_BULK = ['수용', '반려']

// 여기는 접수함이다. 접수함에 있는 건만 건드린다.
//
// 이걸 안 걸고 올렸다가 라이브에서 걸렸다. 이미 배포까지 간 신청서에
// "봤다고 알리기"가 걸려 검토 단계 기록이 붙었고, 그러면 막힌 곳 화면이
// 그 건을 "검토 단계에 있음"으로 읽는다. 애초에 뜻도 없는 조작이다 —
// 이미 도구를 쓰고 있는 부서에 "읽었습니다"를 보내 봐야 할 말이 아니다.
export const INBOX_STATUSES = ['접수', '검토중', '보류']

export function validateBulk({ action, ids, reason }) {
  const fields = {}
  const list = [...new Set(ids ?? [])].filter(Boolean)

  if (!BULK_CODES.includes(String(action ?? ''))) {
    fields.action = '무엇을 하실지 골라주세요.'
  }
  if (list.length === 0) {
    fields.ids = '신청서를 고르세요.'
  } else if (list.length > MAX_AT_ONCE) {
    fields.ids = `한 번에 ${MAX_AT_ONCE}건까지입니다. ${list.length}건을 고르셨습니다.`
  }

  const spec = BULK_BY_CODE[String(action ?? '')]
  if (spec?.needsReason && String(reason ?? '').trim().length < 5) {
    fields.reason = `${spec.reasonLabel ?? '이유'}를 적어주세요.`
  }
  return fields
}

// 고른 것 중 실제로 처리할 수 있는 것.
//
// 이미 판정이 끝난 건을 골랐으면 조용히 건너뛰지 않는다. 몇 건이 왜
// 빠졌는지 말해 준다 — 여덟을 골랐는데 다섯만 처리되고 아무 말이 없으면
// 나머지 셋이 어떻게 됐는지 모른다.
export function partition(items, ids, action) {
  const wanted = new Set(ids ?? [])
  const picked = (items ?? []).filter((i) => wanted.has(i.id))
  const spec = BULK_BY_CODE[action]

  const ok = []
  const skipped = []
  for (const it of picked) {
    if (it.status === '반려' || it.status === '완료') {
      skipped.push({ ...it, reason: `이미 ${it.status}된 건입니다.` })
    } else if (!INBOX_STATUSES.includes(it.status)) {
      skipped.push({ ...it, reason: `이미 ${it.status}이라 접수함을 떠난 건입니다.` })
    } else if (spec?.changesStatus && it.status === spec.changesStatus) {
      skipped.push({ ...it, reason: `이미 ${it.status} 상태입니다.` })
    } else {
      ok.push(it)
    }
  }

  const missing = [...wanted].filter((id) => !picked.some((p) => p.id === id))
  return { ok, skipped, missing }
}

// 처리하고 나서 뭐라고 말할 것인가.
export function resultText({ action, ok, skipped }) {
  const spec = BULK_BY_CODE[action]
  const parts = [`${ok}건을 ${spec?.label ?? '처리'}했습니다.`]
  if (skipped > 0) {
    parts.push(`${skipped}건은 이미 처리된 것이라 건너뛰었습니다.`)
  }
  return parts.join(' ')
}
