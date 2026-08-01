// 주 단위로 묶어 본다.
//
// 담당자가 위에 보고할 때 쓰는 화면이다. 지금은 접수함 목록을 눈으로 세어
// 문장을 만들어야 하는데, 매주 하는 일이라 그것부터 병목이다.

import { jsonResponse, failUnexpected } from '../_lib/http.js'
import { annualHours } from '../_lib/applications.js'
import { rollup, byDept, reportLine } from '../../shared/weekly.js'

const WEEKS = 8

export async function onRequestGet({ env, request }) {
  const url = new URL(request.url)
  const weeks = Math.min(26, Math.max(2, Number(url.searchParams.get('weeks')) || WEEKS))

  try {
    const { results } = await env.DB.prepare(
      `SELECT a.id, a.ticket_no, a.dept, a.title, a.status, a.created_at,
              a.current_minutes, a.current_people, a.current_frequency,
              r.verdict, r.updated_at AS decided_at
       FROM application a
       LEFT JOIN review r ON r.application_id = a.id
       ORDER BY a.created_at DESC
       LIMIT 500`
    ).all()

    const rows = results.map((r) => ({ ...r, annual_hours: annualHours(r) }))
    const buckets = rollup(rows, { weeks })

    return jsonResponse({
      weeks: buckets,
      depts: byDept(rows),
      line: reportLine(buckets),
      total: rows.length,
      // 몇 주치를 실제로 들여다봤는지 밝힌다. 500건 상한에 걸리면
      // 오래된 주가 통째로 비는데, 그걸 "그 주엔 없었다"로 읽으면 안 된다.
      capped: rows.length >= 500,
    })
  } catch (err) {
    return failUnexpected(err, '주간 집계를 불러오지 못했습니다.')
  }
}
