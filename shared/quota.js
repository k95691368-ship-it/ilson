// 도구를 몇 번 더 쓸 수 있는가.
//
// 한도는 있었지만 걸리고 나서야 알 수 있었다. 부서 사람이 월요일 아침에
// 정산을 돌리다가 "오늘은 더 못 쓴다"를 만나면, 그날 할 일이 거기서 멈춘다.
// 미리 알았으면 순서를 바꿨을 것이다.
//
// 그런데 문구가 틀려 있었다. "오늘 남은 5회"라고 적혀 있는데 실제로는
// 하루가 지나 초기화되는 것이 아니라 **최근 24시간** 안에 몇 번 썼는지로
// 센다. 어제 오후 세 시에 다섯 번 쓴 사람은 자정이 아니라 오늘 오후 세
// 시부터 하나씩 풀린다. 자정에 초기화되는 줄 알고 기다리면 헛기다린다.

// 남은 횟수가 이 아래로 내려가면 눈에 띄게 한다.
//
// 늘 경고가 떠 있으면 아무도 안 읽는다. 넉넉할 때는 조용히 둔다.
export const LOW_RATIO = 0.34
export const LOW_ABSOLUTE = 3

export function quotaState({ remaining, limit }) {
  // Number(undefined)는 null이 아니라 NaN이다. ?? 로는 안 걸러진다.
  // 안 걸러 두면 화면에 "NaN번 남았습니다"가 뜬다.
  const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback)
  const r = Math.max(0, num(remaining, 0))
  const l = Math.max(1, num(limit, 1))

  if (r <= 0) {
    return {
      level: '다 씀',
      remaining: 0,
      limit: l,
      loud: true,
      headline: '지금은 더 돌리실 수 없습니다',
    }
  }
  // 한도가 작으면 비율만으로는 못 잡는다. 5회 중 2회 남은 것은 40%지만
  // 두 번이면 곧 끝난다.
  const low = r / l <= LOW_RATIO || r <= LOW_ABSOLUTE
  return {
    level: low ? '얼마 안 남음' : '넉넉함',
    remaining: r,
    limit: l,
    loud: low,
    headline: low ? `${r}번 더 쓰실 수 있습니다` : null,
  }
}

// 언제 한 번 더 쓸 수 있게 되는가.
//
// "기다리세요"만 하면 얼마나 기다릴지 몰라서 결국 담당자에게 전화한다.
// 가장 오래된 실행이 24시간을 넘기는 그때 한 칸이 풀린다.
export function nextFreeText(nextFreeAt, now = Date.now()) {
  if (!nextFreeAt) return null
  const iso = String(nextFreeAt).includes('T')
    ? nextFreeAt
    : `${String(nextFreeAt).replace(' ', 'T')}Z`
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null
  const ms = t - now
  if (ms <= 0) return '지금 한 번 더 쓰실 수 있습니다'
  const min = Math.ceil(ms / 60000)
  if (min < 60) return `${min}분 뒤에 한 번 더 쓰실 수 있습니다`
  const h = Math.floor(min / 60)
  const rest = min % 60
  return rest === 0
    ? `${h}시간 뒤에 한 번 더 쓰실 수 있습니다`
    : `${h}시간 ${rest}분 뒤에 한 번 더 쓰실 수 있습니다`
}

// 한도가 왜 있는지.
//
// 이유를 안 적으면 부서는 "왜 못 쓰게 막아 두지"라고 생각한다. 막으려고
// 둔 것이 아니라, 잘못 만든 도구가 폭주해서 원본을 몇 천 번 읽는 일을
// 막으려고 둔 것이다.
export const WHY_LIMIT =
  '한도를 둔 이유는 못 쓰게 하려는 것이 아니라, 도구가 잘못 돌 때 끝없이 도는 것을 막기 위해서입니다. 실제로 더 필요하시면 담당자가 바로 올려드립니다.'

// 다 썼을 때 무엇을 할 수 있는가.
export function whatNow(state, nextFree) {
  if (state.level !== '다 씀') return null
  const parts = []
  if (nextFree) parts.push(nextFree)
  parts.push('급하시면 담당자에게 말씀해주세요. 한도는 바로 올릴 수 있습니다.')
  return parts.join(' ')
}

// 파일 크기를 미리 걸러 준다.
//
// 올리고 나서 "너무 큽니다"를 듣는 것과, 고르기 전에 아는 것은 다르다.
export function checkFiles(files, { maxFileMb, maxFiles }) {
  const list = [...(files ?? [])]
  const problems = []

  if (maxFiles && list.length > maxFiles) {
    problems.push(`한 번에 ${maxFiles}개까지 올리실 수 있습니다. ${list.length}개를 고르셨습니다.`)
  }
  const limitBytes = (maxFileMb ?? 10) * 1024 * 1024
  for (const f of list) {
    if (f.size > limitBytes) {
      problems.push(`${f.name} — ${(f.size / 1024 / 1024).toFixed(1)}MB로 ${maxFileMb}MB를 넘습니다.`)
    }
  }
  return problems
}
