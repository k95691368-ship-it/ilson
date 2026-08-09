// 부서가 단 합격 기준 이의가 몇 건 남았는가.
//
// 이의는 담당자만 풀 수 있다. 그런데 담당자에게 알리는 길이 없었다 —
// 협의안 화면에서 그 신청서를 골라 아래로 내려가야만 보였다. 그러면
// 부서는 답을 기다리다 "말해 봐야 소용없다"로 끝나고, 다음부터 서명
// 자체를 안 한다. 이 사이트에서 가장 조용히 망가지는 자리다.
//
// 첫 화면 할 일 목록에 올리려고 여기서 센다.

import { jsonResponse, jsonError } from '../_lib/http.js'
import { OBJECTION_KIND, RESOLVE_KIND } from '../../shared/signoff.js'

export async function onRequestGet({ env }) {
  try {
    const { results } = await env.DB.prepare(
      `SELECT id, application_id, link_kind, link_id FROM decision_log
       WHERE link_kind IN (?, ?)`
    )
      .bind(OBJECTION_KIND, RESOLVE_KIND)
      .all()

    // 푼 이의는 안 센다. 풀었는데도 계속 세면 그 목록은 줄지 않고,
    // 그러면 아무도 안 본다.
    const resolved = new Set(
      results.filter((r) => r.link_kind === RESOLVE_KIND).map((r) => r.link_id)
    )
    const open = results.filter((r) => r.link_kind === OBJECTION_KIND && !resolved.has(r.id))

    // 신청서 단위로 센다. 한 건에 이의가 셋이어도 담당자가 열어 볼
    // 신청서는 한 건이다.
    const apps = new Set(open.map((r) => r.application_id))

    return jsonResponse({
      summary: {
        // 이의 건수와 해소 건수도 함께 냈었다. 첫 화면 할 일 목록이 읽는
        // 것은 신청서 수 하나뿐이다 — 담당자가 열어 볼 것이 신청서라서다.
        applications: apps.size,
      },
      applicationIds: [...apps],
    })
  } catch (err) {
    return jsonError(`부서 이의를 세지 못했습니다. (${String(err.message).slice(0, 160)})`, 503)
  }
}
