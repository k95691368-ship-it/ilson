// 5단계 — 베타 테스트 기록.
//
// 채점은 브라우저에서 돈다(shared/grade.js). 여기는 그 결과를 회차로 남기고,
// 현업 담당자가 실제로 써 보고 한 말을 모으는 자리다.
//
// 다만 **합격이냐 아니냐는 여기서 다시 센다.** 채점하는 일과 합격을 선언하는
// 일은 다르다. 앞엣것은 브라우저가 해도 되지만 뒤엣것은 게이트라서 안 된다.

import { jsonResponse, jsonError, failFields, failUnexpected } from '../../../_lib/http.js'
import { newId } from '../../../_lib/ids.js'
import { betaRoundPayload } from '../../../_lib/betaRound.js'
import { mutationFingerprint } from '../../../_lib/atomicMutation.js'
import { loadSignoff, requiredDeptsOf } from '../../../_lib/signoff.js'
import { signoffState } from '../../../../shared/signoff.js'
import { encodeBetaNote, decodeBetaRound } from '../../../../shared/betaEvidence.js'

async function findApplication(env, id) {
  return env.DB.prepare(
    'SELECT id, ticket_no, dept, title, status, beta_criteria_revision FROM application WHERE id = ? OR ticket_no = ?'
  )
    .bind(id, id)
    .first()
}

export async function onRequestGet({ env, data: requestData, params }) {
  env = requestData?.requestEnv ?? env
  const app = await findApplication(env, params.id)
  if (!app) return jsonError('그런 신청서가 없습니다.', 404)

  try {
    const [rounds, criteria, latestBuild, feedback] = await Promise.all([
      env.DB.prepare('SELECT * FROM beta_round WHERE application_id = ? ORDER BY seq DESC')
        .bind(app.id)
        .all(),
      env.DB.prepare(
        `SELECT id, ord, body, check_kind, check_key, is_required_safety, confirmed_at
         FROM acceptance_criterion WHERE application_id = ? AND confirmed_at IS NOT NULL
         ORDER BY ord`
      )
        .bind(app.id)
        .all(),
      env.DB.prepare(
        'SELECT id, seq, rows_out, quarantined, created_at FROM build_run WHERE application_id = ? ORDER BY seq DESC LIMIT 1'
      )
        .bind(app.id)
        .first(),
      env.DB.prepare(
        'SELECT * FROM beta_feedback WHERE application_id = ? ORDER BY created_at DESC'
      )
        .bind(app.id)
        .all(),
    ])

    let results = []
    if (rounds.results.length > 0) {
      const { results: rows } = await env.DB.prepare(
        'SELECT * FROM beta_result WHERE round_id = ? ORDER BY ord'
      )
        .bind(rounds.results[0].id)
        .all()
      results = rows.map((r) => ({ ...r, samples: safeParse(r.samples_json, []) }))
    }

    return jsonResponse({
      application: app,
      criteriaRevision: Number(app.beta_criteria_revision),
      runScope: await env.DB.toolRunScope?.() ?? null,
      criteria: criteria.results,
      rounds: rounds.results.map(decodeBetaRound),
      latestResults: results,
      latestBuild: latestBuild ?? null,
      feedback: feedback.results,
      // 합격 기준을 확정하지 않았으면 채점할 것이 없다.
      canTest: criteria.results.length > 0,
      // 부서가 이 기준을 확인했는가.
      //
      // 통과를 막지는 않는다 — 막으면 부서가 답을 안 줄 때 아무것도 못
      // 하게 된다. 대신 무엇이 없는 통과인지 화면에 적는다.
      signoff: signoffState({
        ...(await loadSignoff(env, app.id, app.dept)),
        requiredDepts: await requiredDeptsOf(env, app.id, app.dept),
      }),
    })
  } catch (error) {
    return failUnexpected(error, '베타 기록을 불러오지 못했습니다.')
  }
}

export async function onRequestPost({ env, data: requestData, params, request }) {
  env = requestData?.requestEnv ?? env
  const app = await findApplication(env, params.id)
  if (!app) return jsonError('그런 신청서가 없습니다.', 404)

  let body
  try {
    body = await request.json()
  } catch {
    return jsonError('요청 형식이 올바르지 않습니다.', 400)
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return jsonError('요청 형식이 올바르지 않습니다.', 400)

  const t = (v) => String(v ?? '').trim()

  // 현업 담당자 피드백
  if (body.kind === 'feedback') {
    if (!t(body.body)) return failFields({ body: '무슨 말씀이었는지 적어주세요.' })
    const id = newId('fbk')
    try {
      await env.DB.prepare(
        `INSERT INTO beta_feedback (id, application_id, round_id, dept, person_label, body, kind)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          id,
          app.id,
          t(body.round_id) || null,
          t(body.dept) || app.dept,
          t(body.person_label) || '담당자',
          t(body.body),
          ['의견', '막힌곳', '요청', '칭찬'].includes(t(body.feedback_kind))
            ? t(body.feedback_kind)
            : '의견'
        )
        .run()
      return jsonResponse({ ok: true, id }, 201)
    } catch (error) {
      return failUnexpected(error, '저장하지 못했습니다.', 500)
    }
  }

  if (body.kind === 'resolve_feedback') {
    try {
      await env.DB.prepare(
        `UPDATE beta_feedback SET resolved_at = datetime('now'), resolution = ?
         WHERE id = ? AND application_id = ?`
      )
        .bind(t(body.resolution) || null, t(body.id), app.id)
        .run()
      return jsonResponse({ ok: true })
    } catch (error) {
      return failUnexpected(error, '저장하지 못했습니다.', 500)
    }
  }

  // 채점 회차 기록
  if (body.kind !== 'round') return jsonError('무엇을 저장할지 알 수 없습니다.', 400)

  const payload = betaRoundPayload(body)
  if (!payload) return jsonError('채점 기준·결과·숫자의 형식을 확인해 주십시오.', 400)
  const encodedNote = encodeBetaNote(payload.criteria_revision, payload.note)
  if (!encodedNote) return failFields({ note: '메모가 너무 깁니다. 특수문자를 포함한 메모의 길이를 줄여주세요.' })
  payload.note = encodedNote
  const requestId = body.run_id ?? request.headers.get('X-Idempotency-Key')
  if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{16,100}$/.test(requestId)) return jsonError('채점 실행 번호가 없습니다. 최신 화면에서 다시 채점해 주십시오.', 400)
  if (typeof env.DB.recordBetaRound !== 'function' || typeof env.DB.toolRunScope !== 'function') return jsonError('베타 저장 기능의 데이터베이스 설정이 필요합니다.', 503)
  try {
    if (body.run_scope !== await env.DB.toolRunScope()) {
      return jsonError('채점한 계정 또는 작업공간이 달라졌습니다. 원래 계정에서 저장 여부를 확인해 주십시오.', 409)
    }
    const fingerprint = await mutationFingerprint({ kind: 'beta-round', application: app.id, payload })
    const saved = await env.DB.recordBetaRound(app.id, requestId, fingerprint, payload)
    return jsonResponse(saved.response.body, saved.response.status, { 'X-Idempotency-Replayed': saved.replayed ? '1' : '0' })
  } catch (error) {
    const message = String(error?.message)
    if (message.includes('/PBT01')) return jsonResponse({ error: '확정 기준이 변경되었거나 일부 기준이 빠졌습니다. 최신 기준을 불러와 다시 채점해 주십시오.', code: 'BETA_CRITERIA_CHANGED', notSaved: true }, 409)
    if (message.includes('/40001')) return jsonError('같은 실행 번호의 내용 또는 권한이 변경되었습니다. 원래 채점 기록을 확인해 주십시오.', 409)
    if (message.includes('/P0002')) return jsonError('그런 신청서가 없습니다.', 404)
    if (message.includes('/22023')) return jsonError('채점 기준과 결과의 형식을 확인해 주십시오.', 400)
    return failUnexpected(error, '채점 결과의 저장 여부를 확인하지 못했습니다. 재채점하지 말고 같은 기록으로 다시 저장해 주십시오.')
  }
}

function safeParse(text, fallback) {
  try {
    return text ? JSON.parse(text) : fallback
  } catch {
    return fallback
  }
}
