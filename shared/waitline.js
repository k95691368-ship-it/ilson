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
