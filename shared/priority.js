// 무엇을 먼저 할 것인가.
//
// 접수함에서 판정은 한 건씩 한다. 그런데 "수용"이 여러 건 쌓이면 그다음
// 질문이 온다 — **이 중에 무엇부터 하나.** 지금은 그걸 정하는 자리가 없다.
// 담당자는 목록을 위에서부터 하거나, 마지막에 들어온 것부터 한다.
//
// 판단 재료는 이미 다 있다. 2단계에서 임팩트와 난이도를 1~5로 매겼고,
// 부서들이 손들며 연간 몇 시간짜리인지 적어 줬다. 없는 것은 그것들을
// 한 판에 놓고 보는 자리뿐이다.
//
// **여기서 순서를 자동으로 정하지 않는다.** 규칙이 할 수 있는 것은
// "무엇이 어디에 있는지"를 보여 주는 것까지다. 그다음은 사람이 정하고,
// 정한 이유가 기록에 남는다. 그게 이 사이트의 주어다.

// 사분면.
//
// 이름을 "먼저 한다 / 나중에 한다"로 붙이지 않는다. 그렇게 붙이면 규칙이
// 순서를 정한 것이 되고, 담당자는 그 이름을 따라가게 된다. 무엇인지만
// 말하고 무엇을 하라고는 안 한다.
export const QUADRANTS = [
  {
    key: 'quick',
    label: '크게 걸리는데 만들기 쉬운 것',
    hint: '여기 있는 것을 안 하고 있으면 그 이유를 댈 수 있어야 합니다.',
    tone: 'good',
  },
  {
    key: 'heavy',
    label: '크게 걸리는데 만들기 어려운 것',
    hint: '오래 걸립니다. 시작하면 다른 것을 못 합니다. 쪼갤 수 있는지부터 보세요.',
    tone: 'warn',
  },
  {
    key: 'small',
    label: '적게 걸리는데 만들기 쉬운 것',
    hint: '틈날 때 하기 좋습니다. 다만 이것만 하면 큰 병목은 그대로 남습니다.',
    tone: 'neutral',
  },
  {
    key: 'avoid',
    label: '적게 걸리는데 만들기 어려운 것',
    hint: '만들 값어치가 있는지 다시 보세요. 반려나 보류가 답일 수 있습니다.',
    tone: 'muted',
  },
]

export const QUADRANT_BY_KEY = Object.fromEntries(QUADRANTS.map((q) => [q.key, q]))

// 가운데 값. 3점이 척도의 한가운데다.
//
// 평균으로 자르지 않는다. 들어온 신청서가 다 쉬운 것뿐이면 평균이 낮아져서
// 그중 제일 어려운 것이 "어려운 것"으로 올라간다. 판이 그날 들어온 것에
// 따라 흔들리면 어제 본 것과 오늘 본 것이 달라진다.
export const MID = 3

// 척도 밖의 값은 자리를 안 정한다.
//
// Number(null)은 NaN이 아니라 **0**이다. 그래서 Number.isFinite만 보면
// 점수를 안 매긴 것이 0점으로 통과해 "적게 걸리고 쉬운 것" 자리에 찍힌다.
// 아직 판정도 안 한 신청서가 판 왼쪽 아래에 앉아 "이건 안 해도 되겠네"로
// 읽힌다. 모르는 것을 아는 척 찍는 것이 이 판에서 가장 나쁜 일이다.
function score(v) {
  if (v == null || v === '') return null
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  // 1~5 척도다. 0이나 6은 어디서 잘못 들어온 값이다.
  if (n < 1 || n > 5) return null
  return n
}

export function quadrantOf(impact, difficulty) {
  const i = score(impact)
  const d = score(difficulty)
  if (i == null || d == null) return null
  const big = i >= MID
  const hard = d > MID
  if (big && !hard) return 'quick'
  if (big && hard) return 'heavy'
  if (!big && !hard) return 'small'
  return 'avoid'
}

// 판에 올릴 수 있는 것.
//
// 점수가 없으면 못 올린다. 0,0에 찍으면 "안 걸리고 쉬운 것"으로 읽히는데
// 실제로는 아직 판정을 안 한 것이다. **모르는 것을 아는 척 찍지 않는다.**
// 아직 시작 안 한 것만 올린다.
//
// 처음에는 '진행중'도 올렸다. 그런데 이 판이 답하려는 질문은
// **"이 중에 무엇부터 시작하나"**다. 이미 만들고 있거나 배포까지 끝난
// 건을 판에 올려 놓고 "이걸 놔두고 다른 것을 하고 계시면 그 이유를 댈 수
// 있어야 합니다"라고 짚으면, 담당자는 이미 하고 있는 일을 시작하라는 말을
// 듣는다. 그 한 줄로 이 판 전체를 못 믿게 된다.
const ON_BOARD = ['수용']

export function boardItems({ applications, joins } = {}) {
  const hoursByApp = joins ?? {}
  const on = []
  const off = []

  for (const a of applications ?? []) {
    const q = quadrantOf(a.impact_score, a.difficulty_score)
    const row = {
      id: a.id,
      ticket_no: a.ticket_no,
      dept: a.dept,
      title: a.title,
      status: a.status,
      impact: score(a.impact_score),
      difficulty: score(a.difficulty_score),
      quadrant: q,
      // 이 병목이 실제로 몇 시간짜리인가. 손든 부서까지 더한 값이다.
      // 점 크기로 쓴다 — 같은 자리에 있어도 크기가 다르면 순서가 달라진다.
      annualHours: hoursByApp[a.id] ?? a.annual_hours ?? null,
      deptCount: a.dept_count ?? 1,
    }
    if (q && ON_BOARD.includes(a.status)) on.push(row)
    else off.push({ ...row, why: whyOff(a, q) })
  }

  return { items: on, off }
}

function whyOff(a, q) {
  if (!q) return '아직 임팩트·난이도를 안 매기셨습니다. 2단계에서 판정하시면 올라옵니다.'
  if (a.status === '접수' || a.status === '검토중') return '아직 판정 전입니다.'
  if (a.status === '진행중') return '이미 시작한 건입니다. 이 판은 아직 시작 안 한 것만 놓습니다.'
  if (a.status === '반려') return '반려한 건입니다.'
  if (a.status === '보류') return '보류한 건입니다. 다시 볼 때가 되면 올라옵니다.'
  if (a.status === '완료') return '끝난 건입니다.'
  return '판에 올릴 상태가 아닙니다.'
}

// 판 위에서 무엇이 눈에 띄는가.
//
// 순서를 정해 주지 않는다. 대신 **담당자가 놓치기 쉬운 것**을 짚는다.
// 짚는 것과 정하는 것은 다르다.
export function boardNotes(items) {
  const list = items ?? []
  const notes = []

  const quick = list.filter((i) => i.quadrant === 'quick')
  if (quick.length > 0) {
    notes.push({
      key: 'quick_waiting',
      text: `크게 걸리는데 만들기 쉬운 것이 ${quick.length}건 있습니다. 이걸 놔두고 다른 것을 하고 계시면 그 이유를 댈 수 있어야 합니다.`,
    })
  }

  // 여러 부서가 걸린 것은 점수만으로 못 잰다.
  const shared = list.filter((i) => (i.deptCount ?? 1) > 1)
  if (shared.length > 0) {
    notes.push({
      key: 'multi_dept',
      text: `${shared.length}건은 여러 부서가 걸린 일입니다. 임팩트 점수는 한 부서 기준으로 매기신 것이라, 실제로는 그 점수보다 큽니다.`,
    })
  }

  // 시간을 못 센 것이 있으면 점 크기를 못 믿는다.
  const noHours = list.filter((i) => i.annualHours == null)
  if (noHours.length > 0) {
    notes.push({
      key: 'no_hours',
      text: `${noHours.length}건은 연간 몇 시간짜리인지 안 적혀 있어 크기를 못 그립니다. 작아 보이는 것이 작은 것은 아닙니다.`,
    })
  }

  return notes
}

// 담당자가 "이걸 먼저 한다"고 정할 때 받는 것.
export const PICK_KIND = '먼저할것'
export const UNPICK_KIND = '먼저할것취소'
export const MIN_WHY = 10

export function validatePick({ why } = {}) {
  const errors = {}
  if (String(why ?? '').trim().length < MIN_WHY) {
    // 이유 없이 고른 순서는 다음 주에 자기도 왜 그랬는지 모른다.
    // 그리고 부서가 "왜 우리 것이 뒤로 밀렸냐"고 물으면 답할 것이 없다.
    errors.why = '왜 이것을 먼저 하시는지 적어주세요. 뒤로 밀린 부서가 물어볼 때 답할 것이 있어야 합니다.'
  }
  return errors
}

// 지금 무엇을 먼저 하기로 해 뒀는가.
export function pickedState({ items, picks } = {}) {
  const live = new Map()
  for (const p of picks ?? []) {
    if (p.cancelled) live.delete(p.application_id)
    else live.set(p.application_id, p)
  }

  const byId = new Map((items ?? []).map((i) => [i.id, i]))
  const picked = [...live.values()]
    .map((p) => ({ ...p, item: byId.get(p.application_id) ?? null }))
    // 판에서 내려간 것(반려·완료 등)은 안 보여준다. 다만 기록에는 남는다.
    .filter((p) => p.item)

  return {
    picked,
    pickedIds: new Set(picked.map((p) => p.application_id)),
    line:
      picked.length === 0
        ? '아직 무엇을 먼저 할지 정하지 않으셨습니다.'
        : `${picked.length}건을 먼저 하기로 정해 두셨습니다.`,
  }
}
