// 담당자가 부서 질문에 답한다.
//
// 부서가 먼저 묻는 길(track/[ticket]/ask.js)을 열었으니 그 반대편이 있어야
// 한다. 물을 자리만 만들고 답할 자리를 안 만들면, 부서는 물어 놓고 영영
// 답을 못 받는다 — 그건 물을 데가 없는 것보다 나쁘다. 물어본 사람은
// 기다리기 때문이다.
//
// 답은 짧아도 된다. 담당자 질문에 부서가 답할 때와 같은 기준을 쓴다 —
// "네", "아니요"도 답이다. 물은 쪽이 알고 싶은 것은 길이가 아니다.

import { jsonResponse, jsonError, failFields, failUnexpected } from '../../../_lib/http.js'
import { logDecision } from '../../../_lib/decisions.js'
import { validateAnswer, DEPT_ASK_KIND, STAFF_REPLY_KIND } from '../../../../shared/thread.js'

export async function onRequestPost({ env, params, request }) {
  let body
  try {
    body = await request.json()
  } catch {
    return jsonError('보내주신 내용을 읽지 못했습니다.', 400)
  }

  const answer = String(body.answer ?? '').trim().slice(0, 2000)
  const author = String(body.author ?? '').trim().slice(0, 60) || 'AX 담당자'
  const questionId = String(body.questionId ?? '').trim()

  const fields = validateAnswer({ answer, author })
  if (!questionId) fields.questionId = '어느 질문에 답하시는지 골라주세요.'
  if (Object.keys(fields).length > 0) {
    return failFields(fields, '적어주신 것을 다시 확인해주세요.')
  }

  try {
    const app = await env.DB.prepare(
      'SELECT id, ticket_no, dept FROM application WHERE id = ? OR ticket_no = ?'
    )
      .bind(params.id, params.id)
      .first()
    if (!app) return jsonError('그 신청서를 찾지 못했습니다.', 404)

    // 그 질문이 정말 이 신청서에 달린 부서 질문인지 본다. 이걸 안 보면
    // 남의 신청서 질문에 답을 붙일 수 있다.
    const question = await env.DB.prepare(
      `SELECT id, title FROM decision_log
       WHERE id = ? AND application_id = ? AND link_kind = ?`
    )
      .bind(questionId, app.id, DEPT_ASK_KIND)
      .first()
    if (!question) return jsonError('그 질문을 찾지 못했습니다.', 404)

    // 이미 답한 질문에 또 답하지 않게 한다. 답이 둘 달리면 어느 것이
    // 진짜인지 부서가 알 수 없다.
    const already = await env.DB.prepare(
      `SELECT id FROM decision_log WHERE link_kind = ? AND link_id = ?`
    )
      .bind(STAFF_REPLY_KIND, questionId)
      .first()
    if (already) {
      return jsonError('그 질문에는 이미 답하셨습니다.', 409)
    }

    const id = await logDecision(env, {
      applicationId: app.id,
      stage: '검토',
      actor: 'human',
      title: author,
      what: answer,
      why: `${app.dept}의 ${question.title}님이 물어본 것에 답했습니다.`,
      linkKind: STAFF_REPLY_KIND,
      linkId: questionId,
    })

    return jsonResponse({
      ok: true,
      id,
      message: '답을 남겼습니다. 부서가 접수번호 조회 화면에서 봅니다.',
    })
  } catch (err) {
    return failUnexpected(err, '답을 남기지 못했습니다.')
  }
}
