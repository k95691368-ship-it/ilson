import { describe, it, expect } from 'vitest'
import {
  taughtBySide,
  annotate,
  sortForReview,
  summarize,
  validateCorrection,
  CONFIRM_KIND,
  CORRECT_KIND,
} from '../shared/codes.js'
import { encodeCodeReviewEvidence } from '../shared/codeReviewEvidence.ts'

// 코드 하나를 잘못 이어 두면 그 코드로 팔린 것이 전부 엉뚱한 상품 매출로
// 잡힌다. 금액이 틀리는데 아무도 안 틀렸다고 생각한다. 격리된 줄은 눈에
// 띄지만 잘못 이어진 줄은 조용히 섞인다.
//
// 그래서 "아직 확인 안 한 것"을 놓치면 안 된다. 확인했다고 잘못 표시하는
// 쪽이 확인 안 했다고 잘못 표시하는 쪽보다 훨씬 나쁘다.

const alias = (code, taughtBy, at) => ({
  external_code: code,
  canonical_code: 'NR-CM-100',
  product_name: '콜라겐 래핑 마스크',
  taught_by: taughtBy,
  created_at: at,
  mapping_revision: 'a'.repeat(64),
})

const confirm = (code, at, by = 'AX 담당자') => ({
  link_kind: CONFIRM_KIND,
  link_id: code,
  application_id: null,
  title: by,
  what: '맞습니다',
  why: '원본 파일과 맞춰 봤습니다',
  created_at: at,
  alternatives: encodeCodeReviewEvidence({ version: 1, action: 'confirm', externalCode: code, reviewedMappingRevision: 'a'.repeat(64),
    beforeCanonicalCode: 'NR-CM-100', afterCanonicalCode: 'NR-CM-100', provenance: { state: 'unknown', applicationId: null } }),
})

const correct = (code, at, what) => ({
  link_kind: CORRECT_KIND,
  link_id: code,
  title: 'AX 담당자',
  what,
  why: '부서가 비슷한 이름의 다른 상품으로 잘못 알려줬습니다',
  created_at: at,
})

describe('누가 알려 줬는가', () => {
  it('담당자가 넣은 것과 부서가 알려준 것을 가른다', () => {
    // 기존 표시 이름으로 분류할 뿐, 어떤 원본을 검증했는지는 증명하지 않는다.
    expect(taughtBySide({ taught_by: 'AX 담당자' })).toBe('담당자')
    expect(taughtBySide({ taught_by: '정산 담당자' })).toBe('부서')
  })

  it('누가 넣었는지 모르면 아는 척하지 않는다', () => {
    expect(taughtBySide({ taught_by: '' })).toBe('알 수 없음')
    expect(taughtBySide({})).toBe('알 수 없음')
  })
})

describe('확인해야 할 것 가려내기', () => {
  it('부서가 알려주고 아직 확인 안 한 것은 확인해야 한다', () => {
    const [a] = annotate([alias('CJ-77', '정산 담당자', '2026-08-01 09:00:00')], [])
    expect(a.needsCheck).toBe(true)
    expect(a.confirmed).toBeNull()
  })

  it('담당자 표시 이름만으로 확인을 면제하지 않는다', () => {
    const [a] = annotate([alias('CJ-77', 'AX 담당자', '2026-08-01 09:00:00')], [])
    expect(a.needsCheck).toBe(true)
  })

  it('확인한 것은 목록에서 빠진다', () => {
    const [a] = annotate(
      [alias('CJ-77', '정산 담당자', '2026-08-01 09:00:00')],
      [confirm('CJ-77', '2026-08-01 10:00:00')]
    )
    expect(a.needsCheck).toBe(false)
    expect(a.confirmed.by).toBe('AX 담당자')
  })

  it('확인한 뒤에 코드가 다시 바뀌면 그 확인은 낡은 것이다', () => {
    // 확인해 놓고 누가 또 고쳤는데 확인 표시가 그대로 남아 있으면,
    // 담당자는 이미 본 것으로 알고 넘어간다.
    const [a] = annotate(
      [{ ...alias('CJ-77', '정산 담당자', '2026-08-02 09:00:00'), mapping_revision: 'b'.repeat(64) }],
      [confirm('CJ-77', '2026-08-01 10:00:00')]
    )
    expect(a.staleCheck).toBe(true)
    expect(a.needsCheck).toBe(true)
  })

  it('여러 번 확인했으면 마지막 것을 본다', () => {
    const [a] = annotate(
      [alias('CJ-77', '정산 담당자', '2026-08-01 09:00:00')],
      [confirm('CJ-77', '2026-08-01 10:00:00', '먼저 본 사람'), confirm('CJ-77', '2026-08-03 10:00:00', '나중 사람')]
    )
    expect(a.confirmed.by).toBe('나중 사람')
  })

  it('다른 코드의 확인은 이 코드를 확인해 주지 않는다', () => {
    const [a] = annotate(
      [alias('CJ-77', '정산 담당자', '2026-08-01 09:00:00')],
      [confirm('OY-31', '2026-08-01 10:00:00')]
    )
    expect(a.needsCheck).toBe(true)
  })

  it('빈 입력에도 터지지 않는다', () => {
    expect(annotate([], [])).toEqual([])
    expect(annotate(undefined, undefined)).toEqual([])
  })
})

describe('정정 이력', () => {
  it('고친 기록을 붙여 준다', () => {
    const [a] = annotate(
      [alias('CJ-77', '정산 담당자', '2026-08-01 09:00:00')],
      [correct('CJ-77', '2026-08-02 09:00:00', 'NR-PA-030 으로 바꿨습니다')]
    )
    expect(a.corrections).toHaveLength(1)
    expect(a.corrections[0].what).toContain('NR-PA-030')
  })

  it('여러 번 고쳤으면 최근 것부터', () => {
    const [a] = annotate(
      [alias('CJ-77', '정산 담당자', '2026-08-01 09:00:00')],
      [
        correct('CJ-77', '2026-08-02 09:00:00', '첫 번째'),
        correct('CJ-77', '2026-08-05 09:00:00', '두 번째'),
      ]
    )
    expect(a.corrections[0].what).toBe('두 번째')
  })
})

describe('훑어볼 순서', () => {
  const rows = annotate(
    [
      alias('A', 'AX 담당자', '2026-08-05 09:00:00'),
      alias('B', '정산 담당자', '2026-08-01 09:00:00'),
      alias('C', '회계 담당자', '2026-08-04 09:00:00'),
    ],
    [confirm('A', '2026-08-05 10:00:00')]
  )

  it('확인해야 할 것이 위로 온다', () => {
    const s = sortForReview(rows)
    expect(s[0].needsCheck).toBe(true)
    expect(s[s.length - 1].external_code).toBe('A')
  })

  it('확인할 것끼리는 최근 것부터', () => {
    // 미확인 연결 사이에서는 기록된 변경 시각 순서로 표시한다.
    const s = sortForReview(rows)
    expect(s[0].external_code).toBe('C')
    expect(s[1].external_code).toBe('B')
  })

  it('원본을 건드리지 않는다', () => {
    const before = rows.map((r) => r.external_code)
    sortForReview(rows)
    expect(rows.map((r) => r.external_code)).toEqual(before)
  })
})

describe('요약', () => {
  it('누가 얼마나 알려줬는지 센다', () => {
    const s = summarize(
      annotate(
        [
          alias('A', 'AX 담당자', '2026-08-01 09:00:00'),
          alias('B', '정산 담당자', '2026-08-01 09:00:00'),
          alias('C', '회계 담당자', '2026-08-01 09:00:00'),
        ],
        [confirm('B', '2026-08-02 09:00:00')]
      )
    )
    expect(s.total).toBe(3)
    expect(s.byDept).toBe(2)
    expect(s.byStaff).toBe(1)
    expect(s.needsCheck).toBe(2) // A와 C: 표시 이름은 확인 근거가 아니다.
  })

  it('빈 목록에서도 터지지 않는다', () => {
    expect(summarize([]).total).toBe(0)
    expect(summarize(undefined).needsCheck).toBe(0)
  })
})

describe('정정할 때 받는 것', () => {
  const known = ['NR-CM-100', 'NR-PA-030']
  const good = { canonicalCode: 'NR-PA-030', why: '이름이 비슷한 다른 상품이었습니다', author: 'AX 담당자', knownCodes: known }

  it('제대로 적었으면 통과한다', () => {
    expect(validateCorrection(good)).toEqual({})
  })

  it('없는 상품코드로는 못 바꾼다', () => {
    expect(validateCorrection({ ...good, canonicalCode: 'NR-XX-999' }).canonicalCode).toBeTruthy()
  })

  it('왜 바꾸는지를 안 적으면 막는다', () => {
    // 이후 계산에 적용되는 연결을 바꾼 이유를 남긴다.
    expect(validateCorrection({ ...good, why: '수정' }).why).toBeTruthy()
  })

  it('누가 정정하는지 받아 둔다', () => {
    expect(validateCorrection({ ...good, author: ' ' }).author).toBeTruthy()
  })

  it('소문자로 적어도 받아 준다', () => {
    expect(validateCorrection({ ...good, canonicalCode: 'nr-pa-030' })).toEqual({})
  })
})

describe('현재 연결을 확인했다는 근거', () => {
  it('과거 원문 확인은 보존하지만 현재 연결의 검증으로 쓰지 않는다', () => {
    const historical = { ...confirm('CJ-77', '2026-08-01 10:00:00'), alternatives: '원문 대안' }
    const [row] = annotate([alias('CJ-77', 'AX 담당자', '2026-08-01 09:00:00')], [historical])
    expect(row.confirmed).toMatchObject({ by: 'AX 담당자', verified: false, legacy: true })
    expect(row.needsCheck).toBe(true); expect(row.staleCheck).toBe(true)
    expect(historical.alternatives).toBe('원문 대안')
  })

  it('동초에 다른 상품으로 바뀐 확인을 현재 확인으로 만들지 않는다', () => {
    const original = alias('CJ-77', '담당자', '2026-08-01 09:00:00')
    const current = { ...original, canonical_code: 'NR-PA-030' }
    const [row] = annotate([current], [confirm('CJ-77', original.created_at)])
    expect(row.needsCheck).toBe(true); expect(row.confirmed.verified).toBe(false)
  })

  it('A→B→A로 값과 표시시각이 같아도 서버 revision이 다르면 옛 확인은 낡은 것이다', () => {
    const current = { ...alias('CJ-77', '담당자', '2026-08-01 09:00:00'), mapping_revision: 'b'.repeat(64) }
    const [row] = annotate([current], [confirm('CJ-77', current.created_at)])
    expect(row.needsCheck).toBe(true); expect(row.staleCheck).toBe(true)
  })

  it('변형된 메타데이터가 확인 근거로 승격되지 않는다', () => {
    const record = confirm('CJ-77', '2026-08-01 10:00:00')
    for (const changes of [{ link_id: 'another' }, { application_id: 'fake-app' }, { alternatives: 'ilson-code-review:{"version":9}' }]) {
      const [row] = annotate([alias('CJ-77', '담당자', '2026-08-01 09:00:00')], [{ ...record, ...changes }])
      expect(row.needsCheck).toBe(true)
    }
  })

  it.each(['__proto__', 'NR-XX-999'])('메타데이터 revision이 맞아도 목록에 없는 상품 %s 은 확인 완료가 아니다', canonicalCode => {
    const current = { ...alias('CJ-77', '담당자', '2026-08-01 09:00:00'), canonical_code: canonicalCode }
    const record = { ...confirm('CJ-77', current.created_at), alternatives: encodeCodeReviewEvidence({
      version: 1, action: 'confirm', externalCode: 'CJ-77', reviewedMappingRevision: current.mapping_revision,
      beforeCanonicalCode: canonicalCode, afterCanonicalCode: canonicalCode, provenance: { state: 'unknown', applicationId: null },
    }) }
    const [row] = annotate([current], [record])
    expect(row.needsCheck).toBe(true); expect(row.confirmed.verified).toBe(false)
  })
})
