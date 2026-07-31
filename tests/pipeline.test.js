// 합치기 규칙이 정확한지 확인한다.
//
// 가장 중요한 검사는 마지막의 "정답과 한 푼도 다르지 않다"이다.
// 시험 파일을 만든 생성기가 정답도 같이 뱉어 두었기 때문에, 우리가 합친
// 결과와 그 정답을 그대로 견줄 수 있다. 사람이 눈으로 맞춰 보는 것이 아니라
// 기계가 견준다.

import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  runPipeline,
  detectChannel,
  buildColumnIndex,
  toNumber,
  toDate,
  isoWeek,
  QUARANTINE_REASONS,
} from '../shared/pipeline.js'

const seedPath = (name) => resolve(process.cwd(), 'seed/out', name)
const load = (name) => ({ name, buffer: readFileSync(seedPath(name)) })

const FILES = [
  '01_자사몰_주문내역_2026-06.csv',
  '02_올리브영_정산_2026-06.xlsx',
  '03_쿠팡_정산내역_2026-06.csv',
  '04_amazon-settlement-2026-06.csv',
  '05_Qoo10_JP_決済明細_2026Q2.xlsx',
]

const truth = JSON.parse(readFileSync(seedPath('ground_truth.json'), 'utf8'))

let result

beforeAll(async () => {
  result = await runPipeline({ files: FILES.map(load) })
})

describe('값 정리', () => {
  it('통화기호와 천 단위 쉼표를 뗀다', () => {
    expect(toNumber('₩24,200')).toBe(24200)
    expect(toNumber('12000')).toBe(12000)
    expect(toNumber(41100)).toBe(41100)
    expect(toNumber('')).toBeNull()
    expect(toNumber(null)).toBeNull()
  })

  it('회계식 괄호 음수를 알아본다', () => {
    expect(toNumber('(1,000)')).toBe(-1000)
    expect(toNumber('-14600')).toBe(-14600)
  })

  it('숫자가 아닌 것은 숫자인 척하지 않는다', () => {
    expect(toNumber('없음')).toBeNull()
    expect(toNumber('N/A')).toBeNull()
  })

  it('날짜 모양 넷을 모두 읽는다', () => {
    expect(toDate('2026-06-09', '자사몰')).toBe('2026-06-09')
    expect(toDate('2026/06/13', '쿠팡')).toBe('2026-06-13')
    expect(toDate('06/01/2026', 'Amazon US')).toBe('2026-06-01')
  })

  it('월·일 순서를 모르면 추측하지 않는다', () => {
    // 06/07/2026이 6월 7일인지 7월 6일인지는 채널을 알아야 정해진다.
    expect(toDate('06/07/2026', '자사몰')).toBeNull()
    expect(toDate('06/07/2026', 'Amazon US')).toBe('2026-06-07')
  })

  it('주차를 센다', () => {
    expect(isoWeek('2026-06-01')).toBe('2026-W23')
    expect(isoWeek('2026-06-30')).toBe('2026-W27')
  })
})

describe('채널 알아보기', () => {
  it('머리글을 보고 어느 채널인지 안다', () => {
    expect(detectChannel(['주문일자', '상품코드', '수량'])).toBe('자사몰')
    expect(detectChannel(['매출일자', '자체상품코드'])).toBe('올리브영')
    expect(detectChannel(['정산일', '옵션ID'])).toBe('쿠팡')
    expect(detectChannel(['sku', 'quantity-purchased'])).toBe('Amazon US')
    expect(detectChannel(['決済日', '商品コード'])).toBe('Qoo10 JP')
  })

  it('모르는 양식이면 아는 척하지 않는다', () => {
    // 조용히 틀린 채널로 처리하는 것보다 모른다고 하는 편이 낫다.
    expect(detectChannel(['가', '나', '다'])).toBeNull()
  })

  it('필요한 컬럼이 없으면 무엇이 없는지 말한다', () => {
    const r = buildColumnIndex('자사몰', ['주문일자', '상품코드'])
    expect(r.missing).toEqual(['qty', 'gross'])
  })

  it('우리가 안 쓰는 컬럼은 따로 알려 준다', () => {
    const r = buildColumnIndex('자사몰', ['주문일자', '상품코드', '수량', '판매가', '결제수단'])
    expect(r.missing).toEqual([])
    expect(r.unmapped).toContain('결제수단')
  })
})

describe('다섯 장을 합치기', () => {
  it('다섯 파일과 시트 일곱 장을 읽는다', () => {
    expect(result.stats.filesRead).toBe(5)
    // 엑셀 하나가 시트 세 장이라 전부 일곱 장이다.
    expect(result.stats.sheetsRead).toBe(7)
    expect(result.files.filter((f) => f.ok)).toHaveLength(7)
  })

  it('외부 서비스를 한 번도 부르지 않는다', () => {
    expect(result.stats.externalCalls).toBe(0)
  })

  it('CP949 파일을 알아보고 읽는다', () => {
    const coupang = result.files.find((f) => f.name.includes('쿠팡'))
    expect(coupang.encoding).toBe('CP949')
    expect(coupang.channel).toBe('쿠팡')
  })

  it('병합된 제목을 지나 4번째 줄에서 머리글을 찾는다', () => {
    const oy = result.files.find((f) => f.name.includes('올리브영'))
    expect(oy.headerRowNo).toBe(4)
  })
})

describe('모르는 것은 버리지 않고 검토함으로', () => {
  it('합계 줄을 데이터로 세지 않는다', () => {
    const totals = result.quarantine.filter((q) => q.reason === 'total_row')
    expect(totals).toHaveLength(1)
    expect(totals[0].note).toContain('두 배')
  })

  it('우리 목록에 없는 상품코드 아홉 개를 골라낸다', () => {
    const unknown = result.quarantine.filter((q) => q.reason === 'unknown_sku')
    expect(unknown).toHaveLength(9)
    // 어느 코드인지, 상품명이 무엇이었는지를 남겨야 사람이 판단할 수 있다.
    expect(unknown[0].externalCode).toBeTruthy()
  })

  it('정산 기간 밖 자료를 합계에 넣지 않는다', () => {
    const out = result.quarantine.filter((q) => q.reason === 'out_of_period')
    // Qoo10의 4월·5월 시트
    expect(out.length).toBeGreaterThan(50)
  })

  it('빈 줄을 골라낸다', () => {
    const empty = result.quarantine.filter((q) => q.reason === 'empty_row')
    expect(empty.length).toBeGreaterThan(0)
  })

  it('검토함의 모든 줄이 원본 어디서 왔는지 안다', () => {
    for (const q of result.quarantine) {
      expect(q.source.file).toBeTruthy()
      expect(q.source.rowNo).toBeGreaterThan(0)
      expect(QUARANTINE_REASONS[q.reason]).toBeTruthy()
    }
  })
})

describe('반품과 중복', () => {
  it('반품 음수 줄을 매출이 아니라 반품으로 센다', () => {
    const returns = result.rows.filter((r) => r.return_qty > 0)
    expect(returns.length).toBeGreaterThan(0)
    for (const r of returns) {
      expect(r.qty).toBe(0)
      expect(r.gross_krw).toBe(0)
      // 반품액은 양수로 들어가야 한다. 음수로 두면 합계에서 두 번 빠진다.
      expect(r.return_krw).toBeGreaterThan(0)
      expect(r.net_revenue_krw).toBeLessThan(0)
    }
  })

  it('똑같아 보이는 줄은 지우지 않고 표시만 한다', () => {
    // 진짜 중복일 수도, 같은 상품을 두 번 산 것일 수도 있다.
    // 여기서 판단할 수 없으므로 사람에게 넘긴다.
    expect(result.stats.duplicateSuspects).toBeGreaterThan(0)
    for (const d of result.duplicates) {
      expect(d.duplicate_of.rowNo).toBeGreaterThan(0)
    }
  })
})

describe('되짚기 — 숫자에서 원본 줄까지', () => {
  it('모든 줄이 원본 파일·시트·줄 번호를 들고 있다', () => {
    for (const r of result.rows) {
      expect(r.source.file).toBeTruthy()
      expect(r.source.rowNo).toBeGreaterThan(0)
    }
  })

  it('어떻게 그 숫자가 됐는지 단계가 남는다', () => {
    const overseas = result.rows.find((r) => r.src_currency === 'USD')
    const steps = overseas.trace.map((t) => t.step)
    expect(steps).toContain('원본')
    expect(steps).toContain('코드 통일')
    expect(steps).toContain('통화 환산')
    expect(steps).toContain('수수료 공제')
    expect(steps).toContain('최종')
  })

  it('외화는 반드시 원화로 바뀐 뒤 합산된다', () => {
    const jp = result.rows.filter((r) => r.src_currency === 'JPY')
    expect(jp.length).toBeGreaterThan(0)
    for (const r of jp) {
      expect(r.fx_rate).toBeGreaterThan(1)
      expect(r.gross_krw).toBeGreaterThan(0)
    }
  })
})

describe('정답과 견주기', () => {
  it('줄 수가 정답과 같다', () => {
    expect(result.rows.length).toBe(truth.row_count)
  })

  it('채널별 순매출이 정답과 한 푼도 다르지 않다', () => {
    const mine = Object.fromEntries(result.totals.byChannel.map((t) => [t.channel, t]))
    for (const t of truth.agg_by_channel) {
      expect(Math.round(mine[t.channel].net_revenue_krw)).toBe(Math.round(t.net_revenue_krw))
    }
  })

  it('채널별 기여이익이 정답과 한 푼도 다르지 않다', () => {
    const mine = Object.fromEntries(result.totals.byChannel.map((t) => [t.channel, t]))
    for (const t of truth.agg_by_channel) {
      expect(Math.round(mine[t.channel].contribution_krw)).toBe(Math.round(t.contribution_krw))
    }
  })

  it('채널×주차 합계도 정답과 같다', () => {
    const mine = new Map(
      result.totals.byChannelWeek.map((t) => [`${t.channel}|${t.iso_week}`, t])
    )
    for (const t of truth.agg_by_channel_week) {
      const got = mine.get(`${t.channel}|${t.iso_week}`)
      expect(got, `${t.channel} ${t.iso_week}`).toBeTruthy()
      expect(Math.round(got.net_revenue_krw)).toBe(Math.round(t.net_revenue_krw))
    }
  })

  it('줄 하나하나가 정답의 같은 줄과 맞는다', () => {
    const truthByKey = new Map(
      truth.rows.map((t) => [`${t.source_file}|${t.source_sheet}|${t.source_row_no}`, t])
    )
    let checked = 0
    for (const r of result.rows) {
      const key = `${r.source.file}|${r.source.sheet}|${r.source.rowNo}`
      const t = truthByKey.get(key)
      if (!t) continue
      expect(r.sku, key).toBe(t.sku)
      expect(Math.round(r.net_revenue_krw), key).toBe(Math.round(t.net_revenue_krw))
      expect(Math.round(r.contribution_krw), key).toBe(Math.round(t.contribution_krw))
      checked += 1
    }
    // 거의 모든 줄이 정답에 있어야 한다.
    expect(checked).toBe(truth.row_count)
  })

  it('격리해야 할 줄을 빠짐없이 격리한다', () => {
    const mine = new Set(
      result.quarantine.map((q) => `${q.source.file}|${q.source.sheet ?? ''}|${q.source.rowNo}`)
    )
    const missed = truth.quarantine.filter(
      (t) => !mine.has(`${t.source_file}|${t.source_sheet}|${t.source_row_no}`)
    )
    expect(missed.map((m) => `${m.source_file}:${m.source_row_no} ${m.reason_code}`)).toEqual([])
  })

  it('멀쩡한 줄을 격리하지 않는다', () => {
    const truthQuarantine = new Set(
      truth.quarantine.map((t) => `${t.source_file}|${t.source_sheet}|${t.source_row_no}`)
    )
    const wrong = result.quarantine.filter(
      (q) => !truthQuarantine.has(`${q.source.file}|${q.source.sheet ?? ''}|${q.source.rowNo}`)
    )
    expect(wrong.map((w) => `${w.source.file}:${w.source.rowNo} ${w.reason}`)).toEqual([])
  })
})
