// 두 신청서를 나란히 놓고 견준다. 그리고 그 판정을 기록에 남긴다.
//
// 중복 판정이 "이 둘이 비슷합니다"까지는 말해 준다. 그다음 판단 — 같은
// 건인가, 말만 비슷하고 다른 일인가 — 은 사람이 한다. 그 판단이 사라지면
// 다음 사람이 같은 두 건을 놓고 처음부터 다시 견주게 된다.

import { jsonResponse, jsonError, failFields, failUnexpected } from '../_lib/http.js'
import { compare, COMPARE_VERDICTS, VERDICT_MEANING } from '../../shared/compare.js'
import { pickPrimary, holdCondition, validateUnmerge, MERGE_KIND, UNMERGE_KIND } from '../../shared/merge.js'
import { logDecision } from '../_lib/decisions.js'
import { annualHours, APP_STATUSES } from '../_lib/applications.js'

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
      // 지금 묶여 있는가. 화면이 이걸 알아야 "묶기"를 보여줄지
      // "풀기"를 보여줄지 정할 수 있다.
      merged: await (async () => {
        const rows = await env.DB.prepare(
          `SELECT id, application_id, link_id, link_kind, why, created_at
           FROM decision_log
           WHERE link_kind IN (?, ?) AND application_id IN (?, ?)
           ORDER BY created_at`
        )
          .bind(MERGE_KIND, UNMERGE_KIND, a.id, b.id)
          .all()
        const undone = new Set(
          rows.results.filter((r) => r.link_kind === UNMERGE_KIND).map((r) => r.link_id)
        )
        const live = rows.results
          .filter((r) => r.link_kind === MERGE_KIND && !undone.has(r.id))
          .pop()
        if (!live) return null
        const heldSide = live.application_id === a.id ? a : b
        const primarySide = live.link_id === a.id ? a : b
        return {
          held: heldSide.ticket_no,
          heldStatus: heldSide.status,
          primary: primarySide.ticket_no,
          why: live.why,
          at: live.created_at,
        }
      })(),
      verdicts: COMPARE_VERDICTS.map((v) => ({ verdict: v, meaning: VERDICT_MEANING[v] })),
    })
  } catch (err) {
    return failUnexpected(err, '두 신청서를 견주지 못했습니다.')
  }
}

function verdictAuthor(body) {
  return String(body?.author ?? '').trim().slice(0, 60) || 'AX 담당자'
}

// decision_log는 id를 직접 넣어야 한다. logDecision을 두 번 부르면
// batch 안에서 한 묶음으로 못 돌아서, 상태만 바뀌고 기록이 안 남는 일이
// 생길 수 있다. 그건 가장 나쁜 결과다 — 왜 보류됐는지 아무도 모른다.
function newDecisionId() {
  return `dec_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`
}

// 두 건을 한 짝으로 묶는 이름. 순서를 정해 두지 않으면 A-B와 B-A가 다른
// 짝이 되어, 좌우를 바꿔 열면 전에 내린 판정이 안 보인다.
function pairKey(x, y) {
  return [x, y].sort().join('~')
}

// 잘못 묶었으면 푼다.
//
// 묶는 길만 내고 푸는 길을 안 내면, 한 번 잘못 누른 것을 되돌릴 방법이
// 없다. 그러면 담당자는 무서워서 아예 안 묶는다. 실제로 그랬다 — 진행이
// 앞선 신청서를 접수만 된 것에 묶어 버렸고, 되돌릴 수가 없었다.
export async function onRequestDelete({ env, request }) {
  let body
  try {
    body = await request.json()
  } catch {
    return jsonError('보내주신 내용을 읽지 못했습니다.', 400)
  }

  const ticket = String(body.ticket ?? '').trim()
  const why = String(body.why ?? '').trim().slice(0, 2000)
  const author = String(body.author ?? '').trim().slice(0, 60) || 'AX 담당자'
  const restoreTo = String(body.restoreTo ?? '').trim()

  const fields = validateUnmerge({ why, author })
  if (!ticket) fields.ticket = '어느 신청서를 푸시는지 알려주세요.'
  if (Object.keys(fields).length > 0) {
    return failFields(fields, '적어주신 것을 다시 확인해주세요.')
  }

  try {
    const app = await findOne(env, ticket)
    if (!app) return jsonError('그 신청서를 찾지 못했습니다.', 404)

    const merge = await env.DB.prepare(
      `SELECT id, link_id FROM decision_log
       WHERE application_id = ? AND link_kind = ?
       ORDER BY created_at DESC LIMIT 1`
    )
      .bind(app.id, MERGE_KIND)
      .first()
    if (!merge) return jsonError('그 신청서는 묶여 있지 않습니다.', 409)

    // 이미 푼 것을 또 풀지 않는다.
    const undone = await env.DB.prepare(
      `SELECT id FROM decision_log WHERE link_kind = ? AND link_id = ?`
    )
      .bind(UNMERGE_KIND, merge.id)
      .first()
    if (undone) return jsonError('그 신청서는 이미 푸셨습니다.', 409)

    // 어느 상태로 되돌릴 것인가. 묶기 전 상태를 서버가 알 수 없으므로
    // 담당자가 정한다. 짐작으로 되돌리면 진행 단계가 조용히 틀어진다.
    const next = APP_STATUSES.includes(restoreTo) ? restoreTo : '접수'

    await env.DB.batch([
      env.DB.prepare(
        `UPDATE application SET status = ?, updated_at = datetime('now') WHERE id = ?`
      ).bind(next, app.id),
      env.DB.prepare(
        `INSERT INTO decision_log
           (id, application_id, stage, actor, title, what, why, link_kind, link_id)
         VALUES (?, ?, '검토', 'human', ?, ?, ?, ?, ?)`
      ).bind(
        newDecisionId(),
        app.id,
        author,
        `${app.ticket_no} 를 묶었던 것을 풀고 ${next} 로 되돌립니다.`,
        why,
        UNMERGE_KIND,
        merge.id
      ),
    ])

    return jsonResponse({ ok: true, ticket: app.ticket_no, status: next })
  } catch (err) {
    return failUnexpected(err, '묶은 것을 풀지 못했습니다.')
  }
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

    // "같은 건"이라고만 하고 아무 일도 안 하면, 담당자는 끝났다고 생각하고
    // 부서는 아무 소식이 없다고 생각한다. 둘 다 상대가 뭘 하고 있는 줄 안다.
    //
    // 묶겠다고 하면 실제로 상태를 바꾼다. 반려가 아니라 보류다 — 안 하는
    // 것이 아니라 그쪽에서 함께 하는 것이라서.
    let merged = null
    if (verdict === '같은 건' && body.merge === true) {
      const pick = pickPrimary(a, b)
      if (pick.blocked) {
        return jsonError(pick.blocked, 409)
      }
      await env.DB.batch([
        env.DB.prepare(
          `UPDATE application SET status = '보류', updated_at = datetime('now') WHERE id = ?`
        ).bind(pick.merged.id),
        env.DB.prepare(
          `INSERT INTO decision_log
             (id, application_id, stage, actor, title, what, why, link_kind, link_id)
           VALUES (?, ?, '검토', 'human', ?, ?, ?, ?, ?)`
        ).bind(
          newDecisionId(),
          pick.merged.id,
          verdictAuthor(body),
          holdCondition(pick.primary),
          reason,
          MERGE_KIND,
          pick.primary.id
        ),
      ])
      merged = {
        primary: pick.primary.ticket_no,
        held: pick.merged.ticket_no,
        condition: holdCondition(pick.primary),
      }
    }

    return jsonResponse({ ok: true, id, verdict, applicationId: later.id, merged })
  } catch (err) {
    return failUnexpected(err, '판정을 남기지 못했습니다.')
  }
}
