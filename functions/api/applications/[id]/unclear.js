// 담당자 쪽 — 부서가 짚은 곳을 보고 다시 쓴다.
//
// 짚는 자리만 만들고 고치는 자리를 안 만들면, 짚기는 신고함이 되고 아무도
// 안 읽는다. 그러면 부서는 "말해 봐야 소용없다"를 배우고 그 뒤로는 짚지
// 않는다. 문서는 영영 그대로다.

import { jsonResponse, jsonError, failFields, failUnexpected } from '../../../_lib/http.js'
import { newId } from '../../../_lib/ids.js'
import { loadUnclear } from '../../../_lib/unclear.js'
import {
  validateFix,
  unclearBoard,
  boardLine,
  UNCLEAR_FIXED_KIND,
} from '../../../../shared/unclear.js'

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
    const board = unclearBoard(await loadUnclear(env, app.id))
    return jsonResponse({ ...board, line: boardLine(board.summary) })
  } catch (err) {
    return jsonError(`짚힌 곳을 불러오지 못했습니다. (${String(err.message).slice(0, 160)})`, 503)
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

  const errors = validateFix(body)
  if (Object.keys(errors).length > 0) {
    return failFields(errors, '적어 주신 내용을 확인해주세요.')
  }

  try {
    const { flags, fixes } = await loadUnclear(env, app.id)
    const flag = flags.find((f) => f.id === body.flag_id)
    if (!flag) return jsonError('그 짚은 것을 찾지 못했습니다.', 404)
    if (fixes.some((f) => f.flag_id === flag.id)) {
      return jsonError('이미 다시 쓰신 대목입니다.', 409)
    }

    await env.DB.prepare(
      `INSERT INTO decision_log
         (id, application_id, stage, actor, title, what, why, link_kind, link_id)
       VALUES (?, ?, '사용법서', 'human', ?, ?, ?, ?, ?)`
    )
      .bind(
        newId('dec'),
        app.id,
        String(body.by).trim().slice(0, 60),
        String(body.body).trim().slice(0, 1000),
        // 부서가 짚은 원문을 같이 남긴다. 나중에 이 기록만 보고도
        // 무엇 때문에 고쳤는지 알 수 있어야 한다.
        `부서가 짚은 것: ${flag.body}`,
        UNCLEAR_FIXED_KIND,
        flag.id
      )
      .run()

    const board = unclearBoard(await loadUnclear(env, app.id))
    return jsonResponse({
      ok: true,
      ...board,
      line: boardLine(board.summary),
      // 고친 문장이 그 자리에 그대로 붙는다는 것을 여기서도 말해 준다.
      message: '남겼습니다. 이 문장이 도구 화면 그 대목에 붙습니다.',
    })
  } catch (err) {
    return failUnexpected(err, '다시 썼다고 남기지 못했습니다.')
  }
}
