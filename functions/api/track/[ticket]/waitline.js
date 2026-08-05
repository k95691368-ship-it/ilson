// "우리 것은 왜 아직입니까"에 답한다.
//
// 담당자는 우선순위 판에서 "이걸 먼저 한다"를 고를 때 이유를 반드시 적는다.
// 그 검증 문구가 이렇다 — *"뒤로 밀린 부서가 물어볼 때 답할 것이 있어야
// 합니다."* 그래 놓고 그 답을 부서가 볼 수 있는 자리에 안 뒀다.
//
// 여기서 그 서랍을 연다. 없는 순서를 지어내지는 않는다 — 담당자가 아직
// 아무것도 안 정했으면 "아직 안 정했습니다"가 정직한 답이다.

import { jsonResponse, jsonError } from '../../../_lib/http.js'
import { waitLine } from '../../../../shared/waitline.js'
import { PICK_KIND, UNPICK_KIND } from '../../../../shared/priority.js'

export async function onRequestGet({ env, params }) {
  try {
    const ticket = String(params.ticket ?? '').trim().toUpperCase()
    const mine = await env.DB.prepare(
      'SELECT id, ticket_no, dept, title, status FROM application WHERE ticket_no = ?'
    )
      .bind(ticket)
      .first()
    if (!mine) return jsonError('그 접수번호를 찾지 못했습니다.', 404)

    const [picks, running] = await Promise.all([
      // 먼저 하기로 정한 것과 그 이유. 취소는 자기 앞의 지정을 지운다.
      env.DB.prepare(
        `SELECT d.application_id, d.what, d.why, d.link_kind, d.created_at,
                a.ticket_no, a.dept, a.title, a.status
         FROM decision_log d JOIN application a ON a.id = d.application_id
         WHERE d.link_kind IN (?, ?)
         ORDER BY d.created_at`
      )
        .bind(PICK_KIND, UNPICK_KIND)
        .all(),

      // 이미 만들고 있는 것. 순서보다 앞에 있는 것은 사실 이쪽이다.
      env.DB.prepare(
        "SELECT id, ticket_no, dept, title FROM application WHERE status = '진행중'"
      ).all(),
    ])

    const live = new Map()
    for (const r of picks.results) {
      if (r.link_kind === UNPICK_KIND) live.delete(r.application_id)
      else live.set(r.application_id, r)
    }

    const picked = [...live.values()]
      // 이미 끝났거나 반려된 것은 앞을 막지 않는다.
      .filter((r) => r.status !== '완료' && r.status !== '반려')
      .map((r) => ({
        application_id: r.application_id,
        ticket_no: r.ticket_no,
        dept: r.dept,
        title: r.title,
        status: r.status,
        // 담당자가 적은 이유를 그대로 보여준다. 다듬지 않는다 — 다듬으면
        // 부서가 읽는 것과 기록에 남은 것이 달라진다.
        why: r.why ?? null,
        at: r.created_at,
      }))

    return jsonResponse({
      state: waitLine({
        mine,
        picked,
        running: running.results,
      }),
    })
  } catch (err) {
    return jsonError(`차례를 계산하지 못했습니다. (${String(err.message).slice(0, 160)})`, 503)
  }
}
