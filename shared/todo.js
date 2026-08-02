// 담당자가 지금 무엇을 해야 하는가.
//
// 화면을 만들 때마다 그 화면이 "여기 볼 것이 있습니다"를 자기 안에서만
// 말한다. 접수함은 밀린 신청서를, 넘긴 뒤 화면은 신고를, 코드 화면은 아직
// 확인 안 한 것을. 그래서 담당자가 아침에 앉으면 여섯 화면을 돌아다녀야
// 오늘 뭘 할지 안다.
//
// 그러면 어떻게 되냐면, 안 돌아다닌다. 늘 열던 한 화면만 열고 나머지는
// 쌓인다. 이 사이트에서 가장 조용히 망가지는 자리가 그것이다.
//
// 여기서 전부 모아 한 줄로 세운다. 다만 **아무거나 다 올리지 않는다.**
// 스무 개가 올라온 목록은 아무것도 안 올라온 것과 같다.

// 급한 정도.
//
// 숫자가 틀리는 것이 가장 급하다. 그 다음이 사람을 기다리게 하는 것,
// 그 다음이 나중에 문제가 될 것.
export const URGENCY = { 금액: 3, 대기: 2, 정리: 1 }

// 이 밑으로는 목록에 안 올린다. 올려 봐야 안 읽는다.
const MAX_ITEMS = 12

function item(o) {
  return { rank: URGENCY[o.kind] ?? 1, ...o }
}

// 모아서 줄 세운다.
//
// 각 화면이 이미 세어 둔 숫자를 받아 쓴다. 여기서 다시 세지 않는다 —
// 두 군데서 세면 두 숫자가 달라지고, 그러면 둘 다 못 믿는다.
export function buildTodo({ overview, reports, codes, tools, stalls } = {}) {
  const out = []

  // ── 금액이 틀릴 수 있는 것 ──────────────────────────────
  const untrusted = reports?.summary?.urgent ?? 0
  if (untrusted > 0) {
    out.push(
      item({
        kind: '금액',
        key: 'untrusted_tool',
        title: `결과를 믿을 수 없다는 신고 ${untrusted}건`,
        why: '숫자가 틀린다는 신고가 살아 있는 동안은 그 도구가 낸 숫자를 보고에 쓰면 안 됩니다.',
        to: '/tools',
        cta: '신고 보기',
      })
    )
  }

  const unchecked = codes?.summary?.needsCheck ?? 0
  if (unchecked > 0) {
    out.push(
      item({
        kind: '금액',
        key: 'unchecked_codes',
        title: `부서가 알려준 상품코드 ${unchecked}개를 아직 안 보셨습니다`,
        why: '잘못 이어져 있으면 그 코드로 팔린 것이 전부 엉뚱한 상품 매출로 잡힙니다. 밀려난 줄과 달리 조용히 섞입니다.',
        to: '/codes',
        cta: '훑어보기',
      })
    )
  }

  // ── 사람을 기다리게 하는 것 ────────────────────────────
  const stale = overview?.counts?.stale ?? 0
  if (stale > 0) {
    out.push(
      item({
        kind: '대기',
        key: 'stale_applications',
        title: `하루 넘게 못 본 신청서 ${stale}건`,
        why: '부서는 낸 뒤로 아무 소식이 없는 상태입니다. 판정이 늦는 것보다 아무 말이 없는 것이 더 나쁩니다.',
        to: '/review',
        cta: '접수함 열기',
      })
    )
  }

  // 접수함에 안 뜨는 중간 단계에서 멈춘 것.
  //
  // 이미 판정해서 진행 중으로 넘어간 건은 어느 목록에도 안 뜬다. 그래서
  // 가장 조용히 늦는다. 앞 두 단계(신청서·검토)는 바로 위에서 이미 세고
  // 있으므로 여기서는 빼고 받는다.
  const stalled = stalls?.summary?.mineLater ?? 0
  if (stalled > 0) {
    out.push(
      item({
        kind: '대기',
        key: 'stalled',
        title: `중간 단계에서 오래 멈춘 신청서 ${stalled}건`,
        why: '판정까지 끝나 진행 중으로 넘어간 건들이라 접수함에도, 신고 목록에도 안 뜹니다. 아무 데도 안 뜨는 채로 몇 주가 지나갑니다.',
        to: '/stall',
        cta: '어디서 막혔는지 보기',
      })
    )
  }

  const idle = tools?.summary?.idle ?? 0
  if (idle > 0) {
    out.push(
      item({
        kind: '대기',
        key: 'idle_tools',
        title: `넘겨 놓고 아무도 안 쓰는 도구 ${idle}개`,
        why: '만든 것으로 끝난 도구입니다. 왜 안 쓰는지 물어보지 않으면 다음에도 같은 것을 만듭니다.',
        to: '/tools',
        cta: '어떤 도구인지 보기',
      })
    )
  }

  // ── 나중에 문제가 될 것 ────────────────────────────────
  const unconfirmed = tools?.summary?.unconfirmed ?? 0
  if (unconfirmed > 0) {
    out.push(
      item({
        kind: '정리',
        key: 'unconfirmed_handover',
        title: `받았다는 확인이 없는 도구 ${unconfirmed}개`,
        why: '넘겼다고 받은 것이 아닙니다. 확인이 없으면 나중에 "그런 거 받은 적 없다"가 됩니다.',
        to: '/tools',
        cta: '확인 요청하기',
      })
    )
  }

  const openReports = (reports?.summary?.open ?? 0) - untrusted
  if (openReports > 0) {
    out.push(
      item({
        kind: '정리',
        key: 'open_reports',
        title: `아직 못 고친 불편 신고 ${openReports}건`,
        why: '급하지는 않지만 쌓이면 부서가 도구를 안 쓰게 됩니다.',
        to: '/tools',
        cta: '보기',
      })
    )
  }

  // 부서가 사용법서에서 모르겠다고 짚은 곳.
  //
  // 지금은 사용법서 화면을 열어야만 보인다. 그런데 담당자는 다 쓴 뒤로
  // 그 화면을 안 연다 — 쓸 일이 끝났다고 생각하기 때문이다. 짚어 주신
  // 것이 거기서 조용히 쌓인다.
  const unclear = tools?.summary?.unclear ?? 0
  if (unclear > 0) {
    out.push(
      item({
        kind: '대기',
        key: 'unclear_manual',
        title: `사용법서에서 모르겠다고 짚힌 곳 ${unclear}곳`,
        why: '읽는 분이 막힌 자리입니다. 안 고치면 그 자리에서 다음 분도 막히고, 그때마다 전화가 옵니다.',
        to: '/manual',
        cta: '어디가 막히는지 보기',
      })
    )
  }

  const noManual = tools?.summary?.noManual ?? 0
  if (noManual > 0) {
    out.push(
      item({
        kind: '정리',
        key: 'no_manual',
        title: `사용법서 없이 넘긴 도구 ${noManual}개`,
        why: '넘긴 사람이 자리를 비우면 아무도 못 씁니다.',
        to: '/manual',
        cta: '사용법서 쓰기',
      })
    )
  }

  return out
    .sort((a, b) => b.rank - a.rank || a.key.localeCompare(b.key))
    .slice(0, MAX_ITEMS)
}

// 할 일이 없을 때 뭐라고 할 것인가.
//
// "할 일이 없습니다"로 끝내면 정말 없는 것인지 못 세고 있는 것인지 모른다.
// 무엇을 보고 없다고 하는지 밝힌다.
export const NOTHING_CHECKED = [
  '하루 넘게 못 본 신청서',
  '중간 단계에서 오래 멈춘 신청서',
  '결과가 이상하다는 신고',
  '아직 확인 안 한 상품코드',
  '아무도 안 쓰는 도구',
  '받았다는 확인이 없는 도구',
  '사용법서에서 모르겠다고 짚힌 곳',
]

export function todoSummary(items) {
  const list = items ?? []
  return {
    total: list.length,
    money: list.filter((i) => i.kind === '금액').length,
    waiting: list.filter((i) => i.kind === '대기').length,
    tidy: list.filter((i) => i.kind === '정리').length,
  }
}
