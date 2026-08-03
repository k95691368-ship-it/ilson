// 시험판을 써 본 부서가 막힌 곳을 직접 말한다.
//
// 조회 화면은 "시험판을 써 보고 막힌 곳을 알려주세요"라고 적어 두고,
// 정작 그 말을 적을 칸을 아무 데도 안 뒀다. 시험판 화면(/beta)은 담당자
// 것이라 부서 사람은 열 일이 없고, 도구 주소(/t/:slug)는 배포가 끝나야
// 생긴다 — 시험판은 배포 **앞** 단계다. 그래서 시키기만 하고 갈 곳이
// 없는 문장이 몇 주째 첫 화면에 떠 있었다.
//
// 수령 확인·성과 확인과 같은 자리에서 같은 방식으로 받는다. 접수번호를
// 아는 사람이 그 신청서의 부서라고 본다.

export const BETA_SAY_KINDS = [
  {
    code: '막힌곳',
    label: '여기서 막혔습니다',
    hint: '어느 화면에서 무엇을 하려다 막히셨는지 적어주세요.',
    // 막힌 곳은 사용법서의 "자주 묻는 것"이 되고, 그 자체로 다음 회차의
    // 고칠 목록이 된다. 그래서 기본값으로 둔다.
    urgent: true,
  },
  {
    code: '요청',
    label: '이것도 됐으면 합니다',
    hint: '지금 없어서 아쉬운 것을 적어주세요. 다 만들어 드리지는 못해도 기록에는 남습니다.',
    urgent: false,
  },
  {
    code: '의견',
    label: '그냥 느낀 점',
    hint: '쓰면서 걸리적거린 것이면 무엇이든 좋습니다.',
    urgent: false,
  },
  {
    code: '칭찬',
    label: '이건 좋았습니다',
    hint: '좋았던 것도 알아야 그걸 안 건드립니다.',
    urgent: false,
  },
]

export const MIN_BODY = 5
export const MIN_NAME = 2

export function kindOf(code) {
  return BETA_SAY_KINDS.find((k) => k.code === code) ?? null
}

export function validateBetaSay({ by, kind, body } = {}) {
  const errors = {}
  if (String(by ?? '').trim().length < MIN_NAME) {
    errors.by = '적어주신 분 성함을 적어주세요. 되물을 것이 생기면 그 성함으로 찾습니다.'
  }
  if (!kindOf(kind)) {
    errors.kind = '어떤 이야기인지 골라주세요.'
  }
  if (String(body ?? '').trim().length < MIN_BODY) {
    // "불편해요" 한 마디만 오면 담당자는 무엇을 고쳐야 할지 모른다.
    errors.body = '무슨 일이 있었는지 한 줄만 적어주세요. 이것만 있으면 고칠 수 있습니다.'
  }
  return errors
}

// 지금 이 신청서의 시험판 의견이 어떤 상태인가.
//
// 부서 쪽 화면이라 담당자 화면과 다른 것을 센다. 담당자는 "몇 건 남았나"를
// 보지만, 부서는 **내가 낸 것이 읽혔나**를 본다.
export function betaSayState({ round, says } = {}) {
  const list = says ?? []
  const open = list.filter((s) => !s.resolved_at)
  const answered = list.filter((s) => s.resolved_at)

  return {
    // 시험판을 아직 안 돌렸으면 물어볼 것이 없다.
    canSay: Boolean(round),
    round: round ? { seq: round.seq, overall: round.overall, at: round.created_at } : null,
    total: list.length,
    open: open.length,
    answered: answered.length,
    says: list,
  }
}

// 부서에게 뭐라고 말할 것인가.
export function betaSayHeadline(state) {
  if (!state?.canSay) return null
  if (state.total === 0) {
    return '시험판을 한 번 써 보시고, 걸리는 것이 있으면 적어주세요'
  }
  if (state.open > 0) {
    return `적어주신 ${state.total}건 중 ${state.open}건은 아직 답을 못 드렸습니다`
  }
  return `적어주신 ${state.total}건에 모두 답을 드렸습니다`
}

// 기계 채점이 통과여도 그것만으로는 통과가 아니라는 것을 말한다.
export function betaSayWhy(state) {
  if (state?.round?.overall === '통과') {
    return '기계 채점은 통과했습니다. 그런데 기계는 "쓰기 불편하다"를 채점하지 못합니다 — 그건 써 보신 분만 압니다.'
  }
  return '여기서 나온 말이 그대로 사용법서의 "자주 묻는 것"이 됩니다.'
}
