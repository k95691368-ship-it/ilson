// 부서가 넘겨받은 도구에 이상을 신고한다.
//
// 도구를 넘기고 나면 그때부터가 진짜다. 그런데 부서가 돌려 보고 "이 숫자
// 좀 이상한데" 싶어도 말할 데가 없었다. 결국 담당자에게 메신저로 말하거나,
// 더 흔하게는 그냥 안 쓴다. 안 쓰는 이유는 아무 데도 안 남는다.
//
// 넘긴 뒤 들어온 신고가 이 사이트에서 가장 값진 기록이다. 만들 때 놓친
// 것은 만든 사람이 못 찾는다 — 매일 그 일을 하는 사람만 찾는다.
//
// 도구 주소를 아는 사람이면 신고할 수 있다. 로그인을 요구하면 그 순간
// 아무도 신고하지 않고, 신고가 없으면 도구가 멀쩡한 줄 알게 된다.

import { jsonResponse, jsonError, failFields, failUnexpected } from '../../../_lib/http.js'
import { checkRateLimit } from '../../../_lib/rateLimit.js'
import { logDecision } from '../../../_lib/decisions.js'
import {
  validateReport,
  REPORT_KIND,
  REPORT_BY_CODE,
  URGENT_CODES,
} from '../../../../shared/report.js'

export async function onRequestPost({ env, params, request }) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown'
  const allowed = await checkRateLimit(env, `report:${ip}`, 20, 600)
  if (!allowed) {
    return jsonError('신고는 십 분에 20건까지 받습니다. 잠시 후 다시 시도해주세요.', 429)
  }

  let body
  try {
    body = await request.json()
  } catch {
    return jsonError('보내주신 내용을 읽지 못했습니다.', 400)
  }

  const code = String(body.code ?? '').trim()
  const text = String(body.body ?? '').trim().slice(0, 3000)
  const reporter = String(body.reporter ?? '').trim().slice(0, 60)

  const fields = validateReport({ code, body: text, reporter })
  if (Object.keys(fields).length > 0) {
    return failFields(fields, '적어주신 것을 다시 확인해주세요.')
  }

  try {
    const h = await env.DB.prepare(
      `SELECT h.application_id, h.title, h.handed_to_dept, h.rolled_back_at
       FROM handover h WHERE h.slug = ?`
    )
      .bind(params.slug)
      .first()
    if (!h) return jsonError('그 도구를 찾지 못했습니다.', 404)
    if (h.rolled_back_at) {
      return jsonError('이 도구는 이미 내려간 상태입니다. 담당자에게 알려주세요.', 409)
    }

    const kind = REPORT_BY_CODE[code]

    // 결정 기록에 얹는다. 신고를 받은 것도 기록이다 — 몇 달 뒤 "이 도구
    // 믿을 만한가"에 답하는 것이 바로 이 줄들이다.
    const id = await logDecision(env, {
      applicationId: h.application_id,
      stage: '배포',
      actor: 'human',
      title: reporter,
      what: text,
      // 근거 없는 결정은 안 남긴다는 규칙이 있다. 신고는 판단이 아니라
      // 겪은 일이라, "무엇이 이상한지"가 곧 근거다.
      why: `${h.handed_to_dept}에서 "${kind.label}"로 신고했습니다.`,
      linkKind: REPORT_KIND,
      // 유형 코드를 여기 담는다. 신고 목록을 만들 때 이걸로 가른다.
      linkId: code,
    })

    return jsonResponse({
      ok: true,
      id,
      urgent: URGENT_CODES.includes(code),
      // 신고하고 나서 아무 말도 없으면 "말해도 소용없구나"가 된다.
      // 다음에 무슨 일이 있을지 그 자리에서 알려 준다.
      next: URGENT_CODES.includes(code)
        ? '결과를 믿을 수 없는 종류라 이 도구에 표시가 붙습니다. 담당자가 먼저 봅니다.'
        : '담당자 화면에 남습니다. 급한 것부터 처리하므로 시간이 걸릴 수 있습니다.',
    })
  } catch (err) {
    return failUnexpected(err, '신고를 남기지 못했습니다.')
  }
}
