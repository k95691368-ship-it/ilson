// 채점기가 제대로 채점하는지 확인한다.
//
// 여기서 검사하는 것은 파이프라인이 아니라 **채점기 자체**다.
// 통과해야 할 것을 통과시키는지도 봐야 하지만, 더 중요한 것은
// **틀린 것을 틀렸다고 잡아내는지**다. 다 통과시키는 채점기는 없느니만 못하다.

import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { gradeAll } from '../shared/grade.js'
import { PERIOD } from '../shared/master.js'

const seed = (n) => readFileSync(resolve(process.cwd(), 'seed/out', n))
const NAMES = [
  '01_자사몰_주문내역_2026-06.csv',
  '02_올리브영_정산_2026-06.xlsx',
  '03_쿠팡_정산내역_2026-06.csv',
  '04_amazon-settlement-2026-06.csv',
  '05_Qoo10_JP_決済明細_2026Q2.xlsx',
]

const files = NAMES.map((n) => ({ name: n, buffer: seed(n) }))
const truth = JSON.parse(readFileSync(resolve(process.cwd(), 'seed/out/ground_truth.json'), 'utf8'))

// 3단계에서 확정했다고 가정하는 합격 기준.
const criteria = [
  { id: 'c1', ord: 1, body: '금액 오차 0원', check_kind: 'rule', check_key: 'amount_exact', is_required_safety: 1 },
  { id: 'c2', ord: 2, body: '빼야 할 줄을 빠짐없이', check_kind: 'rule', check_key: 'quarantine_complete', is_required_safety: 1 },
  { id: 'c3', ord: 3, body: '멀쩡한 줄을 빼지 않기', check_kind: 'rule', check_key: 'quarantine_precise', is_required_safety: 1 },
  { id: 'c4', ord: 4, body: '외화 환산', check_kind: 'rule', check_key: 'currency_converted', is_required_safety: 1 },
  { id: 'c5', ord: 5, body: '두 번 넣어도 같은 합계', check_kind: 'rule', check_key: 'idempotent', is_required_safety: 1 },
  { id: 'c6', ord: 6, body: '다른 달 섞지 않기', check_kind: 'rule', check_key: 'period_scoped', is_required_safety: 0 },
  { id: 'c7', ord: 7, body: '반품 분리', check_kind: 'rule', check_key: 'returns_separated', is_required_safety: 0 },
  { id: 'c8', ord: 8, body: '알려 준 코드 기억', check_kind: 'rule', check_key: 'alias_learned', is_required_safety: 0 },
  { id: 'c9', ord: 9, body: '머리글 바뀌면 묻기', check_kind: 'rule', check_key: 'header_change_detected', is_required_safety: 0 },
  { id: 'c10', ord: 10, body: '되짚기', check_kind: 'rule', check_key: 'traceable', is_required_safety: 0 },
  { id: 'c11', ord: 11, body: '계산 순서', check_kind: 'rule', check_key: 'contribution_order', is_required_safety: 0 },
  { id: 'c12', ord: 12, body: '담당자가 혼자 쓸 수 있는가', check_kind: 'human', check_key: null, is_required_safety: 0 },
]

let graded

beforeAll(async () => {
  graded = await gradeAll({ criteria, files, truth, period: PERIOD })
}, 60000)

describe('제대로 만든 것은 통과시킨다', () => {
  it('기계가 채점하는 기준 11개를 모두 통과한다', () => {
    const failed = graded.graded.filter((g) => g.verdict === '실패')
    expect(failed.map((f) => `${f.check_key}: ${f.evidence}`)).toEqual([])
    expect(graded.summary.overall).toBe('통과')
  })

  it('사람이 봐야 하는 기준은 판정한 척하지 않는다', () => {
    const human = graded.graded.find((g) => g.check_key == null)
    expect(human.verdict).toBe('사람확인')
    expect(graded.summary.humanNeeded).toBe(1)
  })

  it('통과에도 근거를 남긴다', () => {
    // "통과"만 있으면 무엇을 확인했는지 알 수 없다.
    for (const g of graded.graded) {
      expect(g.evidence, g.check_key ?? g.body).toBeTruthy()
    }
  })

  it('두 번 넣어도 합계가 그대로임을 실제로 두 번 돌려서 확인한다', () => {
    const g = graded.graded.find((x) => x.check_key === 'idempotent')
    expect(g.verdict).toBe('통과')
    expect(g.evidence).toContain('두 번 넣어도')
  })

  it('알려 준 코드가 다음 실행에서 자동 처리되는 것을 실제로 확인한다', () => {
    const g = graded.graded.find((x) => x.check_key === 'alias_learned')
    expect(g.verdict).toBe('통과')
    expect(g.evidence).toContain('줄었습니다')
  })

  it('머리글을 바꾼 파일을 만들어 넣어 보고 확인한다', () => {
    const g = graded.graded.find((x) => x.check_key === 'header_change_detected')
    expect(g.verdict).toBe('통과')
  })
})

describe('틀린 것은 틀렸다고 잡아낸다', () => {
  it('금액이 다르면 잡아내고 어느 채널이 얼마나 틀렸는지 말한다', async () => {
    // 정답을 일부러 틀리게 만든다. 채점기가 이걸 통과시키면 안 된다.
    const brokenTruth = {
      ...truth,
      agg_by_channel: truth.agg_by_channel.map((t) =>
        t.channel === '쿠팡' ? { ...t, net_revenue_krw: t.net_revenue_krw + 50000 } : t
      ),
    }
    const r = await gradeAll({
      criteria: [criteria[0]],
      files,
      truth: brokenTruth,
      period: PERIOD,
    })
    const g = r.graded[0]
    expect(g.verdict).toBe('실패')
    expect(g.samples[0].채널).toBe('쿠팡')
    expect(g.samples[0].차이).toBe(-50000)
  }, 30000)

  it('필수 안전 기준이 깨지면 다른 것이 아무리 좋아도 차단이다', async () => {
    const brokenTruth = {
      ...truth,
      agg_by_channel: truth.agg_by_channel.map((t) => ({ ...t, net_revenue_krw: t.net_revenue_krw + 1 })),
    }
    const r = await gradeAll({ criteria, files, truth: brokenTruth, period: PERIOD })
    expect(r.summary.safetyFailed).toBeGreaterThan(0)
    expect(r.summary.overall).toBe('차단')
    // 나머지는 여전히 통과한다는 점이 중요하다 — 그래도 차단이다.
    expect(r.summary.passed).toBeGreaterThan(5)
  }, 60000)

  it('빼야 할 줄을 통과시키면 잡아낸다', async () => {
    // 정답에 없는 격리 대상을 하나 추가한다 → 우리가 못 잡은 것으로 보인다.
    const brokenTruth = {
      ...truth,
      quarantine: [
        ...truth.quarantine,
        { source_file: '01_자사몰_주문내역_2026-06.csv', source_sheet: '', source_row_no: 2, reason_code: 'made_up' },
      ],
    }
    const r = await gradeAll({ criteria: [criteria[1]], files, truth: brokenTruth, period: PERIOD })
    expect(r.graded[0].verdict).toBe('실패')
    expect(r.graded[0].evidence).toContain('그냥 통과시켰습니다')
  }, 30000)

  it('채점 규칙이 없는 기준은 판정한 척하지 않는다', async () => {
    const r = await gradeAll({
      criteria: [{ id: 'x', ord: 1, body: '아직 규칙 없음', check_kind: 'rule', check_key: 'not_implemented_yet', is_required_safety: 0 }],
      files,
      truth,
      period: PERIOD,
    })
    expect(r.graded[0].verdict).toBe('판정불가')
  }, 30000)
})
