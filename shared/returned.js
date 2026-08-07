// 이 부서에 지금까지 얼마를 돌려드렸는가.
//
// 성과는 신청서 한 건씩만 보인다(/result). 부서 단위로 합친 숫자가 아무
// 데도 없다. 그런데 부서 담당자와 마주 앉을 때 담당자가 할 수 있는 가장
// 강한 말이 그것이다 — **"이 부서에 지금까지 N시간을 돌려드렸습니다."**
//
// 부서 화면(/dept/:dept)은 지금 "내가 못 준 것"과 "부서가 답해 주셔야 할
// 것"만 말한다. 둘 다 빚 이야기다. 준 것은 한 마디도 안 한다. 그러면
// 그 화면은 만날 때마다 사과만 하는 자리가 된다.
//
// 다만 세는 방식이 이 사이트의 다른 곳과 같아야 한다.
//
//   ① **부서가 확인한 것만 성과로 센다.** 만든 사람만 아는 성과는 성과가
//      아니다. 확인 안 된 것은 따로 세서 "아직 확인 못 받았습니다"라고
//      적는다. 합쳐 세면 이 사이트가 자기 입으로 한 말이 된다.
//   ② **반박이 살아 있으면 보수적 추정이다.** 성과 화면이 그렇게 하고
//      있는데 여기서만 당당한 숫자를 내면 두 화면이 다른 말을 한다.
//   ③ **돌려드린 시간만 센다.** 금액은 시급을 곱한 것이라 시급을 어떻게
//      잡느냐로 커졌다 작아졌다 한다. 시간은 그 부서가 실제로 겪은 것이다.

// 한 건이 돌려준 시간(초).
//
// 기준선 × 실행 횟수에서 자동화 뒤에도 드는 시간을 뺀다. 검수와 재작업은
// 없어진 것이 아니라 옮겨간 것이다.
export function returnedSecondsOf(row) {
  const runs = Number(row?.runs) || 0
  if (runs <= 0) return 0
  const base = Number(row?.median_seconds)
  if (!Number.isFinite(base) || base <= 0) return 0
  const people = Math.max(1, Number(row?.people) || 1)

  const before = base * people * runs
  const after =
    (Number(row?.duration_total_ms) || 0) / 1000 +
    (Number(row?.review_seconds) || 0) +
    (Number(row?.rework_seconds) || 0)

  return Math.max(0, before - after)
}

// 부서 단위 합계.
//
// rows 한 줄 = 그 부서 신청서 한 건. 이미 세어 온 것을 받는다.
export function returnedFor(rows) {
  const list = rows ?? []
  let confirmedSeconds = 0
  let unconfirmedSeconds = 0
  const confirmed = []
  const unconfirmed = []

  for (const r of list) {
    const secs = returnedSecondsOf(r)
    if (secs <= 0) continue
    const item = {
      ticket_no: r.ticket_no,
      title: r.title,
      seconds: secs,
      hours: Math.round((secs / 3600) * 10) / 10,
      runs: Number(r.runs) || 0,
      // 반박이 살아 있으면 성과 화면이 '보수적 추정'으로 내린다. 여기서도
      // 그렇게 말한다.
      shaky: (Number(r.open_challenges) || 0) > 0,
    }
    if (r.dept_confirmed_at) {
      confirmedSeconds += secs
      confirmed.push(item)
    } else {
      unconfirmedSeconds += secs
      unconfirmed.push(item)
    }
  }

  const hours = (s) => Math.round((s / 3600) * 10) / 10
  return {
    // 할 말이 있을 때만 화면에 뜬다. 0시간을 크게 적으면 그 자리는
    // 그다음부터 안 읽힌다.
    show: confirmedSeconds > 0 || unconfirmedSeconds > 0,
    confirmedHours: hours(confirmedSeconds),
    unconfirmedHours: hours(unconfirmedSeconds),
    confirmed,
    unconfirmed,
    shaky: [...confirmed, ...unconfirmed].some((x) => x.shaky),
  }
}

// 부서에게 뭐라고 말할 것인가.
export function returnedLine(dept, r) {
  if (!r?.show) return null
  if (r.confirmedHours <= 0) {
    // 부서가 확인해 준 것이 없으면 성과라고 말하지 않는다.
    return `${dept}에서 아직 확인해 주신 성과가 없습니다.`
  }
  return `${dept}에 지금까지 ${r.confirmedHours}시간을 돌려드렸습니다.`
}

export function returnedNote(r) {
  if (!r?.show) return null
  const parts = []
  if (r.unconfirmedHours > 0) {
    parts.push(
      `그 밖에 ${r.unconfirmedHours}시간분은 아직 부서 확인을 못 받았습니다 — 확인 전까지는 성과로 세지 않습니다.`
    )
  }
  if (r.shaky) {
    parts.push('반박이 아직 남아 있는 건이 섞여 있어 보수적으로 잡은 숫자입니다.')
  }
  parts.push('기준선에 실행 횟수를 곱한 뒤, 자동화 뒤에도 드는 검수·재작업 시간을 뺀 값입니다.')
  return parts.join(' ')
}
