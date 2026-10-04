import { describe, expect, it } from 'vitest'
import { runPipeline } from '../shared/pipeline.js'

describe('a taught mapping resolves only the missing-code condition', () => {
  const externalCode = 'SYNTHETIC-TEACH-CONDITION'
  async function compare(date, amount) {
    const csv = `주문일자,상품코드,상품명,수량,판매가,할인액\n${date},${externalCode},합성상품,1,${amount},0\n`
    const files = [{ name: 'synthetic.csv', buffer: new TextEncoder().encode(csv) }]
    const before = await runPipeline({ files })
    const after = await runPipeline({ files, aliases: { [externalCode]: 'NR-CM-100' } })
    expect(before.files.every(file => file.ok)).toBe(true)
    expect(after.files.every(file => file.ok)).toBe(true)
    return [before, after]
  }

  it('a valid row becomes processable only on a new calculation', async () => {
    const [before, after] = await compare('2026-06-12', '10000')
    expect(before.quarantine.map(row => row.reason)).toEqual(['unknown_sku'])
    expect(after.quarantine).toHaveLength(0)
    expect(after.rows).toHaveLength(1)
    expect(before.quarantine).toHaveLength(1)
  })

  it.each([
    ['invalid date', 'not-a-date', '10000', 'bad_date'],
    ['invalid amount', '2026-06-12', 'not-money', 'bad_amount'],
  ])('%s remains quarantined after the mapping is taught', async (_label, date, amount, reason) => {
    const [before, after] = await compare(date, amount)
    expect(before.quarantine.map(row => row.reason)).toEqual(['unknown_sku'])
    expect(after.quarantine.map(row => row.reason)).toEqual([reason])
    expect(after.rows).toHaveLength(0)
  })

  it('a date already known to be outside the period never becomes a teaching opportunity', async () => {
    const [before, after] = await compare('2026-05-12', '10000')
    expect(before.quarantine.map(row => row.reason)).toEqual(['out_of_period'])
    expect(after.quarantine.map(row => row.reason)).toEqual(['out_of_period'])
    expect(after.rows).toHaveLength(0)
  })
})
