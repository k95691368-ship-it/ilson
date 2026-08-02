// 담당자 쪽 — 부서가 단 이의를 보고 푼다.
//
// 이 자리를 안 만들면 이의가 달린 순간 그 신청서는 영영 "이의 있음"으로
// 남는다. 그러면 담당자는 다음부터 서명을 아예 안 받는다 — 받아 봐야
// 되돌릴 수 없는 표시만 붙기 때문이다. 서명을 받게 하려면 푸는 길이
// 같이 있어야 한다.

import { jsonResponse, jsonError, failFields, failUnexpected } from '../../../_lib/http.js'
import { newId } from '../../../_lib/ids.js'
import { loadSignoff } from '../../../_lib/signoff.js'
import {
  signoffState,
  validateResolve,
  RESOLUTION_BY_CODE,
  RESOLUTIONS,
  RESOLVE_KIND,
} from '../../../../shared/signoff.js'

async function findApplication(env, id) {
  return env.DB.prepare(
    'SELECT id, ticket_no, dept, title FROM application WHERE id = ? OR ticket_no = ?'
  )
    .bind(id, id)
    .first()
}

export async function onRequestGet({ env, params }) {
  const app = await findApplication(env, params.id)
  if (!app) return jsonError('그런 신청서가 없습니다.', 404)

  try {
    const loaded = await loadSignoff(env, app.id)
    const byId = new Map(loaded.criteria.map((c) => [c.id, c]))
    const resolved = new Map(loaded.resolutions.map((r) => [r.objection_id, r]))

    return jsonResponse({
      state: signoffState(loaded),
      // 이의 하나하나에 어느 기준에 달린 것인지 붙여 준다. 담당자가
      // 기준 문장을 다시 찾아 대조하게 두면 그 일부터 안 한다.
      objections: loaded.objections.map((o) => ({
        ...o,
        criterion: byId.get(o.criterion_id) ?? null,
        resolution: resolved.get(o.id) ?? null,
      })),
      // 어떻게 풀 수 있는지도 서버가 준다. 화면에 박아 두면 여기서 하나
      // 빼도 화면에는 그대로 남는다.
      ways: RESOLUTIONS,
    })
  } catch (err) {
    return jsonError(`이의를 불러오지 못했습니다. (${String(err.message).slice(0, 160)})`, 503)
  }
}

export async function onRequestPost({ env, request, params }) {
  const app = await findApplication(env, params.id)
  if (!app) return jsonError('그런 신청서가 없습니다.', 404)

  let body
  try {
    body = await request.json()
  } catch {
    return jsonError('보내주신 내용을 읽지 못했습니다.', 400)
  }

  const errors = validateResolve(body)
  if (Object.keys(errors).length > 0) {
    return failFields(errors, '적어 주신 내용을 확인해주세요.')
  }

  try {
    const loaded = await loadSignoff(env, app.id)
    const objection = loaded.objections.find((o) => o.id === body.objection_id)
    if (!objection) return jsonError('그 이의를 찾지 못했습니다.', 404)
    if (loaded.resolutions.some((r) => r.objection_id === objection.id)) {
      return jsonError('이미 푸신 이의입니다.', 409)
    }

    const way = RESOLUTION_BY_CODE[body.code]

    await env.DB.prepare(
      `INSERT INTO decision_log
         (id, application_id, stage, actor, title, what, why, link_kind, link_id)
       VALUES (?, ?, '협의안', 'human', ?, ?, ?, ?, ?)`
    )
      .bind(
        newId('dec'),
        app.id,
        String(body.by).trim().slice(0, 60),
        String(body.reason).trim().slice(0, 1000),
        // 어떻게 풀었는지는 코드로 박는다. 제목 글자를 뒤져 가리면
        // 문구를 고치는 날 조용히 틀린다.
        way.code,
        RESOLVE_KIND,
        objection.id
      )
      .run()

    const after = await loadSignoff(env, app.id)
    return jsonResponse({
      ok: true,
      state: signoffState(after),
      message: way.resign
        ? '남겼습니다. 기준이 바뀌었으니 부서에 다시 확인을 요청합니다.'
        : '남겼습니다. 이 사실은 통과를 말할 때마다 같이 적힙니다.',
    })
  } catch (err) {
    return failUnexpected(err, '이의를 풀지 못했습니다.')
  }
}
