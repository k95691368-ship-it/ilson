// 적다 만 신청서를 잃지 않는다.
//
// 신청서 폼이 길다. 병목이 뭔지, 그래서 무슨 일이 생기는지, 얼마나 걸리는지
// 를 다 적으면 십 분이 간다. 그러다 회의에 불려 가서 탭을 닫거나, 실수로
// 새로고침하면 지금은 전부 날아간다.
//
// 한 번 날려 본 사람은 다시 안 적는다. 그러면 그 병목은 영영 접수되지
// 않고, 이 사이트는 "귀찮은 데"가 된다.
//
// 서버에 보내지 않는다. 이 사이트는 로그인이 없어서, 초안을 서버에 두면
// 그것을 누구 것이라고 할 수가 없다. 남이 적던 것을 다른 사람이 이어
// 쓰게 되는 쪽이 잃는 것보다 나쁘다. 브라우저 안에만 둔다.

export const DRAFT_KEY = 'ilson.apply.draft.v1'

// 이 날짜가 지나면 되살리지 않는다.
//
// 두 주 전에 적다 만 것을 지금 꺼내 주면 도움이 아니라 방해다. 그때 무슨
// 생각으로 적었는지 본인도 기억 못 하고, 그 사이 상황이 바뀌었을 수 있다.
export const DRAFT_MAX_DAYS = 7

// 되살릴 값이 있다고 볼 기준.
//
// 부서만 골라 둔 것을 "적으시던 것이 있습니다"라고 꺼내 주면 성가시다.
// 사람이 실제로 글을 쓴 흔적이 있어야 한다.
const MEANINGFUL = ['title', 'bottleneck', 'problem', 'wish', 'impact_if_wrong']
const MIN_CHARS = 10

export function isWorthSaving(form) {
  if (!form) return false
  const written = MEANINGFUL.map((k) => String(form[k] ?? '').trim()).join('')
  return written.length >= MIN_CHARS
}

export function isExpired(savedAt, now = Date.now(), days = DRAFT_MAX_DAYS) {
  if (!savedAt) return true
  const age = now - new Date(savedAt).getTime()
  if (Number.isNaN(age)) return true
  // 미래에 저장된 것으로 적혀 있으면(시계가 틀어졌거나 손댄 것) 믿지 않는다.
  if (age < 0) return true
  return age > days * 24 * 60 * 60 * 1000
}

// 저장한다. 저장할 값이 없으면 전에 저장해 둔 것을 지운다 —
// 사람이 다 지웠는데 옛것이 남아 있으면 다음에 그게 되살아난다.
export function saveDraft(storage, form, now = Date.now()) {
  if (!storage) return false
  if (!isWorthSaving(form)) {
    clearDraft(storage)
    return false
  }
  try {
    storage.setItem(
      DRAFT_KEY,
      JSON.stringify({ savedAt: new Date(now).toISOString(), form })
    )
    return true
  } catch {
    // 브라우저가 저장을 막아 둔 경우(시크릿 창, 용량 초과). 신청 자체는
    // 계속돼야 하므로 조용히 넘어간다. 이건 거들어 주는 기능이다.
    return false
  }
}

export function loadDraft(storage, now = Date.now()) {
  if (!storage) return null
  let raw
  try {
    raw = storage.getItem(DRAFT_KEY)
  } catch {
    return null
  }
  if (!raw) return null

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    // 깨진 값이 남아 있으면 치운다. 그대로 두면 열 때마다 실패한다.
    clearDraft(storage)
    return null
  }

  if (!parsed?.form || !isWorthSaving(parsed.form)) {
    clearDraft(storage)
    return null
  }
  if (isExpired(parsed.savedAt, now)) {
    clearDraft(storage)
    return null
  }
  return { form: parsed.form, savedAt: parsed.savedAt }
}

export function clearDraft(storage) {
  if (!storage) return
  try {
    storage.removeItem(DRAFT_KEY)
  } catch {
    // 지우지 못해도 할 수 있는 것이 없다.
  }
}

// 언제 적던 것인지.
//
// "적으시던 것이 있습니다"만 보여 주면 사람은 그게 방금 것인지 저번 주
// 것인지 몰라 되살릴지 말지 못 정한다.
export function draftAge(savedAt, now = Date.now()) {
  const ms = now - new Date(savedAt).getTime()
  if (Number.isNaN(ms) || ms < 0) return '언제인지 알 수 없는'
  const min = Math.floor(ms / 60000)
  if (min < 1) return '조금 전'
  if (min < 60) return `${min}분 전`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}시간 전`
  return `${Math.floor(h / 24)}일 전`
}

// 되살릴 것이 무엇인지 한 줄로.
//
// 되살리기 전에 무엇이 되살아나는지 보여 준다. 눌러 놓고 엉뚱한 것이
// 채워지면 지금 적던 것까지 잃는다.
export function describeDraft(form) {
  const title = String(form?.title ?? '').trim()
  const filled = Object.entries(form ?? {}).filter(
    ([, v]) => String(v ?? '').trim() !== ''
  ).length
  if (title) return `"${title.slice(0, 40)}${title.length > 40 ? '…' : ''}" 외 ${filled}칸`
  return `${filled}칸을 적어 두셨습니다`
}
