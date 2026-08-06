// 이 조직이 내린 결정 전부.
//
// 이 사이트가 파는 것은 "기록이 끊기지 않는다"이고, 그 기록의 알맹이가
// 결정이다. 여덟 단계에 흩어져 있는 것을 한 화면에 모아 시간순으로 본다.
//
// 왜 필요한가: 몇 달 뒤 "그때 왜 그렇게 정했냐"는 질문은 신청서 단위가 아니라
// 사람 단위로 온다. "재무 건 반려한 이유가 뭐였죠"가 아니라 "요즘 뭘 반려하고
// 계세요"로 온다. 그 질문에 답하려면 결정을 가로로 훑을 수 있어야 한다.

import { jsonResponse, jsonError } from '../_lib/http.js'
import { DEPT_KINDS, PROXY_KINDS, sideTally, sideLine } from '../../shared/side.js'

const STAGES = ['신청서', '검토', '협의안', '제작', '베타테스트', '사용법서', '배포', '성과']

export async function onRequestGet({ env, request }) {
  const url = new URL(request.url)
  const stage = url.searchParams.get('stage')
  const dept = url.searchParams.get('dept')
  const actor = url.searchParams.get('actor')
  const onlyUnrequested = url.searchParams.get('unrequested') === '1'
  const q = (url.searchParams.get('q') ?? '').trim()
  const side = (url.searchParams.get('side') ?? '').trim()

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
    // 담당자가 한 것 / 부서가 한 것 / 담당자가 대신 누른 것.
    //
    // 사람 이름으로 가르지 않는다 — 담당자가 부서 사람 이름으로 대신 눌러
    // 준 것이 실제로 있고, 그건 부서 응답이 아니다.
    const deptList = [...DEPT_KINDS]
    const proxyList = [...PROXY_KINDS]
    if (side === 'dept') {
      where.push(`d.link_kind IN (${deptList.map(() => '?').join(', ')})`)
      binds.push(...deptList)
    } else if (side === 'proxy') {
      where.push(`d.link_kind IN (${proxyList.map(() => '?').join(', ')})`)
      binds.push(...proxyList)
    } else if (side === 'ax') {
      const notMine = [...deptList, ...proxyList]
      where.push(`(d.link_kind IS NULL OR d.link_kind NOT IN (${notMine.map(() => '?').join(', ')}))`)
      binds.push(...notMine)
    }
    if (onlyUnrequested) where.push(`(d.unrequested = 1 OR (d.link_kind = 'review' AND r.verdict = '반려'
                  AND TRIM(COALESCE(r.refuse_alternative, '')) <> ''))`)
    if (q) {
      // 제목·내용·근거·대안 어디에 있든 찾는다. 나중에 "그거 어디 적었더라"를
      // 찾을 때 어느 칸에 적었는지까지 기억하고 있을 리 없다.
      where.push('(d.title LIKE ? OR d.what LIKE ? OR d.why LIKE ? OR d.alternatives LIKE ?)')
      const like = `%${q}%`
      binds.push(like, like, like, like)
    }

    const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''

    const [rows, stageCount, deptCount, totals, allKinds] = await Promise.all([
      env.DB.prepare(
        `SELECT d.id, d.application_id, d.stage, d.actor, d.title, d.what, d.why,
                d.alternatives, d.created_at, d.link_kind,
                -- 요청받지 않았는데 먼저 꺼낸 것.
                --
                -- 저장된 칸만 보면 예전에 남긴 기록은 영영 0이다. 그 칸을
                -- 쓰기 시작한 것이 최근이라, 이미 남은 65건은 전부 0으로
                -- 굳어 있다. 그래서 "먼저 제안한 것만" 필터가 늘 빈 화면이었다.
                --
                -- 남긴 글을 고치지 않는다. 대신 **읽을 때 판정한다** —
                -- 반려하면서 대안을 함께 낸 판정이 정확히 그것이다. 부서는
                -- A를 해달라고 했고 저희는 못 한다고 하면서, 아무도 안
                -- 물어본 B를 꺼냈다. 옛 기록도 새 기록도 같은 규칙으로 잡힌다.
                (d.unrequested = 1 OR (d.link_kind = 'review' AND r.verdict = '반려'
                  AND TRIM(COALESCE(r.refuse_alternative, '')) <> '')) AS unrequested,
                a.ticket_no, a.dept, a.title AS application_title
         FROM decision_log d
         LEFT JOIN application a ON a.id = d.application_id
         LEFT JOIN review r ON r.application_id = d.application_id
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
                SUM(CASE WHEN d.actor = 'human' THEN 1 ELSE 0 END) AS human,
                SUM(CASE WHEN (d.unrequested = 1 OR (d.link_kind = 'review' AND r.verdict = '반려'
                  AND TRIM(COALESCE(r.refuse_alternative, '')) <> '')) THEN 1 ELSE 0 END) AS unrequested,
                SUM(CASE WHEN d.alternatives IS NOT NULL AND d.alternatives <> '' THEN 1 ELSE 0 END) AS with_alternatives
         FROM decision_log d
         LEFT JOIN review r ON r.application_id = d.application_id`
      ).first(),

      // 누가 남긴 것인지 세려면 종류가 필요하다. 거르기와 상관없이 전부
      // 가져온다 — 걸러 놓고 세면 "부서가 0건"이 필터 때문인지 진짜인지
      // 알 수 없다.
      env.DB.prepare('SELECT link_kind FROM decision_log').all(),
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
      // 누가 한 것인지. 거르기와 무관하게 **전체**를 센다 — 걸러 놓고 세면
      // "부서가 0건"이 필터 때문인지 진짜인지 알 수 없다.
      sides: sideTally(allKinds.results),
      sideLine: sideLine(sideTally(allKinds.results)),
    })
  } catch (err) {
    return jsonError(`결정 기록을 불러오지 못했습니다. (${String(err.message).slice(0, 160)})`, 503)
  }
}
