// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { readCsv, splitLine } from '../shared/csv.js'

const read = text => readCsv(new TextEncoder().encode(text))

describe('CSV resource bounds and single-record processing', () => {
  it('rejects oversized bytes before decoding', () => {
    expect(() => readCsv(new Uint8Array(10 * 1024 * 1024 + 1))).toThrow('CSV 처리 한도')
  })
  it('accepts 100,000 data rows but rejects the next rather than truncating', () => {
    const text = 'head\n' + 'x\n'.repeat(100000)
    const table = read(text)
    expect(table.rows).toHaveLength(100000)
    expect(table.rows.at(-1)).toEqual({ rowNo: 100001, cells: ['x'] })
    expect(() => read(text + 'x')).toThrow('CSV 처리 한도')
  })
  it('bounds headers and data columns without counting quoted delimiters', () => {
    expect(splitLine(Array(1024).fill('x').join(','), ',')).toHaveLength(1024)
    expect(() => read(Array(1025).fill('x').join(','))).toThrow('CSV 처리 한도')
    expect(() => read('h\n' + Array(1025).fill('x').join(','))).toThrow('CSV 처리 한도')
    expect(read('h\n"' + ','.repeat(2048) + '"').rows[0].cells).toEqual([','.repeat(2048)])
  })
  it('bounds total cells even below the row and byte limits', () => {
    const row = Array(1024).fill('x').join(',')
    expect(() => read((row + '\n').repeat(1954))).toThrow('CSV 처리 한도')
  })
  it('retains BOM, blank-line positions, escaped quotes and multiline fields', () => {
    const result = read('\uFEFF\r\nh1,h2\r\n\r\n"a\r\nb","c""d"\r\nx,y\r\n')
    expect(result.headerRowNo).toBe(2)
    expect(result.rows).toEqual([
      { rowNo: 4, cells: ['a\nb', 'c"d'] },
      { rowNo: 6, cells: ['x', 'y'] },
    ])
    expect(read(' \r\n\n').rows).toEqual([])
  })
})
