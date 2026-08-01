// 지금 어디서 멈춰 있고, 누구를 기다리는가.
//
// 이 사이트는 부서의 병목을 없애는 곳이다. 그런데 정작 이 사이트 안에서
// 신청서가 어디에 얼마나 오래 걸려 있는지는 아무 데도 안 나온다. 첫 화면이
// "어느 단계에 몇 건" 까지는 세지만, 그 건이 **거기 사흘 있었는지 3주
// 있었는지**는 세지 않는다. 그래서 오래 걸린 건일수록 조용하다.
//
// 여기서 그것을 센다. 다만 "늦었다"만 말하면 이 화면은 잔소리가 된다.
// 늦었다고 말할 거면 **누구를 기다리는 중인지**를 같이 말해야 한다.
// 베타 테스트에서 12일 멈춘 건을 담당자 앞에 늦었다고 들이밀면, 실제로는
// 부서가 아직 안 써 본 것인데 담당자가 자기 잘못으로 받는다. 그런 화면은
// 두 번째부터 안 본다.

// 단계마다 "이만큼 넘으면 늦은 것"이 다르다.
//
// 검토는 하루면 된다 — 판정까지는 아니어도 봤다는 말은 할 수 있다.
// 제작은 열흘 걸려도 이상하지 않다. 같은 잣대를 대면 제작은 늘 빨간불이고
// 검토는 늘 파란불이라, 둘 다 아무 뜻이 없어진다.
export const STALL_RULES = {
  신청서: {
    limit: 1,
    waitingOn: 'ax',
    to: '/review',
    act: '접수함 열기',
    stuck: '낸 지 며칠째인데 아직 아무도 안 봤습니다.',
    next: '판정까지 안 해도 됩니다. 봤다고 알리는 것만으로 부서는 기다릴 수 있게 됩니다.',
  },
  검토: {
    limit: 2,
    waitingOn: 'ax',
    to: '/review',
    act: '판정하기',
    stuck: '열어는 봤는데 수용·반려·보류 중 아무것도 안 하셨습니다.',
    next: '지금 못 하는 것이면 보류로 미루고 언제 다시 볼지 적어 주세요. 판정이 늦는 것보다 아무 말이 없는 것이 나쁩니다.',
  },
  협의안: {
    limit: 5,
    waitingOn: 'both',
    to: '/agreement',
    act: '협의안 보기',
    stuck: '무엇을 통과로 볼지 정하다가 멈췄습니다.',
    next: '여기서 오래 끄는 것은 대개 부서와 담당자가 서로 상대의 답을 기다리고 있는 것입니다. 먼저 초안을 던지면 풀립니다.',
  },
  제작: {
    limit: 10,
    waitingOn: 'ax',
    to: '/build',
    act: '제작 기록 보기',
    stuck: '만들기 시작한 뒤로 진척 기록이 없습니다.',
    next: '막힌 데가 있으면 그것부터 기록에 남기세요. 부서는 "만드는 중"이라는 말만 몇 주째 듣고 있습니다.',
  },
  베타테스트: {
    limit: 5,
    waitingOn: 'dept',
    to: '/beta',
    act: '베타 결과 보기',
    stuck: '부서에 써 보라고 넘긴 뒤로 답이 없습니다.',
    next: '부서가 바빠서 못 써 본 것입니다. 한 번 물어보세요 — 안 물으면 이 건은 여기서 조용히 끝납니다.',
  },
  사용법서: {
    limit: 3,
    waitingOn: 'ax',
    to: '/manual',
    act: '사용법서 쓰기',
    stuck: '통과는 했는데 사용법서가 안 나왔습니다.',
    next: '여기서 멈춘 건이 가장 아깝습니다. 다 만들어 놓고 넘기지를 못한 상태입니다.',
  },
  배포: {
    limit: 2,
    waitingOn: 'ax',
    to: '/deploy',
    act: '인수인계 보기',
    stuck: '넘기는 절차가 끝나지 않았습니다.',
    next: '받았다는 확인이 없으면 나중에 "그런 거 받은 적 없다"가 됩니다.',
  },
  성과: {
    limit: 14,
    waitingOn: 'dept',
    to: '/result',
    act: '성과 보기',
    stuck: '넘긴 뒤로 성과를 정리하지 않았습니다.',
    next: '정리 안 한 성과는 없는 성과입니다. 다음 신청서를 받을 근거가 여기서 나옵니다.',
  },
}

export const STAGE_ORDER = Object.keys(STALL_RULES)

// 누구를 기다리는가.
//
// mine은 "이건 내가 움직여야 풀린다"는 뜻이다. 담당자 화면에서 위로 올리는
// 기준으로 쓴다.
export const WAITING = {
  ax: { label: '제 차례입니다', mine: true },
  dept: { label: '부서 답을 기다리는 중', mine: false },
  both: { label: '같이 앉아야 넘어갑니다', mine: true },
}

// 부서를 기다리는 건이라도 이만큼 넘으면 담당자 몫이 된다.
//
// "부서가 답을 안 준다"는 한 주까지는 사실이다. 3주가 되면 그건 부서 탓이
// 아니라 한 번도 안 물어본 사람 탓이다. 기다림을 방치로 바꾸는 선을 여기
// 둔다.
export const ESCALATE = 2

// 보류는 멈춘 것이 아니라 미뤄 둔 것이다.
//
// 판정을 했고 이유도 적혀 있다. 늦었다고 하면 안 된다. 다만 미뤄 둔 채로
// 한 달이 지나면 "다시 볼 때"가 지났는지 확인은 해야 한다.
export const HOLD_LIMIT = 30

// 판정이 끝나서 더 볼 것이 없는 상태.
const CLOSED = ['반려', '완료']

// 접수함이 이미 세고 있는 앞 단계.
const EARLY_STAGES = ['신청서', '검토']

export function toMs(sqlTime) {
  if (!sqlTime) return null
  const ms = Date.parse(`${String(sqlTime).replace(' ', 'T')}Z`)
  return Number.isFinite(ms) ? ms : null
}

const DAY = 86400000

export function daysBetween(fromMs, toMsValue) {
  if (fromMs == null || toMsValue == null) return 0
  return Math.max(0, Math.floor((toMsValue - fromMs) / DAY))
}

const STAGE_NO = Object.fromEntries(STAGE_ORDER.map((s, i) => [s, i]))

// 앞 단계로 내려간 기록을 가른다.
//
// 라이브에서 이걸 안 하고 올렸다가 바로 걸렸다. 이미 배포까지 간 신청서
// 넷이 전부 "검토 단계에 있음"으로 나왔다. 접수함에서 여러 건을 한 번에
// "봤다고 알리기" 하면 검토 단계 기록이 하나 붙는데, 그것을 **검토로
// 되돌아갔다**고 읽은 것이다.
//
// 내려간 기록에는 두 가지가 섞여 있다.
//   진짜 되돌아간 것 — 베타에서 떨어져 제작으로 내려가 다시 만든 경우.
//   지난 단계에 뒤늦게 붙인 메모 — 위 경우.
//
// 둘을 가르는 표시는 하나뿐이다. **내려갔던 자리에서 원래 있던 데까지
// 다시 올라왔는가.** 되돌아가 다시 만들었으면 그 뒤에 베타든 배포든 기록이
// 또 붙는다. 메모는 거기서 끝나거나, 원래 자리보다 더 앞으로 가 버린다.
function dropBackfilled(rows) {
  const out = []
  let peak = -1
  for (let i = 0; i < rows.length; i += 1) {
    const no = STAGE_NO[rows[i].stage]
    if (no >= peak) {
      out.push(rows[i])
      peak = no
      continue
    }
    const climbsBack = rows
      .slice(i + 1)
      .some((r) => STAGE_NO[r.stage] > no && STAGE_NO[r.stage] <= peak)
    if (climbsBack) {
      out.push(rows[i])
      peak = no
    }
  }
  return out
}

// 이 신청서가 어느 단계에 언제부터 언제까지 있었는가.
//
// 기록을 시각 순으로 훑으면서 단계가 바뀌는 지점을 자른다. 단계 번호로
// 자르지 않는 이유는 **되돌아가는 일이 실제로 있기** 때문이다 — 베타
// 테스트에서 떨어지면 제작으로 내려간다. 그때 제작에 두 번 머문 것을
// 한 번으로 합치면 두 번째로 만든 기간이 통째로 사라진다.
export function spansOf(logs, nowMs, startedAt) {
  const rows = dropBackfilled(
    (logs ?? [])
      .filter((l) => STALL_RULES[l.stage])
      .map((l) => ({ stage: l.stage, at: toMs(l.created_at) }))
      .filter((l) => l.at != null)
      .sort((a, b) => a.at - b.at)
  )

  const start = toMs(startedAt)
  // 기록이 하나도 없으면 낸 그대로 신청서 단계에 있는 것이다.
  if (rows.length === 0) {
    if (start == null) return []
    return [{ stage: '신청서', from: start, to: null, days: daysBetween(start, nowMs), open: true }]
  }

  // 첫 기록보다 앞선 시간은 신청서 단계다. 부서가 내고 담당자가 처음
  // 손대기까지의 공백이 여기 들어간다 — 가장 자주 잊히는 구간이다.
  const spans = []
  if (start != null && rows[0].stage !== '신청서' && start < rows[0].at) {
    spans.push({ stage: '신청서', from: start, to: rows[0].at, days: daysBetween(start, rows[0].at), open: false })
  }

  let cur = { stage: rows[0].stage, from: start != null && rows[0].stage === '신청서' ? start : rows[0].at }
  for (const r of rows.slice(1)) {
    if (r.stage === cur.stage) continue
    spans.push({ ...cur, to: r.at, days: daysBetween(cur.from, r.at), open: false })
    cur = { stage: r.stage, from: r.at }
  }
  spans.push({ ...cur, to: null, days: daysBetween(cur.from, nowMs), open: true })
  return spans
}

function levelOf(days, limit) {
  if (days <= limit) return '괜찮음'
  return days > limit * ESCALATE ? '많이 늦음' : '늦음'
}

// 이 신청서 한 건이 지금 어떤 상태인가.
//
// 판정이 끝난 건(반려·완료)은 null을 돌려준다. 끝난 것을 늦었다고 세면
// 목록이 영원히 안 줄어들고, 그러면 아무도 안 본다.
export function stallOf(app, logs, now) {
  if (!app) return null
  const status = String(app.status ?? '')
  if (CLOSED.includes(status)) return null

  const nowMs = typeof now === 'number' ? now : toMs(now) ?? Date.now()
  const spans = spansOf(logs, nowMs, app.created_at)
  const open = spans[spans.length - 1] ?? null
  if (!open) return null

  const rule = STALL_RULES[open.stage]
  if (!rule) return null

  // 보류는 다른 잣대로 본다.
  if (status === '보류') {
    const days = open.days
    return {
      id: app.id,
      ticket_no: app.ticket_no,
      dept: app.dept,
      title: app.title,
      status,
      stage: open.stage,
      since: open.from,
      days,
      limit: HOLD_LIMIT,
      over: Math.max(0, days - HOLD_LIMIT),
      level: days > HOLD_LIMIT ? '늦음' : '괜찮음',
      held: true,
      waitingOn: 'ax',
      waitingLabel: '미뤄 두신 것입니다',
      mine: true,
      to: '/review',
      act: '다시 보기',
      stuck: '미뤄 둔 지 오래됐습니다.',
      next: '보류할 때 적어 두신 "언제 다시 볼지"가 지났는지 확인해 주세요. 지났으면 다시 판정하거나, 아니면 반려하는 편이 부서에 정직합니다.',
    }
  }

  const level = levelOf(open.days, rule.limit)
  // 부서를 기다리는 것도 너무 오래 두면 안 물어본 사람 몫이 된다.
  const escalated = rule.waitingOn === 'dept' && level === '많이 늦음'

  return {
    id: app.id,
    ticket_no: app.ticket_no,
    dept: app.dept,
    title: app.title,
    status,
    stage: open.stage,
    since: open.from,
    days: open.days,
    limit: rule.limit,
    over: Math.max(0, open.days - rule.limit),
    level,
    held: false,
    waitingOn: rule.waitingOn,
    waitingLabel: escalated
      ? '기다리기만 한 지 오래됐습니다'
      : WAITING[rule.waitingOn].label,
    mine: escalated || WAITING[rule.waitingOn].mine,
    to: rule.to,
    act: rule.act,
    stuck: rule.stuck,
    next: escalated
      ? `${rule.next} ${open.days}일째 기다리기만 한 것은 부서 사정이 아니라 한 번도 안 물어본 쪽 몫입니다.`
      : rule.next,
  }
}

// 단계마다 보통 며칠 걸렸는가.
//
// 지금 열려 있는 구간은 안 센다. 아직 안 끝난 것을 "3일 걸렸다"로 세면
// 오래 걸리는 단계일수록 짧아 보이는 거꾸로 된 숫자가 나온다.
export const MIN_SAMPLE = 3

function median(nums) {
  const s = [...nums].sort((a, b) => a - b)
  if (s.length === 0) return null
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : Math.round(((s[mid - 1] + s[mid]) / 2) * 10) / 10
}

export function stageTypical(allSpans) {
  const byStage = new Map(STAGE_ORDER.map((s) => [s, []]))
  for (const sp of allSpans ?? []) {
    if (sp.open) continue
    if (!byStage.has(sp.stage)) continue
    byStage.get(sp.stage).push(sp.days)
  }
  return STAGE_ORDER.map((stage) => {
    const days = byStage.get(stage)
    const enough = days.length >= MIN_SAMPLE
    return {
      stage,
      n: days.length,
      // 표본이 모자라면 숫자를 아예 안 준다. 한 건 보고 "보통 2일"이라고
      // 하면 그 다음부터 이 화면의 숫자를 아무도 안 믿는다.
      median: enough ? median(days) : null,
      enough,
      limit: STALL_RULES[stage].limit,
    }
  })
}

// 담당자 화면에 올릴 순서.
//
// 늦은 정도가 아니라 **내가 움직여야 풀리는가**를 먼저 본다. 부서 답을
// 기다리는 건이 맨 위에 있으면 담당자는 목록을 보고 할 수 있는 것이 없다.
export function stallBoard(items, now) {
  const nowMs = typeof now === 'number' ? now : toMs(now) ?? Date.now()
  const all = []
  const spans = []
  for (const it of items ?? []) {
    const s = stallOf(it.application ?? it, it.logs, nowMs)
    if (s) all.push(s)
    spans.push(...spansOf(it.logs, nowMs, (it.application ?? it).created_at))
  }

  const late = all.filter((s) => s.level !== '괜찮음')
  const rank = { '많이 늦음': 2, 늦음: 1, 괜찮음: 0 }
  late.sort(
    (a, b) =>
      Number(b.mine) - Number(a.mine) ||
      rank[b.level] - rank[a.level] ||
      b.over - a.over ||
      String(a.ticket_no).localeCompare(String(b.ticket_no))
  )

  return {
    stalls: late,
    onTrack: all.filter((s) => s.level === '괜찮음'),
    typical: stageTypical(spans),
    summary: {
      moving: all.length,
      late: late.length,
      mine: late.filter((s) => s.mine).length,
      waitingDept: late.filter((s) => !s.mine).length,
      // 접수함이 이미 세고 있는 앞 두 단계를 뺀 값.
      //
      // 첫 화면의 할 일 목록은 "하루 넘게 못 본 신청서"를 따로 센다. 여기서
      // 또 세면 같은 건이 두 줄에 올라가고, 담당자는 두 배로 밀린 줄 안다.
      // 접수함에 안 뜨는 중간 단계 것만 넘긴다 — 그게 가장 조용히 늦는다.
      mineLater: late.filter((s) => s.mine && !EARLY_STAGES.includes(s.stage)).length,
      worst: late[0]?.days ?? 0,
    },
  }
}

// 목록 위에 한 줄로 뭐라고 쓸 것인가.
export function boardLine(summary) {
  const s = summary ?? {}
  if (!s.moving) return '진행 중인 신청서가 없습니다.'
  if (!s.late) return `진행 중인 ${s.moving}건 모두 제때 움직이고 있습니다.`
  const parts = [`진행 중인 ${s.moving}건 가운데 ${s.late}건이 예상보다 오래 걸리고 있습니다.`]
  if (s.mine > 0) parts.push(`그중 ${s.mine}건은 제가 움직여야 풀립니다.`)
  if (s.waitingDept > 0) parts.push(`${s.waitingDept}건은 부서 답을 기다리는 중입니다.`)
  return parts.join(' ')
}
