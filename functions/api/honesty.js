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
import { computeOutcome, buildChallenges, runsFromTotals } from '../../shared/outcome.js'
import { OUTCOME_KIND } from '../../shared/accept.js'

// 봉인한 지 며칠 됐나. 성과 화면과 같은 셈법을 쓴다.
function daysSince(sqlTime) {
  if (!sqlTime) return 0
  const t = new Date(`${String(sqlTime).replace(' ', 'T')}Z`).getTime()
  return Math.max(0, Math.floor((Date.now() - t) / 86400000))
}

// 데이터로 증명할 수 없는 것들.
//
// 이것만은 손으로 적는다. 데이터에서 뽑을 수 없는 종류의 한계이기 때문이다.
// 대신 "그래서 어디까지는 말할 수 있는가"를 함께 적는다 — 한계를 적어 놓고
// 아무 말도 안 하면 그건 겸손이 아니라 회피다.
const UNPROVEN = [
  {
    key: 'sample_size',
    title: '기준선을 세 번밖에 안 쟀습니다',
    body:
      '자동화 전에 사람이 그 일을 직접 하는 것을 세 번 재서 중앙값을 봉인했습니다. 세 번은 통계적으로 약합니다. 그날 컨디션이나 파일 상태에 따라 20분씩 차이가 날 수 있습니다.',
    instead:
      '그래서 이 값에 신뢰구간을 붙이지 않았습니다. "97분"이라고만 적고 "97±4분"이라고 적지 않습니다. 절감액도 이 값 위에서만 계산하고, 세 번 잰 값이라는 배지를 화면에서 떼지 않습니다.',
  },
  {
    key: 'fake_data',
    title: '실제 회사 데이터가 아닙니다',
    body:
      '여기 나오는 회사·부서·사람·정산 금액은 전부 만든 것입니다. 실제 사내 자료를 쓸 수 없어서 직접 만들었습니다.',
    instead:
      '대신 더러움을 일부러 넣었습니다 — 병합된 셀, 머리글이 넷째 줄에서 시작하는 시트, CP949로 저장돼 한글이 깨지는 파일, 합계 줄이 섞인 표, 통화가 셋인 원장. 실제로 받는 파일이 깨끗하지 않다는 것이 이 도구의 존재 이유라서, 거기서만은 봐주지 않았습니다.',
  },
  {
    key: 'one_case',
    title: '여덟 단계를 끝까지 간 것은 한 건뿐입니다',
    body:
      '신청서 한 건이 검토·협의·제작·베타·사용법서·배포·성과까지 갔습니다. 나머지는 앞 단계에 서 있습니다. 여러 종류의 병목에서 이 여덟 단계가 똑같이 통하는지는 아직 증명하지 못했습니다.',
    instead:
      '한 건을 얕게 여덟 번 보여 주는 대신 끝까지 판 것을 보여드립니다. 각 단계에서 무엇을 정했고 왜 그렇게 정했고 무엇을 고르지 않았는지가 전부 남아 있습니다.',
  },
  {
    key: 'no_ai',
    title: 'AI가 판단하는 부분이 없습니다',
    body:
      '파일을 읽고 합치고 검산하는 일은 전부 정해진 규칙이 합니다. 비슷한 신청서를 찾는 것도 낱말이 겹치는지 세는 것이지 뜻을 이해하는 것이 아닙니다. 그래서 규칙에 없는 모양의 파일이 오면 처리하지 못하고 격리합니다.',
    instead:
      '대신 같은 파일을 넣으면 언제나 같은 결과가 나오고, 어느 숫자든 눌러서 원본 파일 몇 번째 줄에서 왔는지 되짚을 수 있습니다. 틀렸을 때 어디가 왜 틀렸는지 말할 수 있는 것을 골랐습니다.',
  },
  {
    key: 'not_operated',
    title: '실제 부서가 몇 달 써 본 것이 아닙니다',
    body:
      '넘긴 뒤 실제로 쓰인 횟수는 여기 기록된 것이 전부입니다. 몇 달 돌려 보면서 사람이 지쳐 안 쓰게 되는지, 파일 양식이 바뀌어 깨지는지는 겪어 보지 못했습니다.',
    instead:
      '그래서 "넘긴 뒤" 화면에 안 쓰이는 도구를 숨기지 않고 그대로 세어 둡니다. 지금은 셀 것이 적지만, 세는 자리를 먼저 만들어 뒀습니다.',
  },
]

export async function onRequestGet({ env }) {
  try {
    const [refused, held, stuck, quarantine, failedChecks, unresolved, unusedTools, noBaseline] =
      await Promise.all([
        // 내가 못 하겠다고 한 것. 대안을 같이 줬는지까지 본다 —
        // 대안 없는 반려는 그냥 거절이다.
        env.DB.prepare(
          `SELECT a.id, a.ticket_no, a.dept, a.title, r.refuse_code, r.refuse_alternative,
                  r.verdict_reason, r.updated_at
           FROM review r JOIN application a ON a.id = r.application_id
           WHERE r.verdict = '반려' ORDER BY r.updated_at DESC LIMIT 20`
        ).all(),

        env.DB.prepare(
          `SELECT a.id, a.ticket_no, a.dept, a.title, r.hold_until_condition, r.updated_at
           FROM review r JOIN application a ON a.id = r.application_id
           WHERE r.verdict = '보류' ORDER BY r.updated_at DESC LIMIT 20`
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
        env.DB.prepare(
          `SELECT reason, COUNT(*) AS n FROM build_quarantine GROUP BY reason ORDER BY n DESC`
        ).all(),

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
      ])

    const quarantineTotal = quarantine.results.reduce((s, q) => s + q.n, 0)
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
      const done = new Set(String(r.resolved_codes ?? '').split(',').filter(Boolean))
      for (const c of buildChallenges({
        outcome: computed,
        quarantineLeft: r.quarantine_left ?? 0,
        deptConfirmed: Boolean(r.dept_confirmed_at),
        baselineAgeDays: daysSince(r.sealed_at),
        deptFelt,
      })) {
        if (done.has(c.code)) continue
        openChallenges.push({ rule_code: c.code, title: c.title, body: c.body, ticket_no: r.ticket_no })
      }
    }

    return jsonResponse({
      unproven: UNPROVEN,
      refused: refused.results,
      refusedWithoutAlternative: refused.results.filter((r) => !r.refuse_alternative).length,
      held: held.results,
      stuck: stuck.results,
      quarantine: quarantine.results,
      quarantineTotal,
      failedChecks: failedChecks.results,
      unresolvedChallenges: openChallenges,
      idleTools: idle,
      acceptedWithoutBaseline: noBaseline.results,
      summary: {
        refused: refused.results.length,
        held: held.results.length,
        stuck: stuck.results.length,
        quarantine: quarantineTotal,
        failedChecks: failedChecks.results.length,
        unresolvedChallenges: openChallenges.length,
        idleTools: idle.length,
        unproven: UNPROVEN.length,
      },
    })
  } catch (err) {
    return failUnexpected(err, '못 한 것을 불러오지 못했습니다.')
  }
}
