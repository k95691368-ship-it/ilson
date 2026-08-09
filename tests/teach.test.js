import { describe, it, expect } from 'vitest'
import {
  resolutionFor,
  groupQuarantine,
  validateTeach,
  affectedRows,
  catalog,
} from '../shared/teach.js'
import { QUARANTINE_REASONS } from '../shared/pipeline.js'
import { SKU_BY_CODE } from '../shared/master.js'

// 아무 줄에나 "알려주기" 버튼을 달면, 부서는 알려줘도 안 풀리는 것을
// 알려주고 나서 "말해도 소용없네"가 된다. 그 뒤로는 아무것도 안 알려준다.
//
// 그리고 없는 코드로 이어 두면 그 줄이 또 밀려나거나, 더 나쁘게는 엉뚱한
// 상품 매출로 잡힌다. 금액이 틀리는 쪽이다.

const q = (reason, extra = {}) => ({
  reason,
  source: { file: '자사몰.csv', rowNo: 12 },
  raw: ['2026-07-01', 'MALL-001', '10'],
  ...extra,
})

describe('알려주면 풀리는 것과 아닌 것을 가른다', () => {
  it('모르는 상품코드는 알려주면 풀린다', () => {
    expect(resolutionFor('unknown_sku').kind).toBe('teach')
  })

  it('정산 기간 밖은 밀려나는 것이 맞다', () => {
    // 이번 달 정산에 넣으면 지난달 숫자가 이번 달에 섞인다.
    expect(resolutionFor('out_of_period').kind).not.toBe('teach')
    expect(resolutionFor('out_of_period').kind).toBe('expected')
  })

  it('합계 줄도 밀려나는 것이 맞다', () => {
    // 넣으면 같은 금액을 두 번 센다.
    expect(resolutionFor('total_row').kind).toBe('expected')
    expect(resolutionFor('total_row').body).toContain('두 번')
  })

  it('원본이 잘못된 것은 원본을 고쳐야 한다고 말한다', () => {
    for (const r of ['no_sku', 'bad_date', 'bad_amount']) {
      expect(resolutionFor(r).kind).toBe('fix_source')
    }
  })

  it('양식을 모르는 것은 담당자 일이다', () => {
    expect(resolutionFor('unknown_channel').kind).toBe('ask_staff')
  })

  it('파이프라인이 내는 이유를 전부 안다', () => {
    // 여기 없는 이유가 생기면 부서에게 "왜 밀려났는지 모르겠습니다"만
    // 보여 주게 된다. 새 이유를 만들면 여기도 채워야 한다.
    for (const reason of Object.keys(QUARANTINE_REASONS)) {
      expect(resolutionFor(reason).title).toBeTruthy()
      expect(['teach', 'fix_source', 'expected', 'ask_staff']).toContain(
        resolutionFor(reason).kind
      )
    }
  })

  it('모르는 이유가 와도 터지지 않는다', () => {
    expect(resolutionFor('처음 보는 것').kind).toBe('ask_staff')
  })
})

describe('이유별로 묶기', () => {
  const rows = [
    q('unknown_sku', { externalCode: 'CJ-77' }),
    q('unknown_sku', { externalCode: 'CJ-77' }),
    q('unknown_sku', { externalCode: 'OY-31' }),
    q('out_of_period'),
    q('out_of_period'),
    q('out_of_period'),
    q('total_row'),
  ]

  it('알려주면 풀리는 것을 맨 위로 올린다', () => {
    // 밀려나는 게 맞는 것이 위에 있으면 부서는 그것부터 읽고 지친다.
    const g = groupQuarantine(rows, QUARANTINE_REASONS)
    expect(g[0].reason).toBe('unknown_sku')
    expect(g[g.length - 1].kind).toBe('expected')
  })

  it('같은 코드가 여러 줄이면 코드는 한 번만 센다', () => {
    // 스무 줄에 걸쳐 있어도 알려줄 것은 한 번이다. 그걸 앞에 적어 줘야
    // 부서가 엄두를 낸다.
    const g = groupQuarantine(rows, QUARANTINE_REASONS)
    const unknown = g.find((x) => x.reason === 'unknown_sku')
    expect(unknown.count).toBe(3)
    expect(unknown.codes).toEqual(['CJ-77', 'OY-31'])
  })

  it('사람이 읽는 이름을 붙인다', () => {
    const g = groupQuarantine(rows, QUARANTINE_REASONS)
    expect(g[0].label).toBe(QUARANTINE_REASONS.unknown_sku)
  })

  it('코드 순서가 흔들리지 않는다', () => {
    const a = groupQuarantine(rows, QUARANTINE_REASONS)[0].codes
    const b = groupQuarantine([...rows].reverse(), QUARANTINE_REASONS)[0].codes
    expect(a).toEqual(b)
  })

  it('빈 입력에도 터지지 않는다', () => {
    expect(groupQuarantine([])).toEqual([])
    expect(groupQuarantine(undefined)).toEqual([])
  })
})

describe('알려준 것을 받을 때', () => {
  const real = Object.keys(SKU_BY_CODE)[0]
  const good = { externalCode: 'CJ-77', canonicalCode: real, teacher: '정산 담당자' }

  it('제대로 알려주면 통과한다', () => {
    expect(validateTeach(good)).toEqual({})
  })

  it('우리 목록에 없는 코드로는 못 잇는다', () => {
    // 없는 코드로 이어 두면 그 줄이 또 밀려나거나, 더 나쁘게는 엉뚱한
    // 상품 매출로 잡힌다. 금액이 틀리는 쪽이다.
    expect(validateTeach({ ...good, canonicalCode: 'NR-XX-999' }).canonicalCode).toBeTruthy()
  })

  it('소문자로 적어도 받아 준다', () => {
    expect(validateTeach({ ...good, canonicalCode: real.toLowerCase() })).toEqual({})
  })

  it('같은 코드끼리는 이을 것이 없다', () => {
    expect(validateTeach({ ...good, externalCode: real }).externalCode).toBeTruthy()
  })

  it('빈 칸은 막는다', () => {
    const f = validateTeach({ externalCode: '', canonicalCode: '', teacher: '' })
    expect(f.externalCode).toBeTruthy()
    expect(f.canonicalCode).toBeTruthy()
    expect(f.teacher).toBeTruthy()
  })

  it('고를 수 있는 상품 목록을 준다', () => {
    const c = catalog()
    expect(c.length).toBeGreaterThan(3)
    expect(c[0]).toHaveProperty('code')
    expect(c[0]).toHaveProperty('name')
  })
})

describe('알려주면 몇 줄이 풀리는지 세어 준다', () => {
  const rows = [
    q('unknown_sku', { externalCode: 'CJ-77' }),
    q('unknown_sku', { externalCode: 'CJ-77' }),
    q('unknown_sku', { externalCode: 'OY-31' }),
    q('out_of_period', { externalCode: 'CJ-77' }),
  ]

  it('그 코드로 밀려난 줄만 센다', () => {
    // "고맙습니다"만 하고 끝내면 부서는 자기가 한 일이 뭘 바꿨는지 모른다.
    expect(affectedRows(rows, 'CJ-77')).toBe(2)
  })

  it('다른 이유로 밀려난 줄은 안 센다', () => {
    // 같은 코드라도 기간 밖으로 밀린 줄은 알려준다고 안 풀린다.
    expect(affectedRows(rows, 'CJ-77')).not.toBe(3)
  })

  it('없는 코드면 0이다', () => {
    expect(affectedRows(rows, '없는코드')).toBe(0)
    expect(affectedRows(undefined, 'CJ-77')).toBe(0)
  })
})
