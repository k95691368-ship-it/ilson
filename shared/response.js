// 부서에 부탁한 것 중 실제로 답이 온 비율.
//
// 이 사이트는 부서에게 다섯 가지를 부탁한다 — 합격 기준을 봐 달라, 넘긴
// 것을 받았다고 눌러 달라, 성과 숫자가 체감과 맞는지 봐 달라, 시험판을 써
// 보고 막힌 곳을 알려 달라, 보류 조건이 풀리면 말해 달라.
//
// 부탁하는 자리는 회차마다 하나씩 만들었다. 그런데 **그 부탁이 실제로
// 먹혔는지는 한 번도 안 셌다.** 화면마다 "이건 부서가 해줘야 합니다"라고
// 적어 두고, 정작 부서가 몇 번이나 해줬는지는 아무도 모른다.
//
// 이게 이 사이트에서 가장 중요한 숫자다. 여기가 낮으면 나머지 기록이
// 아무리 촘촘해도 **혼자 만든 것**이다. 그리고 낮을 때 그것을 숨기지 않는
// 것이 이 사이트가 부서에게 요구하는 태도와 같다.
//
// 응답률을 목표치와 견주지 않는다. "80% 넘으면 좋음" 같은 선을 그으면 그
// 선에 맞추게 되고, 애초에 표본이 이 정도 크기에서는 비율보다 **몇 건 중
// 몇 건인지**가 정직하다.

// 부탁 다섯 가지. 각각 "언제 부탁하게 되는가"와 "무엇이 오면 답인가".
export const ASKS = [
  {
    key: 'signoff',
    label: '합격 기준을 봐 달라',
    // 기준을 다 확정한 뒤에 묻는다. 확정 전에 물으면 바뀔 것을 보게 된다.
    why: '이 기준으로 통과·불통과를 판정합니다. 안 보신 채로 넘어가면 나중에 "내가 원한 건 이게 아닌데"라고 하셔도 "기준을 통과했습니다"라고밖에 답할 수 없습니다.',
  },
  {
    key: 'accept',
    label: '넘긴 것을 받았다고 눌러 달라',
    why: '넘겼다고 받은 것이 아닙니다. 확인이 없으면 이게 실제로 쓰이는지 알 수 없습니다.',
  },
  {
    key: 'outcome',
    label: '성과 숫자가 체감과 맞는지 봐 달라',
    why: '만든 사람만 아는 성과는 성과가 아닙니다.',
  },
  {
    key: 'beta',
    label: '시험판을 써 보고 막힌 곳을 알려 달라',
    why: '기계 채점은 "쓰기 불편하다"를 채점하지 못합니다.',
  },
  {
    key: 'hold',
    label: '보류 조건이 풀리면 알려 달라',
    why: '조건이 풀린 것은 부서만 압니다. 저희가 모르면 그대로 묻힙니다.',
  },
]

export function askOf(key) {
  return ASKS.find((a) => a.key === key) ?? null
}

// 부탁마다 몇 건에 물었고 몇 건이 답했는가.
//
// rows 한 줄 = 신청서 한 건. { key, asked, answered, proxied } 형태로 이미
// 세어 온 것을 받는다. 여기서 다시 세지 않는다 — 두 군데서 세면 두 숫자가
// 달라지고 그러면 둘 다 못 믿는다.
export function responseRate(rows) {
  const per = ASKS.map((a) => {
    const r = (rows ?? []).find((x) => x?.key === a.key) ?? {}
    const asked = Number(r.asked) || 0
    const answered = Number(r.answered) || 0
    const proxied = Number(r.proxied) || 0
    return {
      ...a,
      asked,
      answered,
      proxied,
      // 안 물어본 것에 비율을 매기지 않는다. 0/0을 0%로 적으면 "부서가 안
      // 해줬다"로 읽히는데 사실은 물어본 적이 없는 것이다.
      percent: asked > 0 ? Math.round((answered / asked) * 100) : null,
      never: asked === 0,
    }
  })

  const asked = per.reduce((n, x) => n + x.asked, 0)
  const answered = per.reduce((n, x) => n + x.answered, 0)
  const proxied = per.reduce((n, x) => n + x.proxied, 0)

  return {
    per,
    asked,
    answered,
    proxied,
    percent: asked > 0 ? Math.round((answered / asked) * 100) : null,
    // 아직 아무것도 안 물어봤으면 이 화면은 할 말이 없다.
    show: asked > 0,
    // 답을 못 받은 것. 이게 담당자가 쫓아가야 할 목록이다.
    waiting: asked - answered,
  }
}

// 뭐라고 적을 것인가.
//
// 비율만 크게 적지 않는다. 표본이 이 정도일 때 "60%"는 3/5인지 60/100인지
// 모르는 숫자다. 몇 건 중 몇 건인지를 먼저 적는다.
export function responseLine(r) {
  if (!r?.show) return null
  const base = `부서에 ${r.asked}번 부탁드렸고 ${r.answered}번 답을 받았습니다.`
  if (r.proxied > 0) {
    return `${base} 그와 별개로 ${r.proxied}건은 담당자가 대신 눌러 둔 것이라 부서 응답으로 세지 않았습니다.`
  }
  return base
}

// 이 숫자를 어떻게 읽어야 하는가.
//
// 낮으면 낮다고 말한다. 여기서 변명하면 이 사이트가 부서에게 요구하는
// 태도와 어긋난다.
export function responseNote(r) {
  if (!r?.show) return null
  if (r.waiting === 0) {
    return '부탁드린 것은 전부 답을 받았습니다.'
  }
  if (r.answered === 0) {
    return `아직 한 건도 답을 못 받았습니다. 부탁하는 자리는 만들어 뒀지만 실제로 눌리지는 않았다는 뜻이고, 그렇다면 이 기록은 아직 혼자 만든 것입니다.`
  }
  return `${r.waiting}건은 아직 답을 못 받았습니다. 부서가 안 해주는 것과 저희가 안 여쭤본 것은 다른데, 여기 있는 것은 여쭤봤는데 답이 없는 쪽입니다.`
}
