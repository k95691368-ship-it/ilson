// 이 숫자가 무엇 위에 서 있는가.
//
// 첫 화면은 "접수 12건, 완료 1건, 연 N시간" 같은 숫자를 크게 보여 준다.
// 그런데 그중 몇 건은 시연을 위해 **내가 심은 것**이다. 그 사실이 지금
// `/review` 화면 한 군데에만 적혀 있다. 그 화면을 안 열면 모른다.
//
// 이건 작은 문제가 아니다. 이 사이트가 파는 것이 "기록"인데, 기록의 출처를
// 안 밝히면 나머지 기록도 못 믿는다. `/honesty`에 "증명하지 못한 것"을
// 적어 두는 사이트가 정작 자기 첫 화면 숫자의 출처는 안 적는 셈이다.
//
// 그래서 화면마다 자기 숫자가 어디서 왔는지 말하게 한다. 감추지도, 과장해서
// 사과하지도 않는다 — **심은 것은 심었다고 하고, 어떻게 심었는지는 공개해
// 둔다.** 그게 이 사이트가 부서에게 요구하는 것과 같은 태도다.

// 시연용으로 심은 신청서의 접수번호. 이 앞자리로만 가른다.
//
// 표에 `is_demo` 같은 칸을 두면 좋겠지만 새 컬럼을 못 만든다. 접수번호는
// 심을 때 이 앞자리로 찍으므로 그것으로 가른다 — 부서가 직접 낸 것은
// 무작위 세 글자라 겹치지 않는다.
export const DEMO_PREFIX = 'AX-DEM-'

export function isDemo(ticketNo) {
  return String(ticketNo ?? '').startsWith(DEMO_PREFIX)
}

// 지금 이 목록이 무엇으로 이루어져 있는가.
export function provenanceOf(items) {
  const list = items ?? []
  const demo = list.filter((a) => isDemo(a?.ticket_no)).length
  const real = list.length - demo

  return {
    total: list.length,
    demo,
    real,
    // 심은 것이 하나도 없으면 굳이 말하지 않는다. 할 말이 없는데 띠를
    // 띄우면 그다음부터 그 자리는 안 읽힌다.
    show: demo > 0,
    // 전부 심은 것인가, 섞여 있는가.
    onlyDemo: demo > 0 && real === 0,
    percent: list.length > 0 ? Math.round((demo / list.length) * 100) : 0,
  }
}

// 뭐라고 적을 것인가.
//
// "이건 가짜입니다"라고 쓰지 않는다. 그러면 실제로 돌아간 파이프라인까지
// 가짜로 읽힌다. 무엇이 심은 것이고 무엇이 진짜로 돌아간 것인지를 가른다.
export function provenanceLine(p) {
  if (!p?.show) return null
  if (p.onlyDemo) {
    return `이 화면의 숫자는 시연용으로 심은 신청서 ${p.demo}건 위에 서 있습니다.`
  }
  return `신청서 ${p.total}건 중 ${p.demo}건은 시연용으로 심은 것이고, ${p.real}건은 이 사이트에서 직접 받은 것입니다.`
}

// 그럼 무엇이 진짜인가.
//
// 심은 것은 신청서**뿐**이다. 그 뒤로 일어난 일 — 판정, 협의, 파이프라인
// 실행, 격리, 금액 계산 — 은 전부 이 사이트가 실제로 한 것이다. 그걸
// 같이 말하지 않으면 "전부 꾸며 낸 화면"으로 읽힌다.
export function provenanceDetail(p) {
  if (!p?.show) return null
  return {
    seeded: '신청서의 문장(병목·문제·바라는 것)은 시연을 위해 미리 써 둔 것입니다.',
    real: '판정·협의안·합격 기준·파이프라인 실행·격리·금액 계산은 그 위에서 실제로 돌아간 결과입니다. 미리 적어 둔 답이 없습니다.',
    data: '파이프라인이 읽는 원본 파일도 만들어 낸 것입니다. 어떻게 더럽혔는지(병합셀·인코딩·합계행·음수행)까지 공개해 뒀습니다.',
    where: '/honesty',
    doc: 'docs/시험데이터-설계.md',
  }
}
