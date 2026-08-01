// 담당자가 신청서에 되묻는다.
//
// 신청서가 애매할 때 담당자가 할 수 있는 것이 짐작 아니면 보류뿐이었다.
// 짐작은 틀리고 보류는 안 풀린다. 물어볼 데를 만든다.

import { jsonResponse, jsonError, failFields, failUnexpected } from '../../../_lib/http.js'
import { logDecision } from '../../../_lib/decisions.js'
import { validateAsk, ASK_KIND } from '../../../../shared/thread.js'

export async function onRequestPost({ env, params, request }) {
  let body
  try {
    body = await request.json()
  } catch {
    return jsonError('보내주신 내용을 읽지 못했습니다.', 400)
  }

  const question = String(body.question ?? '').trim().slice(0, 2000)
  const why = String(body.why ?? '').trim().slice(0, 2000)
  const author = String(body.author ?? '').trim().slice(0, 60) || 'AX 담당자'

  const fields = validateAsk({ question, why, author })
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

    // 결정 기록에 얹는다. 되묻는 일은 실제로 결정이다 — "정보가 부족해서
    // 판정을 미루고 물었다"는 것 자체가 남길 값어치가 있고, 몇 달 뒤
    // "왜 이 건이 삼 주나 걸렸지"에 답하는 것도 이 기록이다.
    const id = await logDecision(env, {
      applicationId: app.id,
      stage: '검토',
      actor: 'human',
      title: author,
      what: question,
      why,
      linkKind: ASK_KIND,
      // 자기 자신을 가리킨다. 답이 이 값을 보고 어느 질문에 달린 것인지 찾는다.
      linkId: null,
    })

    // logDecision이 link_id를 받아 넣어 주지 않으므로 여기서 자기 id로 채운다.
    // 질문이 여럿 쌓였을 때 어느 것에 답한 것인지 못 가리면, 하나만 답해도
    // 전부 답한 것처럼 보인다.
    await env.DB.prepare('UPDATE decision_log SET link_id = ? WHERE id = ?').bind(id, id).run()

    return jsonResponse({
      ok: true,
      id,
      ticket_no: app.ticket_no,
      // 부서에게 알릴 방법이 메일밖에 없는데 아직 메일을 안 붙였다.
      // 그러니 담당자가 직접 알려야 한다는 것을 화면에서 숨기지 않는다.
      tellThem: `${app.dept}에 접수번호 ${app.ticket_no}로 조회하면 질문이 보인다고 알려주세요.`,
    })
  } catch (err) {
    return failUnexpected(err, '질문을 남기지 못했습니다.')
  }
}
