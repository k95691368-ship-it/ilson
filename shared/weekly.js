// 주 단위로 묶어 본다.
//
// 접수함이 한 줄로 죽 늘어서 있으면 "이번 주에 뭐가 들어왔나", "지난주보다
// 늘었나"를 볼 수가 없다. 담당자가 위에 보고할 때 필요한 것이 그건데,
// 지금은 목록을 눈으로 세어 만들어야 한다.
//
// 이 화면에서 가장 조심할 것은 **적은 표본으로 추세인 척하는 것**이다.
// 두 건이 세 건이 된 것을 "50% 증가"라고 적으면 그건 거짓말에 가깝다.
// 그래서 몇 건 아래에서는 아예 늘었다 줄었다를 말하지 않는다.

// 우리 시각으로 주를 자른다.
//
// 데이터베이스는 시각을 UTC로 준다. 그대로 자르면 월요일 새벽에 낸
// 신청서가 지난주로 밀린다 — 8월 4일 오전 1시(우리 시각)는 UTC로 8월 3일
// 오후 4시라서, 일요일 것으로 잡힌다. 부서 사람은 월요일 아침에 낸 것이
// 지난주 실적에 들어가 있는 이유를 알 길이 없다.
const KST_OFFSET_MS = 9 * 60 * 60 * 1000

export function toKst(sqlTime) {
  if (!sqlTime) return null
  const iso = String(sqlTime).includes('T')
    ? sqlTime
    : `${String(sqlTime).replace(' ', 'T')}Z`
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return new Date(d.getTime() + KST_OFFSET_MS)
}

// 그 시각이 속한 주의 월요일. 'YYYY-MM-DD'로 돌려준다.
//
// 월요일을 시작으로 잡는다. 회사에서 주는 월요일에 시작하고, 주간 보고도
// 월요일 기준이다. 일요일 시작으로 자르면 보고서 숫자와 안 맞는다.
export function weekStart(sqlTime) {
  const d = toKst(sqlTime)
  if (!d) return null
  // getUTC*를 쓴다. 이미 우리 시각으로 옮겨 둔 값이라 여기서 또 지역
  // 시간대를 적용하면 두 번 밀린다. 시험 돌리는 컴퓨터가 어느 나라에
  // 있든 같은 결과가 나와야 한다.
  const day = d.getUTCDay() // 0=일요일
  const back = day === 0 ? 6 : day - 1
  const monday = new Date(d.getTime() - back * 24 * 60 * 60 * 1000)
  return monday.toISOString().slice(0, 10)
}

// 사람이 읽는 주 이름. "7월 28일 ~ 8월 3일"
export function weekLabel(startKey) {
  const start = new Date(`${startKey}T00:00:00Z`)
  const end = new Date(start.getTime() + 6 * 24 * 60 * 60 * 1000)
  const f = (d) => `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일`
  return `${f(start)} ~ ${f(end)}`
}

// 이번 주 / 지난주 / N주 전.
export function weekRelative(startKey, now = Date.now()) {
  const thisWeek = weekStart(new Date(now).toISOString())
  const diff = Math.round(
    (new Date(`${thisWeek}T00:00:00Z`) - new Date(`${startKey}T00:00:00Z`)) /
      (7 * 24 * 60 * 60 * 1000)
  )
  if (diff === 0) return '이번 주'
  if (diff === 1) return '지난주'
  if (diff < 0) return null
  return `${diff}주 전`
}

// 이 건수 아래에서는 늘었다 줄었다를 말하지 않는다.
//
// 두 건이 세 건이 된 것을 "50% 늘었다"고 적으면 거짓말에 가깝다. 그
// 한 건은 누가 그 주에 휴가를 갔느냐로 갈린다.
export const MIN_FOR_TREND = 5

export function compareWeeks(current, previous) {
  if (previous == null) return { text: null, enough: false }
  if (current < MIN_FOR_TREND && previous < MIN_FOR_TREND) {
    return {
      text: `표본이 적어 늘었다 줄었다를 말하지 않습니다 (${MIN_FOR_TREND}건 미만)`,
      enough: false,
    }
  }
  const diff = current - previous
  if (diff === 0) return { text: '지난주와 같습니다', enough: true, diff: 0 }
  return {
    text: `지난주보다 ${Math.abs(diff)}건 ${diff > 0 ? '늘었습니다' : '줄었습니다'}`,
    enough: true,
    diff,
  }
}

// 아직 판정 안 한 것.
function isOpen(row) {
  return row.status === '접수' || row.status === '검토중'
}

// 주별로 묶는다.
//
// 들어온 주와 판정한 주는 다르다. 7월 마지막 주에 들어온 것을 8월 첫 주에
// 판정했으면, 들어온 것은 7월에 세고 판정한 것은 8월에 센다. 한 주에
// 몰아서 세면 "그 주에 일을 얼마나 했나"가 안 보인다.
export function rollup(rows, { now = Date.now(), weeks = 8 } = {}) {
  const byWeek = new Map()
  const touch = (key) => {
    if (!key) return null
    if (!byWeek.has(key)) {
      byWeek.set(key, {
        key,
        label: weekLabel(key),
        relative: weekRelative(key, now),
        arrived: 0,
        decided: 0,
        refused: 0,
        stillOpen: 0,
        byDept: {},
        hours: 0,
        hoursMissing: 0,
      })
    }
    return byWeek.get(key)
  }

  // 신청서가 하나도 없는 주도 자리를 만들어 둔다. 빠뜨리면 그래프에서
  // 조용한 주가 사라져서, 꾸준히 들어오는 것처럼 보인다.
  const thisWeek = weekStart(new Date(now).toISOString())
  for (let i = 0; i < weeks; i++) {
    const d = new Date(`${thisWeek}T00:00:00Z`).getTime() - i * 7 * 24 * 60 * 60 * 1000
    touch(new Date(d).toISOString().slice(0, 10))
  }

  for (const row of rows ?? []) {
    const arrivedKey = weekStart(row.created_at)
    const w = touch(arrivedKey)
    if (w) {
      w.arrived += 1
      w.byDept[row.dept] = (w.byDept[row.dept] ?? 0) + 1
      if (isOpen(row)) w.stillOpen += 1
      if (row.annual_hours == null) w.hoursMissing += 1
      else w.hours += row.annual_hours
    }

    // 판정한 주는 따로 센다.
    if (row.decided_at) {
      const d = touch(weekStart(row.decided_at))
      if (d) {
        d.decided += 1
        if (row.verdict === '반려') d.refused += 1
      }
    }
  }

  // 최근 것부터. 요청한 주 수만큼만.
  return [...byWeek.values()]
    .sort((a, b) => b.key.localeCompare(a.key))
    .slice(0, weeks)
}

// 부서별 합계. 어느 부서가 많이 내는가.
export function byDept(rows) {
  const map = new Map()
  for (const row of rows ?? []) {
    if (!map.has(row.dept)) {
      map.set(row.dept, { dept: row.dept, total: 0, open: 0, refused: 0, hours: 0 })
    }
    const d = map.get(row.dept)
    d.total += 1
    if (isOpen(row)) d.open += 1
    if (row.verdict === '반려') d.refused += 1
    if (row.annual_hours != null) d.hours += row.annual_hours
  }
  return [...map.values()].sort((a, b) => b.total - a.total || a.dept.localeCompare(b.dept, 'ko'))
}

// 담당자가 그대로 읽을 수 있는 한 줄.
//
// 보고할 때 필요한 것은 표가 아니라 문장이다. 표를 보고 문장을 만드는
// 일을 매주 하게 하지 않는다.
export function reportLine(weeks) {
  const cur = weeks?.[0]
  if (!cur) return null
  const prev = weeks[1]
  const cmp = compareWeeks(cur.arrived, prev?.arrived)
  const parts = [`${cur.relative ?? cur.label}에 ${cur.arrived}건이 들어왔고 ${cur.decided}건을 판정했습니다`]
  if (cur.stillOpen > 0) parts.push(`아직 ${cur.stillOpen}건이 판정을 기다립니다`)
  if (cmp.enough) parts.push(cmp.text)
  return `${parts.join('. ')}.`
}
