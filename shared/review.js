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

// 예전에는 근거를 스무 자 이상 쓰지 않으면 저장 자체를 막았다. 근거가
// 중요하다는 뜻이었지만 실제로는 쓰는 사람을 붙잡아 두는 걸림돌이 됐다.
// 지금은 막지 않는다. 대신 화면에서 비어 있는 칸을 눈에 띄게 표시해 나중에
// 채우고 싶어지게 한다. 억지로 채운 스무 글자보다 비어 있는 칸이 정직하다.

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

  // 막는 것은 이 셋뿐이다. 없으면 기록 자체가 성립하지 않는 값들이다.
  if (impact == null) errors.impact_score = '임팩트를 골라주세요.'
  if (difficulty == null) errors.difficulty_score = '난이도를 골라주세요.'
  if (!VERDICTS.includes(v.verdict)) errors.verdict = '판정을 골라주세요.'

  // 반려 사유는 값이 들어왔을 때만 목록에 있는지 본다. 비어 있어도 저장된다.
  if (v.verdict === '반려' && v.refuse_code && !REFUSE_CODES.includes(v.refuse_code)) {
    errors.refuse_code = '목록에 있는 사유를 골라주세요.'
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
