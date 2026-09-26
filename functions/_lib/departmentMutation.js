import { atomicMutation, mutationFingerprint } from './atomicMutation.ts'
import { jsonError, failUnexpected } from './http.ts'

// Department declarations and their audit records must share one commit. The
// callback reads the current actor through the staged DB before authorizing it.
export async function departmentMutation(env, request, identity, body, action) {
  const key = request.headers.get('X-Idempotency-Key') || crypto.randomUUID()
  if (!/^[a-zA-Z0-9_-]{16,100}$/.test(key)) return jsonError('중복 방지 요청 번호가 올바르지 않습니다.', 400)
  try {
    return await atomicMutation(env.DB, key, await mutationFingerprint({ identity, body }), action)
  } catch (error) {
    if (/\/(40001|40P01|28000)/.test(error.message)) return jsonError('자료 또는 계정 권한이 변경되었습니다. 최신 내용을 확인한 뒤 다시 시도해주세요.', 409)
    return failUnexpected(error, '부서 확인을 기록하지 못했습니다.')
  }
}
