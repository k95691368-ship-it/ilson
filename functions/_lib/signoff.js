// 서명·이의·해소를 한 곳에서 읽는다.
//
// 부서 화면(/track)과 담당자 화면(/agreement)이 이 상태를 각각 따로 조립하면
// 반드시 갈라진다. 한쪽은 "이의 있음"인데 다른 쪽은 "확인됨"으로 보이는
// 식으로. 읽는 자리를 하나만 둔다.

import { SIGNOFF_KIND, OBJECTION_KIND, RESOLVE_KIND } from '../../shared/signoff.js'

export async function loadSignoff(env, applicationId) {
  const [criteria, logs] = await Promise.all([
    env.DB.prepare(
      `SELECT id, ord, body, check_kind, is_required_safety, confirmed_at
       FROM acceptance_criterion WHERE application_id = ? ORDER BY ord`
    )
      .bind(applicationId)
      .all(),
    env.DB.prepare(
      `SELECT id, title, what, why, link_kind, link_id, created_at
       FROM decision_log WHERE application_id = ? AND link_kind IN (?, ?, ?)
       ORDER BY created_at`
    )
      .bind(applicationId, SIGNOFF_KIND, OBJECTION_KIND, RESOLVE_KIND)
      .all(),
  ])

  // 마지막 서명만 살아 있는 것으로 본다. 기준이 고쳐진 뒤 다시 받는 일이
  // 실제로 있고, 그때 앞의 서명은 고치기 전 문장에 한 것이다.
  const signs = logs.results.filter((l) => l.link_kind === SIGNOFF_KIND)
  const last = signs[signs.length - 1] ?? null
  const signoff = last ? { by: last.title, at: last.created_at, id: last.id } : null

  // 이의는 그 서명 뒤에 달린 것만 본다. 앞 서명에 달렸던 이의는 이미
  // 지나간 이야기다.
  const objections = logs.results
    .filter((l) => l.link_kind === OBJECTION_KIND && (!signoff || l.created_at >= signoff.at))
    .map((l) => ({
      id: l.id,
      criterion_id: l.link_id,
      by: l.title,
      body: l.what,
      of: l.why,
      at: l.created_at,
    }))

  const resolutions = logs.results
    .filter((l) => l.link_kind === RESOLVE_KIND)
    .map((l) => ({
      id: l.id,
      objection_id: l.link_id,
      // 어떻게 풀었는지는 why에 코드로 박아 둔다. 제목 글자를 뒤져
      // 가리면 문구를 고치는 날 조용히 틀린다.
      code: l.why,
      by: l.title,
      body: l.what,
      at: l.created_at,
    }))

  return { criteria: criteria.results, signoff, objections, resolutions }
}
