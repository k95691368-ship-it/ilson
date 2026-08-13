// 2단계 검토의 규칙. 화면과 서버가 이 파일 하나를 같이 쓴다.
//
// 같은 규칙을 양쪽에 각각 두면 반드시 갈라진다. 화면에서는 통과했는데 서버가
// 막거나 그 반대가 되면, 쓰는 사람은 무엇이 잘못됐는지 알 수 없다.

export const VERDICTS = ['수용', '반려', '보류']

// 근거·대안·조건에 요구하는 최소 길이.
//
// 스무 자였다. 풀었다 — 글자 수를 세는 것으로는 근거가 있는지 없는지를
// 가릴 수 없다. "그냥요"를 스무 자로 늘려 쓰는 것도 되고, 정확한 한 마디가
// 스무 자를 못 채워 막히기도 한다. 길이는 판단을 흉내 낼 뿐이다.
//
// 대신 **비었는지는 계속 막는다.** 빈칸으로 눌리면 그건 결정이 아니라
// 클릭이고, 그 말은 이 저장소가 여러 화면에서 하고 있는 약속이다.
export const MIN_REASON = 1

// 반려 사유. 이 목록이 곧 "우리가 만들지 않는 것"의 선언이다.
//
// 목록이 짧은 것은 능력이 모자라서가 아니라 정한 것이다. "무엇이든 만들어
// 드립니다"는 지킬 수 있는 약속이 아니고, 못 만드는 것을 이유와 대안과 함께
// 말할 수 있어야 나머지 약속이 믿긴다.
export const REFUSE_REASONS = [
  {
    code: 'external_write',
    label: '다른 시스템에 직접 쓰기',
    detail:
      'ERP·그룹웨어·메신저에 등록하거나 발송하는 일. 계정 권한과 실패했을 때 되돌리는 설계가 따로 필요하다.',
    alternative: '올릴 양식에 맞춘 파일까지 만들어 드리고, 등록 버튼은 사람이 누른다.',
  },
  {
    code: 'auth_crawl',
    label: '로그인해야 보이는 자료 수집',
    detail: '계정으로 들어가야 보이는 화면을 긁어 오는 일. 비밀번호 보관과 차단 대응이 별개 문제다.',
    alternative: '그 화면에서 내려받은 파일을 올리면 그다음부터는 자동으로 처리한다.',
  },
  {
    code: 'realtime',
    label: '실시간 감시',
    detail: '값이 바뀌는 즉시 반응해야 하는 일. 이 도구는 사람이 파일을 올릴 때 도는 방식이다.',
    alternative: '정해진 주기로 확인하고, 기준을 넘으면 성과 화면에 알림 카드로 띄운다.',
  },
  {
    code: 'human_judgment',
    label: '사람의 판단이 본체인 일',
    detail: '협상, 품평, 채용 결정처럼 결과의 책임이 판단 자체에 있는 일.',
    alternative: '판단에 필요한 자료를 한 장으로 정리해 드린다. 결정은 사람이 한다.',
  },
  {
    code: 'media_gen',
    label: '이미지·영상 만들기',
    detail: '시안이나 영상 결과물을 만드는 일. 이 도구는 표와 문서를 다룬다.',
    alternative: '없다. 다른 도구로 가야 한다. 다만 거기 들어갈 정보 표는 정리해 드릴 수 있다.',
  },
  {
    // 이름이 라벨과 안 맞아 보이는 이유.
    //
    // 이 코드는 migrations/0003_review.sql의 CHECK 목록에 있는 값이어야 한다.
    // D1은 CHECK를 나중에 못 고치고 이 프로젝트는 표를 다시 만들 권한이 없다.
    // 한동안 여기에 no_input이라고 적어 뒀는데, 그 값은 CHECK에 없어서
    // **이 사유로 반려하면 판정 저장이 통째로 500이 났다.** 점수도 근거도
    // 대안도 같은 배치에 묶여 있어서 셋 다 롤백됐고, 담당자는 적어 둔 것을
    // 전부 잃었다. 아래 시험이 두 목록을 묶어 다시 갈라지지 않게 한다.
    code: 'unstructured_only',
    label: '자동화할 자료가 아직 없음',
    detail: '대상 파일이나 문서가 아직 존재하지 않는 일. 만들 근거가 없다.',
    alternative: '그 자료가 어디서 어떤 모양으로 생기는지부터 회의로 정한다.',
  },
  {
    code: 'other',
    label: '그 밖의 사유',
    detail: '위 어디에도 해당하지 않는 경우. 이유를 직접 적는다.',
    alternative: null,
  },
]

export const REFUSE_CODES = REFUSE_REASONS.map((r) => r.code)
export const REFUSE_LABELS = Object.fromEntries(REFUSE_REASONS.map((r) => [r.code, r.label]))

// 1~5 척도에 말을 붙여 둔다. 숫자만 있으면 매기는 사람마다 기준이 달라지고,
// 나중에 자기가 왜 3을 줬는지도 기억하지 못한다.
export const IMPACT_SCALE = [
  { score: 1, label: '한 사람이 가끔', detail: '없어져도 조직이 체감하지 못한다' },
  { score: 2, label: '한 사람이 자주', detail: '그 사람의 시간은 확실히 줄어든다' },
  { score: 3, label: '한 팀이 자주', detail: '팀 단위로 시간이 줄고 실수가 준다' },
  { score: 4, label: '여러 부서가 결과를 쓴다', detail: '이 결과물로 다른 팀이 결정을 내린다' },
  { score: 5, label: '틀리면 되돌릴 수 없다', detail: '외부 보고·정산·규제에 닿아 있다' },
]

export const DIFFICULTY_SCALE = [
  { score: 1, label: '규칙이 명확하다', detail: '입력도 출력도 정해져 있다' },
  { score: 2, label: '예외가 조금 있다', detail: '대부분 규칙으로 풀리고 몇 건만 사람이 본다' },
  { score: 3, label: '자료가 여럿이다', detail: '모양이 서로 다른 것을 맞춰야 한다' },
  { score: 4, label: '판단이 섞여 있다', detail: '규칙만으로 안 되고 사람의 기준이 필요하다' },
  { score: 5, label: '자료 자체가 없다', detail: '만들기 전에 없는 자료부터 만들어야 한다' },
]

// 예전에는 근거를 스무 자 이상 쓰지 않으면 저장 자체를 막았다. 근거가
// 중요하다는 뜻이었지만 실제로는 쓰는 사람을 붙잡아 두는 걸림돌이 됐다.
// 지금은 막지 않는다. 억지로 채운 스무 글자보다 비어 있는 칸이 정직하다.

function text(value) {
  return String(value ?? '').trim()
}

function toScore(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 1 || n > 5) return null
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

  if (impact == null) errors.impact_score = '임팩트를 골라주세요.'
  if (difficulty == null) errors.difficulty_score = '난이도를 골라주세요.'
  if (!VERDICTS.includes(v.verdict)) errors.verdict = '판정을 골라주세요.'

  // 근거 없이 누른 것은 결정이 아니라 클릭이다.
  //
  // 이 저장소는 처음부터 그렇게 말해 왔다 — 의사결정 로그 파일 머리에
  // "why가 비어 있으면 결정이 아니라 클릭이다"라고 적혀 있고, /honesty 는
  // "대안 없이 반려한 것"을 실패로 센다. 부서 화면은 "반려했지만 대신
  // 해볼 수 있는 것을 적어 뒀습니다"라고 약속한다.
  //
  // **그런데 아무것도 안 막고 있었다.** 막는 것은 임팩트·난이도·판정
  // 셋뿐이었고, 근거 열다섯 자에 대안 없는 반려가 실제로 저장돼 있다.
  //
  // 결정적인 것은 첫 화면의 초대문이다. 보러 오신 분께 "근거를 안 적으면
  // 서버가 막습니다, 반려는 대안까지 받습니다"라고 적어 뒀는데 사실이
  // 아니었다. 면접관이 빈칸으로 눌러 보면 그대로 저장된다 — 평가하러 온
  // 사람에게 사이트가 거짓말을 하는 셈이다.
  if (v.verdict_reason.length < MIN_REASON) {
    errors.verdict_reason = '왜 그렇게 판정하셨는지 적어주세요. 근거 없이 누른 것은 결정이 아니라 클릭입니다.'
  }
  if (v.alternatives_considered.length < MIN_REASON) {
    // 무엇을 고르지 않았는지를 적어야 판단이 판단이 된다.
    errors.alternatives_considered = '무엇을 고르지 않으셨는지 적어주세요. 대안을 적어야 판단이 판단이 됩니다.'
  }

  if (v.verdict === '반려') {
    if (v.refuse_code && !REFUSE_CODES.includes(v.refuse_code)) {
      errors.refuse_code = '목록에 있는 사유를 골라주세요.'
    }
    // 만들지 못한다는 말만 하고 끝내면 병목은 그대로 남는다.
    if (v.refuse_alternative.length < MIN_REASON) {
      errors.refuse_alternative = '대신 해보실 수 있는 것을 적어주세요. 못 만든다는 말만 하고 끝내면 그 부서의 병목은 그대로 남습니다.'
    }
  }

  if (v.verdict === '보류' && v.hold_until_condition.length < MIN_REASON) {
    // 조건 없이 미뤄 두면 부서는 언제까지 기다려야 하는지 모른다. 그리고
    // 보류는 아무도 안 움직이면 영원히 그대로인 유일한 상태다.
    errors.hold_until_condition = '무엇이 풀리면 다시 볼지 적어주세요. 조건이 없으면 부서는 언제까지 기다려야 하는지 모릅니다.'
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
      refuse_code: v.verdict === '반려' ? v.refuse_code || null : null,
      refuse_alternative: v.verdict === '반려' ? v.refuse_alternative || null : null,
      hold_until_condition: v.verdict === '보류' ? v.hold_until_condition || null : null,
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
