// 부서 쪽 — 사용법서에서 "여기 모르겠습니다"를 짚는다.
//
// 도구를 실제로 쓰는 자리에서 받는다. 사용법서 화면을 따로 열어야 짚을 수
// 있으면, 막힌 순간에 짚지 못하고 그냥 전화를 건다. 막힌 자리에서 바로
// 짚을 수 있어야 한다.
//
// 별도의 이름 입력은 받지 않는다. 실제 업무는 기존 인증 계정 범위,
// 체험은 개인 워크스페이스 범위에서 제보를 기록한다.

import { jsonResponse, jsonError, failUnexpected } from '../../../_lib/http.ts'
import { saveToolFeedback } from '../../../_lib/toolFeedback.ts'
import { loadUnclear } from '../../../_lib/unclear.js'
import {
  unclearBoard,
  sectionNote,
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
export async function onRequestGet({ env, data: requestData, params }) {
  env = requestData?.requestEnv ?? env
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
  } catch (error) {
    return failUnexpected(error, '짚힌 곳을 불러오지 못했습니다.')
  }
}

export async function onRequestPost({ env, data: requestData, request, params }) {
  env = requestData?.requestEnv ?? env
  let body
  try { body = await request.json() }
  catch { return jsonError('보내주신 내용을 읽지 못했습니다.', 400) }
  return saveToolFeedback(env, params.slug, 'unclear', body, request.headers.get('X-Idempotency-Key'), request.headers.get('CF-Connecting-IP') || 'unknown')
}
