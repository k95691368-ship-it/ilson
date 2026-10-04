import { describe, expect, it } from 'vitest'
import { indexTeachQuarantine } from '../src/lib/teachQuarantine.js'
import { affectedRows, groupQuarantine } from '../shared/teach.js'

describe('quarantine teaching index', () => {
  it('preserves first-any-reason sample, unknown-only counts, grouping, and sorted codes', () => {
    const rows = [
      { reason: 'bad_date', externalCode: 'B', raw: ['first non-unknown'] },
      { reason: 'unknown_sku', externalCode: 'B', raw: ['unknown'] },
      { reason: 'unknown_sku', externalCode: '__proto__' },
      { reason: 'unknown_sku', externalCode: 'constructor' },
      { reason: 'unknown_sku', externalCode: 'A' },
      { reason: 'unknown_sku', externalCode: 'B' },
      { reason: 'out_of_period', externalCode: 'B' },
    ]
    const index = indexTeachQuarantine(rows)
    const group = groupQuarantine(rows).find(item => item.reason === 'unknown_sku')
    expect(group.count).toBe(5)
    expect(group.codes).toEqual(['A', 'B', '__proto__', 'constructor'])
    for (const code of group.codes) {
      expect(index.get(code)).toEqual({ affected: affectedRows(rows, code), sample: rows.find(row => row.externalCode === code) })
    }
    expect(index.get('B').sample).toBe(rows[0])
    expect(index.get('B').affected).toBe(2)
  })

  it('visits each of 20,000 rows once, without a filter or find per code', () => {
    let codeReads = 0, reasonReads = 0
    const rows = Array.from({ length: 20000 }, (_, index) => ({
      get externalCode() { codeReads++; return `CODE-${index}` },
      get reason() { reasonReads++; return 'unknown_sku' },
    }))
    const index = indexTeachQuarantine(rows)
    expect(index.size).toBe(20000)
    expect(codeReads).toBe(20000)
    expect(reasonReads).toBe(20000)
    expect(index.get('CODE-19999').sample).toBe(rows[19999])
  })

  it('does not create actionable entries for missing/falsy codes', () => {
    expect(indexTeachQuarantine(undefined).size).toBe(0)
    expect(indexTeachQuarantine([{ reason: 'unknown_sku' }, { reason: 'no_sku', externalCode: '' }]).size).toBe(0)
  })
})
