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
    body: '주소를 열어 한 번 돌려 보시고, 쓸 만하면 받았다고 눌러주세요.',
    why: '넘겼다고 받은 것이 아닙니다. 확인이 없으면 저희는 이게 실제로 쓰이는지 알 수 없습니다.',
  },
  outcome_unconfirmed: {
    headline: '정리한 성과가 맞는지 봐주세요',
    body: '얼마나 줄었다고 적었는지 보시고, 실제 체감과 다르면 그대로 알려주세요.',
    why: '만든 사람만 아는 성과는 성과가 아닙니다. 부서가 아니라고 하면 아닌 것입니다.',
  },
  hold_condition: {
    headline: '보류 조건이 풀리면 알려주세요',
    body: null, // 조건 문장을 서버에서 받아 채운다
    why: '조건이 풀렸는데 저희가 모르면 이 신청서는 그대로 묻힙니다.',
  },
  beta_feedback: {
    headline: '시험판을 써 보고 막힌 곳을 알려주세요',
    body: '기계 채점은 통과했지만, 실제로 쓰기 불편하면 통과한 게 아닙니다.',
    why: '여기서 나온 말이 그대로 사용법서의 "자주 묻는 것"이 됩니다.',
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
