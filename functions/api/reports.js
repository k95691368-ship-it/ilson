// 넘긴 뒤 들어온 신고 전부. 그리고 담당자가 처리했다고 남기는 자리.
//
// 도구별로 흩어져 있으면 "지금 어느 도구가 못 미더운가"를 볼 수가 없다.
// 담당자는 도구를 하나씩 열어 보지 않는다 — 한곳에 모여 있어야 본다.

import { jsonResponse, jsonError, failUnexpected } from '../_lib/http.ts'
import { toReports, REPORT_FIX } from '../../shared/report.js'
import { loadReportFeed, parseReportFeedQuery } from '../_lib/reportFeed.ts'
import { handleReportFix, reportSourceVersion } from '../_lib/reportFix.ts'

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
      const originals = new Map(rows.filter(r => r.link_kind === '신고').map(r => [r.id, r]))
      for (const report of reports) report.version = await reportSourceVersion(originals.get(report.id))
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
  return handleReportFix(env, request)
}
