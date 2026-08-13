// 예시를 넣은 다음, 그래서 뭘 눌러야 하나.
//
// 빈 화면에 "예시 세 건 넣기"를 놨다. 눌러 보면 접수함에 세 건이 들어온다.
// 그리고 거기서 끝난다.
//
// 처음 오신 분 입장에서 보면 이렇다. 여섯 단계 목차가 있고 접수함에
// 신청서가 있다. 그런데 나머지 일곱 단계는 전부 비어 있다.
// 무엇을 눌러야 이 사이트가 말하는 "여섯 단계 기록"을 볼 수 있는지가
// 아무 데도 안 적혀 있다. 한 단계씩 짚어 가려면 각 화면에서 무엇이
// 필요한지를 먼저 알아야 하는데, 그건 눌러 봐야 안다.
//
// 그래서 **지금 다음에 할 것 한 가지**만 말해 준다. 여덟 개를 한꺼번에
// 늘어놓으면 첫 번째도 안 누른다.
//
// 이건 담당자용 할 일 목록(shared/todo.js)과 다른 것이다. 저쪽은 "지금
// 문제가 되는 것"을 급한 순서로 올린다 — 금액이 틀리는 것, 사람이 기다리는
// 것. 이쪽은 **아무 문제가 없어도** 다음 단계로 한 칸 밀어 준다. 보러 오신
// 분에게는 문제가 아니라 길이 필요하다.

// 한 칸씩. 각 칸은 "이 조건이면 여기가 다음 자리"다.
//
// where 는 갈 화면, need 는 그 화면이 받아 주지 않는 조건(미리 말해 주지
// 않으면 막혔을 때 고장인 줄 안다), shows 는 하고 나면 무엇이 보이는지.
//
// **각 칸의 글은 at() 이 보는 조건과 같은 일을 가리켜야 한다.**
// 협의안 칸이 "합격 기준을 적습니다"라고만 적혀 있었다. 그런데 이 단계를
// 넘기는 조건은 기준선 봉인이다. 그래서 시키는 대로 합격 기준을 적어도
// 안내가 그대로 있고, 두 번 세 번 적어도 그대로다 — 안내를 따라가면
// 영영 2단계에 머무른다.
//
// 그리고 봉인은 협의안 화면에서 하는데 그 설명이 제작 칸에 있었다.
// 시키는 대로 제작 화면에 가면 봉인할 자리가 없다.
const STEPS = [
  {
    key: 'review',
    stage: '검토',
    at: (s) => s.total > 0 && s.reviewed === 0,
    label: '신청서 한 건을 판정해 보기',
    what: '접수함에서 아무거나 골라 수용·반려·보류를 누르시면 됩니다.',
    need: '근거를 20자 안 적으면 서버가 막습니다. 반려는 대안까지 받습니다 — 못 만든다는 말만 하고 끝내면 병목은 그대로 남기 때문입니다.',
    shows: '누른 것이 결정 기록에 남고, 부서 쪽 조회 화면의 문장이 그 자리에서 바뀝니다.',
    where: '/review',
  },
  {
    key: 'agreement',
    stage: '협의안',
    at: (s) => s.reviewed > 0 && s.agreed === 0,
    label: '합격 기준을 정하고 기준선을 재 두기',
    what: '무엇까지 되면 성공인지를 적고, 그 일을 사람이 직접 세 번 해 보고 몇 분 걸리는지 재서 봉인합니다.',
    need: '세 번을 안 재면 봉인이 막힙니다. 그리고 봉인해야 이 단계가 끝난 것으로 칩니다 — 합격 기준만 적어서는 안 넘어갑니다.',
    shows: '부서가 그 기준을 항목마다 보고 맞다/아니다를 누를 수 있게 되고, 봉인한 값이 나중에 "얼마나 줄었나"의 바닥이 됩니다.',
    where: '/agreement',
  },
  {
    key: 'build',
    stage: '제작',
    at: (s) => s.agreed > 0 && s.built === 0,
    label: '파일을 올려 실제로 돌려 보기',
    what: '채널 정산서 다섯 종을 올리면 규칙이 하나로 합칩니다.',
    need: '외부 서비스를 부르지 않습니다. 합치는 일은 브라우저 안에서 돌고, 서버에는 몇 줄이 나왔고 몇 줄이 밀렸는지만 남습니다.',
    shows: '못 읽은 줄은 버리지 않고 검토함으로 뺍니다. 숫자를 누르면 원본 파일 몇 번째 줄에서 왔는지까지 되짚습니다.',
    where: '/build',
  },
  {
    key: 'beta',
    stage: '베타테스트',
    at: (s) => s.built > 0 && s.tested === 0,
    label: '합격 기준으로 채점해 보기',
    what: '앞에서 정한 기준으로 기계가 채점하고, 부서가 직접 써 보고 막힌 곳을 적습니다.',
    need: '기계는 "쓰기 불편하다"를 채점하지 못합니다. 그래서 둘 다 받습니다.',
    shows: '통과하지 못하면 다음 단계로 넘어가지 않습니다. 그게 게이트입니다.',
    where: '/beta',
  },
  {
    key: 'result',
    stage: '성과',
    at: (s) => s.tested > 0 && s.confirmed === 0,
    label: '얼마나 줄었는지 세기',
    what: '봉인해 둔 기준선과 실제 실행 기록으로 계산합니다.',
    need: '만든 공수와 검수 시간을 빼고 셉니다. 그리고 부서가 그 숫자에 동의해야 성과로 칩니다.',
    shows: '숫자마다 "이 숫자를 의심해 보세요"가 붙습니다. 반박이 안 풀리면 보수적 추정치로 내려갑니다.',
    where: '/result',
  },
]

// 다 밟은 뒤에 할 말.
//
// "끝났습니다"로 끝내면 그 자리에서 나간다. 끝까지 간 기록 한 건이 이
// 사이트에서 제일 값나가는 것이므로, 그걸 한 장으로 펴서 보게 한다.
const DONE = {
  key: 'record',
  stage: '기록',
  label: '한 건의 기록을 처음부터 끝까지 펴 보기',
  what: '신청서 한 건 아래 여섯 단계에서 있었던 일이 한 문서로 이어집니다.',
  need: '누가 언제 무엇을 왜 그렇게 정했는지가 전부 들어갑니다. 지운 것이 없습니다.',
  shows: '이 문서가 이 사이트가 만들어 내는 물건입니다.',
  where: '/log',
}

// 지금 어느 칸인가.
//
// overview 의 byStage 는 "각 신청서가 지금 머물러 있는 단계"를 센다. 한 건이
// 성과까지 갔으면 앞 단계 칸은 0이 된다 — 그래서 칸별 개수를 그대로 쓰면
// "검토가 0이니 판정부터 하세요"가 되어 뒤로 돌아간다.
//
// 그래서 **누적**으로 바꾼다. 성과에 있는 한 건은 검토도 협의안도 제작도
// 지나온 것이다.
export function passedCounts(byStage = {}) {
  const n = (k) => Number(byStage?.[k]) || 0
  // 뒤에서부터 더해 나간다. 반려·보류는 어느 단계도 지나오지 않은 것으로
  // 치지 않는다 — 판정은 받았으므로 검토는 지났다.
  const confirmed = n('성과')
  const tested = confirmed + n('베타테스트')
  const built = tested + n('제작')
  const agreed = built + n('협의안')
  const reviewed = agreed + n('검토') + n('반려') + n('보류')
  const total = reviewed + n('신청서')
  return { total, reviewed, agreed, built, tested, confirmed }
}

// 다음에 할 것 한 가지.
//
// 없으면 null. 아직 아무것도 안 읽었거나 신청서가 없으면 이 안내가 나설
// 자리가 아니다 — 그때는 "예시 넣기"가 맞는 말이다.
export function nextStep(overview) {
  if (!overview?.byStage) return null
  const s = passedCounts(overview.byStage)
  if (s.total === 0) return null
  const step = STEPS.find((x) => x.at(s))
  if (step) {
    // 같은 칸인데 할 일이 달라진 경우 문구만 바꿔 끼운다.
    const swap = step.instead?.(s)
    return { ...step, ...(swap || {}), remaining: STEPS.length - STEPS.indexOf(step) }
  }
  // 전부 지났다.
  return { ...DONE, remaining: 0 }
}

// 여섯 단계 중 몇 칸까지 왔나. 진행 막대에 쓴다.
export function tourProgress(overview) {
  const s = passedCounts(overview?.byStage ?? {})
  const done = [s.reviewed, s.agreed, s.built, s.tested, s.confirmed].filter((v) => v > 0).length
  // 신청서 자체가 첫 칸이다.
  return { done: s.total > 0 ? done + 1 : 0, total: 6 }
}

export { STEPS as TOUR_STEPS, DONE as TOUR_DONE }
