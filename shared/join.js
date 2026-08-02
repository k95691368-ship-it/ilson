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
