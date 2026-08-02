// 부서 쪽 — 사용법서에서 "여기 모르겠습니다"를 짚는다.
//
// 도구를 실제로 쓰는 자리에서 받는다. 사용법서 화면을 따로 열어야 짚을 수
// 있으면, 막힌 순간에 짚지 못하고 그냥 전화를 건다. 막힌 자리에서 바로
// 짚을 수 있어야 한다.
//
// 로그인이 없고 이름도 안 받는다. 모르겠다고 말하는 일에 이름을 붙이라고
// 하면, 모르는 것을 밝히는 것 자체가 부담이 되어 아무도 안 짚는다.

import { jsonResponse, jsonError, failFields, failUnexpected } from '../../../_lib/http.js'
import { newId } from '../../../_lib/ids.js'
import { checkRateLimit, releaseRateLimit } from '../../../_lib/rateLimit.js'
import { loadUnclear } from '../../../_lib/unclear.js'
import {
  validateUnclear,
  unclearBoard,
  sectionNote,
  UNCLEAR_KIND,
  SECTION_BY_KEY,
} from '../../../../shared/unclear.js'

async function findBySlug(env, slug) {
  return env.DB.prepare(
    `SELECT h.application_id AS id, a.ticket_no, a.title
     FROM handover h JOIN application a ON a.id = h.application_id
     WHERE h.slug = ? AND h.rolled_back_at IS NULL`
  )
    .bind(slug)
    .first()
}

// 화면이 대목마다 무슨 표시를 붙일지 물어본다.
export async function onRequestGet({ env, params }) {
  const app = await findBySlug(env, params.slug)
  if (!app) return jsonError('그런 도구가 없습니다.', 404)

  try {
    const board = unclearBoard(await loadUnclear(env, app.id))
    const bySection = {}
    for (const s of board.sections) {
      const note = sectionNote(s)
      if (note) bySection[s.key] = note
    }
    return jsonResponse({ notes: bySection, summary: board.summary })
  } catch (err) {
    return jsonError(`짚힌 곳을 불러오지 못했습니다. (${String(err.message).slice(0, 160)})`, 503)
  }
}

export async function onRequestPost({ env, request, params }) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown'
  // 넉넉하게 둔다. 여기서 막으면 짚기를 그만두게 되고, 그러면 문서는
  // 영영 그대로다.
  const ticket = await checkRateLimit(env, `unclear:${ip}`, 20, 3600)
  if (!ticket) return jsonError('짚기는 시간당 20회까지 가능합니다.', 429)

  const app = await findBySlug(env, params.slug)
  if (!app) {
    await releaseRateLimit(env, `unclear:${ip}`, ticket)
    return jsonError('그런 도구가 없습니다.', 404)
  }

  let body
  try {
    body = await request.json()
  } catch {
    await releaseRateLimit(env, `unclear:${ip}`, ticket)
    return jsonError('보내주신 내용을 읽지 못했습니다.', 400)
  }

  const errors = validateUnclear(body)
  if (Object.keys(errors).length > 0) {
    await releaseRateLimit(env, `unclear:${ip}`, ticket)
    return failFields(errors, '적어 주신 내용을 확인해주세요.')
  }

  const section = SECTION_BY_KEY[body.section]

  try {
    await env.DB.prepare(
      `INSERT INTO decision_log
         (id, application_id, stage, actor, title, what, why, link_kind, link_id)
       VALUES (?, ?, '사용법서', 'human', ?, ?, ?, ?, ?)`
    )
      .bind(
        newId('dec'),
        app.id,
        `사용법서에서 막혔다 — ${section.label}`,
        String(body.body).trim().slice(0, 1000),
        '쓴 사람은 다 안다. 모르는 데가 어디인지는 실제로 읽는 사람만 안다.',
        UNCLEAR_KIND,
        section.key
      )
      .run()

    const board = unclearBoard(await loadUnclear(env, app.id))
    const now = board.sections.find((s) => s.key === section.key)
    return jsonResponse({
      ok: true,
      note: sectionNote(now),
      message:
        (now?.open ?? 1) >= 2
          ? '고맙습니다. 이 대목에서 막히신 분이 여러 분이라, 담당자가 다시 씁니다.'
          : '고맙습니다. 담당자가 이 대목을 다시 씁니다.',
    })
  } catch (err) {
    await releaseRateLimit(env, `unclear:${ip}`, ticket)
    return failUnexpected(err, '짚어 주신 것을 남기지 못했습니다.')
  }
}
