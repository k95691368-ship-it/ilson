// 넘긴 도구 전부와, 넘긴 뒤에 실제로 무슨 일이 일어나고 있는지.
//
// 도구를 하나만 넘길 것처럼 만들어 뒀다. 두 번째를 넘기면 둘을 나란히 볼
// 데가 없다. 부서 담당자는 "우리한테 넘어온 게 뭐뭐 있지"를 물어볼 데가
// 없고, 나는 "지금 돌고 있는 것들이 괜찮나"를 볼 데가 없다.
//
// 그런데 목록만 만들면 반쪽이다. 넘겼다는 사실보다 중요한 것은 **넘긴 뒤에
// 어떻게 됐는가**다. 만들었다는 기록은 흔하고, 만든 것이 지금도 돌고 있다는
// 증거는 드물다. 그래서 이 화면은 사용 기록 쪽에 무게를 둔다.
//
// 특히 이 셋을 숨기지 않는다.
//   - 넘겨 놓고 한 번도 안 쓰인 것   ← 가장 중요한 신호다
//   - 실패한 실행과 그 이유
//   - 부서가 받았다고 확인 안 한 것

import { jsonResponse, failUnexpected } from '../../_lib/http.js'
import { UNCLEAR_KIND, UNCLEAR_FIXED_KIND } from '../../../shared/unclear.js'
import { rollbackState } from '../../../shared/rollback.js'

// 최근 며칠을 "요즘"으로 볼 것인가. 주 1회 도는 도구가 많아서 이레로 잡는다.
// 사흘로 잡으면 정상인 도구가 전부 "안 쓰임"으로 찍힌다.
const RECENT_DAYS = 7

export async function onRequestGet({ env }) {
  try {
    const [tools, uses, fails] = await Promise.all([
      env.DB.prepare(
        `SELECT h.application_id, h.slug, h.title, h.handed_to_dept, h.handed_to_person,
                h.handed_at, h.accepted_at, h.accepted_by, h.daily_limit, h.max_file_mb,
                h.rolled_back_at, h.rollback_reason, h.note,
                a.ticket_no, a.dept AS asked_by_dept, a.title AS application_title,
                b.median_seconds, b.sample_n,
                m.published_at AS manual_published_at
         FROM handover h
         JOIN application a ON a.id = h.application_id
         LEFT JOIN baseline b ON b.application_id = h.application_id
         LEFT JOIN manual m ON m.application_id = h.application_id
         ORDER BY h.handed_at DESC`
      ).all(),

      env.DB.prepare(
        `SELECT application_id,
                COUNT(*) AS runs,
                SUM(CASE WHEN ok = 1 THEN 1 ELSE 0 END) AS ok_runs,
                SUM(rows_out) AS rows_out,
                SUM(quarantined) AS quarantined,
                SUM(human_review_seconds) AS review_seconds,
                SUM(rework_seconds) AS rework_seconds,
                AVG(duration_ms) AS avg_ms,
                MAX(used_at) AS last_use,
                MIN(used_at) AS first_use,
                SUM(CASE WHEN used_at >= datetime('now', ?) THEN 1 ELSE 0 END) AS recent_runs
         FROM tool_use GROUP BY application_id`
      )
        .bind(`-${RECENT_DAYS} days`)
        .all(),

      // 실패한 실행. 성공만 세면 "잘 돌고 있습니다"가 되는데, 실제로는
      // 부서가 세 번 시도해서 세 번 다 실패했을 수도 있다.
      env.DB.prepare(
        `SELECT u.application_id, u.used_at, u.actor_label, u.fail_reason, h.slug, h.title
         FROM tool_use u JOIN handover h ON h.application_id = u.application_id
         WHERE u.ok = 0
         ORDER BY u.used_at DESC LIMIT 30`
      ).all(),
    ])

    const useBy = new Map(uses.results.map((u) => [u.application_id, u]))

    const items = tools.results.map((t) => {
      const u = useBy.get(t.application_id)
      const runs = u?.runs ?? 0
      const okRuns = u?.ok_runs ?? 0

      // 넘긴 뒤 이 도구가 어떤 상태인가. 한 낱말로 답한다.
      let health
      if (t.rolled_back_at) health = '내림'
      else if (runs === 0) health = '안 쓰임'
      else if (okRuns < runs) health = '실패 있음'
      else if ((u?.recent_runs ?? 0) === 0) health = '뜸해짐'
      else health = '돌고 있음'

      return {
        ...t,
        runs,
        okRuns,
        failedRuns: runs - okRuns,
        recentRuns: u?.recent_runs ?? 0,
        rowsOut: u?.rows_out ?? 0,
        quarantined: u?.quarantined ?? 0,
        avgMs: u?.avg_ms ?? null,
        lastUse: u?.last_use ?? null,
        firstUse: u?.first_use ?? null,
        // 자동화 뒤에도 드는 사람 시간. 이걸 빼지 않으면 절감이 부풀려진다.
        reviewSeconds: u?.review_seconds ?? 0,
        reworkSeconds: u?.rework_seconds ?? 0,
        // 이 도구가 대신한 일이 원래 얼마나 걸렸나 × 몇 번 돌았나.
        // "아꼈다"가 아니라 "대신한 분량"까지만 말한다. 진짜 절감은
        // 8단계에서 검수·재작업까지 빼고 계산한다.
        replacedSeconds: t.median_seconds != null ? t.median_seconds * runs : null,
        health,
      }
    })

    // 부서가 사용법서에서 모르겠다고 짚었는데 아직 안 고친 곳.
    //
    // 첫 화면 할 일 목록에 올리려고 여기서 센다. 사용법서 화면을 열어야만
    // 보이면 담당자는 못 본다 — 다 쓴 뒤로 그 화면을 안 열기 때문이다.
    const { results: unclearRows } = await env.DB.prepare(
      `SELECT id, link_kind, link_id FROM decision_log
       WHERE link_kind IN (?, ?)`
    )
      .bind(UNCLEAR_KIND, UNCLEAR_FIXED_KIND)
      .all()
    const fixedFlagIds = new Set(
      unclearRows.filter((r) => r.link_kind === UNCLEAR_FIXED_KIND).map((r) => r.link_id)
    )
    const openUnclear = unclearRows.filter(
      (r) => r.link_kind === UNCLEAR_KIND && !fixedFlagIds.has(r.id)
    ).length

    const summary = {
      total: items.length,
      unclear: openUnclear,
      running: items.filter((i) => i.health === '돌고 있음').length,
      idle: items.filter((i) => i.health === '안 쓰임').length,
      quiet: items.filter((i) => i.health === '뜸해짐').length,
      failing: items.filter((i) => i.health === '실패 있음').length,
      rolledBack: items.filter((i) => i.health === '내림').length,
      unconfirmed: items.filter((i) => !i.accepted_at && !i.rolled_back_at).length,
      noManual: items.filter((i) => !i.manual_published_at && !i.rolled_back_at).length,
      // 내려 둔 채 잊은 것.
      //
      // 내린 도구는 넘긴 목록에서도 빠져서 화면 어디에도 안 보인다. 그동안
      // 그 부서는 원래 하던 방식으로 일하고 있다 — 조용히 사라지는 자리다.
      downStale: items.filter((i) => rollbackState({ handover: i }).stale).length,
      down: items.filter((i) => i.rolled_back_at).length,
      totalRuns: items.reduce((s, i) => s + i.runs, 0),
      totalFailed: items.reduce((s, i) => s + i.failedRuns, 0),
      totalRows: items.reduce((s, i) => s + i.rowsOut, 0),
      recentDays: RECENT_DAYS,
    }

    return jsonResponse({ items, failures: fails.results, summary })
  } catch (err) {
    return failUnexpected(err, '넘긴 도구를 불러오지 못했습니다.')
  }
}
