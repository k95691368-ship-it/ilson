// 다른 부서가 손든 신청서가 몇 건인가.
//
// 손든 사실은 그 신청서를 열어야만 보인다. 그런데 담당자는 이미 판정한
// 건을 다시 열지 않는다. 첫 화면 할 일 목록에 올리려고 여기서 센다.

import { jsonResponse, jsonError } from '../_lib/http.js'
import { JOIN_KIND, UNJOIN_KIND } from '../../shared/join.js'

export async function onRequestGet({ env }) {
  try {
    const { results } = await env.DB.prepare(
      `SELECT id, application_id, link_kind, link_id FROM decision_log
       WHERE link_kind IN (?, ?)`
    )
      .bind(JOIN_KIND, UNJOIN_KIND)
      .all()

    // 담당자가 "이건 다른 건입니다"로 푼 것은 안 센다. 풀었는데도 계속
    // 세면 그 목록은 줄지 않고, 그러면 아무도 안 본다.
    const released = new Set(
      results.filter((r) => r.link_kind === UNJOIN_KIND).map((r) => r.link_id)
    )
    const live = results.filter((r) => r.link_kind === JOIN_KIND && !released.has(r.id))

    // 신청서 단위로 센다. 한 건에 세 부서가 손들어도 담당자가 다시 볼
    // 신청서는 한 건이다.
    const apps = new Set(live.map((r) => r.application_id))

    return jsonResponse({
      summary: {
        needsRepriority: apps.size,
        joinCount: live.length,
        releasedCount: released.size,
      },
      applicationIds: [...apps],
    })
  } catch (err) {
    return jsonError(`손든 부서를 세지 못했습니다. (${String(err.message).slice(0, 160)})`, 503)
  }
}
