import { describe, expect, it } from 'vitest'
import { quantity, num, krw } from '../src/lib/format.js'

describe('quantity display without rounding the computed number', () => {
  it.each([
    [0,'0'], [1,'1'], [1234,'1,234'], [-1234,'-1,234'], [1.5,'1.5'], [0.5,'0.5'], [-0.5,'-0.5'],
    [1234.56789,'1,234.56789'], [1 + Number.EPSILON,'1.0000000000000002'],
    [4503599627370495.5,'4,503,599,627,370,495.5'], [Number.MAX_SAFE_INTEGER,'9,007,199,254,740,991'],
    [1e-7,'1e-7'], [Number.MIN_VALUE,'5e-324'], ['1.5','1.5'], ['+1.0','+1.0'], ['-2e3','-2e3'],
    ['1e-1000','1e-1000'], ['1.00000000000000001','1.00000000000000001'],
    ['9007199254740990.5','9,007,199,254,740,990.5'],
  ])('keeps %j visible as %s', (value, expected) => {
    const displayed = quantity(value)
    expect(displayed).toBe(expected)
    expect(Number(displayed.replaceAll(',', ''))).toBe(Number(value))
  })
  it.each([null,undefined,NaN,Infinity,-Infinity,'', ' ', 'not a number','0x10','1e9999',true,{},[]])('does not invent a count for %j', value => {
    expect(quantity(value)).toBe('—')
  })
  it('leaves global count precision and money display unchanged', () => {
    expect(num(1.5)).toBe('2')
    expect(num(1.5, 2)).toBe('1.50')
    expect(krw(1234.5)).toBe('1,235원')
  })
})
