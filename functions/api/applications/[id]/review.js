// 2단계 — 판정을 저장한다.
//
// 이 라우트가 하는 일은 셋이다. 검토 기록을 남기고, 신청서 상태를 옮기고,
// 의사결정 로그에 근거를 적는다. 셋이 함께 일어나야 한다 — 판정만 저장되고
// 근거가 없으면 나중에 "왜 반려했나"에 답할 수 없다.
//
// D1은 여러 문장을 한 번에 보내는 batch를 지원한다. 세 쓰기를 batch로 묶어
// 중간에 끊긴 상태(판정은 있는데 로그가 없는 상태)가 남지 않게 한다.

import { jsonResponse, jsonError } from '../../../_lib/http.js'
import { validateReview, statusFromVerdict, REFUSE_LABELS } from '../../../../shared/review.js'
import { newId } from '../../../_lib/ids.js'

export async function onRequestPost({ env, params, request }) {
  const id = params.id

  let body
  try {
    body = await request.json()
  } catch {
    return jsonError('요청 형식이 올바르지 않습니다.', 400)
  }

  const check = validateReview(body)
  if (!check.ok) {
    return jsonResponse({ error: '적어 주신 내용을 확인해주세요.', fields: check.errors }, 400)
  }
  const v = check.value

  const application = await env.DB.prepare(
    `SELECT id, ticket_no, dept, title, status FROM application WHERE id = ? OR ticket_no = ?`
  )
    .bind(id, id)
    .first()

  if (!application) return jsonError('그런 신청서가 없습니다.', 404)

  const nextStatus = statusFromVerdict(v.verdict)

  // 판정을 바꾸는 것 자체는 막지 않는다. 검토는 다시 할 수 있는 일이고,
  // 무엇이 어떻게 바뀌었는지는 decision_log에 두 줄로 남는다.
  const isUpdate = Boolean(
    await env.DB.prepare('SELECT 1 FROM review WHERE application_id = ?')
      .bind(application.id)
      .first()
  )

  const statements = [
    env.DB.prepare(
      `INSERT INTO review
         (application_id, impact_score, impact_reason, difficulty_score, difficulty_reason,
          verdict, verdict_reason, alternatives_considered,
          refuse_code, refuse_alternative, hold_until_condition, reviewer_label, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(application_id) DO UPDATE SET
         impact_score = excluded.impact_score,
         impact_reason = excluded.impact_reason,
         difficulty_score = excluded.difficulty_score,
         difficulty_reason = excluded.difficulty_reason,
         verdict = excluded.verdict,
         verdict_reason = excluded.verdict_reason,
         alternatives_considered = excluded.alternatives_considered,
         refuse_code = excluded.refuse_code,
         refuse_alternative = excluded.refuse_alternative,
         hold_until_condition = excluded.hold_until_condition,
         reviewer_label = excluded.reviewer_label,
         updated_at = datetime('now')`
    ).bind(
      application.id,
      v.impact_score,
      v.impact_reason,
      v.difficulty_score,
      v.difficulty_reason,
      v.verdict,
      v.verdict_reason,
      v.alternatives_considered,
      v.refuse_code,
      v.refuse_alternative,
      v.hold_until_condition,
      v.reviewer_label
    ),

    env.DB.prepare(
      `UPDATE application SET status = ?, updated_at = datetime('now') WHERE id = ?`
    ).bind(nextStatus, application.id),

    env.DB.prepare(
      `INSERT INTO decision_log
         (id, application_id, stage, actor, title, what, why, alternatives, link_kind, link_id)
       VALUES (?, ?, '검토', 'human', ?, ?, ?, ?, 'review', ?)`
    ).bind(
      newId('dec'),
      application.id,
      isUpdate ? `판정을 ${v.verdict}(으)로 바꿨다` : `${v.verdict} 판정`,
      buildWhat(application, v),
      v.verdict_reason,
      v.alternatives_considered,
      application.id
    ),
  ]

  try {
    await env.DB.batch(statements)
  } catch (err) {
    return jsonError(`판정을 저장하지 못했습니다. (${String(err.message).slice(0, 160)})`, 500)
  }

  return jsonResponse({
    ok: true,
    application_id: application.id,
    ticket_no: application.ticket_no,
    status: nextStatus,
    verdict: v.verdict,
  })
}

function buildWhat(application, v) {
  const head = `${application.ticket_no} · ${application.dept} · ${application.title}`
  const score = `임팩트 ${v.impact_score} / 난이도 ${v.difficulty_score}`
  if (v.verdict === '반려') {
    return `${head} — 반려(${REFUSE_LABELS[v.refuse_code] ?? v.refuse_code}). 대안: ${v.refuse_alternative} [${score}]`
  }
  if (v.verdict === '보류') {
    return `${head} — 보류. 다시 볼 조건: ${v.hold_until_condition} [${score}]`
  }
  return `${head} — 수용 [${score}]`
}
