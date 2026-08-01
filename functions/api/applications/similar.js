// 지금 적고 있는 신청서와 비슷한 것이 이미 있는지.
//
// 신청서 화면에서 부른다. 다 적고 낸 뒤에 "이미 있습니다"라고 하면 늦다 —
// 그 사람은 이미 십 분을 썼다. 적는 도중에 알려 줘야 한다.
//
// 브라우저에서 다 하지 않고 여기서 하는 이유: 그러려면 접수된 신청서 전부를
// 브라우저로 내려보내야 한다. 신청서 화면은 로그인 없이 누구나 여는 자리라,
// 남의 부서가 무슨 병목을 겪고 있는지 통째로 넘겨줄 자리가 아니다.
// 여기서 골라 맞는 몇 건만 돌려준다.

import { jsonResponse, jsonError, failUnexpected } from '../../_lib/http.js'
import { findSimilar } from '../../../shared/similar.js'
import { annualHours } from '../../_lib/applications.js'

const MAX_TEXT = 4000

export async function onRequestPost({ env, request }) {
  let body
  try {
    body = await request.json()
  } catch {
    return jsonError('보내주신 내용을 읽지 못했습니다.', 400)
  }

  const t = (v) => String(v ?? '').slice(0, MAX_TEXT).trim()
  const draft = {
    id: t(body.id) || null,
    dept: t(body.dept),
    title: t(body.title),
    bottleneck: t(body.bottleneck),
    problem: t(body.problem),
  }

  // 아직 아무것도 안 적었으면 찾을 것이 없다. 몇 글자 안 적었을 때 부르면
  // 아무 신청서나 걸려서, 사람이 첫 낱말을 치자마자 경고를 보게 된다.
  const written = `${draft.title}${draft.bottleneck}${draft.problem}`
  if (written.length < 8) return jsonResponse({ hits: [] })

  try {
    const { results } = await env.DB.prepare(
      `SELECT id, ticket_no, dept, title, bottleneck, problem, status, created_at,
              current_minutes, current_people, current_frequency
       FROM application
       ORDER BY created_at DESC
       LIMIT 400`
    ).all()

    const hits = findSimilar(draft, results).map((h) => ({
      id: h.id,
      ticket_no: h.ticket_no,
      dept: h.dept,
      title: h.title,
      status: h.status,
      created_at: h.created_at,
      score: h.score,
      same: h.same,
      shared: h.shared,
      annual_hours: annualHours(h),
    }))

    return jsonResponse({ hits })
  } catch (err) {
    return failUnexpected(err, '비슷한 신청서를 찾지 못했습니다.')
  }
}
