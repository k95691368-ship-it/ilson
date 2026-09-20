import { jsonResponse } from './http.js'

// This is an expected-scope precondition, never an authentication credential or
// a selector for another user's database. DB is already bound by middleware.
export async function requireSessionScope(request, DB) {
  const expected = request.headers.get('X-Ilson-Scope')
  if (expected === null) return jsonResponse({ error: '접근 상태를 먼저 확인해주세요. 페이지를 새로 열어 다시 시도해주세요.', code: 'SESSION_SCOPE_REQUIRED' }, 428)
  if (!/^[a-f0-9]{64}$/.test(expected)) return jsonResponse({ error: '접근 확인 정보의 형식이 올바르지 않습니다.', code: 'SESSION_SCOPE_INVALID' }, 400)
  if (typeof DB?.toolRunScope !== 'function') return jsonResponse({ error: '세션의 데이터 접근 설정을 확인하지 못했습니다.' }, 503)
  const actual = await DB.toolRunScope()
  if (typeof actual !== 'string' || !/^[a-f0-9]{64}$/.test(actual)) return jsonResponse({ error: '세션의 작업공간을 확인하지 못했습니다.' }, 503)
  if (expected !== actual) return jsonResponse({ error: '계정 또는 체험 공간이 바뀌었습니다. 접근을 다시 확인한 뒤 작업해주세요.', code: 'SESSION_SCOPE_CHANGED' }, 409)
  return null
}
