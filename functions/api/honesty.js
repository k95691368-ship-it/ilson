// 못 한 것, 안 되는 것, 증명하지 못한 것.
//
// 이 사이트의 다른 화면은 전부 "무엇을 했는가"를 말한다. 그것만 있으면
// 읽는 사람은 결국 "그래서 안 된 건 뭔데"를 속으로 묻게 되고, 그 질문에
// 답이 없으면 잘된 것까지 못 믿는다.
//
// 그래서 안 좋은 것만 모아 놓은 화면을 따로 둔다. 여기 있는 숫자는 전부
// 다른 화면에도 있는 것이다. 숨겨 놓고 여기서만 꺼내는 것이 아니라,
// 흩어져 있어서 한눈에 안 보이던 것을 한곳에 모으는 것이다.
//
// 중요한 것: 이 화면은 데이터에서 만들어진다. 잘 보이려고 손으로 적은
// 반성문이 아니다. 반려가 늘면 여기 숫자가 늘고, 격리가 줄면 여기 숫자가 준다.

import { jsonResponse, failUnexpected } from '../_lib/http.js'
import { computeOutcome, liveChallenges, runsFromTotals, daysSince } from '../../shared/outcome.js'
import { OUTCOME_KIND } from '../../shared/accept.js'
import { unprovenList } from '../../shared/unproven.js'

// 몇 건인지를 말하는 문장은 손으로 적으면 안 된다. 데이터가 바뀌어도 문장은
// 안 바뀌기 때문이다. 실제로 화면이 여섯 단계를 끝까지 간 것이 한 건 있다고
// 단언하는 동안 그런 신청서는 한 건도 없었다. 그래서 아래에서 셋을 세어
// shared/unproven.js 에 넘기고, 문장은 그 숫자를 보고 골라진다.

export async function onRequestGet({ env }) {
  try {
    const [
      refused,
      held,
      stuck,
      quarantine,
      liveQuarantine,
      failedChecks,
      unresolved,
      unusedTools,
      noBaseline,
      proof,
    ] = await Promise.all([
        // 내가 못 하겠다고 한 것. 대안을 같이 줬는지까지 본다 —
        // 대안 없는 반려는 그냥 거절이다.
        env.DB.prepare(
          `SELECT a.id, a.ticket_no, a.dept, a.title, r.refuse_code, r.refuse_alternative,
                  r.verdict_reason, r.updated_at
           FROM review r JOIN application a ON a.id = r.application_id
           WHERE r.verdict = '반려' ORDER BY r.updated_at DESC LIMIT 20`
        ).all(),

        // 보류는 두 길로 들어온다. 한 건씩 판정하면 review 에 조건이 적히고,
        // 접수함에서 한 번에 미루면 decision_log 에만 남는다. review 만 보면
        // 한 번에 미룬 건이 이 화면에서 통째로 빠진다 — 이 화면은 못 한 것을
        // 모아 보여주는 자리인데, 정작 미뤄 둔 것 절반을 빠뜨리고 있었다.
        env.DB.prepare(
          `SELECT a.id, a.ticket_no, a.dept, a.title,
                  r.hold_until_condition,
                  COALESCE(r.updated_at, b.created_at) AS updated_at,
                  b.what AS bulk_what
           FROM application a
           LEFT JOIN review r ON r.application_id = a.id
           LEFT JOIN (
             SELECT application_id, what, created_at,
                    ROW_NUMBER() OVER (PARTITION BY application_id ORDER BY created_at DESC) AS rn
             FROM decision_log WHERE link_kind = '일괄:hold'
           ) b ON b.application_id = a.id AND b.rn = 1
           WHERE a.status = '보류'
           ORDER BY updated_at DESC LIMIT 20`
        ).all(),

        // 접수만 되고 아직 아무도 안 본 것. 이게 가장 정직하게 아픈 숫자다.
        env.DB.prepare(
          `SELECT a.id, a.ticket_no, a.dept, a.title, a.created_at,
                  CAST((julianday('now') - julianday(a.created_at)) AS INTEGER) AS days
           FROM application a
           WHERE a.status = '접수'
           ORDER BY a.created_at ASC LIMIT 20`
        ).all(),

        // 도구가 처리하지 못하고 밀어 둔 줄. 버린 것이 아니라 격리한 것이라
        // 여기서 셀 수 있다.
        //
        // 다만 이 표에는 **만드는 중에 시운전한 것**만 들어 있다. 넘긴 뒤
        // 부서가 실제로 돌린 것은 tool_use 에 개수만 남는다 — 아래에서
        // 따로 센다.
        env.DB.prepare(
          `SELECT reason, COUNT(*) AS n FROM build_quarantine GROUP BY reason ORDER BY n DESC`
        ).all(),

        // 넘긴 뒤 실제 실행에서 밀려난 줄.
        //
        // 이 화면은 못 한 것을 모아 보여 주는 자리인데, 여태 시운전 것만
        // 세고 있었다. 부서가 매주 돌리면서 밀어 둔 줄이 훨씬 많을 수 있는데
        // 그게 0으로 보였다. **가장 정직해야 할 화면이 가장 적게 세고 있었다.**
        //
        // 이유별로는 못 나눈다. 실제 실행은 브라우저에서 돌고 서버에는
        // 개수만 남기 때문이다. 모르는 것은 모른다고 적는다.
        env.DB.prepare(
          `SELECT COALESCE(SUM(u.quarantined), 0) AS n, COUNT(DISTINCT u.application_id) AS tools
           FROM tool_use u`
        ).first(),

        // 합격 기준 중 통과 못 한 것.
        env.DB.prepare(
          `SELECT br.verdict, br.body, br.evidence, br.is_required_safety, r.seq, a.ticket_no, a.title
           FROM beta_result br
           JOIN beta_round r ON r.id = br.round_id
           JOIN application a ON a.id = r.application_id
           WHERE br.verdict IN ('실패', '판정불가')
           ORDER BY br.is_required_safety DESC LIMIT 20`
        ).all(),

        // 성과 숫자에 붙은 반박 중 아직 못 푼 것. 미해소 반박이 있으면
        // 그 금액은 '보수적 추정치'로 강등된다.
        //
        // **`outcome_challenge` 표를 세면 안 된다.** 그 표에는 해소한 것만
        // 저장되고, 살아 있는 반박은 읽을 때 규칙으로 계산한다. 그래서
        // `resolved_at IS NULL` 로 세면 영원히 0이다.
        //
        // 하필 이 화면에서 그랬다. 자기 한계를 보여주는 자리가 자기 반박
        // 다섯 건을 0건이라고 말하고 있었다. 성과 화면은 같은 건에 표본
        // 부족·실행 횟수 부족·격리 미해소·계절성·부서가 다르다고 함을
        // 띄우는 중이었다.
        env.DB.prepare(
          `SELECT a.ticket_no, a.title,
                  b.median_seconds, b.people, b.sample_n, b.sealed_at,
                  o.dev_hours, o.ops_cost_krw, o.amortize_months, o.dept_confirmed_at,
                  (SELECT COUNT(*) FROM tool_use u WHERE u.application_id = a.id) AS run_count,
                  -- 실제로 잰 값을 넘겨야 한다. 0으로 지어내면 "검수 시간을
                  -- 안 쟀습니다"라는 반박이 없는데도 붙는다. 실제로 그랬다.
                  (SELECT COALESCE(SUM(u.duration_ms), 0) FROM tool_use u
                    WHERE u.application_id = a.id) AS duration_total_ms,
                  (SELECT COALESCE(SUM(u.human_review_seconds), 0) FROM tool_use u
                    WHERE u.application_id = a.id) AS review_total_seconds,
                  (SELECT COALESCE(SUM(u.rework_seconds), 0) FROM tool_use u
                    WHERE u.application_id = a.id) AS rework_total_seconds,
                  (SELECT u.quarantined FROM tool_use u
                    WHERE u.application_id = a.id ORDER BY u.used_at DESC LIMIT 1) AS quarantine_left,
                  (SELECT d.alternatives FROM decision_log d
                    WHERE d.application_id = a.id AND d.link_kind = ?
                    ORDER BY d.created_at DESC LIMIT 1) AS dept_said,
                  (SELECT GROUP_CONCAT(c.rule_code) FROM outcome_challenge c
                    WHERE c.application_id = a.id AND c.resolved_at IS NOT NULL) AS resolved_codes
           FROM application a
           JOIN baseline b ON b.application_id = a.id
           LEFT JOIN outcome o ON o.application_id = a.id
           WHERE (SELECT COUNT(*) FROM tool_use u WHERE u.application_id = a.id) > 0`
        )
          .bind(OUTCOME_KIND)
          .all(),

        env.DB.prepare(
          `SELECT h.slug, h.title, h.handed_to_dept, h.handed_at,
                  (SELECT COUNT(*) FROM tool_use u WHERE u.application_id = h.application_id) AS runs
           FROM handover h WHERE h.rolled_back_at IS NULL`
        ).all(),

        // 수용해 놓고 아직 실측 안 한 것. 재지 않고 만들면 나중에
        // 얼마나 줄었는지 말할 수 없다.
        env.DB.prepare(
          `SELECT a.ticket_no, a.title, a.dept FROM application a
           JOIN review r ON r.application_id = a.id
           LEFT JOIN baseline b ON b.application_id = a.id
           WHERE r.verdict = '수용' AND b.application_id IS NULL LIMIT 20`
        ).all(),

        // "증명하지 못한 것" 중 개수를 말하는 세 문장이 쓸 숫자.
        //
        // 끝까지 갔다 = 부서에 넘겼고(되돌리지 않았고) 성과까지 냈다.
        // 둘 중 하나만으로는 여섯 단계를 밟은 것이 아니다.
        env.DB.prepare(
          `SELECT
             (SELECT COUNT(*) FROM application a
               WHERE EXISTS (SELECT 1 FROM handover h
                              WHERE h.application_id = a.id AND h.rolled_back_at IS NULL)
                 AND EXISTS (SELECT 1 FROM outcome o WHERE o.application_id = a.id)) AS finished,
             (SELECT COUNT(*) FROM baseline) AS baselines,
             (SELECT COALESCE(SUM(sample_n), 0) FROM baseline) AS baseline_samples,
             (SELECT COUNT(*) FROM tool_use) AS runs`
        ).first(),
      ])

    const buildQuarantine = quarantine.results.reduce((s, q) => s + q.n, 0)
    const liveQuarantineRows = liveQuarantine?.n ?? 0
    // 화면 맨 위 숫자는 **둘을 합친 것**이다. 시운전 것만 세면 부서가 매주
    // 겪는 것이 안 보인다.
    const quarantineTotal = buildQuarantine + liveQuarantineRows
    const idle = unusedTools.results.filter((t) => t.runs === 0)

    // 성과 화면과 **같은 함수**로 살아 있는 반박을 만든 뒤, 이미 해소한
    // 것만 걷어낸다.
    const openChallenges = []
    for (const r of unresolved.results) {
      let deptFelt = null
      try {
        deptFelt = JSON.parse(r.dept_said)?.felt ?? null
      } catch {
        // 옛 기록에는 숫자가 없다.
      }
      const computed = computeOutcome({
        baseline: r,
        runs: runsFromTotals({
          count: r.run_count,
          durationMs: r.duration_total_ms,
          reviewSeconds: r.review_total_seconds,
          reworkSeconds: r.rework_total_seconds,
        }),
        devHours: r.dev_hours ?? 0,
        opsCostKrw: r.ops_cost_krw ?? 0,
        amortizeMonths: r.amortize_months ?? 24,
      })
      if (computed.status === '산정불가') continue
      // 세는 자리를 shared/outcome.js 한 곳으로 모았다. 네 화면이 각자
      // 세다가 서로 다른 개수를 말했다.
      const { open } = liveChallenges({
        outcome: computed,
        quarantineLeft: r.quarantine_left ?? 0,
        deptConfirmed: Boolean(r.dept_confirmed_at),
        baselineAgeDays: daysSince(r.sealed_at),
        deptFelt,
        resolvedCodes: r.resolved_codes,
      })
      for (const c of open) {
        openChallenges.push({ rule_code: c.code, title: c.title, body: c.body, ticket_no: r.ticket_no })
      }
    }

    const unproven = unprovenList({
      finished: proof?.finished,
      baselines: proof?.baselines,
      baselineSamples: proof?.baseline_samples,
      runs: proof?.runs,
    })

    return jsonResponse({
      unproven,
      refused: refused.results,
      refusedWithoutAlternative: refused.results.filter((r) => !r.refuse_alternative).length,
      // 어느 길로 들어온 보류든 조건 한 칸으로 내보낸다. 화면은 두 길을
      // 알 필요가 없다.
      held: held.results.map((h) => ({
        ...h,
        hold_until_condition:
          h.hold_until_condition ||
          String(h.bulk_what ?? '').replace(/^보류로 미룹니다\.\s*/, '') ||
          null,
        bulk: !h.hold_until_condition && Boolean(h.bulk_what),
      })),
      stuck: stuck.results,
      quarantine: quarantine.results,
      quarantineTotal,
      quarantineBuild: buildQuarantine,
      quarantineLive: liveQuarantineRows,
      failedChecks: failedChecks.results,
      unresolvedChallenges: openChallenges,
      idleTools: idle,
      acceptedWithoutBaseline: noBaseline.results,
      summary: {
        refused: refused.results.length,
        held: held.results.length,
        stuck: stuck.results.length,
        quarantine: quarantineTotal,
        quarantineBuild: buildQuarantine,
        quarantineLive: liveQuarantineRows,
        failedChecks: failedChecks.results.length,
        unresolvedChallenges: openChallenges.length,
        idleTools: idle.length,
        unproven: unproven.length,
      },
    })
  } catch (err) {
    return failUnexpected(err, '못 한 것을 불러오지 못했습니다.')
  }
}
