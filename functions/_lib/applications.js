// 신청서의 검증 규칙. 순수 함수로 두어 서버와 화면이 같은 규칙을 쓴다.
//
// 같은 규칙을 두 곳에 각각 쓰면 반드시 갈라진다. 화면에서는 통과했는데 서버가
// 막거나, 그 반대가 되면 사용자는 무엇이 잘못됐는지 알 수 없다. 그래서 검증은
// 여기 한 곳에만 둔다.

export const DEPTS = ['재무', '마케팅', '영업', 'SCM', '운영', '인사', '기타']

// migrations/0002_application.sql 의 CHECK 목록과 같은 값이다.
// 목록 API의 ?status= 화이트리스트로 쓴다 — 여기 없는 값이 오면 조건을 안 붙인다.
export const APP_STATUSES = ['접수', '검토중', '수용', '진행중', '완료', '보류', '반려']

export const FREQUENCIES = [
  '하루 여러 번',
  '매일',
  '주 2~3회',
  '주 1회',
  '격주',
  '매월',
  '분기',
  '비정기',
]

// 각 항목의 길이 상한. 넉넉하게 두되 무한은 아니다 —
// 상한이 없으면 실수로든 고의로든 본문 하나로 저장소를 채울 수 있다.
const LIMITS = {
  title: 80,
  bottleneck: 1000,
  problem: 1500,
  wish: 1000,
  impact_if_wrong: 600,
  applicant_label: 40,
  contact: 80,
}

// 최소 글자 수 제한은 두지 않는다.
//
// 처음에는 "병목을 15자 이상 적어야 낼 수 있다"로 막아 뒀다. 짧게 적으면
// 담당자가 다시 물어야 하니까. 그런데 그 규칙은 짧게 적는 사람을 도운 게
// 아니라 아예 안 내게 만든다. 신청서는 받는 게 먼저고, 부족하면 담당자가
// 물어보면 된다. 그게 원래 담당자가 할 일이다.

export const MAX_FILES = 5
export const MAX_FILE_BYTES = 10 * 1024 * 1024
export const ALLOWED_EXT = ['csv', 'xlsx', 'xls', 'txt', 'json', 'pdf', 'png', 'jpg', 'jpeg']

export function fileExt(name) {
  return (String(name || '').split('.').pop() || '').toLowerCase()
}

function text(value) {
  return String(value ?? '').trim()
}

// 통과하면 { ok: true, value }, 아니면 { ok: false, errors }.
// errors는 필드명 → 사용자에게 보여줄 한국어 한 문장.
export function validateApplication(input) {
  const errors = {}
  const v = {
    dept: text(input.dept),
    applicant_label: text(input.applicant_label),
    contact: text(input.contact),
    title: text(input.title),
    bottleneck: text(input.bottleneck),
    problem: text(input.problem),
    wish: text(input.wish),
    impact_if_wrong: text(input.impact_if_wrong),
    current_frequency: text(input.current_frequency),
  }

  // 꼭 있어야 하는 것만 막는다 — 어느 부서인지, 누가 냈는지, 무엇에 대한 건지.
  // 이 셋이 없으면 담당자가 되물을 상대조차 알 수 없다.
  if (!DEPTS.includes(v.dept)) errors.dept = '신청 부서를 골라주세요.'
  if (!v.applicant_label) errors.applicant_label = '신청자를 적어주세요. 이름 대신 직책이어도 됩니다.'
  if (!v.title) errors.title = '무슨 일인지 한 줄만 적어주세요.'

  for (const [key, max] of Object.entries(LIMITS)) {
    if (v[key] && v[key].length > max) {
      errors[key] = `${max}자를 넘었습니다. ${v[key].length}자 적으셨습니다.`
    }
  }

  if (v.current_frequency && !FREQUENCIES.includes(v.current_frequency)) {
    errors.current_frequency = '주기를 목록에서 골라주세요.'
  }

  const minutes = toPositiveInt(input.current_minutes)
  const people = toPositiveInt(input.current_people)

  if (input.current_minutes != null && text(input.current_minutes) !== '' && minutes == null) {
    errors.current_minutes = '분 단위 숫자로 적어주세요. 정확하지 않아도 됩니다.'
  }
  if (minutes != null && minutes > 60 * 24 * 5) {
    errors.current_minutes = '한 번에 5일을 넘는 값은 받을 수 없습니다. 단위가 분이 맞는지 확인해주세요.'
  }
  if (input.current_people != null && text(input.current_people) !== '' && people == null) {
    errors.current_people = '사람 수를 숫자로 적어주세요.'
  }
  if (people != null && people > 500) {
    errors.current_people = '500명을 넘는 값은 받을 수 없습니다.'
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors }

  return {
    ok: true,
    value: {
      ...v,
      contact: v.contact || null,
      wish: v.wish || null,
      impact_if_wrong: v.impact_if_wrong || null,
      current_frequency: v.current_frequency || null,
      current_minutes: minutes,
      current_people: people,
    },
  }
}

function toPositiveInt(value) {
  const s = text(value)
  if (s === '') return null
  if (!/^\d+$/.test(s)) return null
  const n = Number(s)
  return n > 0 ? n : null
}

export function validateFile(file) {
  if (!file || typeof file === 'string') return '파일을 선택해주세요.'
  if (file.size <= 0) return '빈 파일은 올릴 수 없습니다.'
  if (file.size > MAX_FILE_BYTES) {
    return `파일 하나는 10MB까지 올릴 수 있습니다. (${file.name}은 ${Math.round(file.size / 1024 / 1024)}MB)`
  }
  if (!ALLOWED_EXT.includes(fileExt(file.name))) {
    return `${file.name}은 받을 수 없는 형식입니다. ${ALLOWED_EXT.join(', ')}만 됩니다.`
  }
  return null
}

// 지금 이 일에 드는 연간 시간. 우선순위를 매길 때 쓴다.
// 신청자의 체감값이므로 어디까지나 참고치이고, 3단계에서 실측으로 대체된다.
// 이 표는 shared/outcome.js의 RUNS_PER_YEAR와 같은 값이어야 한다.
// 한쪽만 고치면 접수함에 적힌 연간 시간과 성과 화면의 연 환산이 서로
// 다른 횟수로 계산된다. 어긋나면 시험이 잡는다(tests/outcome.test.js).
export const PER_YEAR = {
  '하루 여러 번': 250 * 3,
  매일: 250,
  '주 2~3회': 52 * 2.5,
  '주 1회': 52,
  격주: 26,
  매월: 12,
  분기: 4,
  비정기: 6,
}

export function annualHours({ current_minutes, current_people, current_frequency }) {
  if (!current_minutes || !current_frequency) return null
  const times = PER_YEAR[current_frequency]
  if (!times) return null
  const people = current_people || 1
  return Math.round(((current_minutes * people * times) / 60) * 10) / 10
}
