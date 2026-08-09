// 신청서 한 건의 기록 전부.
//
// 이 사이트는 신청서와 그 신청서에 일어난 일을 기록하는 곳이다. 그런데
// 지금까지 그 기록을 한 번에 꺼낼 방법이 없었다. 여덟 단계가 여덟 화면에
// 흩어져 있어서, 신청서 한 건이 어떻게 시작해서 어떻게 끝났는지 보려면
// 화면을 여덟 번 옮겨 다녀야 했다.
//
// 기록을 남기는 것과 꺼내 보는 것은 다른 일이다. 남기기만 하고 꺼낼 수
// 없으면 그건 기록이 아니라 그냥 저장이다.
//
// 여기서 한 건에 붙은 것을 전부 모아 준다. 화면은 이걸 받아 한 문서로 펴서
// 인쇄하거나 텍스트로 내려받는다.

import { jsonResponse, jsonError, failUnexpected } from '../../../_lib/http.js'
import { computeOutcome, buildChallenges, annualize, labelForOutcome } from '../../../../shared/outcome.js'
import { OUTCOME_KIND } from '../../../../shared/accept.js'

// 봉인한 지 며칠 됐나. 성과 화면과 같은 셈법을 쓴다.
function daysSince(sqlTime) {
  if (!sqlTime) return 0
  const t = new Date(`${String(sqlTime).replace(' ', 'T')}Z`).getTime()
  return Math.max(0, Math.floor((Date.now() - t) / 86400000))
}

const q = (env, sql, ...binds) => env.DB.prepare(sql).bind(...binds)

export async function onRequestGet({ env, params }) {
  try {
    // 접수번호로도 열리게 한다. 담당자는 id를 모르고 접수번호만 안다.
    const app = await q(
      env,
      'SELECT * FROM application WHERE id = ? OR ticket_no = ?',
      params.id,
      params.id
    ).first()

    if (!app) return jsonError('그런 신청서가 없습니다.', 404)

    const id = app.id
    const [
      review,
      stakeholders,
      meetings,
      requirements,
      conflicts,
      criteria,
      shadowRuns,
      baseline,
      builds,
      betaRounds,
      betaFeedback,
      manual,
      faqs,
      handover,
      uses,
      outcome,
      challenges,
      decisions,
    ] = await Promise.all([
      q(env, 'SELECT * FROM review WHERE application_id = ?', id).first(),
      q(env, 'SELECT * FROM stakeholder WHERE application_id = ? ORDER BY is_owner DESC, created_at', id).all(),
      q(env, 'SELECT * FROM meeting WHERE application_id = ? ORDER BY seq', id).all(),
      q(env, 'SELECT * FROM requirement WHERE application_id = ? ORDER BY kind, created_at', id).all(),
      q(env, 'SELECT * FROM requirement_conflict WHERE application_id = ? ORDER BY created_at', id).all(),
      q(env, 'SELECT * FROM acceptance_criterion WHERE application_id = ? ORDER BY ord', id).all(),
      q(env, 'SELECT * FROM shadow_run WHERE application_id = ? ORDER BY seq', id).all(),
      q(env, 'SELECT * FROM baseline WHERE application_id = ?', id).first(),
      q(env, 'SELECT id, seq, rows_out, quarantined, duplicate_suspects, duration_ms, totals_json, files_json, note, created_at FROM build_run WHERE application_id = ? ORDER BY seq', id).all(),
      q(env, 'SELECT * FROM beta_round WHERE application_id = ? ORDER BY seq', id).all(),
      q(env, 'SELECT * FROM beta_feedback WHERE application_id = ? ORDER BY created_at', id).all(),
      q(env, 'SELECT * FROM manual WHERE application_id = ?', id).first(),
      q(env, 'SELECT * FROM manual_faq WHERE application_id = ? ORDER BY ord', id).all(),
      q(env, 'SELECT * FROM handover WHERE application_id = ?', id).first(),
      q(env, 'SELECT * FROM tool_use WHERE application_id = ? ORDER BY used_at', id).all(),
      q(env, 'SELECT * FROM outcome WHERE application_id = ?', id).first(),
      q(env, 'SELECT * FROM outcome_challenge WHERE application_id = ? ORDER BY rule_code', id).all(),
      q(env, 'SELECT * FROM decision_log WHERE application_id = ? ORDER BY created_at', id).all(),
    ])

    // 살아 있는 반박을 성과 화면과 **같은 함수**로 만든다. 저장된 해소분은
    // 그대로 지킨다.
    // 문서에 실을 금액. 성과 화면과 **같은 함수**로 낸다.
    //
    // 여태 이 라우트는 computeOutcome 을 부르고도 그 결과를 반박 만드는 데만
    // 쓰고 버렸다. 그래서 인쇄 문서의 성과 칸에 만든 공수와 반박은 있는데
    // **정작 얼마나 줄었는지가 없었다.** 여덟 단계가 만들어 내는 숫자가
    // 그 여덟 단계를 편 문서에 안 실린 것이다.
    //
    // 따로 계산하지 않는다. 두 벌로 만들면 화면과 종이가 다른 금액을 말하는
    // 날이 오고, 그날 둘 다 못 믿게 된다.
    let money = null
    let moneyLabel = null
    let liveChallenges = challenges.results
    if (baseline && uses.results.length > 0) {
      let deptFelt = null
      const said = decisions.results
        .filter((d) => d.link_kind === OUTCOME_KIND)
        .at(-1)
      try {
        deptFelt = JSON.parse(said?.alternatives)?.felt ?? null
      } catch {
        // 옛 기록에는 숫자가 없다.
      }
      const computed = computeOutcome({
        baseline,
        runs: uses.results,
        devHours: outcome?.dev_hours ?? 0,
        opsCostKrw: outcome?.ops_cost_krw ?? 0,
        amortizeMonths: outcome?.amortize_months ?? 24,
      })
      const shouldHave =
        computed.status === '산정불가'
          ? []
          : buildChallenges({
              outcome: computed,
              quarantineLeft: uses.results.at(-1)?.quarantined ?? 0,
              deptConfirmed: Boolean(outcome?.dept_confirmed_at),
              baselineAgeDays: daysSince(baseline?.sealed_at),
              deptFelt,
            })
      if (computed.status !== '산정불가') {
        money = {
          ...computed,
          annual: annualize(computed, baseline?.frequency ?? app.current_frequency, {
            devKrw: computed.devKrw ?? 0,
            opsCostKrw: outcome?.ops_cost_krw ?? 0,
          }),
        }
      }

      const byCode = new Map(challenges.results.map((c) => [c.rule_code, c]))
      liveChallenges = shouldHave.map((c) => {
        const saved = byCode.get(c.code)
        return {
          rule_code: c.code,
          title: c.title,
          body: c.body,
          resolved_at: saved?.resolved_at ?? null,
          resolution: saved?.resolution ?? null,
        }
      })
    }

    // 금액에 붙일 딱지. 미해소 반박 수에 따라 '보수적 추정'으로 내려간다.
    // 화면이 쓰는 것과 같은 함수다.
    if (money) {
      const unresolved = liveChallenges.filter((c) => !c.resolved_at).length
      moneyLabel = labelForOutcome(money, unresolved)
    }

    // 회차별 기준 판정. 회차가 없으면 한 번도 안 돌린 것이고, 그것도 기록이다.
    const roundIds = betaRounds.results.map((r) => r.id)
    let betaResults = []
    if (roundIds.length > 0) {
      const marks = roundIds.map(() => '?').join(',')
      const r = await q(
        env,
        `SELECT * FROM beta_result WHERE round_id IN (${marks}) ORDER BY round_id, ord`,
        ...roundIds
      ).all()
      betaResults = r.results
    }

    // 여덟 단계 중 어디까지 실제로 기록이 남았나.
    //
    // "진행 중"이라고 적힌 상태값을 믿지 않고, 그 단계의 기록이 실제로
    // 있는지로 판정한다. 상태값은 사람이 바꾸는 것이라 실제와 어긋날 수 있다.
    const done = {
      신청서: true,
      검토: Boolean(review),
      협의안: criteria.results.length > 0 || requirements.results.length > 0,
      제작: builds.results.length > 0,
      베타테스트: betaRounds.results.length > 0,
      사용법서: Boolean(manual),
      배포: Boolean(handover),
      성과: Boolean(outcome),
    }

    return jsonResponse({
      application: app,
      review,
      stakeholders: stakeholders.results,
      meetings: meetings.results,
      requirements: requirements.results,
      conflicts: conflicts.results,
      criteria: criteria.results,
      shadowRuns: shadowRuns.results,
      baseline,
      builds: builds.results,
      betaRounds: betaRounds.results,
      betaResults,
      betaFeedback: betaFeedback.results,
      manual,
      faqs: faqs.results,
      handover,
      uses: uses.results,
      outcome,
      // 살아 있는 반박까지 넣는다.
      //
      // `outcome_challenge` 표에는 **해소한 것만** 저장된다. 살아 있는
      // 반박은 읽을 때 규칙으로 계산한다. 그래서 이 표만 실으면 인쇄
      // 기록의 "이 숫자를 의심해보세요" 칸이 통째로 비고, 해소한 것이
      // 하나도 없으면 그 칸 자체가 안 그려진다.
      //
      // 실제로 그랬다. 성과 화면은 반박 다섯 건(표본 부족·실행 횟수 부족·
      // 격리 미해소·계절성·부서가 다르다고 함)을 띄우는데, 같은 건의 인쇄
      // 기록은 0건이었다. **평가하는 사람이 들고 가는 종이에서 자기 반박이
      // 통째로 사라진다.** 이 저장소가 파는 것이 기록인데 가장 불리한
      // 대목만 빠지는 셈이다.
      challenges: liveChallenges,
      money,
      moneyLabel,
      decisions: decisions.results,
      done,
      // 이 문서를 언제 뽑았는지. 인쇄물에는 이게 있어야 나중에 어느 시점의
      // 기록인지 알 수 있다.
      generatedAt: new Date().toISOString(),
    })
  } catch (err) {
    return failUnexpected(err, '기록을 모으지 못했습니다.')
  }
}
