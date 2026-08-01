// 부서가 담당자 질문에 답한다.
//
// 로그인이 없는 사이트다. 그래서 "이 사람이 그 부서 사람이 맞나"를 계정으로
// 증명할 수 없다. 대신 접수번호를 아는 사람만 답할 수 있게 한다. 접수번호는
// 신청서를 낸 사람에게만 준 것이고, 사내에서 그 정도면 충분하다.
//
// 그 대신 답한 사람 이름을 직접 적게 한다. 증명은 아니지만 몇 달 뒤
// "이건 누가 답한 거지"에 답할 수는 있어야 한다. 화면에도 증명이 아니라고
// 적어 둔다 — 아닌 것을 맞다고 하지 않는다.

import { jsonResponse, jsonError, failFields, failUnexpected } from '../../../_lib/http.js'
import { checkRateLimit } from '../../../_lib/rateLimit.js'
import { logDecision } from '../../../_lib/decisions.js'
import { validateAnswer, ASK_KIND, ANSWER_KIND } from '../../../../shared/thread.js'

const TICKET = /^AX-[A-Z0-9]{3}-[A-Z0-9]{3}$/

export async function onRequestPost({ env, params, request }) {
  const ticket = String(params.ticket ?? '').trim().toUpperCase()
  if (!TICKET.test(ticket)) {
    return jsonError('접수번호 모양이 맞지 않습니다. AX-000-000 형태로 적어주세요.', 400)
  }

  // 접수번호를 찍어 맞히려는 것을 막는다. 진짜 답을 막지 않도록 넉넉히 둔다.
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown'
  const allowed = await checkRateLimit(env, `answer:${ip}`, 30, 600)
  if (!allowed) {
    return jsonError('답변은 십 분에 30건까지 받습니다. 잠시 후 다시 시도해주세요.', 429)
  }

  let body
  try {
    body = await request.json()
  } catch {
    return jsonError('보내주신 내용을 읽지 못했습니다.', 400)
  }

  const answer = String(body.answer ?? '').trim().slice(0, 2000)
  const author = String(body.author ?? '').trim().slice(0, 60)
  const questionId = String(body.questionId ?? '').trim()

  const fields = validateAnswer({ answer, author })
  if (!questionId) fields.questionId = '어느 질문에 답하시는지 골라주세요.'
  if (Object.keys(fields).length > 0) {
    return failFields(fields, '적어주신 것을 다시 확인해주세요.')
  }

  try {
    const app = await env.DB.prepare('SELECT id, ticket_no FROM application WHERE ticket_no = ?')
      .bind(ticket)
      .first()
    if (!app) return jsonError('그 접수번호로 낸 신청서를 찾지 못했습니다.', 404)

    // 그 질문이 정말 이 신청서에 달린 질문인지 본다. 이걸 안 보면 남의
    // 신청서 질문에 답을 붙일 수 있다 — 접수번호 하나만 알면.
    const question = await env.DB.prepare(
      `SELECT id FROM decision_log
       WHERE id = ? AND application_id = ? AND link_kind = ?`
    )
      .bind(questionId, app.id, ASK_KIND)
      .first()
    if (!question) return jsonError('그 질문을 찾지 못했습니다.', 404)

    // 이미 답한 질문에 또 답하지 않게 한다. 답이 둘 달리면 어느 것이
    // 진짜인지 담당자가 알 수 없다.
    const already = await env.DB.prepare(
      `SELECT id FROM decision_log WHERE link_kind = ? AND link_id = ?`
    )
      .bind(ANSWER_KIND, questionId)
      .first()
    if (already) {
      return jsonError('그 질문에는 이미 답하셨습니다. 새로 하실 말씀은 담당자에게 알려주세요.', 409)
    }

    const id = await logDecision(env, {
      applicationId: app.id,
      stage: '검토',
      actor: 'human',
      title: author,
      what: answer,
      // 근거 없는 결정은 기록하지 않는다는 규칙이 있어서 한 줄 붙인다.
      // 답변은 판단이 아니라 사실이라 "누가 무엇에 답했다"가 곧 근거다.
      why: `${author}님이 담당자 질문에 답했습니다.`,
      linkKind: ANSWER_KIND,
      linkId: questionId,
    })

    return jsonResponse({ ok: true, id })
  } catch (err) {
    return failUnexpected(err, '답변을 남기지 못했습니다.')
  }
}
