import { failUnexpected, jsonError, jsonResponse } from '../_lib/http.js'

const methodNotAllowed = () => jsonResponse({ error: '세션 확인은 GET 요청만 사용할 수 있습니다.' }, 405, { Allow: 'GET' })

// Authentication belongs to the existing middleware. This endpoint confirms
// that its scoped database access is still valid, without returning user data.
export async function onRequestGet({ env, data: requestData, request }) {
  if (request.method !== 'GET') return methodNotAllowed()
  env = requestData?.requestEnv ?? env
  const mode = env.DEMO_WORKSPACE === true ? 'demo' : env.AUTH_ACTOR?.mode === 'access' ? 'access' : null
  if (!mode) return jsonError('인증된 계정 또는 개인 체험 공간이 필요합니다.', 401)

  const DB = env.DB
  const scoped = mode === 'demo'
    ? DB?.workspace === true && !DB.actorEmail && !env.AUTH_ACTOR
    : DB?.workspace === false && Boolean(DB.actorEmail) && DB.actorEmail === env.AUTH_ACTOR.email
  if (!scoped || typeof DB.prepare !== 'function' || typeof DB.toolRunScope !== 'function') {
    return jsonError('세션의 데이터 접근 설정을 확인하지 못했습니다.', 503)
  }
  try {
    await DB.prepare('SELECT 1').first()
    const scope = await DB.toolRunScope()
    if (typeof scope !== 'string' || !/^[a-f0-9]{64}$/.test(scope)) {
      return jsonError('세션의 작업공간을 확인하지 못했습니다.', 503)
    }
    return jsonResponse({ ok: true, mode, scope })
  } catch (error) {
    return failUnexpected(error, '세션을 확인하지 못했습니다. 잠시 후 다시 시도해주세요.')
  }
}

// Pages handles every other method here; the explicit GET export also keeps
// the existing local API router on the same authenticated read path.
export async function onRequest({ env, data: requestData, request }) {
  env = requestData?.requestEnv ?? env
  return request.method === 'GET' ? onRequestGet({ env, data: requestData, request }) : methodNotAllowed()
}
