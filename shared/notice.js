// 신청서를 낸 부서에게 무슨 일이 있었는지 알린다.
//
// 부서 담당자는 신청서를 내고 나면 깜깜하다. 조회 화면이 있어도 여덟 단계
// 타임라인을 눈으로 훑어 "지난번이랑 뭐가 달라졌지"를 찾아야 한다. 그건
// 알림이 아니라 그냥 조회다.
//
// 두 가지를 나눠서 준다.
//   - 해주실 일  : 지금 이 사람이 움직여야 진행되는 것. 맨 위에 둔다.
//   - 그동안의 소식 : 이미 일어난 일. 최근 것부터.
//
// 소식을 따로 표에 쌓지 않고 이미 남아 있는 기록에서 뽑아낸다. 표를 따로
// 두면 기록과 소식이 언젠가 어긋난다 — 기록은 고쳤는데 소식은 안 고친 채로
// 남는 식으로. 뽑아 쓰면 어긋날 수가 없고, 이미 진행된 신청서에도 그대로
// 적용된다.

import { RESUBMIT_KIND, RESUBMIT_BACK_KIND } from './resubmit.js'
import { JOIN_KIND, UNJOIN_KIND } from './join.js'
import { withJosa } from './korean.js'

// 소식으로 삼을 만한 단계인가.
//
// '대기'는 소식이 아니다. 아무 일도 안 일어났다는 것을 알리는 것은
// 알림이 아니라 소음이다.
function happened(t) {
  return t.status !== '대기' && Boolean(t.at)
}

const HEADLINE = {
  신청서: () => '신청서를 접수했습니다',
  검토: (t) =>
    t.summary?.startsWith('반려')
      ? '검토 결과 — 이번에는 만들지 않기로 했습니다'
      : t.summary?.startsWith('보류')
        ? '검토 결과 — 조건이 풀릴 때까지 보류합니다'
        : '검토를 마쳤습니다 — 만들기로 했습니다',
  협의안: () => '무엇을 만들지 정했습니다',
  제작: () => '만들기 시작했습니다',
  베타테스트: (t) =>
    t.summary?.includes('차단')
      ? '시험에서 걸러진 것이 있어 고치는 중입니다'
      : t.summary?.includes('통과')
        ? '시험을 통과했습니다'
        : '시험 중입니다',
  사용법서: () => '사용법서를 썼습니다',
  배포: (t) =>
    t.status === '되돌림'
      ? '문제가 있어 잠시 내렸습니다'
      : t.status === '완료'
        ? '넘겨받으신 것을 확인해 주셨습니다'
        : '만든 것을 부서로 넘겼습니다',
  성과: (t) => (t.status === '완료' ? '성과를 확인해 주셨습니다' : '넘긴 뒤 실제로 쓰이고 있습니다'),
}

// 반려된 신청서를 고쳐서 다시 낸 것.
//
// 이건 여덟 단계 타임라인에 안 나온다. 한 신청서 안에서 일어난 일이 아니라
// 두 신청서 사이에서 일어난 일이기 때문이다. 그래서 기록에서 따로 뽑는다.
//
// 안 뽑으면 어떻게 되냐면, 부서가 앞 접수번호를 다시 열었을 때 "반려했습니다"
// 에서 이야기가 끊긴다. 자기가 고쳐 낸 것이 어디 갔는지 알 수가 없다.
function resubmitNotices(track) {
  return (track?.decisions ?? [])
    .filter((d) => d.link_kind === RESUBMIT_KIND || d.link_kind === RESUBMIT_BACK_KIND)
    .map((d) => {
      const forward = d.link_kind === RESUBMIT_BACK_KIND
      return {
        // 단계 이름을 열쇠로 쓰면 접수 소식과 부딪친다.
        key: `resubmit:${d.id}`,
        stage: '신청서',
        at: d.created_at,
        headline: forward
          ? '고쳐서 다시 내셨습니다'
          : '앞에 반려된 신청서를 고쳐서 내신 것입니다',
        body: forward ? `바꾸신 점 — ${d.what}` : d.what,
        detail: null,
        link: d.link_ticket ? `/track?no=${d.link_ticket}` : null,
        linkLabel: forward ? '새 신청서 보기' : '앞 신청서 보기',
      }
    })
}

// 다른 부서가 "우리도 같은 일을 겪는다"고 손든 것.
//
// 손들면 그 자리에서 고맙다는 말은 나가는데, **그 뒤로 아무것도 안 보인다.**
// 손든 부서는 자기가 붙였다는 사실이 남아 있는지도 모르고, 담당자가
// "이건 다른 건입니다"로 풀어 버려도 알 길이 없다. 그러면 그 부서는
// 이 건이 자기 것도 해결해 줄 줄 알고 몇 주를 기다리다가, 다 만들어진
// 뒤에야 자기 것은 아니었다는 것을 안다.
//
// 푼 것을 특히 크게 알려야 한다. 그때는 **따로 내셔야 한다**는 말이
// 그 부서에 가야 한다.
function joinNotices(track) {
  const rows = track?.decisions ?? []
  const released = new Set(
    rows.filter((d) => d.link_kind === UNJOIN_KIND).map((d) => d.link_id)
  )

  const out = []
  for (const d of rows) {
    if (d.link_kind === JOIN_KIND) {
      const gone = released.has(d.id)
      out.push({
        key: `join:${d.id}`,
        stage: '신청서',
        at: d.created_at,
        headline: gone
          ? `${withJosa(deptOf(d), '가')} 붙였던 것은 다른 건으로 판정됐습니다`
          : `${deptOf(d)}도 같은 일을 겪는다고 붙였습니다`,
        body: d.what,
        detail: null,
        link: gone ? '/apply' : null,
        linkLabel: gone ? '따로 신청서 내기' : null,
      })
    }
    if (d.link_kind === UNJOIN_KIND) {
      out.push({
        key: `unjoin:${d.id}`,
        stage: '신청서',
        at: d.created_at,
        // 이게 가장 중요한 소식이다. 안 알리면 그 부서는 이 건이 자기
        // 것도 해결해 줄 줄 알고 계속 기다린다.
        headline: '이 건은 그쪽 일과 다른 것으로 판정됐습니다',
        body: `${d.what} — 그쪽 병목은 따로 신청서를 내 주셔야 합니다.`,
        detail: null,
        link: '/apply',
        linkLabel: '따로 신청서 내기',
      })
    }
  }
  return out
}

function deptOf(d) {
  try {
    return JSON.parse(d.alternatives || d.why).dept || '다른 부서'
  } catch {
    return String(d.title ?? '').split(' — ')[0] || '다른 부서'
  }
}

export function noticesFrom(track) {
  const timeline = track?.timeline ?? []
  const notices = timeline.filter(happened).map((t) => ({
    // 같은 단계는 한 번만 나온다. 화면에서 목록 열쇠로 쓴다.
    key: t.stage,
    stage: t.stage,
    at: t.at,
    headline: (HEADLINE[t.stage] ?? (() => t.stage))(t),
    body: t.summary,
    // 판정 이유·대안처럼 접어 둘 것
    detail: t.detail ?? null,
    link: t.link ?? null,
  }))

  notices.push(...resubmitNotices(track))
  notices.push(...joinNotices(track))

  // 최근 것이 위로. 알림은 옛날 것부터 읽는 물건이 아니다.
  notices.sort((a, b) => String(b.at ?? '').localeCompare(String(a.at ?? '')))
  return notices
}

// 지금 이 부서가 움직여야 진행되는 것.
//
// 서버가 넘겨준 needs를 사람이 읽을 문장으로 바꾼다. 무엇을 해달라는지와
// **왜 그게 필요한지**를 같이 적는다. 이유 없이 시키면 아무도 안 한다.
const ACTION_TEXT = {
  handover_unconfirmed: {
    headline: '넘겨드린 것을 받으셨는지 확인해주세요',
    body: '주소를 열면 맨 위에 확인 칸이 있습니다. 한 번 돌려 보시고 받았다고 눌러주세요. 안 맞으면 안 맞는다고 눌러주셔도 됩니다.',
    why: '넘겼다고 받은 것이 아닙니다. 확인이 없으면 저희는 이게 실제로 쓰이는지 알 수 없습니다.',
  },
  outcome_unconfirmed: {
    headline: '정리한 성과가 맞는지 봐주세요',
    // 갈 곳을 안 적으면 시키기만 하고 끝난다. 이 화면 아래에 칸이 있다.
    body: '이 화면 아래에 "저희는 몇 분으로 재 두었습니다"가 적혀 있습니다. 체감과 다르면 실제로 몇 분쯤 걸리는지만 적어주세요.',
    why: '만든 사람만 아는 성과는 성과가 아닙니다. 부서가 아니라고 하면 아닌 것입니다.',
  },
  // 쓰던 도구가 내려가 있다. 이 사이트에서 가장 급한 상황인데 지금까지
  // 가장 말이 없던 자리다 — "문제가 있어 잠시 내렸습니다" 한 줄이 전부였다.
  tool_down: {
    headline: '쓰시던 도구를 잠시 내렸습니다',
    body: null, // 왜 내렸는지를 서버에서 받아 채운다
    why: '그동안은 원래 하시던 방식으로 해주셔야 합니다. 죄송합니다 — 잘못 넘긴 것을 그대로 두는 것보다는 낫다고 판단했습니다. 다시 올리면 이 화면에 뜹니다.',
  },
  hold_condition: {
    headline: '보류 조건이 풀리면 알려주세요',
    body: null, // 조건 문장을 서버에서 받아 채운다
    why: '조건이 풀렸는데 저희가 모르면 이 신청서는 그대로 묻힙니다.',
  },
  beta_feedback: {
    headline: '시험판을 써 보고 막힌 곳을 알려주세요',
    // 예전에는 이 말만 적어 두고 적을 칸을 아무 데도 안 뒀다. /beta는
    // 담당자 화면이고, 도구 주소는 배포가 끝나야 생긴다.
    body: '기계 채점은 통과했지만, 실제로 쓰기 불편하면 통과한 게 아닙니다. 이 화면 아래에 적는 칸이 있습니다.',
    why: '여기서 나온 말이 그대로 사용법서의 "자주 묻는 것"이 됩니다.',
  },
  criteria_signoff: {
    headline: '합격 기준을 한 번 봐주세요',
    body: null,
    why: '이 기준으로 시험하고 통과·불통과를 판정합니다. 안 보신 채로 넘어가면, 나중에 "내가 원한 건 이게 아닌데"라고 하셔도 저희는 "기준을 통과했습니다"라고밖에 답할 수 없습니다.',
  },
  refused_alternative: {
    headline: '반려했지만 대신 해볼 수 있는 것을 적어 뒀습니다',
    body: null,
    why: '만들지 못한다는 말만 하고 끝내면 병목은 그대로 남습니다.',
  },
}

export function actionsFrom(track) {
  const needs = track?.needs ?? []
  return needs
    .map((n) => {
      const t = ACTION_TEXT[n.code]
      if (!t) return null
      return {
        code: n.code,
        headline: t.headline,
        body: n.body ?? t.body,
        why: t.why,
        link: n.link ?? null,
      }
    })
    .filter(Boolean)
}

// 지난번 이 브라우저에서 본 뒤로 새로 생긴 것.
//
// 서버에 "읽음"을 저장하지 않는다. 이 사이트는 부서 담당자에게 계정을
// 만들게 하지 않기로 했고, 계정이 없으면 누가 읽었는지 구분할 방법이 없다.
// 접수번호 단위로 서버에 저장하면 담당자가 열어 본 것까지 신청자가 읽은
// 것으로 처리된다. 그건 틀린 기록이다.
//
// 그래서 브라우저에만 남긴다. "이 브라우저에서 마지막으로 본 시각"은
// 정확히 그 뜻이고, 화면에도 그렇게 적는다.
export function newSince(notices, lastSeen) {
  if (!lastSeen) return []
  return (notices ?? []).filter((n) => String(n.at ?? '') > String(lastSeen))
}

export const SEEN_PREFIX = 'ilson:seen:'

export function seenKey(ticket) {
  return `${SEEN_PREFIX}${String(ticket ?? '').toUpperCase()}`
}

// 결정 기록의 "왜"에 사람이 읽을 말이 들어 있는가.
//
// 한동안 손들기 기록의 why 칸에 JSON을 넣어 뒀다. 그래서 첫 화면
// "최근 결정"과 /log에 {"dept":"재무",...}가 통째로 찍혔다. 이 사이트가
// 스스로 핵심 증거라고 내세운 자리다.
//
// 쓰는 쪽은 고쳤지만 이미 쌓인 기록은 그대로 있다. decision_log는 일부러
// 못 지우게 만든 표라 지울 수도 없다. 그리는 쪽에서 걸러 준다.
export function readableWhy(why) {
  const t = String(why ?? '').trim()
  if (!t) return null
  if (t.startsWith('{') || t.startsWith('[')) return null
  return t
}
