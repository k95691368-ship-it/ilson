// 손든 부서가 걸린 신청서가 몇 건인가.
//
// 손든 사실은 그 신청서를 열어야만 보인다. 그런데 담당자는 이미 판정한
// 건을 다시 열지 않는다. 첫 화면 할 일 목록에 올리려고 여기서 센다.
//
// 판정 전인 건과 협의 중인 건을 갈라 센다. 한 신청서가 두 줄에 동시에
// 뜨면 목록이 두 배로 길어 보이고, 그러면 아무도 안 읽는다.

import { jsonResponse, jsonError } from '../_lib/http.js'
import { JOIN_KIND, UNJOIN_KIND, joinCounts } from '../../shared/join.js'

export async function onRequestGet({ env }) {
  try {
    const { results } = await env.DB.prepare(
      `SELECT id, application_id, title, what, why, link_kind, link_id FROM decision_log
       WHERE link_kind IN (?, ?)`
    )
      .bind(JOIN_KIND, UNJOIN_KIND)
      .all()

    const released = new Set(
      results.filter((r) => r.link_kind === UNJOIN_KIND).map((r) => r.link_id)
    )

    const joinsByApp = {}
    for (const r of results) {
      if (r.link_kind !== JOIN_KIND) continue
      let dept = null
      try {
        dept = JSON.parse(r.why).dept
      } catch {
        // 옛 기록은 제목에만 부서가 들어 있다.
        dept = String(r.title ?? '').split(' — ')[0] || null
      }
      ;(joinsByApp[r.application_id] ??= []).push({
        id: r.id,
        dept,
        story: r.what,
        released: released.has(r.id),
      })
    }

    const ids = Object.keys(joinsByApp)
    if (ids.length === 0) {
      return jsonResponse({ summary: joinCounts({}), applicationIds: [] })
    }

    const holes = ids.map(() => '?').join(',')
    const [apps, reqs] = await Promise.all([
      env.DB.prepare(`SELECT id, status FROM application WHERE id IN (${holes})`)
        .bind(...ids)
        .all(),
      env.DB.prepare(
        `SELECT DISTINCT application_id, dept FROM requirement WHERE application_id IN (${holes})`
      )
        .bind(...ids)
        .all(),
    ])

    const requirementsByApp = {}
    for (const r of reqs.results) {
      ;(requirementsByApp[r.application_id] ??= []).push({ dept: r.dept })
    }

    // 세는 규칙은 shared에 둔다. 라우트 안에 두면 시험을 못 붙인다 —
    // 이 저장소의 시험은 전부 순수 함수 시험이다.
    const summary = joinCounts({ joinsByApp, apps: apps.results, requirementsByApp })
    return jsonResponse({ summary, applicationIds: summary.repriorityIds })
  } catch (err) {
    return jsonError(`손든 부서를 세지 못했습니다. (${String(err.message).slice(0, 160)})`, 503)
  }
}
