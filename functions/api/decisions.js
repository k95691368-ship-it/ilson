// 이 조직이 내린 결정 전부.
//
// 이 사이트가 파는 것은 "기록이 끊기지 않는다"이고, 그 기록의 알맹이가
// 결정이다. 여덟 단계에 흩어져 있는 것을 한 화면에 모아 시간순으로 본다.
//
// 왜 필요한가: 몇 달 뒤 "그때 왜 그렇게 정했냐"는 질문은 신청서 단위가 아니라
// 사람 단위로 온다. "재무 건 반려한 이유가 뭐였죠"가 아니라 "요즘 뭘 반려하고
// 계세요"로 온다. 그 질문에 답하려면 결정을 가로로 훑을 수 있어야 한다.

import { jsonResponse, jsonError } from '../_lib/http.js'

const STAGES = ['신청서', '검토', '협의안', '제작', '베타테스트', '사용법서', '배포', '성과']

export async function onRequestGet({ env, request }) {
  const url = new URL(request.url)
  const stage = url.searchParams.get('stage')
  const dept = url.searchParams.get('dept')
  const actor = url.searchParams.get('actor')
  const onlyUnrequested = url.searchParams.get('unrequested') === '1'
  const q = (url.searchParams.get('q') ?? '').trim()

  try {
    const where = []
    const binds = []

    if (stage && STAGES.includes(stage)) {
      where.push('d.stage = ?')
      binds.push(stage)
    }
    if (dept) {
      where.push('a.dept = ?')
      binds.push(dept)
    }
    if (actor === 'human' || actor === 'ai') {
      where.push('d.actor = ?')
      binds.push(actor)
    }
    if (onlyUnrequested) where.push('d.unrequested = 1')
    if (q) {
      // 제목·내용·근거·대안 어디에 있든 찾는다. 나중에 "그거 어디 적었더라"를
      // 찾을 때 어느 칸에 적었는지까지 기억하고 있을 리 없다.
      where.push('(d.title LIKE ? OR d.what LIKE ? OR d.why LIKE ? OR d.alternatives LIKE ?)')
      const like = `%${q}%`
      binds.push(like, like, like, like)
    }

    const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''

    const [rows, stageCount, deptCount, totals] = await Promise.all([
      env.DB.prepare(
        `SELECT d.id, d.application_id, d.stage, d.actor, d.title, d.what, d.why,
                d.alternatives, d.unrequested, d.created_at,
                a.ticket_no, a.dept, a.title AS application_title
         FROM decision_log d
         LEFT JOIN application a ON a.id = d.application_id
         ${clause}
         ORDER BY d.created_at DESC
         LIMIT 200`
      )
        .bind(...binds)
        .all(),

      env.DB.prepare(
        'SELECT stage, COUNT(*) AS n FROM decision_log GROUP BY stage'
      ).all(),

      env.DB.prepare(
        `SELECT a.dept, COUNT(*) AS n FROM decision_log d
         JOIN application a ON a.id = d.application_id
         GROUP BY a.dept ORDER BY n DESC`
      ).all(),

      env.DB.prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN actor = 'human' THEN 1 ELSE 0 END) AS human,
                SUM(CASE WHEN unrequested = 1 THEN 1 ELSE 0 END) AS unrequested,
                SUM(CASE WHEN alternatives IS NOT NULL AND alternatives <> '' THEN 1 ELSE 0 END) AS with_alternatives
         FROM decision_log`
      ).first(),
    ])

    return jsonResponse({
      items: rows.results,
      stages: STAGES,
      byStage: Object.fromEntries(stageCount.results.map((s) => [s.stage, s.n])),
      byDept: deptCount.results,
      totals: {
        total: totals?.total ?? 0,
        human: totals?.human ?? 0,
        unrequested: totals?.unrequested ?? 0,
        withAlternatives: totals?.with_alternatives ?? 0,
      },
      filtered: rows.results.length,
    })
  } catch (err) {
    return jsonError(`결정 기록을 불러오지 못했습니다. (${String(err.message).slice(0, 160)})`, 503)
  }
}
