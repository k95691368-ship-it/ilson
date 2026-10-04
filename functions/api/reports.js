// 넘긴 뒤 들어온 신고 전부. 그리고 담당자가 처리했다고 남기는 자리.
//
// 도구별로 흩어져 있으면 "지금 어느 도구가 못 미더운가"를 볼 수가 없다.
// 담당자는 도구를 하나씩 열어 보지 않는다 — 한곳에 모여 있어야 본다.

import { jsonResponse, jsonError, failFields, failUnexpected } from '../_lib/http.ts'
import { logDecision } from '../_lib/decisions.js'
import { toReports, REPORT_KIND, REPORT_FIX } from '../../shared/report.js'
import { loadReportFeed, parseReportFeedQuery } from '../_lib/reportFeed.ts'

export async function onRequestGet({ env, data: requestData, request }) {
  const query = parseReportFeedQuery(request)
  if (!query.ok) return jsonError('신고 페이지 요청을 확인해주세요.', 400)
  env = requestData?.requestEnv ?? env
  try {
    const feed = await loadReportFeed(env.DB, query.value)
    if (query.value.basis !== null && query.value.basis !== feed.basis) {
      return jsonResponse({ error: '신고 기록이 바뀌었습니다. 첫 페이지에서 다시 확인해주세요.', code: 'REPORTS_CHANGED' }, 409)
    }
    // Only this page's original reports are grouped. Tool badges and summary
    // remain complete for the current scoped data, not counts of visible cards.
    const byApp = new Map()
    for (const r of feed.rows) {
      if (!byApp.has(r.application_id)) byApp.set(r.application_id, [])
      byApp.get(r.application_id).push(r)
      if (r.fix_id !== null) byApp.get(r.application_id).push({
        id:r.fix_id,application_id:r.fix_application_id,link_kind:REPORT_FIX,link_id:r.id,
        what:r.fix_how,why:r.fix_why,created_at:r.fix_at,
      })
    }
    const counts = new Map(feed.counts.map(c => [c.application_id,c]))
    const tools = []
    for (const [applicationId, rows] of byApp) {
      const first = rows[0]
      const reports = toReports(rows)
      const count = counts.get(applicationId)
      tools.push({
        applicationId,
        ticket_no: first.ticket_no,
        slug: first.slug,
        toolTitle: first.tool_title ?? first.dept,
        dept: first.handed_to_dept ?? first.dept,
        reports,
        open: count.open,
        urgent: count.urgent,
        total: count.total,
        fixed: count.fixed,
      })
    }

    // 못 미더운 도구를 맨 위로. 급한 신고가 살아 있는 것이 먼저다.
    tools.sort((a, b) => b.urgent - a.urgent || b.open - a.open || (a.applicationId < b.applicationId ? -1 : a.applicationId > b.applicationId ? 1 : 0))
    return jsonResponse({ tools, summary: feed.summary, page: feed.page })
  } catch (err) {
    return failUnexpected(err, '신고를 불러오지 못했습니다.')
  }
}

// 담당자가 "이렇게 고쳤습니다"를 남긴다.
export async function onRequestPost({ env, data: requestData, request }) {
  env = requestData?.requestEnv ?? env
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
