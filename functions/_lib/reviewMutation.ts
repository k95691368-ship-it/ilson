import { atomicMutation, mutationFingerprint } from './atomicMutation.ts'
import type { MutationAction } from './atomicMutation.ts'
import { jsonError, failUnexpected } from './http.ts'
import type { Database, DatabaseResult } from './runtimeTypes.ts'

export const validReviewRevision = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
export const reviewConflict = () => jsonError('판정 또는 진행 상태가 변경되었습니다. 작성한 내용은 유지한 채 최신 판정을 확인한 뒤 다시 저장해주세요.', 409)

// The optimistic read check alone is not a row lock: build/accept can commit
// between it and the writes. This first staged write locks the parent and checks
// its monotonic revision inside the same transaction as every following write.
export function lockReviewRevision(DB: Database, application: { id: string; review_revision: unknown }): Promise<DatabaseResult> {
  return DB.prepare('SELECT public.ilson_lock_review_revision(?, ?)')
    .bind(application.id, Number(application.review_revision)).run()
}

export async function reviewMutation(DB: Database, request: Request, identity: string, body: unknown, action: MutationAction, message: string): Promise<Response> {
  const requestId = request.headers.get('X-Idempotency-Key') || crypto.randomUUID()
  if (!/^[a-zA-Z0-9_-]{16,100}$/.test(requestId)) return jsonError('중복 방지 요청 번호가 올바르지 않습니다.', 400)
  try {
    return await atomicMutation(DB, requestId, await mutationFingerprint({ identity, body }), action)
  } catch (error) {
    const detail = typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string' ? error.message : ''
    if (/\/(40001|40P01)/.test(detail)) return reviewConflict()
    return failUnexpected(error, message)
  }
}
