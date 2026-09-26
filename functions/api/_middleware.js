// Public demonstrations use private visitor workspaces and same-origin writes.
// Real deployments require signed Access identity for business reads and writes.
// Rate limits are additional abuse protection, not a replacement for authentication.

import { jsonError, failUnexpected, privateResponse } from '../_lib/http.ts'
import { boundRequestBody } from '../_lib/requestBody.ts'
import { checkRateLimit } from '../_lib/rateLimit.js'
import { withDbBinding } from '../_lib/dbBridge.ts'
import { workspaceEnabled, workspaceToken, workspaceDb, sameOrigin } from '../_lib/workspace.js'
import { resolveOverrideActor } from '../_lib/override.js'
import { canUseBusinessRoute, scopeEnvironment, verifiedAttribution } from '../_lib/authorization.js'
import { requireSessionScope } from '../_lib/sessionScope.js'

// 한 사람이 십 분에 몇 번까지 쓸 수 있는가.
//
// 넉넉하게 잡았다. 사람이 손으로 하는 일은 십 분에 예순 번을 넘지 않는다.
// 좁게 잡으면 시연 중에 막히는데, 그건 막아야 할 것을 막는 게 아니라
// 보러 온 사람을 막는 것이다.
const WRITES_PER_WINDOW = 60
const WINDOW_SECONDS = 600

export async function onRequest(context) {
  let body
  let response
  try {
    body = boundRequestBody(context.request)
    if (!body.exceeded) {
      const next = context.next
      context.request = body.request
      // Pages must pass the bounded stream to the downstream handler, not the
      // original request captured when the middleware chain was constructed.
      context.next = (forwarded = context.request) => next(forwarded)
      response = await handleRequest(context)
    }
  } catch (error) {
    response = failUnexpected(error, '요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.')
  }
  // Authentication/maintenance may return without reading a body at all.
  if (body?.request.body && !body.request.body.locked) void body.request.body.cancel().catch(() => {})
  if (body?.exceeded) response = jsonError('요청 데이터가 너무 큽니다. 파일이나 결과를 나누어 다시 시도해주세요.', 413)
  return privateResponse(response)
}

async function handleRequest(context) {
  // Never mutate the reusable platform env with a visitor-specific DB binding.
  context.env = { ...context.env }
  // Pages next() constructs a NEW context using the original bindings, while
  // context.data is explicitly shared within this request (not across requests).
  context.data ??= {}
  context.data.requestEnv = context.env
  const { request, next } = context
  if (context.env?.DB_MAINTENANCE === 'true' && !['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    return jsonError('데이터베이스 이전 중입니다. 잠시 후 다시 시도해주세요.', 503)
  }
  if (!context.env?.DBBridgeApplied) {
    const db = await withDbBinding(context.env)
    if (db) {
      context.env.DB = db
      context.env.DBBridgeApplied = true
    }
  }

  const path = new URL(request.url).pathname.replace(/\/$/, '')
  // Demo maintenance must never target the public business schema, even for admins.
  if (path.startsWith('/api/demo/') && !workspaceEnabled(context.env)) {
    // The UI gate must be able to discover that demos are disabled. This one
    // read returns only { enabled: false }; it neither authenticates a business
    // request nor opens a workspace. All other demo operations stay forbidden.
    if (path === '/api/demo/workspace' && request.method === 'GET') return next()
    return jsonError('개인 체험 공간에서만 사용할 수 있습니다.', 403)
  }
  if (workspaceEnabled(context.env)) {
    const rateLimitEnv = { ...context.env }
    const control = path === '/api/demo/workspace'
    const health = path === '/api/health'
    const sessionProbe = path === '/api/session' && request.method === 'GET'
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && !sameOrigin(request)) {
      return jsonError('이 사이트에서 직접 요청해 주세요.', 403)
    }
    if ((!control && !health) || (control && request.method === 'DELETE')) {
      const token = workspaceToken(request)
      if (!token) return jsonError('개인 체험 공간을 먼저 열어 주세요.', 428)
      const scopedDB = workspaceDb(context.env, token)
      try { await scopedDB.prepare('SELECT 1').first() } catch (error) {
        return failUnexpected(error, '체험 공간에 연결하지 못했습니다.')
      }
      if (!sessionProbe) {
        const mismatch = await requireSessionScope(request, scopedDB)
        if (mismatch) return mismatch
      }
      if (!control) {
        context.env.DB = scopedDB
        context.env.DEMO_WORKSPACE = true
        context.env.OVERRIDE_DEMO_MODE = 'true'
        // A demonstration must not use real integration or model credentials.
        if (path === '/api/override/assist') return jsonError('개인 체험에서는 외부 AI 호출을 실행하지 않습니다.', 403)
      }
    }
    // A stale tab must not consume a quota ticket or reset the current space.
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown'
      if (!await checkRateLimit(rateLimitEnv, 'write:' + ip, WRITES_PER_WINDOW, WINDOW_SECONDS)) {
        return jsonError('요청이 너무 많습니다. 잠시 후 다시 시도해주세요.', 429)
      }
    }
    return next()
  }

  // A demo role is only safe after selecting an isolated visitor workspace.
  if (path !== '/api/health' && context.env.OVERRIDE_DEMO_MODE === 'true') return jsonError('개인 체험 공간 설정이 필요합니다.', 503)
  // Real deployments protect reads as well as writes. An email header is not authentication.
  if (path !== '/api/health') {
    const actor = await resolveOverrideActor(context.env, request)
    if (!actor) return jsonError('인증된 사내 계정이 필요합니다.', 401)
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && !sameOrigin(request)) return jsonError('이 사이트에서 직접 요청해 주세요.', 403)
    if (!canUseBusinessRoute(actor, path, request.method)) return jsonError('현재 계정에는 이 작업 권한이 없습니다.', 403)
    context.env = scopeEnvironment(context.env, actor)
    context.data.requestEnv = context.env
    if (!(path === '/api/session' && request.method === 'GET')) {
      const mismatch = await requireSessionScope(request, context.env.DB)
      if (mismatch) return mismatch
    }
    const attributed = await verifiedAttribution(request, actor)
    if (attributed instanceof Response) return attributed
    context.request = attributed
  }
  if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') {
    return next(context.request)
  }

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown'
  const allowed = await checkRateLimit(context.env, 'write:' + ip, WRITES_PER_WINDOW, WINDOW_SECONDS)
  if (!allowed) {
    return jsonError('요청이 너무 많습니다. 잠시 후 다시 시도해주세요.', 429)
  }

  return next(context.request)
}
