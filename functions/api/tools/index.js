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
import { ACCEPT_KIND, REJECT_KIND } from '../../../shared/accept.js'
import { toReports, trustLevel, REPORT_KIND, REPORT_FIX } from '../../../shared/report.js'

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
      `SELECT id, application_id, link_kind, link_id FROM decision_log
       WHERE link_kind IN (?, ?)`
    )
      .bind(UNCLEAR_KIND, UNCLEAR_FIXED_KIND)
      .all()
    const fixedFlagIds = new Set(
      unclearRows.filter((r) => r.link_kind === UNCLEAR_FIXED_KIND).map((r) => r.link_id)
    )
    const openUnclearRows = unclearRows.filter(
      (r) => r.link_kind === UNCLEAR_KIND && !fixedFlagIds.has(r.id)
    )
    const openUnclear = openUnclearRows.length
    // 어느 신청서의 사용법서인지까지 모은다. 세는 것으로 끝내면 담당자가
    // 사용법서 화면에 와서 칩을 하나씩 눌러 찾아야 한다.
    const unclearIds = [...new Set(openUnclearRows.map((r) => r.application_id))]

    // 부서가 "못 쓰겠습니다"를 누른 것.
    //
    // 이게 담당자 화면 어디에도 안 왔다. 부서는 이 사이트가 시킨 대로
    // 버튼을 누르고 무엇이 안 맞는지까지 적어 줬는데, 담당자는 그 도구
    // 화면을 따로 열어 보지 않는 한 모른다. 그동안 그 부서는 도구를 못
    // 쓰고 있다 — 못 쓴다고 **말까지 해 준** 상태로.
    //
    // 거절한 뒤에 다시 받았다고 하면 그것이 최신이라 안 센다.
    // what 을 안 뽑고 있었다. 그래서 담당자 화면에는 "부서가 못 쓰겠다고
    // 함" 배지 한 줄만 떴다. 그런데 첫 화면 할 일 목록은 그 배지를 가리키며
    // **"무엇이 안 맞는지 보기"**라고 약속한다. 눌러서 간 자리에 그 "무엇"이
    // 없었다. 부서는 시킨 대로 이유까지 적어 줬는데, 그 글이 부서용 도구
    // 화면 안에만 있어서 담당자는 그 주소를 직접 열어야 볼 수 있었다.
    const { results: acceptRows } = await env.DB.prepare(
      `SELECT application_id, link_kind, title, what, created_at FROM decision_log
       WHERE link_kind IN (?, ?) ORDER BY created_at`
    )
      .bind(ACCEPT_KIND, REJECT_KIND)
      .all()
    // append-only 로그다. 마지막 것이 지금 상태다 — 거절한 뒤에 다시
    // 받았다고 하면 그것이 최신이다.
    const lastAccept = new Map()
    for (const r of acceptRows) lastAccept.set(r.application_id, r)
    for (const it of items) {
      const last = lastAccept.get(it.application_id)
      it.rejected = last?.link_kind === REJECT_KIND
      it.rejectedWhy = it.rejected ? (last.what ?? null) : null
      it.rejectedBy = it.rejected ? (last.title ?? null) : null
      it.rejectedAt = it.rejected ? (last.created_at ?? null) : null
    }

    // ② 도는 것과 맞는 것은 다르다.
    //
    // health 는 실행 횟수와 실패 횟수로만 정해진다. 그래서 "숫자가 안
    // 맞습니다" 신고가 세 건 쌓여 있어도 그 도구 카드는 초록 "돌고 있음"
    // 이었다. 실행은 성공하고 결과만 틀리는 것이 정확히 제일 위험한
    // 상태인데, 화면은 그때 가장 안심시켜 주고 있었다.
    //
    // shared/report.js 의 trustLevel() 이 이 판단을 이미 갖고 있었다.
    // 부르는 곳이 시험밖에 없었을 뿐이다.
    const { results: reportRows } = await env.DB.prepare(
      `SELECT id, application_id, link_kind, link_id, title, what, why, created_at
       FROM decision_log WHERE link_kind IN (?, ?) ORDER BY created_at`
    )
      .bind(REPORT_KIND, REPORT_FIX)
      .all()
    const byApp = new Map()
    for (const r of reportRows) {
      if (!byApp.has(r.application_id)) byApp.set(r.application_id, [])
      byApp.get(r.application_id).push(r)
    }
    for (const it of items) {
      it.trust = trustLevel(toReports(byApp.get(it.application_id) ?? []))
    }

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
      // 부서가 못 쓰겠다고 한 채로 남아 있는 것.
      rejected: items.filter((i) => i.rejected).length,
      // 돌고는 있는데 결과를 믿을 수 없는 것. 이게 제일 위험한 상태다 —
      // 실행이 성공하니까 어떤 실패 지표에도 안 잡힌다.
      untrusted: items.filter((i) => i.trust?.level === '결과를 믿을 수 없음').length,
      uncomfortable: items.filter((i) => i.trust?.level === '불편하다는 신고 있음').length,
      totalRuns: items.reduce((s, i) => s + i.runs, 0),
      totalFailed: items.reduce((s, i) => s + i.failedRuns, 0),
      totalRows: items.reduce((s, i) => s + i.rowsOut, 0),
      recentDays: RECENT_DAYS,

      // 세는 것으로 끝내지 않고 **어느 것인지**까지 준다.
      //
      // 첫 화면 할 일 다섯 줄 중 셋이 이 화면을 가리킨다. 눌러서 오면
      // 카드가 늘어서 있고, 담당자는 "못 쓰겠다고 한 게 어느 거지"를 다시
      // 찾아야 한다. 세 줄이면 세 번 찾는다. 그러다 다른 걸 열게 되고,
      // 결국 그 목록을 안 쓰게 된다.
      //
      // 목록은 세는 것과 **같은 조건**에서 뽑는다. 따로 쓰면 "3개"라고
      // 해 놓고 두 개만 짚어 준다.
      rejectedIds: items.filter((i) => i.rejected).map((i) => i.application_id),
      untrustedIds: items
        .filter((i) => i.trust?.level === '결과를 믿을 수 없음')
        .map((i) => i.application_id),
      idleIds: items.filter((i) => i.health === '안 쓰임').map((i) => i.application_id),
      downStaleIds: items
        .filter((i) => rollbackState({ handover: i }).stale)
        .map((i) => i.application_id),
      unclearIds,
      noManualIds: items
        .filter((i) => !i.manual_published_at && !i.rolled_back_at)
        .map((i) => i.application_id),
    }

    return jsonResponse({ items, failures: fails.results, summary })
  } catch (err) {
    return failUnexpected(err, '넘긴 도구를 불러오지 못했습니다.')
  }
}
