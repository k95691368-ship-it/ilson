import { describe, it, expect } from 'vitest'
import { findSimilar } from '../shared/similar.js'
import { compare } from '../shared/compare.js'
import { applyQuery, facetCounts } from '../src/lib/inbox.js'
import { stallBoard } from '../shared/stall.js'

// 데이터가 쌓였을 때 무너지지 않는가.
//
// 지금 이 사이트가 빠른 이유의 절반은 DB 가 비어 있기 때문이다. 신청서가
// 스무 건일 때는 무엇을 어떻게 짜도 빠르다. 문제는 이백 건, 팔백 건이 됐을
// 때인데, 그때 느려지는 것은 배포하고 몇 달 뒤에야 드러난다.
//
// 그래서 재 둔다. 여기서 보는 것은 "몇 밀리초인가"가 아니라 **몇 배로
// 늘어나는가**다. 밀리초는 기계마다 다르지만, 데이터가 네 배가 됐을 때
// 열여섯 배로 늘어나는 것은 어느 기계에서든 제곱이다.

const WORDS =
  '정산 엑셀 매출 재고 발주 세금 보고 마감 채널 쿠팡 올리브영 자사몰 시트 합계 반품 환불 수수료 원가 마진 주간'.split(
    ' '
  )
const pick = (n, seed) =>
  Array.from({ length: n }, (_, i) => WORDS[(seed * 7 + i * 13) % WORDS.length]).join(' ')

const app = (i) => ({
  id: `app_${i}`,
  ticket_no: `AX-${i}`,
  dept: ['재무', '마케팅', '영업', '운영', '인사', 'SCM'][i % 6],
  title: pick(4, i),
  bottleneck: pick(12, i),
  problem: pick(14, i + 3),
  wish: pick(8, i + 5),
  status: ['접수', '수용', '반려', '보류', '진행중', '완료'][i % 6],
  current_minutes: 30 + (i % 90),
  current_people: 1 + (i % 4),
  current_frequency: '주 1회',
  created_at: `2026-0${1 + (i % 8)}-1${i % 9} 09:00:00`,
})

const make = (n) => Array.from({ length: n }, (_, i) => app(i))

// 다섯 번 돌려 평균을 낸다. 한 번만 재면 그날 기계 사정이 그대로 결론이 된다.
function ms(fn) {
  fn()
  const started = performance.now()
  for (let i = 0; i < 5; i += 1) fn()
  return (performance.now() - started) / 5
}

// 데이터 네 배에 시간이 몇 배가 되는가.
//
// 선형이면 4배, 제곱이면 16배다. 8배를 넘으면 제곱 쪽으로 넘어간 것으로 본다.
// 느슨하게 잡는 이유는 이 검사가 기계가 바쁘다는 이유로 빨개지면 아무도
// 안 믿게 되기 때문이다. 잡으려는 것은 흔들림이 아니라 차수다.
const QUADRATIC = 8

function growth(fn) {
  const small = make(200)
  const big = make(800)
  const a = ms(() => fn(small))
  const b = ms(() => fn(big))
  // 너무 빨라 잴 수 없는 것은 비율을 따질 수 없다. 그건 통과다.
  if (a < 0.05) return { ratio: 1, a, b }
  return { ratio: b / a, a, b }
}

describe('데이터가 네 배가 돼도 제곱으로 늘지 않는다', () => {
  it('비슷한 신청서 찾기', () => {
    const g = growth((list) => findSimilar(list[0], list, { limit: 2 }))
    expect(g.ratio, `200건 ${g.a.toFixed(1)}ms → 800건 ${g.b.toFixed(1)}ms`).toBeLessThan(QUADRATIC)
  })

  it('둘 견주기', () => {
    const g = growth((list) => compare(list[0], list[1], list))
    expect(g.ratio, `200건 ${g.a.toFixed(1)}ms → 800건 ${g.b.toFixed(1)}ms`).toBeLessThan(QUADRATIC)
  })

  it('접수함 거르기', () => {
    const g = growth((list) => applyQuery(list, { q: '정산', sort: 'old' }))
    expect(g.ratio, `200건 ${g.a.toFixed(1)}ms → 800건 ${g.b.toFixed(1)}ms`).toBeLessThan(QUADRATIC)
  })

  it('칩 개수 세기', () => {
    const g = growth((list) => facetCounts(list, {}))
    expect(g.ratio, `200건 ${g.a.toFixed(1)}ms → 800건 ${g.b.toFixed(1)}ms`).toBeLessThan(QUADRATIC)
  })

  it('막힌 곳 판 세우기', () => {
    const g = growth((list) =>
      stallBoard(
        list.map((a) => ({ application: a, logs: [{ stage: '검토', created_at: a.created_at }] })),
        Date.now()
      )
    )
    expect(g.ratio, `200건 ${g.a.toFixed(1)}ms → 800건 ${g.b.toFixed(1)}ms`).toBeLessThan(QUADRATIC)
  })

  it('이 검사가 헛돌지 않는다', () => {
    // 일부러 제곱으로 도는 것을 넣어 본다. 이게 안 걸리면 위 다섯도 못 믿는다.
    const g = growth((list) => list.forEach((x) => list.forEach((y) => x.id === y.id)))
    expect(g.ratio).toBeGreaterThan(QUADRATIC)
  })
})
