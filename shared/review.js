// 2단계 검토의 규칙. 순수 함수로 두어 서버와 화면이 같은 규칙을 쓴다.

import { OUT_OF_SCOPE } from './blockTypes.js'

export const VERDICTS = ['수용', '반려', '보류']

export const REFUSE_CODES = [...OUT_OF_SCOPE.map((o) => o.code), 'other']

export const REFUSE_LABELS = Object.fromEntries([
  ...OUT_OF_SCOPE.map((o) => [o.code, o.label]),
  ['other', '그 밖의 사유'],
])

// 1~5 척도에 말을 붙여 둔다. 숫자만 있으면 매기는 사람마다 기준이 달라지고,
// 나중에 자기가 왜 3을 줬는지도 기억하지 못한다.
export const IMPACT_SCALE = [
  { score: 1, label: '한 사람이 가끔', detail: '없어져도 조직이 체감하지 못한다' },
  { score: 2, label: '한 사람이 자주', detail: '그 사람의 시간은 확실히 줄어든다' },
  { score: 3, label: '한 팀이 자주', detail: '팀 단위로 시간이 줄고 실수가 준다' },
  { score: 4, label: '여러 부서가 결과를 쓴다', detail: '이 산출물로 다른 팀이 결정을 내린다' },
  { score: 5, label: '틀리면 되돌릴 수 없다', detail: '외부 보고·정산·규제에 닿아 있다' },
]

export const DIFFICULTY_SCALE = [
  { score: 1, label: '규칙이 명확하다', detail: '입력도 출력도 정해져 있다' },
  { score: 2, label: '예외가 조금 있다', detail: '대부분 규칙으로 풀리고 몇 건만 사람이 본다' },
  { score: 3, label: '원천이 여럿이다', detail: '포맷이 서로 다른 것을 맞춰야 한다' },
  { score: 4, label: '판단이 섞여 있다', detail: '규칙만으로 안 되고 사람의 기준이 필요하다' },
  { score: 5, label: '자료 자체가 없다', detail: '만들기 전에 없는 자료부터 만들어야 한다' },
]

const MIN_REASON = 20

function text(value) {
  return String(value ?? '').trim()
}

function toScore(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  if (n < 1 || n > 5) return null
  return Math.round(n * 2) / 2
}

// 통과하면 { ok: true, value }, 아니면 { ok: false, errors }.
export function validateReview(input) {
  const errors = {}

  const impact = toScore(input.impact_score)
  const difficulty = toScore(input.difficulty_score)
  const v = {
    impact_reason: text(input.impact_reason),
    difficulty_reason: text(input.difficulty_reason),
    verdict: text(input.verdict),
    verdict_reason: text(input.verdict_reason),
    alternatives_considered: text(input.alternatives_considered),
    refuse_code: text(input.refuse_code),
    refuse_alternative: text(input.refuse_alternative),
    hold_until_condition: text(input.hold_until_condition),
    reviewer_label: text(input.reviewer_label) || 'AX 담당자',
  }

  if (impact == null) errors.impact_score = '임팩트를 1~5 사이에서 골라주세요.'
  if (difficulty == null) errors.difficulty_score = '난이도를 1~5 사이에서 골라주세요.'

  if (v.impact_reason.length < MIN_REASON) {
    errors.impact_reason = `왜 그 점수인지 ${MIN_REASON}자 이상 적어주세요. 점수만 남으면 나중에 근거를 알 수 없습니다.`
  }
  if (v.difficulty_reason.length < MIN_REASON) {
    errors.difficulty_reason = `왜 그 점수인지 ${MIN_REASON}자 이상 적어주세요.`
  }

  if (!VERDICTS.includes(v.verdict)) errors.verdict = '판정을 골라주세요.'
  if (v.verdict_reason.length < MIN_REASON) {
    errors.verdict_reason = `판정 근거를 ${MIN_REASON}자 이상 적어주세요. 근거 없는 판정은 판정이 아닙니다.`
  }
  if (v.alternatives_considered.length < MIN_REASON) {
    errors.alternatives_considered = `무엇을 고르지 않았는지 ${MIN_REASON}자 이상 적어주세요. 대안을 적어야 판단이 판단이 됩니다.`
  }

  if (v.verdict === '반려') {
    if (!REFUSE_CODES.includes(v.refuse_code)) {
      errors.refuse_code = '무엇이 범위 밖인지 골라주세요.'
    }
    if (v.refuse_alternative.length < MIN_REASON) {
      // "안 됩니다"만 돌려보내면 그 부서는 다시 신청하지 않는다.
      errors.refuse_alternative =
        '대신 무엇을 해 드릴 수 있는지 적어주세요. 정말 없으면 "이 요청은 다른 도구로 가야 합니다"라고 적으시면 됩니다.'
    }
  }

  if (v.verdict === '보류' && v.hold_until_condition.length < MIN_REASON) {
    errors.hold_until_condition =
      '무엇이 풀리면 다시 볼 것인지 적어주세요. 조건 없는 보류는 그냥 방치입니다.'
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors }

  return {
    ok: true,
    value: {
      impact_score: impact,
      difficulty_score: difficulty,
      impact_reason: v.impact_reason,
      difficulty_reason: v.difficulty_reason,
      verdict: v.verdict,
      verdict_reason: v.verdict_reason,
      alternatives_considered: v.alternatives_considered,
      refuse_code: v.verdict === '반려' ? v.refuse_code : null,
      refuse_alternative: v.verdict === '반려' ? v.refuse_alternative : null,
      hold_until_condition: v.verdict === '보류' ? v.hold_until_condition : null,
      reviewer_label: v.reviewer_label,
    },
  }
}

// 판정에 따라 신청서 상태가 어디로 가는지. 한 곳에만 둔다.
export function statusFromVerdict(verdict) {
  if (verdict === '수용') return '수용'
  if (verdict === '반려') return '반려'
  return '보류'
}

// 무엇을 먼저 할지의 기본 순서. 임팩트가 클수록, 난이도가 낮을수록 앞이다.
// 이것은 제안일 뿐이고 실제 순번(priority_rank)은 담당자가 정한다 —
// 부서 사정이나 다른 과제와의 의존은 이 식에 들어 있지 않기 때문이다.
export function suggestedOrder(reviews) {
  return [...reviews]
    .filter((r) => r.verdict === '수용')
    .sort((a, b) => b.impact_score / b.difficulty_score - a.impact_score / a.difficulty_score)
}
