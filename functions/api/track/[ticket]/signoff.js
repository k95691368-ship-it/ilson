// 부서가 합격 기준을 직접 확인하고 서명한다.
//
// 협의안 화면은 이 기준을 "부서와 합의해 정한 것"이라고 말한다. 그런데
// 확정은 담당자 혼자 하고 부서는 그 문장을 본 적이 없다. 5단계에서
// "합격 기준을 통과했습니다"라고 말했을 때 부서가 "그런 거 합의한 적
// 없다"고 답하면, 합격 기준은 부서를 설득하는 도구가 아니라 막는 도구가 된다.
//
// 표를 새로 만들지 않고 decision_log에 남긴다. 서명도 결정이고, 이 사이트는
// 결정을 한 곳에 모으기로 했다.

import { jsonResponse, jsonError, failFields, failUnexpected } from '../../../_lib/http.js'
import { newId } from '../../../_lib/ids.js'
import { checkRateLimit, releaseRateLimit } from '../../../_lib/rateLimit.js'
import {
  canAsk,
  validateSignoff,
  signoffState,
  VERDICTS,
  SIGNOFF_KIND,
  OBJECTION_KIND,
} from '../../../../shared/signoff.js'
import { loadSignoff } from '../../../_lib/signoff.js'

async function load(env, ticket) {
  const app = await env.DB.prepare(
    'SELECT id, ticket_no, dept, title, status FROM application WHERE ticket_no = ?'
  )
    .bind(ticket)
    .first()
  if (!app) return null
  return { app, ...(await loadSignoff(env, app.id)) }
}

export async function onRequestGet({ env, params }) {
  const loaded = await load(env, String(params.ticket ?? '').trim().toUpperCase())
  if (!loaded) return jsonError('그 접수번호를 찾지 못했습니다.', 404)

  const state = signoffState(loaded)
  return jsonResponse({
    criteria: loaded.criteria,
    state,
    // 이의가 달린 항목이 어느 것인지, 그리고 담당자가 거기에 뭐라고
    // 답했는지를 같이 준다. 답을 안 보여주면 부서는 자기가 낸 이의가
    // 읽히기는 했는지 알 수 없다.
    objectionsByCriterion: Object.fromEntries(
      loaded.objections.map((o) => [
        o.criterion_id,
        {
          body: o.body,
          answer: loaded.resolutions.find((r) => r.objection_id === o.id) ?? null,
        },
      ])
    ),
  })
}

export async function onRequestPost({ env, request, params }) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown'
  const ticket = await checkRateLimit(env, `signoff:${ip}`, 10, 3600)
  if (!ticket) return jsonError('확인은 시간당 10회까지 가능합니다.', 429)

  let body
  try {
    body = await request.json()
  } catch {
    await releaseRateLimit(env, `signoff:${ip}`, ticket)
    return jsonError('보내주신 내용을 읽지 못했습니다.', 400)
  }

  const loaded = await load(env, String(params.ticket ?? '').trim().toUpperCase())
  if (!loaded) {
    await releaseRateLimit(env, `signoff:${ip}`, ticket)
    return jsonError('그 접수번호를 찾지 못했습니다.', 404)
  }

  // 화면이 막았어도 서버가 다시 본다. 확정 안 된 기준에 서명이 붙으면
  // 나중에 기준이 바뀌는데 서명은 남는다.
  const ask = canAsk(loaded.criteria)
  if (!ask.ok) {
    await releaseRateLimit(env, `signoff:${ip}`, ticket)
    return jsonError(ask.why, 409)
  }

  const errors = validateSignoff({
    by: body.by,
    criteria: loaded.criteria,
    verdicts: body.verdicts,
    reasons: body.reasons,
  })
  if (Object.keys(errors).length > 0) {
    await releaseRateLimit(env, `signoff:${ip}`, ticket)
    return failFields(errors, '확인해주셔야 할 것이 남았습니다.')
  }

  const by = String(body.by).trim().slice(0, 60)
  const objected = loaded.criteria.filter((c) => VERDICTS[body.verdicts[c.id]]?.needsReason)

  try {
    const stmts = [
      env.DB.prepare(
        `INSERT INTO decision_log
           (id, application_id, stage, actor, title, what, why, link_kind, link_id)
         VALUES (?, ?, '협의안', 'human', ?, ?, ?, ?, ?)`
      ).bind(
        newId('dec'),
        loaded.app.id,
        by,
        objected.length > 0
          ? `합격 기준 ${loaded.criteria.length}개를 확인했다. ${objected.length}개에 이의를 달았다.`
          : `합격 기준 ${loaded.criteria.length}개를 모두 확인했고 이의 없다.`,
        '담당자 혼자 정한 기준으로 통과 판정을 내리면, 부서가 아니라고 할 때 통과의 근거가 사라진다.',
        SIGNOFF_KIND,
        loaded.app.id
      ),
    ]

    for (const c of objected) {
      stmts.push(
        env.DB.prepare(
          `INSERT INTO decision_log
             (id, application_id, stage, actor, title, what, why, link_kind, link_id)
           VALUES (?, ?, '협의안', 'human', ?, ?, ?, ?, ?)`
        ).bind(
          newId('dec'),
          loaded.app.id,
          `${by} — 이 기준은 아니라고 하셨다`,
          String(body.reasons?.[c.id] ?? '').trim().slice(0, 1000),
          `원래 기준: ${c.body}`,
          OBJECTION_KIND,
          c.id
        )
      )
    }

    await env.DB.batch(stmts)

    const after = await load(env, loaded.app.ticket_no)
    return jsonResponse({
      ok: true,
      state: signoffState(after),
      message:
        objected.length > 0
          ? `확인해주셔서 고맙습니다. 아니라고 하신 ${objected.length}개는 담당자가 다시 봅니다.`
          : '확인해주셔서 고맙습니다. 이 기준으로 시험하고 판정합니다.',
    })
  } catch (err) {
    await releaseRateLimit(env, `signoff:${ip}`, ticket)
    return failUnexpected(err, '확인을 남기지 못했습니다.')
  }
}
