// 화면에 숫자를 적는 방식을 한 곳에 모은다.
//
// 같은 값이 화면마다 다른 모양으로 적히면 읽는 사람이 다른 값이라고 느낀다.
// 특히 시간은 초·분·시간이 섞이기 쉬워서, 자릿수 규칙을 여기서 못 박는다.

export function krw(value, { sign = false } = {}) {
  if (value == null || Number.isNaN(value)) return '—'
  const n = Math.round(value)
  const body = Math.abs(n).toLocaleString('ko-KR')
  const mark = n < 0 ? '−' : sign ? '+' : ''
  return `${mark}${body}원`
}

export function num(value, digits = 0) {
  if (value == null || Number.isNaN(value)) return '—'
  return Number(value).toLocaleString('ko-KR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

export function pct(value, digits = 1) {
  if (value == null || Number.isNaN(value)) return '—'
  return `${(value * 100).toFixed(digits)}%`
}

// 초를 사람이 읽는 단위로. 1분 미만은 초, 1시간 미만은 분, 그 위는 시간+분.
// 반올림해서 "2시간"으로 뭉개지 않는 이유는, 이 값이 절감 근거로 쓰이기 때문이다.
export function duration(seconds) {
  if (seconds == null || Number.isNaN(seconds)) return '—'
  const s = Math.round(seconds)
  if (s < 60) return `${s}초`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}분`
  const h = Math.floor(m / 60)
  const rest = m % 60
  return rest === 0 ? `${h}시간` : `${h}시간 ${rest}분`
}

// 밀리초 단위 실측치. 실행 시간은 초 단위까지 보여야 "51초"라는 말이 산다.
export function ms(value) {
  if (value == null || Number.isNaN(value)) return '—'
  if (value < 1000) return `${Math.round(value)}ms`
  return `${(value / 1000).toFixed(1)}초`
}

// D1은 시각을 'YYYY-MM-DD HH:MM:SS' UTC 문자열로 준다. 그대로 new Date()에
// 넣으면 브라우저가 지역 시간으로 오해하는 경우가 있어 Z를 붙여 준다.
export function toDate(sqlTime) {
  if (!sqlTime) return null
  const iso = String(sqlTime).includes('T') ? sqlTime : `${sqlTime}Z`.replace(' ', 'T')
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}

export function dateLabel(sqlTime) {
  const d = toDate(sqlTime)
  if (!d) return '—'
  return d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })
}

export function dateTimeLabel(sqlTime) {
  const d = toDate(sqlTime)
  if (!d) return '—'
  return d.toLocaleString('ko-KR', {
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// "3일 전"처럼. 접수함에서 얼마나 묵었는지가 한눈에 보여야 한다.
export function ago(sqlTime) {
  const d = toDate(sqlTime)
  if (!d) return '—'
  const diff = Date.now() - d.getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return '방금'
  if (min < 60) return `${min}분 전`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}시간 전`
  const day = Math.floor(h / 24)
  if (day < 30) return `${day}일 전`
  return dateLabel(sqlTime)
}
