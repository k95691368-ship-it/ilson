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

// 한 사람이 십 분에 몇 번까지 쓸 수 있는가.
//
// 넉넉하게 잡았다. 사람이 손으로 하는 일은 십 분에 예순 번을 넘지 않는다.
// 좁게 잡으면 시연 중에 막히는데, 그건 막아야 할 것을 막는 게 아니라
// 보러 온 사람을 막는 것이다.
const WRITES_PER_WINDOW = 60
const WINDOW_SECONDS = 600

export async function onRequest(context) {
  const { request, next } = context
  if (!context.env?.DBBridgeApplied) {
    const db = await withDbBinding(context.env)
    if (db) {
      context.env.DB = db
      context.env.DBBridgeApplied = true
    }
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
