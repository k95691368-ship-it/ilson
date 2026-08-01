// 두 신청서를 나란히 놓고 견준다. 그리고 그 판정을 기록에 남긴다.
//
// 중복 판정이 "이 둘이 비슷합니다"까지는 말해 준다. 그다음 판단 — 같은
// 건인가, 말만 비슷하고 다른 일인가 — 은 사람이 한다. 그 판단이 사라지면
// 다음 사람이 같은 두 건을 놓고 처음부터 다시 견주게 된다.

import { jsonResponse, jsonError, failFields, failUnexpected } from '../_lib/http.js'
import { compare, COMPARE_VERDICTS, VERDICT_MEANING } from '../../shared/compare.js'
import { logDecision } from '../_lib/decisions.js'
import { annualHours } from '../_lib/applications.js'

const COLUMNS = `id, ticket_no, dept, applicant_label, title, bottleneck, problem, wish,
                 impact_if_wrong, current_minutes, current_people, current_frequency,
                 is_measured, status, created_at`

// 접수번호로도 id로도 찾을 수 있게 한다. 화면끼리 주고받을 때는 id가 편하고,
// 사람이 주소창에 적을 때는 접수번호가 편하다.
async function findOne(env, key) {
  return env.DB.prepare(
    `SELECT ${COLUMNS} FROM application WHERE id = ? OR ticket_no = ?`
  )
    .bind(key, key)
    .first()
}

export async function onRequestGet({ env, request }) {
  const url = new URL(request.url)
  const aKey = url.searchParams.get('a')
  const bKey = url.searchParams.get('b')
  if (!aKey || !bKey) return jsonError('견줄 신청서 둘을 알려주세요.', 400)
  if (aKey === bKey) return jsonError('같은 신청서끼리는 견줄 것이 없습니다.', 400)

  try {
    const [a, b, all, past] = await Promise.all([
      findOne(env, aKey),
      findOne(env, bKey),
      // 흔한 말을 가리려면 이미 들어와 있는 것 전부가 필요하다.
      env.DB.prepare(`SELECT id, title, bottleneck, problem FROM application LIMIT 400`).all(),
      // 전에 이미 견줘서 판정한 적이 있으면 그것부터 보여 준다.
      // 같은 두 건을 두 번 판정하게 하지 않는다.
      env.DB.prepare(
        `SELECT title, what, why, created_at FROM decision_log
         WHERE stage = '검토' AND link_kind = 'compare'
           AND (link_id = ? OR link_id = ?)
         ORDER BY created_at DESC LIMIT 5`
      )
        .bind(pairKey(aKey, bKey), pairKey(bKey, aKey))
        .all(),
    ])

    if (!a || !b) return jsonError('그 신청서를 찾지 못했습니다.', 404)

    const result = compare(a, b, all.results)

    return jsonResponse({
      a: { ...a, annual_hours: annualHours(a) },
      b: { ...b, annual_hours: annualHours(b) },
      ...result,
      pastVerdicts: past.results,
      verdicts: COMPARE_VERDICTS.map((v) => ({ verdict: v, meaning: VERDICT_MEANING[v] })),
    })
  } catch (err) {
    return failUnexpected(err, '두 신청서를 견주지 못했습니다.')
  }
}

// 두 건을 한 짝으로 묶는 이름. 순서를 정해 두지 않으면 A-B와 B-A가 다른
// 짝이 되어, 좌우를 바꿔 열면 전에 내린 판정이 안 보인다.
function pairKey(x, y) {
  return [x, y].sort().join('~')
}

export async function onRequestPost({ env, request }) {
  let body
  try {
    body = await request.json()
  } catch {
    return jsonError('보내주신 내용을 읽지 못했습니다.', 400)
  }

  const aKey = String(body.a ?? '').trim()
  const bKey = String(body.b ?? '').trim()
  const verdict = String(body.verdict ?? '').trim()
  const reason = String(body.reason ?? '').trim().slice(0, 2000)

  const fields = {}
  if (!aKey || !bKey) fields.a = '견줄 신청서 둘이 필요합니다.'
  if (!COMPARE_VERDICTS.includes(verdict)) {
    fields.verdict = `판정은 ${COMPARE_VERDICTS.join(' 또는 ')} 중 하나여야 합니다.`
  }
  // 근거 없는 판정은 남길 가치가 없다. 나중에 이 기록을 보는 사람이
  // "왜 다른 건이라고 했지"를 물으면 답이 있어야 한다.
  if (reason.length < 5) {
    fields.reason = '왜 그렇게 판정했는지 한 줄이라도 적어주세요.'
  }
  if (Object.keys(fields).length > 0) {
    return failFields(fields, '적어주신 것을 다시 확인해주세요.')
  }

  try {
    const [a, b] = await Promise.all([findOne(env, aKey), findOne(env, bKey)])
    if (!a || !b) return jsonError('그 신청서를 찾지 못했습니다.', 404)

    // 어느 쪽 신청서에 붙일 것인가.
    //
    // 나중에 낸 쪽에 붙인다. 먼저 낸 것은 이미 제 갈 길을 가고 있고,
    // 판정이 필요해진 것은 나중 것 때문이다.
    const later = String(a.created_at) >= String(b.created_at) ? a : b
    const earlier = later.id === a.id ? b : a

    const id = await logDecision(env, {
      applicationId: later.id,
      stage: '검토',
      actor: 'human',
      title: `${verdict} — ${later.ticket_no} 와 ${earlier.ticket_no}`,
      what:
        verdict === '같은 건'
          ? `${later.ticket_no}는 ${earlier.ticket_no}와 같은 병목이다. 하나로 본다.`
          : `${later.ticket_no}와 ${earlier.ticket_no}는 말은 비슷하지만 다른 일이다. 따로 본다.`,
      why: reason,
      alternatives: VERDICT_MEANING[verdict === '같은 건' ? '다른 건' : '같은 건'],
      linkKind: 'compare',
      linkId: pairKey(a.id, b.id),
    })

    return jsonResponse({ ok: true, id, verdict, applicationId: later.id })
  } catch (err) {
    return failUnexpected(err, '판정을 남기지 못했습니다.')
  }
}
