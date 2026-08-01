// 넘긴 뒤 들어온 신고 전부. 그리고 담당자가 처리했다고 남기는 자리.
//
// 도구별로 흩어져 있으면 "지금 어느 도구가 못 미더운가"를 볼 수가 없다.
// 담당자는 도구를 하나씩 열어 보지 않는다 — 한곳에 모여 있어야 본다.

import { jsonResponse, jsonError, failFields, failUnexpected } from '../_lib/http.js'
import { logDecision } from '../_lib/decisions.js'
import { toReports, openReports, REPORT_KIND, REPORT_FIX } from '../../shared/report.js'

export async function onRequestGet({ env }) {
  try {
    const { results } = await env.DB.prepare(
      `SELECT d.id, d.application_id, d.title, d.what, d.why, d.link_kind, d.link_id, d.created_at,
              a.ticket_no, a.dept, h.slug, h.title AS tool_title, h.handed_to_dept
       FROM decision_log d
       JOIN application a ON a.id = d.application_id
       LEFT JOIN handover h ON h.application_id = d.application_id
       WHERE d.link_kind IN (?, ?)
       ORDER BY d.created_at DESC
       LIMIT 200`
    )
      .bind(REPORT_KIND, REPORT_FIX)
      .all()

    // 도구별로 묶어서 각각 몇 건이 살아 있는지 센다.
    const byApp = new Map()
    for (const r of results) {
      if (!byApp.has(r.application_id)) byApp.set(r.application_id, [])
      byApp.get(r.application_id).push(r)
    }

    const tools = []
    for (const [applicationId, rows] of byApp) {
      const first = rows[0]
      const reports = toReports(rows)
      if (reports.length === 0) continue
      tools.push({
        applicationId,
        ticket_no: first.ticket_no,
        slug: first.slug,
        toolTitle: first.tool_title ?? first.dept,
        dept: first.handed_to_dept ?? first.dept,
        reports,
        open: openReports(reports).length,
        urgent: openReports(reports).filter((r) => r.urgent).length,
      })
    }

    // 못 미더운 도구를 맨 위로. 급한 신고가 살아 있는 것이 먼저다.
    tools.sort((a, b) => b.urgent - a.urgent || b.open - a.open)

    const all = tools.flatMap((t) => t.reports)
    return jsonResponse({
      tools,
      summary: {
        total: all.length,
        open: all.filter((r) => r.open).length,
        urgent: all.filter((r) => r.open && r.urgent).length,
        fixed: all.filter((r) => !r.open).length,
        toolsAffected: tools.length,
        toolsUntrusted: tools.filter((t) => t.urgent > 0).length,
      },
    })
  } catch (err) {
    return failUnexpected(err, '신고를 불러오지 못했습니다.')
  }
}

// 담당자가 "이렇게 고쳤습니다"를 남긴다.
export async function onRequestPost({ env, request }) {
  let body
  try {
    body = await request.json()
  } catch {
    return jsonError('보내주신 내용을 읽지 못했습니다.', 400)
  }

  const reportId = String(body.reportId ?? '').trim()
  const how = String(body.how ?? '').trim().slice(0, 2000)
  const why = String(body.why ?? '').trim().slice(0, 2000)
  const author = String(body.author ?? '').trim().slice(0, 60) || 'AX 담당자'

  const fields = {}
  if (!reportId) fields.reportId = '어느 신고를 처리하셨는지 골라주세요.'
  if (how.length < 5) fields.how = '무엇을 하셨는지 적어주세요.'
  // 원인을 안 적으면 다음에 같은 것이 또 온다. 고친 것보다 왜 그랬는지가
  // 남아야 다음에 안 겪는다.
  if (why.length < 5) fields.why = '왜 그랬던 것인지 적어주세요.'
  if (Object.keys(fields).length > 0) {
    return failFields(fields, '적어주신 것을 다시 확인해주세요.')
  }

  try {
    const report = await env.DB.prepare(
      `SELECT id, application_id FROM decision_log WHERE id = ? AND link_kind = ?`
    )
      .bind(reportId, REPORT_KIND)
      .first()
    if (!report) return jsonError('그 신고를 찾지 못했습니다.', 404)

    const already = await env.DB.prepare(
      `SELECT id FROM decision_log WHERE link_kind = ? AND link_id = ?`
    )
      .bind(REPORT_FIX, reportId)
      .first()
    if (already) return jsonError('그 신고는 이미 처리하셨습니다.', 409)

    const id = await logDecision(env, {
      applicationId: report.application_id,
      stage: '배포',
      actor: 'human',
      title: author,
      what: how,
      why,
      linkKind: REPORT_FIX,
      linkId: reportId,
    })

    return jsonResponse({ ok: true, id })
  } catch (err) {
    return failUnexpected(err, '처리를 남기지 못했습니다.')
  }
}
