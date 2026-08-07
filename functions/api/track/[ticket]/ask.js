// 부서가 **먼저** 묻는다.
//
// 여기가 오랫동안 한쪽으로만 열려 있었다. 담당자는 되묻고(applications/[id]/ask.js)
// 부서는 그 질문에 답할 수만 있었다(answer.js — questionId 가 반드시 있어야 한다).
// 부서가 자기가 궁금한 것을 먼저 묻는 길은 화면에도 서버에도 없었다.
//
// 그런데 화면은 물어보라고 시키고 있었다. 뒤로 밀린 신청서 안내가
// "납득이 안 되시면 아래 되묻기로 물어봐 주세요"라고 하고, 순서 안내가
// "급하시면 알려주세요 — 그것도 판단 재료입니다"라고 한다. 둘 다 갈 데가
// 없었다. 이 저장소는 같은 모양의 구멍을 이미 두 번 고쳤다(보류 해제,
// 시험판 의견). 이게 세 번째다.
//
// 인증은 답변 쪽과 같은 방식이다 — 접수번호를 아는 사람만. 접수번호는
// 신청서를 낸 사람에게만 준 것이고, 사내에서 그 정도면 충분하다.

import { jsonResponse, jsonError, failFields, failUnexpected } from '../../../_lib/http.js'
import { checkRateLimit } from '../../../_lib/rateLimit.js'
import { logDecision } from '../../../_lib/decisions.js'
import { validateDeptAsk, DEPT_ASK_KIND, STAFF_REPLY_KIND } from '../../../../shared/thread.js'

const TICKET = /^AX-[A-Z0-9]{3}-[A-Z0-9]{3}$/

// 답 안 받은 질문이 이만큼 쌓이면 더 안 받는다.
//
// 막는 것이 목적이 아니다. 열 개를 던져 놓고 답을 기다리면 담당자는 어느
// 것부터 답해야 할지 모르고, 그러면 하나도 안 답한다. 쌓인 것부터 풀리게
// 한다.
const MAX_OPEN = 5

export async function onRequestPost({ env, params, request }) {
  const ticket = String(params.ticket ?? '').trim().toUpperCase()
  if (!TICKET.test(ticket)) {
    return jsonError('접수번호 모양이 맞지 않습니다. AX-000-000 형태로 적어주세요.', 400)
  }

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown'
  const allowed = await checkRateLimit(env, `deptask:${ip}`, 20, 600)
  if (!allowed) {
    return jsonError('질문은 십 분에 20건까지 받습니다. 잠시 후 다시 시도해주세요.', 429)
  }

  let body
  try {
    body = await request.json()
  } catch {
    return jsonError('보내주신 내용을 읽지 못했습니다.', 400)
  }

  const question = String(body.question ?? '').trim().slice(0, 2000)
  const author = String(body.author ?? '').trim().slice(0, 60)

  const fields = validateDeptAsk({ question, author })
  if (Object.keys(fields).length > 0) {
    return failFields(fields, '적어주신 것을 다시 확인해주세요.')
  }

  try {
    const app = await env.DB.prepare(
      'SELECT id, ticket_no, dept FROM application WHERE ticket_no = ?'
    )
      .bind(ticket)
      .first()
    if (!app) return jsonError('그 접수번호로 낸 신청서를 찾지 못했습니다.', 404)

    // 아직 답 안 온 질문이 몇 개인가. 답이 달린 것은 세지 않는다.
    const { results: open } = await env.DB.prepare(
      `SELECT q.id FROM decision_log q
       WHERE q.application_id = ? AND q.link_kind = ?
         AND NOT EXISTS (
           SELECT 1 FROM decision_log r WHERE r.link_kind = ? AND r.link_id = q.id
         )`
    )
      .bind(app.id, DEPT_ASK_KIND, STAFF_REPLY_KIND)
      .all()

    if (open.length >= MAX_OPEN) {
      return jsonError(
        `아직 답을 못 받은 질문이 ${open.length}건 있습니다. 그 답을 받으신 뒤에 더 물어봐 주세요.`,
        409
      )
    }

    const id = await logDecision(env, {
      applicationId: app.id,
      stage: '검토',
      actor: 'human',
      title: author,
      what: question,
      // 근거 없는 결정은 기록하지 않는다는 규칙이 있어서 한 줄 붙인다.
      // 부서가 묻는 것은 판단이 아니라 사실이라 "누가 물었다"가 곧 근거다.
      why: `${app.dept}의 ${author}님이 먼저 물었습니다. 담당자 답을 기다립니다.`,
      linkKind: DEPT_ASK_KIND,
      // 담당자 질문과 달리 무엇에 딸린 질문이 아니다. 스스로 실이 된다.
      linkId: null,
    })

    return jsonResponse({
      ok: true,
      id,
      openCount: open.length + 1,
      message: '물어보신 것을 담당자에게 전했습니다. 답이 오면 이 화면에 뜹니다.',
    })
  } catch (err) {
    return failUnexpected(err, '질문을 남기지 못했습니다.')
  }
}
