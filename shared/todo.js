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
export function buildTodo({ overview, reports, codes, tools, stalls, joins, signoffs } = {}) {
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

  // 부서가 "그 숫자는 체감과 다릅니다"라고 한 것.
  //
  // 이 사이트는 "만든 사람만 아는 성과는 성과가 아니다"라고 여러 화면에서
  // 말한다. 그런데 부서가 실제로 아니라고 했을 때 그 말이 성과 화면 안에만
  // 남으면, 담당자는 그 화면을 열 때까지 모른다. 그 사이에 금액은 보고에
  // 올라간다.
  const disagreed = overview?.deptDisagrees ?? 0
  if (disagreed > 0) {
    out.push(
      item({
        kind: '금액',
        key: 'dept_disagrees',
        title: `부서가 "그렇게 안 걸린다"고 한 성과 ${disagreed}건`,
        why: '저희가 잰 값 위에서 절감액을 계산했는데 부서는 다르다고 했습니다. 다시 재기 전까지 그 금액은 보수적 추정입니다.',
        to: '/result',
        cta: '얼마나 다른지 보기',
      })
    )
  }

  // 부서가 "못 쓰겠습니다"라고 한 도구.
  //
  // 이 사이트는 부서에게 "안 맞으면 안 맞는다고 눌러주셔도 됩니다"라고
  // 적어 뒀다. 부서가 그대로 했다 — 버튼을 누르고 무엇이 안 맞는지까지
  // 적어 줬다. 그런데 그 말이 담당자 화면 어디에도 안 왔다.
  //
  // 도구가 그냥 안 쓰이는 것과, **못 쓴다고 말까지 해 준 것**은 다르다.
  // 뒤엣것을 놓치면 그 부서는 다음부터 아무 버튼도 안 누른다.
  const rejected = tools?.summary?.rejected ?? 0
  if (rejected > 0) {
    out.push(
      item({
        kind: '금액',
        key: 'tool_rejected',
        title: `부서가 "못 쓰겠다"고 한 도구 ${rejected}개`,
        why: '무엇이 안 맞는지까지 적어 주셨습니다. 그동안 그 부서는 원래 하던 방식으로 일하고 있습니다.',
        to: '/tools',
        cta: '무엇이 안 맞는지 보기',
      })
    )
  }

  // 내려 둔 채 잊은 도구.
  //
  // 부서가 쓰던 것을 내렸다는 것은 **그 부서가 지금 일을 못 하고 있다**는
  // 뜻이다. 그런데 내린 도구는 넘긴 목록에서도 빠져서 화면 어디에도 안
  // 보인다. 부서는 "고쳐 주겠지" 하고 기다리고, 담당자 화면에는 그 도구가
  // 아예 없다. 조용히 사라지는 자리라 금액 급으로 올린다.
  const downStale = tools?.summary?.downStale ?? 0
  if (downStale > 0) {
    out.push(
      item({
        kind: '금액',
        key: 'tool_down_stale',
        title: `내려 둔 채 사흘이 지난 도구 ${downStale}개`,
        why: '내린 도구는 넘긴 목록에서도 빠져서 화면 어디에도 안 보입니다. 그동안 그 부서는 원래 하던 방식으로 일하고 있습니다.',
        to: '/tools',
        cta: '어느 것인지 보기',
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
  //
  // 되물어서 답을 받은 것은 바로 위에서 이미 올렸다. 여기서 또 세면 같은
  // 신청서가 한 화면에 두 번 뜬다 — "답이 온 것 1건"과 "하루 넘게 못 본 것
  // 4건"에 같은 건이 들어 있고, 담당자는 두 가지 일인 줄 안다.
  //
  // 이 목록의 값어치는 짧다는 데 있다. 스무 개가 올라온 목록은 아무것도
  // 안 올라온 것과 같고, 그중 겹치는 것이 있으면 나머지도 못 믿는다.
  // `answered` 를 여기서 다시 읽는다. 아래에서 선언한 것을 쓰면 TDZ에
  // 걸린다 — 같은 실수로 /api/overview 가 통째로 503이 나서 첫 화면이
  // 안 열린 적이 있다.
  const stale = Math.max(0, (overview?.counts?.stale ?? 0) - (overview?.answered ?? 0))
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

  // 다른 부서가 손든 신청서.
  //
  // 처음 판정할 때는 한 부서 일인 줄 알고 점수를 매겼다. 두 부서가 손들면
  // 같은 신청서인데 크기가 몇 배가 된다. 그런데 손든 사실은 그 신청서를
  // 열어야만 보이고, 담당자는 이미 판정한 건을 다시 열지 않는다.
  const rejoined = joins?.summary?.needsRepriority ?? 0
  if (rejoined > 0) {
    out.push(
      item({
        kind: '대기',
        key: 'rejoined',
        title: `다른 부서가 손든 신청서 ${rejoined}건`,
        why: '판정하실 때는 한 부서 일이었습니다. 여러 부서가 걸린 일이면 순서가 달라집니다.',
        to: '/review',
        cta: '우선순위 다시 보기',
      })
    )
  }

  // 손든 부서 사정이 아직 협의안에 안 들어온 것.
  //
  // 위의 '손든 신청서'와 겹치지 않는다. 저건 아직 판정 전인 건이고,
  // 이건 판정이 끝나 협의 중인 건이다. 한 신청서가 두 줄에 동시에 뜨면
  // 목록이 두 배로 길어 보이고, 그러면 아무도 안 읽는다.
  const notFiled = joins?.summary?.notInAgreement ?? 0
  if (notFiled > 0) {
    out.push(
      item({
        kind: '대기',
        key: 'join_not_in_agreement',
        title: `손든 부서 사정이 협의안에 안 들어온 신청서 ${notFiled}건`,
        why: '지금 합의하시는 그 기준을, 손든 부서는 다 만들어진 뒤에 처음 봅니다. 그때 아니라고 해도 되돌리기엔 늦습니다.',
        to: '/agreement',
        cta: '협의안 열기',
      })
    )
  }

  // 부서가 단 합격 기준 이의.
  //
  // 이의는 담당자만 풀 수 있는데, 알리는 길이 없었다 — 협의안 화면에서
  // 그 신청서를 골라 아래로 내려가야만 보였다. 그러면 부서는 답을 기다리다
  // "말해 봐야 소용없다"로 끝나고, 다음부터 서명 자체를 안 한다.
  //
  // 금액 쪽에 놓지 않은 이유: 이의가 있다고 숫자가 틀리지는 않는다.
  // 다만 사람이 답을 기다리고 있다.
  const objections = signoffs?.summary?.applications ?? 0
  if (objections > 0) {
    out.push(
      item({
        kind: '대기',
        key: 'open_objections',
        title: `부서가 합격 기준에 이의를 단 신청서 ${objections}건`,
        why: '이의는 담당자만 푸실 수 있습니다. 안 풀면 그 기준으로 낸 통과에 계속 단서가 붙고, 그 부서는 다음부터 확인을 안 해줍니다.',
        to: '/agreement',
        cta: '이의 보기',
      })
    )
  }

  // 되물었고 답을 받았는데 아직 판정 안 한 것.
  //
  // 담당자가 막혀서 되물었던 건이다. 답이 오면 막고 있던 것이 없어졌는데,
  // 지금까지는 "답 기다리는 중" 배지가 조용히 사라지는 것이 전부였다.
  // 한 번도 안 물어본 신청서와 화면에서 구분이 안 됐다.
  //
  // 부서는 시간을 써서 답해 줬다. 그걸 놓치면 다음부터 "답해 봐야
  // 소용없다"를 배운다.
  const answered = overview?.answered ?? 0
  if (answered > 0) {
    out.push(
      item({
        kind: '대기',
        key: 'answered_ready',
        title: `되물은 것에 답이 온 신청서 ${answered}건`,
        why: '막고 있던 것이 없어졌습니다. 이제 판정하실 수 있습니다 — 부서는 답해 놓고 기다리고 있습니다.',
        to: '/review',
        cta: '판정하기',
      })
    )
  }

  // 하기로 해 놓고 순서를 안 정한 채 여럿이 기다리는 상태.
  //
  // 순서를 안 정하는 것 자체는 잘못이 아니다. 한 건만 있으면 정할 것도 없다.
  // 다만 여럿이 기다리는데 안 정하면, 부서 조회 화면은 "아직 순서를 정하지
  // 않았습니다"라고 그대로 적는다. 그걸 읽은 부서가 다음에 물어볼 때 댈 말이
  // 없다.
  const unranked = overview?.unranked ?? 0
  if (unranked > 0) {
    out.push(
      item({
        kind: '대기',
        key: 'unranked_queue',
        title: `하기로 한 ${unranked}건이 순서 없이 기다립니다`,
        why: '부서 조회 화면에 "아직 순서를 정하지 않았습니다"라고 그대로 적힙니다. 무엇을 먼저 할지 정하면 그 이유까지 부서가 읽습니다.',
        to: '/priority',
        cta: '순서 정하기',
      })
    )
  }

  // 보류 조건이 풀렸다고 부서가 알려 온 것.
  //
  // 보류는 이 사이트에서 **아무도 안 움직이면 영원히 그대로**인 유일한
  // 상태다. 반려는 끝난 것이고 진행 중인 것은 다음 단계가 있는데, 보류는
  // 누가 먼저 말하지 않으면 그냥 묻힌다. 그래서 부서가 큰맘 먹고 알린 것을
  // 놓치면 다음부터 그 부서는 아무것도 안 알린다.
  const lifted = overview?.holdLiftWaiting ?? 0
  if (lifted > 0) {
    out.push(
      item({
        kind: '대기',
        key: 'hold_lifted',
        title: `보류 조건이 풀렸다고 알려 온 것 ${lifted}건`,
        why: '조건이 풀린 것은 부서만 압니다. 알려 왔는데 다시 판정하지 않으면, 그 부서는 다음부터 알리지 않습니다.',
        to: '/review',
        cta: '다시 판정하기',
      })
    )
  }

  // 부서가 시험판을 써 보고 적어 준 것.
  //
  // 이건 부서가 자기 시간을 써서 답해 준 것이다. 답을 안 하면 다음번에는
  // 안 적어 주고, 그러면 기계 채점만 남는다.
  const betaOpen = overview?.betaUnanswered ?? 0
  if (betaOpen > 0) {
    out.push(
      item({
        kind: '대기',
        key: 'beta_unanswered',
        title: `시험판 써 보고 적어 주신 것 ${betaOpen}건에 아직 답을 안 하셨습니다`,
        why: '부서가 자기 시간을 써서 적어 준 것입니다. 답이 없으면 다음 시험판에는 아무도 안 적어 줍니다.',
        to: '/beta',
        cta: '읽고 답하기',
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
  '다른 부서가 손든 신청서',
  '손든 부서 사정이 협의안에 안 들어온 신청서',
  '부서가 합격 기준에 단 이의',
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
