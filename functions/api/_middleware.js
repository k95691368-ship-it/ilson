// API 로 들어오는 모든 요청이 지나는 문.
//
// 이 사이트에는 로그인이 없다. 그것은 설계로 고른 것이고 바꿀 생각도 없다 --
// 현업 담당자에게 계정을 만들라고 하면 그 순간 사용률이 0 이 된다.
//
// 그런데 계정이 없다는 것은 **누가 얼마나 두드리는지 셀 근거도 없다**는 뜻이다.
// 세어 보니 값을 쓰는 창구가 서른한 곳인데 그중 열다섯 곳에 아무 한도가
// 없었다. 신청서·판정·신고·질문을 원하는 만큼 밀어 넣을 수 있었다는 뜻이다.
// 화면은 멀쩡히 돌고 아무 기록도 안 남으므로, 그렇게 되고 있어도 모른다.
//
// 라우트마다 한 줄씩 붙이는 방법도 있지만 그러면 새 라우트를 만들 때마다
// 잊는다. 실제로 열다섯 곳이 그렇게 빠졌다. 그래서 지나가는 길목에 둔다.
//
// 읽기(GET)는 막지 않는다. 보러 온 사람을 막을 이유가 없고, 읽기는 아무것도
// 남기지 않는다. 막는 것은 **남기는 요청**뿐이다.

import { jsonError } from '../_lib/http.js'
import { checkRateLimit } from '../_lib/rateLimit.js'
import { withDbBinding } from '../_lib/dbBridge.js'
import { workspaceEnabled, workspaceToken, workspaceDb, sameOrigin } from '../_lib/workspace.js'

// 한 사람이 십 분에 몇 번까지 쓸 수 있는가.
//
// 넉넉하게 잡았다. 사람이 손으로 하는 일은 십 분에 예순 번을 넘지 않는다.
// 좁게 잡으면 시연 중에 막히는데, 그건 막아야 할 것을 막는 게 아니라
// 보러 온 사람을 막는 것이다.
const WRITES_PER_WINDOW = 60
const WINDOW_SECONDS = 600

export async function onRequest(context) {
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
  if (workspaceEnabled(context.env)) {
    const control = path === '/api/demo/workspace'
    const health = path === '/api/health'
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && !sameOrigin(request)) {
      return jsonError('이 사이트에서 직접 요청해 주세요.', 403)
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown'
      if (!await checkRateLimit(context.env, 'write:' + ip, WRITES_PER_WINDOW, WINDOW_SECONDS)) {
        return jsonError('요청이 너무 많습니다. 잠시 후 다시 시도해주세요.', 429)
      }
    }
    if (!control && !health) {
      const token = workspaceToken(request)
      if (!token) return jsonError('개인 체험 공간을 먼저 열어 주세요.', 428)
      context.env.DB = workspaceDb(context.env, token)
      try { await context.env.DB.prepare('SELECT 1').first() } catch (error) {
        return jsonError(error.message.includes('/28000') ? '체험 공간이 만료되었습니다. 페이지를 새로 열어 주세요.' : '체험 공간에 연결하지 못했습니다.', error.message.includes('/28000') ? 428 : 503)
      }
      context.env.DEMO_WORKSPACE = true
      context.env.OVERRIDE_DEMO_MODE = 'true'
      // A demonstration must not use real integration or model credentials.
      if (path === '/api/override/assist') return jsonError('개인 체험에서는 외부 AI 호출을 실행하지 않습니다.', 403)
    }
    const response = await next()
    const privateResponse = new Response(response.body, response)
    privateResponse.headers.set('Cache-Control', 'private, no-store')
    privateResponse.headers.append('Vary', 'Cookie')
    return privateResponse
  }

  if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') {
    return next()
  }

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown'
  const allowed = await checkRateLimit(context.env, 'write:' + ip, WRITES_PER_WINDOW, WINDOW_SECONDS)
  if (!allowed) {
    return jsonError('요청이 너무 많습니다. 잠시 후 다시 시도해주세요.', 429)
  }

  return next()
}
