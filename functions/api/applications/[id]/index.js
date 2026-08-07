// 신청서 하나의 전부. 2단계 검토 화면이 쓴다.
//
// 부서가 적어 낸 원문과 AI가 추정한 값과 담당자가 확정한 판정을 각각 따로
// 내려보낸다. 서버에서 미리 합쳐 버리면 화면에서 "이건 누가 쓴 것인가"를
// 구분할 수 없게 되고, 그 구분이 이 앱의 전부다.

import { jsonResponse, jsonError } from '../../../_lib/http.js'
import { annualHours } from '../../../_lib/applications.js'

export async function onRequestGet({ env, params }) {
  const id = params.id

  try {
    const application = await env.DB.prepare(
      `SELECT * FROM application WHERE id = ? OR ticket_no = ?`
    )
      .bind(id, id)
      .first()

    if (!application) return jsonError('그런 신청서가 없습니다.', 404)

    const [review, decisions, siblings] = await Promise.all([
      env.DB.prepare(`SELECT * FROM review WHERE application_id = ?`)
        .bind(application.id)
        .first(),

      // link_kind·link_id 가 빠져 있었다.
      //
      // 화면은 이 줄들을 shared/thread.js 의 toThread 로 넘긴다. 그 함수는
      // link_kind 로 주고받은 말만 골라내는데, 그 칸이 안 오니 **하나도 안
      // 골라졌다.** 담당자가 되물어도 자기 화면에는 아무것도 안 나오고
      // "되물어보기" 버튼만 계속 보였다. 부서가 답해도 못 봤다. 첫 화면이
      // "되물은 것에 답이 온 신청서 N건"이라고 알려 줘도 눌러서 가면 없었다.
      //
      // 예외도 안 나고 화면도 안 깨진다. 그냥 늘 빈 목록이다.
      env.DB.prepare(
        `SELECT id, stage, actor, title, what, why, alternatives, unrequested,
                link_kind, link_id, created_at
         FROM decision_log WHERE application_id = ? ORDER BY created_at`
      )
        .bind(application.id)
        .all(),

      // 같은 부서의 다른 신청서. 검토할 때 "이거 아까 그거랑 같은 거 아닌가"를
      // 담당자가 직접 확인할 수 있어야 한다.
      env.DB.prepare(
        `SELECT a.id, a.ticket_no, a.title, a.dept, a.status
         FROM application a
         WHERE a.id <> ? AND (a.dept = ? OR a.status = '접수')
         ORDER BY a.created_at DESC LIMIT 12`
      )
        .bind(application.id, application.dept)
        .all(),
    ])

    return jsonResponse({
      application: {
        ...application,
        annual_hours: annualHours(application),
      },
      review: review ?? null,
      decisions: decisions.results,
      siblings: siblings.results,
    })
  } catch (err) {
    return jsonError(`신청서를 불러오지 못했습니다. (${String(err.message).slice(0, 160)})`, 503)
  }
}

