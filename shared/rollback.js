// 쓰던 도구를 내렸을 때 부서에게 무슨 말을 하는가.
//
// 담당자가 도구를 내리면 조회 화면에는 이 한 줄이 뜬다 —
// **"문제가 있어 잠시 내렸습니다."**
//
// 그게 전부다. 왜 내렸는지는 `rollback_reason` 칸에 저장되는데 조회 화면으로
// 안 간다. 언제 다시 올릴지도, 그동안 어떻게 해야 하는지도 아무 말이 없다.
//
// 부서 입장에서 보면 이렇다. 어제까지 그 도구로 정산서를 만들었는데 오늘
// 안 열린다. 조회 화면을 열면 "문제가 있어 잠시 내렸습니다" 한 줄. **그래서
// 전화한다.** 이 사이트가 없애려는 것이 정확히 그 전화다.
//
// 그리고 이건 이 사이트에서 가장 급한 상황인데 가장 말이 없던 자리다.
// 다른 것들(판정이 늦다, 확인이 안 됐다)은 기다리면 되지만, 이건 부서가
// **지금 일을 못 하고 있는** 것이다.

// 고쳐서 다시 올린 기록.
//
// 되돌리는 길은 있는데 다시 올리는 길이 없었다. 정확히는 있었는데 아무도
// 몰랐다 — 넘기기 폼이 저장될 때 rolled_back_at 을 조용히 지웠고 그 버튼
// 이름이 "고치기"였다. 그게 두 방향으로 나빴다. 다시 올리려는 사람은 그
// 방법을 모르고, 메모 한 줄만 고치려던 사람은 자기도 모르게 부서에게 다시
// 열어 준다.
export const RESTORE_KIND = '다시올림'

// 다시 올릴 때 무엇을 받아야 하는가.
//
// "고쳤습니다" 한 마디로 다시 열면 부서는 안 쓴다. 한 번 틀린 숫자를 낸
// 도구이므로, 무엇이 달라졌는지를 알아야 다시 손을 댄다.
export function validateRestore({ fixed } = {}) {
  const errors = {}
  if (String(fixed ?? '').trim().length < 5) {
    errors.fixed = '무엇을 고치셨는지 적어주세요. 부서가 이걸 보고 다시 씁니다.'
  }
  return errors
}

// 다시 올라온 도구가 부서에게 할 말.
//
// 복구 라우트는 "다시 올렸습니다. 부서 도구 화면에 무엇을 고쳤는지 함께
// 뜹니다"라고 답한다. 그런데 도구 화면이 그 기록을 안 읽어서 아무것도 안
// 떴다. 라이브에서 되돌렸다 올려 보고 알았다.
//
// 부서 쪽에서 보면 이렇다. 틀린 숫자를 낸 도구를 겪었고, 며칠 못 썼고,
// 어느 날 그냥 다시 열려 있다. 무엇이 달라졌는지는 아무 데도 없다. 그러면
// 안 쓴다 — 원래 하던 손 작업으로 돌아가고, 그 사실을 아무도 모른다.
//
// 몇 번째인지도 같이 말한다. 두 번 세 번 내려간 도구라면 부서가 그것까지
// 알고 판단할 일이다. 감추면 다음번에 더 크게 잃는다.
export function lastRestore(rows) {
  const list = (Array.isArray(rows) ? rows : []).filter((r) => r?.link_kind === RESTORE_KIND)
  // 마지막 것을 쓴다. find() 로 첫 줄을 잡으면 예전에 고친 내용이 뜬다.
  const last = list.at(-1)
  if (!last) return null
  return {
    count: list.length,
    // 담당자가 적은 그대로. 다듬으면 부서가 읽는 것과 기록이 달라진다.
    fixed: last.what ?? null,
    why: last.why ?? null,
    at: last.created_at ?? null,
  }
}

// 내린 지 얼마나 됐으면 담당자를 짚어야 하는가.
//
// 내려 두고 잊는 것이 최악이다. 부서는 "고쳐 주겠지" 하고 기다리는데
// 담당자 화면에는 그 도구가 아예 안 보인다 — 넘긴 목록에서도 빠지기
// 때문이다. 조용히 사라진다.
export const STALE_DAYS = 3

export function rollbackState({ handover, now } = {}) {
  const at = handover?.rolled_back_at ?? null
  if (!at) return { down: false, days: null, reason: null, stale: false }

  const days = daysBetween(at, now)
  return {
    down: true,
    at,
    days,
    // 왜 내렸는지. 담당자가 적은 그대로 보여준다 — 다듬으면 부서가 읽는
    // 것과 기록에 남은 것이 달라진다.
    reason: handover.rollback_reason ?? null,
    stale: days != null && days >= STALE_DAYS,
  }
}

function daysBetween(from, now) {
  const a = Date.parse(`${String(from).replace(' ', 'T')}Z`)
  const b = typeof now === 'number' ? now : Date.parse(`${String(now ?? '').replace(' ', 'T')}Z`)
  const end = Number.isFinite(b) ? b : Date.now()
  if (!Number.isFinite(a)) return null
  return Math.max(0, Math.floor((end - a) / 86400000))
}

// 부서에게 뭐라고 말할 것인가.
export function rollbackHeadline(s) {
  if (!s?.down) return null
  if (s.days === 0) return '쓰시던 도구를 오늘 내렸습니다'
  return `쓰시던 도구를 내린 지 ${s.days}일 됐습니다`
}

// 그동안 어떻게 해야 하는가.
//
// **여기서 "곧 고치겠습니다"라고 하지 않는다.** 언제 올릴지 모르면서 곧
// 이라고 하면, 부서는 그 말을 믿고 기다리다가 두 번 손해를 본다 — 도구도
// 없고 대비도 안 한 채로.
export function rollbackWhatNow(s) {
  if (!s?.down) return null
  const base =
    '그동안은 이 일을 원래 하시던 방식으로 해주셔야 합니다. 죄송합니다 — 잘못 넘긴 것을 그대로 두는 것보다는 낫다고 판단했습니다.'
  if (s.stale) {
    // 오래 내려가 있으면 그것도 사실대로 말한다. 부서가 언제까지 기다려야
    // 할지 모르는 채로 두는 것이 가장 나쁘다.
    return `${base} 내려간 지 ${s.days}일이 지났습니다. 이만큼 걸리고 있다면 담당자에게 다시 여쭤보셔도 됩니다 — 저희 쪽에서 놓치고 있는 것일 수 있습니다.`
  }
  return base
}

// rollbackNudge() 가 여기 있었다. 담당자에게 "내려 둔 채 잊은 도구"를
// 알리는 함수인데, shared/todo.js 가 같은 규칙을 따로 구현해 두고 그쪽만
// 화면에 걸려 있었다. 두 벌이 있으면 한쪽만 고치는 날 두 화면이 다른
// 숫자를 말한다. 쓰이는 쪽을 남기고 이쪽을 지운다.
