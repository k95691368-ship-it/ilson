import { describe, expect, it } from 'vitest'
import { settlementCsv } from '../shared/settlementExport.js'
import { readCsv } from '../shared/csv.js'
import { runPipeline } from '../shared/pipeline.js'

const baseRow = () => ({
  date: '2026-06-01', iso_week: '2026-W23', channel: '자사몰', sku: 'NR-CM-100', sku_name: '합성 상품',
  qty: 1, return_qty: 0, gross_krw: 10000, discount_krw: 0, return_krw: 0,
  net_revenue_krw: 10000, commission_krw: 0, cogs_krw: 3000, logistics_krw: 1000,
  ad_krw: 500, contribution_krw: 5500,
  source: { file: '정산.csv', sheet: '', rowNo: 2, sha256: 'a'.repeat(64) },
})
const parse = rows => readCsv(new TextEncoder().encode(settlementCsv(rows)))
const cell = (parsed, label) => parsed.rows[0].cells[parsed.header.indexOf(label)]

describe('spreadsheet-review settlement CSV', () => {
  it.each(['=1+2', '+1+2', '-1+2', '@SUM(1,2)', '＝1+2', '＋1+2', '－1+2', '＠SUM(1,2)', '  =1+2', '\t=1+2', '\r=1+2', '\n=1+2', '\uFEFF=1+2'])(
    'protects formula-like text %j without changing the original reference', value => {
      const row = baseRow()
      row.sku_name = value
      row.source.file = value
      row.source.sheet = value
      row.duplicate_of = { file: value, sheet: value, rowNo: 4, sha256: 'b'.repeat(64) }
      const csv = settlementCsv([row])
      // This is an exporter contract, not a claim that a spreadsheet was run.
      expect(csv).toContain(`"\t${value.replaceAll('"', '""')}"`)
      expect(row.source.file).toBe(value)
      expect(row.sku_name).toBe(value)
      expect(cell(parse([row]), '원본SHA256')).toBe('a'.repeat(64))
      expect(cell(parse([row]), '중복의심원본SHA256')).toBe('b'.repeat(64))
    },
  )

  it('keeps real negative numbers numeric while protecting negative-looking text', () => {
    const row = { ...baseRow(), qty: -2, return_qty: -1, gross_krw: -10000, net_revenue_krw: -10000, contribution_krw: -15500, sku_name: '-123' }
    const csv = settlementCsv([row])
    expect(csv).toContain('"-10000"')
    expect(csv).not.toContain('"\t-10000"')
    expect(csv).toContain('"\t-123"')
    const parsed = parse([row])
    expect(Number(cell(parsed, '순매출'))).toBe(-10000)
    expect(Number(cell(parsed, '수량'))).toBe(-2)
    expect(Number(cell(parsed, '기여이익'))).toBe(-15500)
  })

  it('preserves harmless labels, cell separators, quotes and line breaks', () => {
    const row = baseRow()
    row.sku_name = '정상 "상품", 설명; 다음\n줄'
    row.source.file = '01_정산 "확인",최종.csv'
    const parsed = parse([row])
    expect(parsed.rows).toHaveLength(1)
    expect(cell(parsed, '상품명')).toBe(row.sku_name)
    expect(cell(parsed, '원본파일')).toBe(row.source.file)
    expect(cell(parsed, '원본줄')).toBe('2')
    expect(settlementCsv([row])).toMatch(/^\uFEFF/)
  })

  it('does not allow quote/separator payloads to create new cells', () => {
    const row = baseRow()
    row.sku_name = '=1+2";=1+2,\n=3+4'
    const parsed = parse([row])
    expect(parsed.rows).toHaveLength(1)
    expect(parsed.rows[0].cells).toHaveLength(parsed.header.length)
    expect(settlementCsv([row])).toContain('"\t=1+2"";=1+2,\n=3+4"')
  })

  it('protects a formula-shaped filename through the actual pipeline/export path', async () => {
    const input = { name: '=1+2.csv', buffer: new TextEncoder().encode('주문일자,상품코드,상품명,수량,판매가,할인액\n2026-06-01,NR-CM-100,상품,1,10000,0') }
    const result = await runPipeline({ files: [input] })
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].source.file).toBe(input.name)
    expect(result.totals.all.net_revenue_krw).toBe(10000)
    expect(settlementCsv(result.rows)).toContain('"\t=1+2.csv"')
  })
})
