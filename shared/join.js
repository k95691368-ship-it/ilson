// "저것도 우리 얘기입니다" — 다른 부서가 같은 병목에 손을 든다.
//
// 신청서를 내려는데 비슷한 것이 이미 있으면 화면이 알려 준다. 그런데 알려
// 주기만 한다. **부서가 거기서 할 수 있는 일이 없다.**
//
// 그래서 둘 중 하나가 된다. 그냥 똑같이 내거나(같은 것이 두 건이 되고
// 담당자가 두 번 판정한다), 아니면 그만두거나. 그만두면 더 나쁘다 —
// 그 부서도 같은 일로 시간을 쓰고 있다는 사실이 어디에도 안 남는다.
// 담당자는 이 병목이 한 부서 것인 줄 알고 우선순위를 낮게 매긴다.
//
// 여기서는 손을 들 수 있게 한다. 새 신청서를 만들지 않고, 있는 신청서에
// "우리 부서도 이걸 겪습니다"를 붙인다.

export const JOIN_KIND = '같은건손듦'
export const UNJOIN_KIND = '같은건아님'

// 손들 때 받는 것.
//
// 부서 이름만 받으면 "세 부서가 겪습니다"까지밖에 못 말한다. 그 부서가
// 얼마나 겪는지를 같이 받아야 담당자가 우선순위를 다시 매길 수 있다.
export const MIN_STORY = 10

// shared/outcome.js와 같은 표다. 여기서 다시 쓰는 이유는 붙은 부서의
// 연간 시간을 화면과 서버가 같은 식으로 세야 하기 때문이다.
import { RUNS_PER_YEAR } from './outcome.js'

export const FREQUENCIES = Object.keys(RUNS_PER_YEAR)

export function validateJoin({ dept, by, minutes, people, frequency, story } = {}) {
  const errors = {}
  const t = (v) => String(v ?? '').trim()

  if (!t(dept)) errors.dept = '어느 부서인지 적어주세요.'
  if (!t(by)) errors.by = '누구신지 적어주세요.'

  if (t(story).length < MIN_STORY) {
    // 부서 이름만 받으면 "세 부서가 겪습니다"까지밖에 못 말한다.
    errors.story = '그쪽 부서에서는 이 일이 어떻게 벌어지는지 한 줄만 적어주세요. 같은 병목이라도 부서마다 다릅니다.'
  }

  const m = Number(minutes)
  if (!Number.isFinite(m) || m <= 0) {
    errors.minutes = '한 번에 몇 분쯤 걸리는지 적어주세요.'
  }
  if (frequency && !FREQUENCIES.includes(String(frequency))) {
    errors.frequency = '목록에 있는 주기를 골라주세요.'
  }

  const p = Number(people)
  if (people != null && people !== '' && (!Number.isFinite(p) || p <= 0)) {
    errors.people = '몇 분이 하시는지 숫자로 적어주세요.'
  }

  return errors
}

// 한 부서가 이 일에 쓰는 연간 시간.
export function annualHoursOf({ minutes, people, frequency } = {}) {
  const m = Number(minutes)
  const times = RUNS_PER_YEAR[frequency]
  if (!Number.isFinite(m) || m <= 0 || !times) return null
  const p = Number(people) > 0 ? Number(people) : 1
  return Math.round(((m * p * times) / 60) * 10) / 10
}

// 손든 부서들을 모아 이 병목이 실제로 얼마나 큰지 센다.
//
// 다만 **더한 값을 실측인 척하지 않는다.** 부서마다 일하는 방식이 달라서
// 같은 병목이라도 걸리는 시간이 다르고, 여기 적힌 것은 전부 스스로 말한
// 체감값이다. 3단계에서 재 봉인한 값과는 다른 종류의 숫자다.
export function joinSummary({ application, joins } = {}) {
  const list = (joins ?? []).filter((j) => !j.released)
  const ownHours = annualHoursOf({
    minutes: application?.current_minutes,
    people: application?.current_people,
    frequency: application?.current_frequency,
  })

  const depts = [...new Set([application?.dept, ...list.map((j) => j.dept)].filter(Boolean))]
  const joinedHours = list.reduce((sum, j) => sum + (annualHoursOf(j) ?? 0), 0)

  // 시간을 못 센 부서가 하나라도 있으면 합계를 내놓지 않는다. 일부만
  // 더한 값을 "이 병목의 크기"라고 부르면 실제보다 작게 보인다.
  const missing = list.filter((j) => annualHoursOf(j) == null).length
  const complete = missing === 0 && ownHours != null

  return {
    deptCount: depts.length,
    depts,
    joinCount: list.length,
    ownHours,
    joinedHours: Math.round(joinedHours * 10) / 10,
    totalHours: complete ? Math.round((ownHours + joinedHours) * 10) / 10 : null,
    missing,
    // 손든 부서가 있으면 우선순위를 다시 봐야 한다. 처음 판정할 때는
    // 한 부서 일인 줄 알고 매긴 점수다.
    needsRepriority: list.length > 0,
    caveat:
      '부서들이 스스로 말한 체감값을 더한 것입니다. 실제로 재 본 값이 아닙니다.',
  }
}

// 담당자 접수함에 뜰 한 줄.
export function joinLine(summary) {
  const s = summary ?? {}
  if (!s.joinCount) return null
  const parts = [`${s.joinCount}개 부서가 "우리도 같은 일을 겪는다"고 손들었습니다.`]
  if (s.totalHours != null) {
    parts.push(`다 합치면 연 ${s.totalHours}시간짜리 일입니다.`)
  } else if (s.missing > 0) {
    parts.push(`${s.missing}개 부서는 시간을 안 적어 주셔서 합계를 못 냅니다.`)
  }
  return parts.join(' ')
}

// 손든 것을 부서 쪽에서 뭐라고 확인해 줄 것인가.
export function joinReceipt({ ticket, dept, deptCount }) {
  return [
    `${dept}도 같은 일을 겪는다고 ${ticket}에 붙였습니다.`,
    deptCount > 1 ? ` 지금 ${deptCount}개 부서가 이 일에 걸려 있습니다.` : '',
    ' 새로 신청서를 내지 않으셔도 됩니다 — 이 건이 진행되면 그쪽도 같이 쓰시게 됩니다.',
  ].join('')
}

// ── 손든 부서의 한 줄을 협의 자리로 건네기 ──────────────────
//
// 손든 부서의 사정은 이미 다 적혀 있다. 없는 것은 그 한 줄이 협의 자리로
// 건너오는 다리 하나뿐이다. 지금은 담당자가 낸 부서하고만 합의하고,
// 손든 부서는 다 만들어진 뒤에 처음 기준을 본다.
//
// **충돌을 자동으로 찾아 주지 않는다.** 규칙의 몫은 "여러 부서 요구를 한
// 목록에 나란히 세우는 것"까지다. 낱말 사전으로 '정확 ↔ 마감'을 짚어 주는
// 규칙은 안 만든다 — 다섯 낱말짜리 사전은 "정확해야 한다"조차 못 짚고,
// 틀린 후보가 늘 켜져 있으면 담당자가 충돌 카드 자체를 안 읽는다.

// 부서 이름 표기 흔들림을 흡수한다.
//
// "운영"과 "운영팀"은 같게 보고, "영업"과 "영업지원"은 다르게 본다.
// 접미사를 하나만 떼는 이유는, 여러 개를 떼기 시작하면 서로 다른 부서가
// 같은 부서로 뭉개지기 때문이다.
const DEPT_SUFFIX = ['팀', '파트', '실', '본부', '그룹']

function normDept(v) {
  let s = String(v ?? '').replace(/\s+/g, '')
  for (const suffix of DEPT_SUFFIX) {
    if (s.length > suffix.length && s.endsWith(suffix)) {
      s = s.slice(0, -suffix.length)
      break
    }
  }
  return s
}

// 아직 협의안에 안 들어온 손든 부서.
//
// 판정 기준은 하나다 — "풀리지 않은 손들기의 부서 중, 이 신청서에 그 이름으로
// 된 요구가 0건인 부서". **상태를 새로 안 만든다.** 그래서 요구를 지우면
// 저절로 다시 뜨고, 손들기를 풀면 한꺼번에 빠진다. 되돌리는 코드를 한 줄도
// 안 쓰고 되돌리기가 된다.
//
// 요구의 status는 안 본다. 기각된 요구도 "들어온 것"으로 센다 — 판단이 끝난
// 것을 다시 조르면 담당자는 이 목록을 통째로 무시한다.
export function pendingJoinDepts({ joins, requirements } = {}) {
  const have = new Set((requirements ?? []).map((r) => normDept(r.dept)).filter(Boolean))
  return (joins ?? [])
    .filter((j) => !j.released && j.dept)
    .filter((j) => !have.has(normDept(j.dept)))
    .map((j) => ({
      join_id: j.id,
      dept: j.dept,
      by: j.by,
      story: j.story,
      minutes: j.minutes,
      people: j.people,
      frequency: j.frequency,
      annualHours: annualHoursOf(j),
      at: j.at,
    }))
}

// 손든 한 줄을 요구 등록에 넣을 모양으로.
//
// **회의록 인용은 비운다.** 회의에서 나온 말이 아니라 손들면서 적어 주신
// 것이라, 채우면 "회의록에서 못 찾음" 표시가 잘못 붙는다.
//
// 그리고 '가정'으로 올린다. 아직 그 부서와 마주 앉기 전이라 확정이 아니다.
export function joinAsRequirement(join) {
  const j = join ?? {}
  return {
    kind: 'requirement',
    req_kind: '가정',
    dept: j.dept ?? '',
    body: j.story ?? '',
    quote: '',
    priority: '보통',
    measurable: '',
  }
}

// 손든 부서가 자기 것만 볼 수 있는 조회 주소.
//
// 손든 부서는 접수번호가 없다. 낸 부서의 접수번호로 열면 화면 전체가
// 낸 부서 시점이라, 자기가 적어 낸 한 줄이 어떻게 됐는지 못 찾는다.
export function joinTrackPath({ ticket, dept } = {}) {
  const t = String(ticket ?? '').trim()
  if (!t) return '/track'
  const d = String(dept ?? '').trim()
  return d ? `/track?no=${encodeURIComponent(t)}&as=${encodeURIComponent(d)}` : `/track?no=${encodeURIComponent(t)}`
}

// 첫 화면 할 일 목록이 쓸 집계.
//
// 한 신청서가 두 줄에 동시에 뜨지 않게 상태로 가른다. 아직 판정 전인 건은
// "우선순위 다시 보기", 판정이 끝나 협의 중인 건은 "협의안에 넣기".
// 끝나거나 접힌 건은 어느 쪽에도 안 센다.
const BEFORE_VERDICT = ['접수', '검토중']
const IN_PROGRESS = ['수용', '진행중']

export function joinCounts({ joinsByApp, apps, requirementsByApp } = {}) {
  const status = new Map((apps ?? []).map((a) => [a.id, a.status]))
  const repriorityIds = []
  const notInAgreementIds = []
  let joinCount = 0
  let releasedCount = 0

  for (const [appId, joins] of Object.entries(joinsByApp ?? {})) {
    const live = (joins ?? []).filter((j) => !j.released)
    releasedCount += (joins ?? []).length - live.length
    if (live.length === 0) continue
    joinCount += live.length

    const s = status.get(appId)
    if (BEFORE_VERDICT.includes(s)) {
      repriorityIds.push(appId)
    } else if (IN_PROGRESS.includes(s)) {
      const pending = pendingJoinDepts({
        joins: live,
        requirements: (requirementsByApp ?? {})[appId] ?? [],
      })
      if (pending.length > 0) notInAgreementIds.push(appId)
    }
  }

  return {
    joinCount,
    releasedCount,
    needsRepriority: repriorityIds.length,
    notInAgreement: notInAgreementIds.length,
    repriorityIds,
    notInAgreementIds,
  }
}
