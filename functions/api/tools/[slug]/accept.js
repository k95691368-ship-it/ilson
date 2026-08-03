// 부서가 넘겨받은 것을 직접 확인한다.
//
// 이 사이트는 "넘겼다고 받은 것이 아니다"를 여러 화면에서 되풀이한다.
// 그런데 그 확인을 누르는 자리가 담당자 화면에만 있었다. 담당자가 창을
// 띄워 부서 사람 이름을 대신 타이핑하고, 기록에는 그 부서 사람이 확인한
// 것으로 남았다. **자기 주장과 정반대로 만들어져 있었다.**
//
// 부서 사람은 조회 화면에서 "받았다고 눌러주세요"를 읽고 도구 화면으로
// 왔는데 거기엔 누를 것이 없었다. 시키는 일을 하러 왔다가 막다른 화면에서
// 끝난다. 그런 목록은 한 번 겪으면 그다음부터 통째로 안 읽힌다.
//
// 로그인이 없다. 도구 주소를 아는 사람이 그 도구를 넘겨받은 사람이라고
// 본다 — 조회 화면과 같은 규칙이다.

import { jsonResponse, jsonError, failFields, failUnexpected } from '../../../_lib/http.js'
import { newId } from '../../../_lib/ids.js'
import { checkRateLimit, releaseRateLimit } from '../../../_lib/rateLimit.js'
import {
  validateAccept,
  validateReject,
  acceptState,
  ACCEPT_KIND,
  ACCEPT_PROXY_KIND,
  REJECT_KIND,
} from '../../../../shared/accept.js'

async function load(env, slug) {
  const h = await env.DB.prepare(
    `SELECT h.application_id, h.slug, h.title, h.handed_to_dept, h.handed_to_person,
            h.handed_at, h.accepted_at, h.accepted_by, h.rolled_back_at,
            a.ticket_no, a.dept
     FROM handover h JOIN application a ON a.id = h.application_id
     WHERE h.slug = ?`
  )
    .bind(slug)
    .first()
  if (!h) return null

  const { results } = await env.DB.prepare(
    `SELECT id, title, what, link_kind, created_at FROM decision_log
     WHERE application_id = ? AND link_kind IN (?, ?, ?)
     ORDER BY created_at`
  )
    .bind(h.application_id, ACCEPT_KIND, ACCEPT_PROXY_KIND, REJECT_KIND)
    .all()

  const records = results.map((r) => ({
    id: r.id,
    kind: r.link_kind,
    by: r.title,
    what: r.what,
    at: r.created_at,
  }))

  return { handover: h, records }
}

export async function onRequestGet({ env, params }) {
  const loaded = await load(env, params.slug)
  if (!loaded) return jsonError('그런 도구가 없습니다.', 404)

  return jsonResponse({
    handedTo: {
      dept: loaded.handover.handed_to_dept,
      person: loaded.handover.handed_to_person,
      at: loaded.handover.handed_at,
    },
    state: acceptState(loaded),
  })
}

export async function onRequestPost({ env, request, params }) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown'
  const ticket = await checkRateLimit(env, `accept:${ip}`, 10, 3600)
  if (!ticket) return jsonError('확인은 시간당 10회까지 가능합니다.', 429)

  const loaded = await load(env, params.slug)
  if (!loaded) {
    await releaseRateLimit(env, `accept:${ip}`, ticket)
    return jsonError('그런 도구가 없습니다.', 404)
  }

  let body
  try {
    body = await request.json()
  } catch {
    await releaseRateLimit(env, `accept:${ip}`, ticket)
    return jsonError('보내주신 내용을 읽지 못했습니다.', 400)
  }

  const app = loaded.handover.application_id
  const by = String(body.by ?? '').trim().slice(0, 60)

  if (loaded.handover.rolled_back_at) {
    await releaseRateLimit(env, `accept:${ip}`, ticket)
    return jsonError('이 도구는 문제가 있어 잠시 내려가 있습니다. 담당자가 다시 올리면 확인해주세요.', 409)
  }

  // 못 쓰겠다는 답.
  //
  // "받았습니다" 버튼만 두면 그건 도장 찍기다. 안 맞을 때 말할 자리가
  // 없으면 부서는 그냥 안 누르고, 담당자는 왜 안 누르는지 모른다.
  if (body.kind === 'reject') {
    const errors = validateReject(body)
    if (Object.keys(errors).length > 0) {
      await releaseRateLimit(env, `accept:${ip}`, ticket)
      return failFields(errors, '적어 주신 내용을 확인해주세요.')
    }
    try {
      await env.DB.prepare(
        `INSERT INTO decision_log
           (id, application_id, stage, actor, title, what, why, link_kind, link_id)
         VALUES (?, ?, '배포', 'human', ?, ?, ?, ?, ?)`
      )
        .bind(
          newId('dec'),
          app,
          by,
          String(body.reason).trim().slice(0, 1000),
          '받았다고 누를 수만 있고 못 쓰겠다고 말할 자리가 없으면, 부서는 그냥 안 누르고 담당자는 왜 안 누르는지 모른다.',
          REJECT_KIND,
          loaded.handover.slug
        )
        .run()
      const after = await load(env, params.slug)
      return jsonResponse({
        ok: true,
        state: acceptState(after),
        message: '알려주셔서 고맙습니다. 담당자가 고친 뒤에 다시 여쭙겠습니다.',
      })
    } catch (err) {
      await releaseRateLimit(env, `accept:${ip}`, ticket)
      return failUnexpected(err, '남기지 못했습니다.')
    }
  }

  const errors = validateAccept(body)
  if (Object.keys(errors).length > 0) {
    await releaseRateLimit(env, `accept:${ip}`, ticket)
    return failFields(errors, '적어 주신 내용을 확인해주세요.')
  }

  try {
    // 한 묶음으로 돌린다. 따로 돌리다 끊기면 확인은 됐는데 상태는 안 바뀐
    // 것이 남고, 그게 어느 쪽인지 아무도 모른다.
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE handover SET accepted_at = datetime('now'), accepted_by = ?, updated_at = datetime('now')
         WHERE application_id = ?`
      ).bind(by, app),
      env.DB.prepare(
        "UPDATE application SET status = '완료', updated_at = datetime('now') WHERE id = ?"
      ).bind(app),
      env.DB.prepare(
        `INSERT INTO decision_log
           (id, application_id, stage, actor, title, what, why, link_kind, link_id)
         VALUES (?, ?, '배포', 'human', ?, ?, ?, ?, ?)`
      ).bind(
        newId('dec'),
        app,
        by,
        `${loaded.handover.handed_to_dept}에서 직접 받았다고 확인했습니다.`,
        // 이 기록이 담당자 대리 확인과 다른 값을 갖는 이유.
        '넘겼다고 받은 것이 아니다. 담당자가 대신 눌러 준 확인은 부서 확인이 아니다.',
        ACCEPT_KIND,
        loaded.handover.slug
      ),
    ])

    const after = await load(env, params.slug)
    return jsonResponse({
      ok: true,
      state: acceptState(after),
      message: '확인해주셔서 고맙습니다. 이제 이 도구는 그쪽 것입니다.',
    })
  } catch (err) {
    await releaseRateLimit(env, `accept:${ip}`, ticket)
    return failUnexpected(err, '확인을 남기지 못했습니다.')
  }
}
