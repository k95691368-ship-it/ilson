import { describe, expect, it } from 'vitest'
import { runPipeline, summarize, toDate, toNumber } from '../shared/pipeline.js'

const header = '주문일자,상품코드,상품명,수량,판매가,할인액'
const record = ({ date = '2026-06-01', sku = 'NR-CM-100', qty = '1', gross = '10000', discount = '0' } = {}) =>
  [date, sku, '가상 정산 검증', qty, gross, discount].join(',')
const file = (records, name = 'validation.csv', columns = header) => ({
  name, buffer: new TextEncoder().encode([columns, ...records].join('\n')),
})
const run = (records, aliases) => runPipeline({ files: [file(records)], aliases })

describe('unreadable monetary cells cannot become zero', () => {
  it.each(['미확인', 'N/A', '₩', '$', '0x10', '1e308'])('quarantines nonempty invalid discount %s and keeps its source', async discount => {
    const result = await run([record(), record({ discount }), record({ gross: '15000' })])
    expect(result.rows).toHaveLength(2)
    expect(result.totals.all.net_revenue_krw).toBe(25000)
    expect(result.quarantine).toEqual([expect.objectContaining({
      reason: 'bad_amount', source: { file: 'validation.csv', sheet: '', rowNo: 3 },
      raw: expect.arrayContaining([discount]), note: expect.stringContaining('할인액'),
    })])
  })

  it.each(['0', '', '   '])('preserves existing zero/empty discount policy: %j', async discount => {
    const result = await run([record({ discount })])
    expect(result.quarantine).toEqual([])
    expect(result.rows[0]).toMatchObject({ discount_krw: 0, net_revenue_krw: 10000 })
  })

  it('preserves discount magnitudes and signed return calculation', async () => {
    const result = await run([record({ discount: '-250' }), record({ qty: '-1', gross: '-10000', discount: '' })])
    expect(result.rows[0]).toMatchObject({ discount_krw: 250, net_revenue_krw: 9750 })
    expect(result.rows[1]).toMatchObject({ qty: 0, return_qty: 1, return_krw: 10000, net_revenue_krw: -10000 })
    expect(result.totals.all.net_revenue_krw).toBe(-250)
  })

  it.each(['미확인', '1e308'])('also isolates nonempty unreadable reported commission %s', async commission => {
    const result = await runPipeline({ files: [file([
      `06/01/2026,NURIE-NRCM100-US,1,10,0,${commission},USD`,
    ], 'amazon.csv', 'posted-date,sku,quantity-purchased,item-price,item-promotion-discount,commission,currency')] })
    expect(result.rows).toEqual([])
    expect(result.quarantine[0]).toMatchObject({ reason: 'bad_amount', source: { rowNo: 2 }, note: expect.stringContaining('수수료') })
  })

  it.each(['₩', '$', '원', '0x10', '0b11', '--10'])('does not parse %s as a number', value => {
    expect(toNumber(value)).toBeNull()
  })
})

describe('calendar dates are not normalized into another day', () => {
  it.each([
    ['2026-06-31', '자사몰'], ['2026-02-29', '자사몰'], ['1900-02-29', '자사몰'],
    ['2026-00-01', '자사몰'], ['2026-13-01', '자사몰'], ['2026-06-00', '자사몰'],
    ['0000-06-01', '자사몰'], ['2026/6/31', '쿠팡'], ['02/30/2024', 'Amazon US'],
    ['06/31/2026', 'Amazon US'],
  ])('rejects %s (%s)', (value, channel) => expect(toDate(value, channel)).toBeNull())

  it.each([
    ['2024-02-29', '자사몰', '2024-02-29'], ['2000-02-29', '자사몰', '2000-02-29'],
    ['2026-06-30T12:30:00Z', '자사몰', '2026-06-30'], ['2026/6/30', '쿠팡', '2026-06-30'],
    ['2/29/2024', 'Amazon US', '2024-02-29'],
  ])('keeps valid supported date %s', (value, channel, expected) => expect(toDate(value, channel)).toBe(expected))

  it('isolates an impossible day without discarding valid rows in the same file', async () => {
    const result = await run([record(), record({ date: '2026-06-31' }), record({ date: '2026-06-30' })])
    expect(result.rows.map(row => row.date)).toEqual(['2026-06-01', '2026-06-30'])
    expect(result.quarantine[0]).toMatchObject({ reason: 'bad_date', source: { rowNo: 3 }, raw: expect.arrayContaining(['2026-06-31']) })
  })
})

describe('unresolved product mappings cannot abort a batch', () => {
  it.each(['toString', '__proto__', 'constructor', 'hasOwnProperty'])('isolates inherited property name %s', async sku => {
    const result = await run([record(), record({ sku }), record({ gross: '15000' })])
    expect(result.rows).toHaveLength(2)
    expect(result.quarantine[0]).toMatchObject({ reason: 'unknown_sku', externalCode: sku, source: { rowNo: 3 } })
  })

  it.each(['retired-sku', 'toString', '__proto__', { name_ko: 'not a code' }])('isolates a stale or invalid canonical mapping %j', async canonical => {
    const result = await run([record({ sku: 'EXT' }), record()], { EXT: canonical })
    expect(result.rows).toHaveLength(1)
    expect(result.quarantine[0]).toMatchObject({ reason: 'unknown_sku', externalCode: 'EXT', source: { rowNo: 2 } })
  })

  it('ignores inherited aliases but honors explicitly taught unusual external names', async () => {
    const inherited = await run([record({ sku: 'EXT' })], Object.create({ EXT: 'NR-CM-100' }))
    expect(inherited.quarantine[0].reason).toBe('unknown_sku')
    const own = await run([record({ sku: '__proto__' })], Object.fromEntries([['__proto__', 'NR-CM-100']]))
    expect(own.rows[0].sku).toBe('NR-CM-100')
    expect(own.quarantine).toEqual([])
  })
})

describe('safe monetary calculation and complete consistent aggregation', () => {
  it.each([
    { gross: '1e308' }, { gross: '90071992547410' }, { qty: '1e308' },
    { qty: '100000000000' }, { discount: '1e308' },
  ])('isolates unsafe input or derived amount %j', async bad => {
    const result = await run([record(bad), record()])
    expect(result.rows).toHaveLength(1)
    expect(result.quarantine[0]).toMatchObject({ reason: 'bad_amount', source: { rowNo: 2 } })
    expect(result.totals.all.net_revenue_krw).toBe(10000)
  })

  it('checks converted foreign currency, not just the original amount', async () => {
    const result = await runPipeline({ files: [file([
      '06/01/2026,NURIE-NRCM100-US,1,1000000000000,0,0,USD',
      '06/01/2026,NURIE-NRCM100-US,1,10,0,0,USD',
    ], 'amazon.csv', 'posted-date,sku,quantity-purchased,item-price,item-promotion-discount,commission,currency')] })
    expect(result.rows).toHaveLength(1)
    expect(result.quarantine[0]).toMatchObject({ reason: 'bad_amount', source: { rowNo: 2 } })
  })

  it('quarantines only the row that would overflow aggregate cents and then continues', async () => {
    const result = await run([
      record({ gross: '40000000000000' }), record({ gross: '40000000000000', date: '2026-06-08' }),
      record({ gross: '40000000000000' }), record({ gross: '0.10', qty: '0' }),
    ])
    expect(result.rows.map(row => row.source.rowNo)).toEqual([2, 3, 5])
    expect(result.quarantine[0]).toMatchObject({ reason: 'bad_amount', source: { rowNo: 4 }, note: expect.stringContaining('합계') })
    expect(result.files.at(-1)).toMatchObject({ rowsIn: 4, rowsOut: 3, quarantined: 1 })
    expect(result.totals.all.rows).toBe(3)
    expect(result.totals.all.gross_krw).toBe(80000000000000.1)
    expect(result.totals.byChannel[0].gross_krw).toBe(result.totals.all.gross_krw)
    expect(result.totals.byChannelWeek[0].rows).toBe(2)
    for (const row of [...result.rows, result.totals.all, ...result.totals.byChannel, ...result.totals.byChannelWeek]) {
      for (const [key, value] of Object.entries(row)) {
        if (key.endsWith('_krw') && value != null) {
          expect(Number.isFinite(value), key).toBe(true)
          expect(Number.isSafeInteger(Math.round(value * 100)), key).toBe(true)
        }
      }
    }
  })

  it('aggregates already rounded cents exactly and refuses invalid direct summaries', () => {
    const row = { channel: '자사몰', iso_week: '2026-W23', qty: 0, return_qty: 0,
      gross_krw: 0.1, net_revenue_krw: 0.1, commission_krw: 0.01, contribution_krw: 0.09 }
    expect(summarize(Array.from({ length: 1000 }, () => row)).all).toMatchObject({
      gross_krw: 100, net_revenue_krw: 100, commission_krw: 10, contribution_krw: 90, rows: 1000,
    })
    expect(() => summarize([{ ...row, gross_krw: Infinity }])).toThrow('범위')
    expect(() => summarize([{ ...row, contribution_krw: NaN }])).toThrow('범위')
  })

  it.each(['channel', 'week'])('checks each %s even when the overall signed amount cancels', group => {
    const row = { channel: '자사몰', iso_week: '2026-W23', qty: 0, return_qty: 0,
      gross_krw: 0, net_revenue_krw: 40000000000000, commission_krw: 0, contribution_krw: 0 }
    const offset = { ...row, net_revenue_krw: -40000000000000,
      ...(group === 'channel' ? { channel: '쿠팡' } : { iso_week: '2026-W24' }) }
    // Overall total would be safe (+40T), but one group would become +120T.
    expect(() => summarize([row, offset, row, offset, row])).toThrow('범위')
  })
})
