// 우리가 만든 기능에 대한 버그 제보를 도구 주소 없이 받는 창구.
//
// 여태 신고하려면 넘겨받은 도구 주소(/t/…)를 알아야 했다. 그 주소를 아는
// 사람은 그 도구를 받은 부서뿐이고, 주소를 잃어버리면 말할 데가 없어진다.
// 아직 안 넘긴 것은 신고할 길이 아예 없었다 — 만드는 중에 이상한 걸 본
// 사람이 가장 먼저 아는데도.
//
// **새 저장소를 만들지 않는다.** 신고는 이미 decision_log 에 REPORT_KIND 로
// 쌓이고, 첫 화면과 「넘긴 뒤」 화면이 그것을 읽어 "이 도구를 지금 믿을 수
// 있나"를 판정한다. 여기서 따로 받으면 같은 것을 두 곳에서 세게 되고, 그
// 순간 두 화면이 서로 다른 숫자를 말한다. 이 저장소에서 가장 자주 난 사고다.

import { jsonResponse, jsonError, failFields, failUnexpected } from '../../_lib/http.js'
import { checkRateLimit } from '../../_lib/rateLimit.js'
import { logDecision } from '../../_lib/decisions.js'
import { validateFiledReport, REPORT_KIND, REPORT_BY_CODE } from '../../../shared/report.js'

// 무엇에 대해 신고할 수 있나.
//
// 넘긴 것만 고르게 하면 만드는 중인 것은 신고할 수 없다. 판정을 받아
// 실제로 만들기 시작한 것부터 고를 수 있게 한다.
export async function onRequestGet({ env }) {
  try {
    const { results } = await env.DB.prepare(
      `SELECT a.id, a.ticket_no, a.dept, a.title, a.status, h.slug
       FROM application a
       LEFT JOIN handover h ON h.application_id = a.id AND h.rolled_back_at IS NULL
       WHERE a.status IN ('수용', '진행중', '완료')
       ORDER BY a.created_at DESC
       LIMIT 100`
    ).all()

    return jsonResponse({
      targets: results.map((r) => ({
        id: r.id,
        ticket_no: r.ticket_no,
        dept: r.dept,
        title: r.title,
        status: r.status,
        // 넘긴 것이면 부서가 실제로 쓰는 주소도 같이 준다.
        slug: r.slug ?? null,
      })),
    })
  } catch (err) {
    return failUnexpected(err, '신고할 수 있는 기능을 불러오지 못했습니다.')
  }
}

export async function onRequestPost({ env, request }) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown'
  const allowed = await checkRateLimit(env, `bug:${ip}`, 20, 600)
  if (!allowed) {
    return jsonError('신고는 십 분에 20건까지 받습니다. 잠시 후 다시 시도해주세요.', 429)
  }

  let body
  try {
    body = await request.json()
  } catch {
    return jsonError('보내주신 내용을 읽지 못했습니다.', 400)
  }

  const applicationId = String(body.applicationId ?? '').trim()
  const code = String(body.code ?? '').trim()
  const text = String(body.body ?? '').trim().slice(0, 3000)
  const reporter = String(body.reporter ?? '').trim().slice(0, 60)

  const fields = validateFiledReport({ applicationId, code, body: text, reporter })
  if (Object.keys(fields).length > 0) {
    return failFields(fields, '적어주신 것을 다시 확인해주세요.')
  }

  try {
    const app = await env.DB.prepare(
      `SELECT id, ticket_no, dept, title FROM application WHERE id = ? OR ticket_no = ?`
    )
      .bind(applicationId, applicationId)
      .first()
    if (!app) return jsonError('그런 기능을 찾지 못했습니다.', 404)

    const kind = REPORT_BY_CODE[code]

    // 도구 화면에서 낸 신고와 **같은 모양**으로 남긴다. 읽는 쪽(첫 화면,
    // 넘긴 뒤 화면, 처리 창구)이 어느 길로 들어왔는지 알 필요가 없어야 한다.
    const id = await logDecision(env, {
      applicationId: app.id,
      stage: '제작',
      actor: 'human',
      title: reporter,
      what: text,
      // 근거 없는 결정은 안 남긴다는 규칙이 있다. 신고는 판단이 아니라
      // 겪은 일이라, "무엇이 이상한지"가 곧 근거다.
      why: `${app.dept}에서 "${kind.label}"로 신고했습니다.`,
      linkKind: REPORT_KIND,
      linkId: code,
    })

    return jsonResponse({ ok: true, id, ticket_no: app.ticket_no })
  } catch (err) {
    return failUnexpected(err, '신고를 남기지 못했습니다.')
  }
}
