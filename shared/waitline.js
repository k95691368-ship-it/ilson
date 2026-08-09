// "우리 것은 왜 아직입니까"에 답한다.
//
// 부서가 조회 화면을 여는 이유는 대개 하나다. 낸 지 2주가 됐는데 아무
// 소식이 없어서다. 그런데 지금 그 화면은 "신청서 단계에 있습니다"까지만
// 말한다. 그건 이미 아는 것이다. 알고 싶은 것은 **내 앞에 무엇이 있고,
// 왜 그것이 먼저인가**다.
//
// 답할 재료는 이미 다 있다. 담당자가 우선순위 판에서 "이걸 먼저 한다"를
// 고를 때 이유를 반드시 적게 되어 있고, 그 검증 문구가 이렇다 —
// *"뒤로 밀린 부서가 물어볼 때 답할 것이 있어야 합니다."*
// 그래 놓고 그 답을 부서가 볼 수 있는 자리에 안 뒀다. 답을 적어 두고
// 서랍에 넣어 둔 셈이다.
//
// **없는 순서를 지어내지 않는다.** 담당자가 아직 아무것도 안 정했으면
// "아직 안 정했습니다"가 정직한 답이다. 규칙으로 등수를 매겨 보여 주면
// 그건 담당자가 한 판단이 아닌데 판단처럼 보인다.

// 이미 시작한 것. 앞에 있다고 말할 때 이것부터 센다.
const RUNNING = ['진행중']
// 아직 안 끝난 것. 끝난 것은 앞을 막지 않는다.
const CLOSED = ['완료', '반려']

// "그래서 언제쯤 됩니까"에 지금까지의 기록으로 답한다.
//
// 부서가 제일 먼저 묻는 것이 이것이다. 여태 이 화면은 순서만 말했다 —
// "앞에 1건 있습니다"까지. 그건 몇째냐는 답이지 언제냐는 답이 아니다.
//
// 날짜를 약속하지 않는다. 대신 **지금까지 실제로 걸린 날수**를 보여 준다.
// 첫 화면이 이미 그 값을 세고 있다(접수부터 인수인계까지 중앙값). 같은
// 값을 쓴다 — 두 화면이 다른 날수를 말하면 둘 다 못 믿는다.
//
// 표본이 적으면 적다고 말한다. 한 건 넘겨 놓고 "보통 9일 걸립니다"라고
// 하면 그건 통계가 아니라 우연이다.
export function leadGuess(lead) {
  const n = Number(lead?.count) || 0
  // Number(null) 은 0이고 0은 유한하다. 그대로 두면 값이 없을 때 "0일
  // 걸렸습니다"가 된다 — 부서는 그걸 "바로 됩니다"로 읽는다.
  // 이 저장소에서 같은 함정에 다섯 번째다. 숫자로 바꾸기 **전에** 없는
  // 값부터 걸러 낸다.
  const raw = lead?.medianDays
  const days = raw == null || raw === '' ? NaN : Number(raw)
  if (n === 0 || !Number.isFinite(days)) {
    return {
      show: true,
      text: '아직 끝까지 간 것이 한 건도 없어서 얼마나 걸릴지 말씀드릴 수가 없습니다. 지어내지 않겠습니다.',
      shaky: true,
    }
  }
  const base = `지금까지 넘긴 ${n}건은 접수부터 부서에 넘기기까지 가운데값으로 ${days}일 걸렸습니다.`
  if (n < 3) {
    return {
      show: true,
      // 한두 건으로 낸 값은 다음 건에서 크게 달라진다. 그 사실을 숫자보다
      // 먼저 읽히게 둔다.
      text: `${base} 다만 ${n}건뿐이라 이 숫자는 다음 건에서 크게 달라질 수 있습니다 — 약속으로 받지 말아 주세요.`,
      shaky: true,
    }
  }
  return {
    show: true,
    text: `${base} 앞에 놓인 건이 있으면 그만큼 더 걸립니다.`,
    shaky: false,
  }
}

export function waitLine({ mine, picked, running } = {}) {
  const status = mine?.status ?? null

  // 판정 전이면 순서 이야기를 꺼낼 자리가 아니다. 아직 하기로 한 것도
  // 아닌데 "몇 번째"라고 하면 받아들여진 줄 안다.
  if (!status || status === '접수' || status === '검토중') {
    return {
      show: status === '접수' || status === '검토중',
      phase: 'before',
      aheadPicked: [],
      aheadRunning: running ?? [],
      headline: '아직 판정 전입니다',
      body:
        '먼저 이 일을 맡을지부터 정합니다. 그다음에 순서를 정합니다. 순서가 정해지면 여기에 몇 번째인지 적힙니다.',
      mePicked: false,
    }
  }

  if (CLOSED.includes(status)) {
    return { show: false, phase: 'closed', aheadPicked: [], aheadRunning: [], headline: null, body: null, mePicked: false }
  }

  if (status === '보류') {
    // 보류는 순서 문제가 아니다. 조건이 안 풀린 것이라 줄에 서 있지도 않다.
    return { show: false, phase: 'held', aheadPicked: [], aheadRunning: [], headline: null, body: null, mePicked: false }
  }

  const list = (picked ?? []).filter((p) => p && p.application_id)
  const mePick = list.find((p) => p.application_id === mine?.id) ?? null
  const ahead = mePick ? [] : list
  const run = (running ?? []).filter((r) => r.id !== mine?.id)

  if (mePick) {
    return {
      show: true,
      phase: 'picked',
      aheadPicked: [],
      aheadRunning: run,
      mePicked: true,
      pickWhy: mePick.why ?? null,
      pickAt: mePick.at ?? null,
      headline: '먼저 하기로 정한 것에 들어 있습니다',
      body:
        run.length > 0
          ? `지금 만들고 있는 ${run.length}건이 끝나는 대로 시작합니다.`
          : '지금 만들고 있는 다른 건은 없습니다.',
    }
  }

  if (list.length === 0) {
    // 여기서 "곧 하겠습니다"라고 하지 않는다. 안 정한 것은 안 정한 것이다.
    return {
      show: true,
      phase: 'unranked',
      aheadPicked: [],
      aheadRunning: run,
      mePicked: false,
      headline: '아직 순서를 정하지 않았습니다',
      body:
        '하기로 한 것 중에 무엇부터 할지 담당자가 아직 안 정했습니다. 정해지면 여기에 몇 번째인지와 그 이유가 적힙니다. 급하시면 알려주세요 — 그것도 판단 재료입니다.',
    }
  }

  return {
    show: true,
    phase: 'behind',
    aheadPicked: ahead,
    aheadRunning: run,
    mePicked: false,
    headline: `앞에 ${ahead.length}건이 있습니다`,
    body:
      '담당자가 먼저 하기로 정한 것들입니다. 왜 그것이 먼저인지도 같이 적어 두었습니다 — 납득이 안 되시면 그렇게 말씀해주세요.',
  }
}

// 담당자가 순서를 안 정한 채로 기다리는 부서가 몇이나 되는가.
//
// 이건 담당자 쪽 숫자다. 순서를 안 정하는 것 자체는 잘못이 아니다. 한 건만
// 있으면 정할 것도 없다. 다만 **여럿이 기다리는데 안 정한 것**은 다르다 —
// 그때 부서가 "왜 우리 것은 아직입니까"라고 물으면 댈 말이 없다.
export const UNRANKED_LIMIT = 3

export function unrankedPressure({ waiting, picked } = {}) {
  const n = waiting ?? 0
  const p = (picked ?? []).length
  if (p > 0) return { over: false, waiting: n, picked: p }
  return { over: n >= UNRANKED_LIMIT, waiting: n, picked: 0 }
}

export { RUNNING, CLOSED }
