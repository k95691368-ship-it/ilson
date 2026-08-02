// 짚힌 곳과 고친 곳을 한 자리에서 읽는다.
//
// 부서가 보는 도구 화면과 담당자가 보는 사용법서 화면이 각각 조립하면
// 반드시 갈라진다. 한쪽은 "고쳤습니다"인데 다른 쪽은 아직 짚혀 있는 식으로.

import { UNCLEAR_KIND, UNCLEAR_FIXED_KIND } from '../../shared/unclear.js'

export async function loadUnclear(env, applicationId) {
  const { results } = await env.DB.prepare(
    `SELECT id, title, what, why, link_kind, link_id, created_at
     FROM decision_log WHERE application_id = ? AND link_kind IN (?, ?)
     ORDER BY created_at`
  )
    .bind(applicationId, UNCLEAR_KIND, UNCLEAR_FIXED_KIND)
    .all()

  const flags = results
    .filter((r) => r.link_kind === UNCLEAR_KIND)
    // link_id에 어느 대목인지가 들어 있다. 제목 글자를 뒤져 가리면
    // 문구를 고치는 날 조용히 틀린다.
    .map((r) => ({ id: r.id, section: r.link_id, body: r.what, at: r.created_at }))

  const fixes = results
    .filter((r) => r.link_kind === UNCLEAR_FIXED_KIND)
    .map((r) => ({ id: r.id, flag_id: r.link_id, by: r.title, body: r.what, at: r.created_at }))

  return { flags, fixes }
}
