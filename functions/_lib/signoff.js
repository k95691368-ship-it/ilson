// 서명·이의·해소를 한 곳에서 읽는다.
//
// 부서 화면(/track)과 담당자 화면(/agreement)이 이 상태를 각각 따로 조립하면
// 반드시 갈라진다. 한쪽은 "이의 있음"인데 다른 쪽은 "확인됨"으로 보이는
// 식으로. 읽는 자리를 하나만 둔다.

import { SIGNOFF_KIND, OBJECTION_KIND, RESOLVE_KIND } from '../../shared/signoff.js'
import { JOIN_KIND, UNJOIN_KIND } from '../../shared/join.js'

export async function loadSignoff(env, applicationId, ownDept = null) {
  const [criteria, logs] = await Promise.all([
    env.DB.prepare(
      `SELECT id, ord, body, check_kind, is_required_safety, confirmed_at
       FROM acceptance_criterion WHERE application_id = ? ORDER BY ord`
    )
      .bind(applicationId)
      .all(),
    env.DB.prepare(
      `SELECT id, title, what, why, alternatives, link_kind, link_id, created_at
       FROM decision_log WHERE application_id = ? AND link_kind IN (?, ?, ?)
       ORDER BY created_at`
    )
      .bind(applicationId, SIGNOFF_KIND, OBJECTION_KIND, RESOLVE_KIND)
      .all(),
  ])

  // 부서마다 한 장씩 받는다.
  //
  // link_id에 부서 이름을 넣는다. 옛 기록에는 거기에 신청서 id가 들어 있어서
  // 'app_'으로 시작한다. 그때는 **낸 부서의 서명으로 본다** — 이 기능을
  // 만들기 전에는 걸린 부서가 하나뿐이었으니 그게 맞는 읽기다.
  //
  // null로 두면 안 된다. 그러면 "재무 김대리님이 확인하셨습니다"라고 적어
  // 놓고 바로 아래에 "재무 아직"이라고 적는 화면이 된다.
  const signs = logs.results
    .filter((l) => l.link_kind === SIGNOFF_KIND)
    .map((l) => ({
      id: l.id,
      by: l.title,
      dept: String(l.link_id ?? '').startsWith('app_') ? ownDept : l.link_id,
      at: l.created_at,
    }))

  // 같은 부서가 다시 서명하면 뒤엣것만 남긴다. 기준이 고쳐진 뒤 다시 받는
  // 일이 실제로 있고, 그때 앞의 서명은 고치기 전 문장에 한 것이다.
  const latestByDept = new Map()
  for (const s of signs) latestByDept.set(s.dept ?? '(부서 없음)', s)
  const signatures = [...latestByDept.values()]

  const last = signs[signs.length - 1] ?? null
  const signoff = last ? { by: last.by, at: last.at, id: last.id, dept: last.dept } : null

  // 이의는 **그 부서의 서명**을 기준으로 본다.
  //
  // 처음에는 "가장 마지막 서명 뒤에 달린 것만"으로 했다. 틀렸다. 부서가
  // 여럿이 되자마자 사고가 났다 — 재무가 이의를 달아 둔 신청서에 마케팅이
  // 서명하니, 마케팅 서명이 가장 마지막이 되면서 재무의 이의가 통째로
  // 사라지고 상태가 '확인됨'이 됐다. 부서가 반대한 기준으로 통과 판정이
  // 나갈 뻔했다.
  //
  // 이의는 그것을 단 부서의 것이다. 그 부서가 다시 봐야 지워진다.
  const signByDept = new Map(signatures.map((s) => [s.dept ?? ownDept, s]))
  const objections = logs.results
    .filter((l) => l.link_kind === OBJECTION_KIND)
    .map((l) => ({
      id: l.id,
      criterion_id: l.link_id,
      by: l.title,
      // 어느 부서가 단 이의인지. alternatives 칸을 쓴다 — 이 표에서 비어
      // 있는 칸이고, 제목 글자를 뒤져 가리면 문구를 고치는 날 틀린다.
      dept: l.alternatives || ownDept,
      body: l.what,
      of: l.why,
      at: l.created_at,
    }))
    .filter((o) => {
      const sig = signByDept.get(o.dept)
      // 그 부서가 그 뒤에 다시 서명했으면 이미 다시 본 것이다.
      return !sig || o.at >= sig.at
    })

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

  return { criteria: criteria.results, signoff, signatures, objections, resolutions }
}

// 이 일에 걸린 부서 전부.
//
// 낸 부서 하나만 세면 안 된다. 다른 부서가 "우리도 같은 일을 겪는다"고
// 손들었으면 그 부서도 합격 기준을 봐야 한다. 안 그러면 마케팅과 영업이
// 걸린 일인데 재무 한 사람이 확인했다고 "확인됨"이 되고, 나머지 두 부서는
// 다 만들어진 뒤에 처음 기준을 본다. 그때는 늦다.
export async function requiredDeptsOf(env, applicationId, ownDept) {
  const { results } = await env.DB.prepare(
    `SELECT id, title, why, link_kind, link_id FROM decision_log
     WHERE application_id = ? AND link_kind IN (?, ?)`
  )
    .bind(applicationId, JOIN_KIND, UNJOIN_KIND)
    .all()

  // 담당자가 "이건 다른 건입니다"로 푼 부서는 빼야 한다. 풀었는데도
  // 그 부서 서명을 기다리면 이 신청서는 영영 확인됨이 못 된다.
  const released = new Set(
    results.filter((r) => r.link_kind === UNJOIN_KIND).map((r) => r.link_id)
  )
  const joined = results
    .filter((r) => r.link_kind === JOIN_KIND && !released.has(r.id))
    .map((r) => {
      try {
        return JSON.parse(r.why).dept
      } catch {
        // 옛 기록은 제목에만 부서가 들어 있다.
        return String(r.title ?? '').split(' — ')[0]
      }
    })
    .filter(Boolean)

  return [...new Set([ownDept, ...joined].filter(Boolean))]
}
