// 접수함에서 다음에 볼 것을 고르는 규칙.
//
// 신청서가 쌓이면 목록을 위에서 아래로 훑는 것으로는 못 고른다. 담당자가
// 실제로 던지는 질문은 "재무에서 온 것 중 아직 안 본 게 뭐가 있나",
// "사흘 넘게 묵은 게 있나", "연 환산 시간이 큰 것부터 보자" 같은 것들이다.
//
// 화면이 아니라 여기에 규칙을 두는 이유는, 이 규칙이 틀리면 담당자가 잘못된
// 것을 먼저 보게 되기 때문이다. 시험으로 못 박을 수 있어야 한다.

// 정렬 축.
//
// 기본값을 '묵은 순'으로 둔다. 최신순이 아니다. 접수함에서 가장 위험한 것은
// 새로 온 것이 아니라 아무도 안 본 채로 오래 앉아 있는 것이다. 최신순으로
// 두면 묵은 것이 아래로 밀려 영영 안 보인다.
export const SORTS = [
  { key: 'stale', label: '묵은 순', note: '접수하고 오래된 것부터 — 기본값' },
  { key: 'recent', label: '최근 접수 순', note: '방금 들어온 것부터' },
  { key: 'hours', label: '연 환산 시간 큰 순', note: '없앴을 때 가장 크게 줄어드는 것부터' },
  { key: 'dept', label: '부서별', note: '같은 부서 것끼리 모아서' },
]

// migrations/0002_application.sql 의 CHECK 목록과 같은 값이고 같은 순서다.
// 순서가 곧 진행 순서라, 칩을 이 순서로 늘어놓으면 왼쪽에서 오른쪽으로
// 일이 흘러가는 모양이 된다.
export const STATUSES = ['접수', '검토중', '수용', '진행중', '완료', '보류', '반려']

// 실제로 그 상태인 신청서가 있는 것만 고른다.
//
// 일곱 개를 다 늘어놓으면 누를 것과 못 누를 것이 섞여 고르기 나빠진다.
// 반대로 네 개만 박아 두면 '진행중'인 신청서가 있어도 그것만 골라 볼
// 방법이 없다 — 화면에 보이는데 좁힐 수가 없는 상태가 생긴다.
export function presentStatuses(items) {
  const seen = new Set((items ?? []).map((i) => i.status))
  return STATUSES.filter((s) => seen.has(s))
}

// 지금 보고 있는 것 안에서 아직 판정 안 한 것과 그중 묵은 것.
//
// 이 화면의 머릿수는 전체 건수가 아니라 이 값이다.
export function queueStats(items) {
  const list = items ?? []
  return {
    // 부서 답을 기다리는 것은 내 할 일이 아니다. 따로 센다.
    waiting: list.filter((i) => i.status === '접수' && !isWaitingAnswer(i)).length,
    askedBack: list.filter(isWaitingAnswer).length,
    stale: list.filter(isStale).length,
  }
}

// 아무 조건도 걸지 않은 상태. 화면과 시험이 같은 것을 쓰게 한다.
export const EMPTY_QUERY = {
  q: '',
  status: '',
  dept: '',
  onlyStale: false,
  onlyWithFiles: false,
  onlyWaiting: false,
  sort: 'stale',
}

// 묵었다고 볼 기준. 접수하고 하루가 지나도록 아무도 판정하지 않은 것.
//
// 하루로 잡은 이유는, 부서 담당자 입장에서 "냈는데 다음 날까지 아무 말이
// 없다"가 불안이 시작되는 지점이기 때문이다. 판정이 끝난 것은 아무리
// 오래돼도 묵은 것이 아니다 — 답을 이미 줬으니까.
export const STALE_HOURS = 24

export function isStale(item) {
  // 부서 답을 기다리는 중이면 묵은 것이 아니다. 담당자가 안 본 것이 아니라
  // 물어 놓고 기다리는 것이라, 이걸 밀린 일로 세면 접수함이 늘 빨갛다.
  if (isWaitingAnswer(item)) return false
  return item.status === '접수' && (item.hours_since ?? 0) >= STALE_HOURS
}

// 지금 공이 부서 쪽에 있는 건.
export function isWaitingAnswer(item) {
  return (item?.waiting_answers ?? 0) > 0
}

// 검색이 훑는 자리.
//
// 제목만 훑으면 못 찾는다. 담당자가 기억하는 것은 제목이 아니라 "그 정산서
// 얘기하던 거" 같은 본문 한 조각인 경우가 많다. 그래서 병목·문제·바람까지
// 전부 훑는다. 접수번호도 포함한다 — 부서가 번호로 문의해 오기 때문이다.
const SEARCH_FIELDS = [
  'ticket_no',
  'title',
  'bottleneck',
  'problem',
  'wish',
  'impact_if_wrong',
  'dept',
  'applicant_label',
]

// 접수번호는 사람이 대시를 빼고 옮겨 적는다. 부서에서 "AX-EFD-E58 건이요"를
// 메신저로 받아 붙여 넣을 때는 대시가 붙어 오지만, 전화로 듣고 치면
// "axefde58"이 된다. 둘 다 같은 것을 찾아야 한다.
function stripPunct(s) {
  return s.replace(/[^a-z0-9가-힣]/g, '')
}

export function matchesQuery(item, q) {
  const needle = String(q ?? '').trim().toLowerCase()
  if (!needle) return true
  // 띄어쓰기로 나눠 전부 들어 있는 것만. "재무 정산"으로 두 낱말을 다 가진
  // 것을 찾을 수 있어야 한다. 붙여서 한 덩어리로 찾으면 어순을 외워야 한다.
  const words = needle.split(/\s+/)
  const hay = SEARCH_FIELDS.map((f) => String(item[f] ?? ''))
    .join(' ')
    .toLowerCase()
  // 대시·공백을 뗀 것도 같이 뒤진다. 원본만 뒤지면 "axefde58"이 안 걸리고,
  // 뗀 것만 뒤지면 "재무 정산" 같은 두 낱말 검색이 붙어버려 안 걸린다.
  const bare = stripPunct(hay)
  return words.every((w) => hay.includes(w) || bare.includes(stripPunct(w)))
}

function passesFacets(item, query, { skip } = {}) {
  if (skip !== 'status' && query.status && item.status !== query.status) return false
  if (skip !== 'dept' && query.dept && item.dept !== query.dept) return false
  if (skip !== 'stale' && query.onlyStale && !isStale(item)) return false
  if (skip !== 'files' && query.onlyWithFiles && !(item.file_count > 0)) return false
  if (skip !== 'waiting' && query.onlyWaiting && !isWaitingAnswer(item)) return false
  return true
}

// 정렬.
//
// 어느 축이든 마지막에 접수번호로 한 번 더 정렬한다. 값이 같을 때 순서가
// 매번 달라지면, 담당자가 방금 본 것이 어디 있었는지 놓친다. 목록이 흔들리는
// 것만으로도 "이 화면 못 믿겠는데"가 된다.
function compareBy(sort) {
  const tie = (a, b) => String(a.ticket_no ?? '').localeCompare(String(b.ticket_no ?? ''))

  switch (sort) {
    case 'recent':
      return (a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')) || tie(a, b)

    case 'hours':
      // 소요 시간을 안 적은 신청서가 있다. 그것을 0으로 쳐서 맨 아래로
      // 보내면 "안 적었다"와 "0시간이다"가 같아진다. 다르다. 미기재는
      // 언제나 맨 뒤로 보내되, 자기들끼리는 묵은 순으로 둔다.
      return (a, b) => {
        const ah = a.annual_hours
        const bh = b.annual_hours
        const aMissing = ah == null
        const bMissing = bh == null
        if (aMissing !== bMissing) return aMissing ? 1 : -1
        if (!aMissing && ah !== bh) return bh - ah
        return String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')) || tie(a, b)
      }

    case 'dept':
      return (a, b) =>
        String(a.dept ?? '').localeCompare(String(b.dept ?? ''), 'ko') ||
        String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')) ||
        tie(a, b)

    case 'stale':
    default:
      // 아직 판정 안 한 것을 언제나 위로 올린다. 판정이 끝난 것은 아무리
      // 오래돼도 담당자가 지금 할 일이 아니다.
      return (a, b) => {
        const aw = a.status === '접수' ? 0 : 1
        const bw = b.status === '접수' ? 0 : 1
        if (aw !== bw) return aw - bw
        return String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')) || tie(a, b)
      }
  }
}

export function applyQuery(items, query) {
  const q = { ...EMPTY_QUERY, ...query }
  const filtered = (items ?? []).filter((i) => matchesQuery(i, q.q) && passesFacets(i, q))
  return [...filtered].sort(compareBy(q.sort))
}

// 조건 칩에 붙일 건수.
//
// 이 숫자는 "지금 걸린 다른 조건은 그대로 두고 이 칩을 눌렀을 때 몇 건이
// 나오는가"다. 전체 건수를 적으면 눌러 놓고 0건이 나오는 일이 생기는데,
// 그건 화면이 거짓말을 한 것이다. 눌러 보기 전에 알 수 있어야 한다.
export function facetCounts(items, query) {
  const q = { ...EMPTY_QUERY, ...query }
  const base = (items ?? []).filter((i) => matchesQuery(i, q.q))

  const byStatus = {}
  const byDept = {}
  for (const i of base.filter((i) => passesFacets(i, q, { skip: 'status' }))) {
    byStatus[i.status] = (byStatus[i.status] ?? 0) + 1
  }
  for (const i of base.filter((i) => passesFacets(i, q, { skip: 'dept' }))) {
    byDept[i.dept] = (byDept[i.dept] ?? 0) + 1
  }

  return {
    byStatus,
    byDept,
    stale: base.filter((i) => passesFacets(i, q, { skip: 'stale' }) && isStale(i)).length,
    waiting: base.filter((i) => passesFacets(i, q, { skip: 'waiting' }) && isWaitingAnswer(i)).length,
    withFiles: base.filter((i) => passesFacets(i, q, { skip: 'files' }) && i.file_count > 0).length,
  }
}

// 지금 보고 있는 것이 무엇인지 한 줄로. 필터를 걸어 놓고 무엇을 걸었는지
// 잊는 일이 흔하다. 특히 화면을 떠났다 돌아왔을 때.
export function describeQuery(query, shown, total) {
  const q = { ...EMPTY_QUERY, ...query }
  const parts = []
  if (q.dept) parts.push(`${q.dept} 부서`)
  if (q.status) parts.push(`${q.status} 상태`)
  if (q.onlyStale) parts.push(`${STALE_HOURS}시간 넘게 안 본 것`)
  if (q.onlyWithFiles) parts.push('첨부가 있는 것')
  if (q.onlyWaiting) parts.push('부서 답을 기다리는 것')
  if (q.q) parts.push(`"${q.q}"가 들어간 것`)

  if (parts.length === 0) return `전체 ${total}건`
  return `${total}건 중 ${shown}건 — ${parts.join(' 그리고 ')}`
}

export function isFiltered(query) {
  const q = { ...EMPTY_QUERY, ...query }
  return Boolean(q.q || q.status || q.dept || q.onlyStale || q.onlyWithFiles || q.onlyWaiting)
}

// 걸린 조건 안에서 합계. 필터를 걸면 이 숫자도 따라 움직여야 한다.
// 전체 합계를 그대로 두면 "재무 것만 봤는데 왜 합계가 그대로지"가 된다.
export function sumAnnualHours(items) {
  let hours = 0
  let missing = 0
  for (const i of items ?? []) {
    if (i.annual_hours == null) missing += 1
    else hours += i.annual_hours
  }
  return { hours, missing }
}
