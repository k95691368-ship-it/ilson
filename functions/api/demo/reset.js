// 시연 데이터를 처음 상태로 되돌린다.
//
// 면접관이 마음껏 눌러 볼 수 있어야 하므로 로그인을 요구하지 않는다. 대신
// 남용 방어로 시간당 횟수를 제한한다 — 이 엔드포인트는 표를 통째로 지우고
// 다시 심으므로, 누가 반복해서 부르면 D1 쓰기가 낭비된다.

import { jsonResponse, jsonError } from '../../_lib/http.js'
import { checkRateLimit } from '../../_lib/rateLimit.js'
import { seedDemo } from '../../_lib/demoSeed.js'

export async function onRequestPost({ env, request }) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown'
  const ticket = await checkRateLimit(env, `demo-reset:${ip}`, 6, 3600)
  if (!ticket) {
    return jsonError('초기화는 시간당 6회까지 가능합니다. 잠시 후 다시 시도해주세요.', 429)
  }

  try {
    const stats = await seedDemo(env)
    return jsonResponse({ ok: true, ...stats })
  } catch (err) {
    return jsonError(`초기화에 실패했습니다: ${String(err.message).slice(0, 220)}`, 500)
  }
}
