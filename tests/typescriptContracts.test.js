import { describe, expect, it } from 'vitest'
import { onRequestPost as review } from '../functions/api/applications/[id]/review.ts'
import { validateReview } from '../shared/review.ts'
import { validateOutcomeInputs } from '../shared/outcomeInputs.ts'

describe('TypeScript 전환 후에도 외부 입력은 런타임에서 검증한다', () => {
  it.each([null, [], '수용', 12, false])('검토 API의 객체 아닌 본문 %j는 DB 접근 전에 거절한다', async body => {
    const response = await review({
      env: { DB: { prepare() { throw Error('Invalid input must not reach the DB') } } },
      params: { id: 'contract-only' },
      request: new Request('https://local.invalid/api/applications/contract-only/review', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }),
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: '요청 형식이 올바르지 않습니다.' })
  })

  it('합격하지 않은 판정은 성공 value를 반환하지 않는다', () => {
    const result = validateReview({ verdict: '자동승인', impact_score: 3, difficulty_score: 2 })
    expect(result.ok).toBe(false)
    expect(result).not.toHaveProperty('value')
    expect(result.errors.verdict).toBeTruthy()
  })

  it.each([true, [], {}, ' '])('TypeScript와 별개로 잘못된 비용 %j를 거절한다', value => {
    const result = validateOutcomeInputs({ dev_hours: value, ops_cost_krw: value, amortize_months: value })
    expect(result.ok).toBe(false)
    expect(Object.keys(result.errors)).toEqual(['dev_hours', 'ops_cost_krw', 'amortize_months'])
  })
})
