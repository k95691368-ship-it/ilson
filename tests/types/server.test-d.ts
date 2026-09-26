import type { ReviewResponse } from '../../functions/api/applications/[id]/review.ts'
import { validateReview } from '../../shared/review.ts'

export function reviewContract(input: unknown): ReviewResponse | null {
  const result = validateReview(input)
  if (!result.ok) {
    // @ts-expect-error Failed validation must not expose a trusted review value.
    const invalidValue = result.value
    void invalidValue
    return null
  }
  const response = {
    ok: true,
    application_id: 'contract-only',
    ticket_no: 'AX-CON-001',
    status: result.value.verdict,
    verdict: result.value.verdict,
  } satisfies ReviewResponse
  // @ts-expect-error A response cannot invent a new workflow status.
  const invalidStatus: ReviewResponse['status'] = '자동승인'
  // @ts-expect-error Successful validation yields numbers, not arbitrary strings.
  const invalidScore: typeof result.value.impact_score = '높음'
  void invalidStatus
  void invalidScore
  return response
}
