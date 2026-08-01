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
      files,
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
      q(env, 'SELECT id, name, byte_size, uploaded_at FROM application_file WHERE application_id = ? ORDER BY uploaded_at', id).all(),
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
      files: files.results,
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
      challenges: challenges.results,
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
