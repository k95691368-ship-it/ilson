import { jsonError } from './http.js'
import { actorAssignments } from './dataScope.js'

// Reading an application is not authority to sign on behalf of its department.
// Only verified, administrator-assigned departments may make direct attestations.
export function departmentAuthority(env, department) {
  if (env.DEMO_WORKSPACE === true || env.OVERRIDE_DEMO_MODE === 'true') return null
  const actor = env.AUTH_ACTOR
  if (actor?.mode !== 'access' || !actor.email) return jsonError('인증된 사내 계정이 필요합니다.', 401)
  if (['audit', 'executive'].includes(actor.role)) return null
  const departments = Array.isArray(actor.departments) ? actor.departments : actorAssignments(actor).departments
  if (!department || !departments.includes(department)) {
    return jsonError('이 부서를 대신하여 확인할 권한이 없습니다. 계정에 배정된 부서로 확인해주세요.', 403)
  }
  return null
}
