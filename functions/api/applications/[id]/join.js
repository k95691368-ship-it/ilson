// 다른 부서가 "저것도 우리 얘기입니다"라고 손든다.
//
// 새 신청서를 만들지 않는다. 만들면 같은 것이 두 건이 되고 담당자가 두 번
// 판정한다. 있는 신청서에 그 부서의 사정을 붙인다.
//
// 표를 새로 만들지 않고 decision_log에 남긴다. 손든 것도 결정이고, 이
// 사이트는 결정을 한 곳에 모으기로 했다.

import { jsonResponse, jsonError, failFields, failUnexpected } from '../../../_lib/http.js'
import { newId } from '../../../_lib/ids.js'
import { checkRateLimit, releaseRateLimit } from '../../../_lib/rateLimit.js'
import {
  validateJoin,
  joinSummary,
  joinLine,
  joinReceipt,
  normDept,
  JOIN_KIND,
  UNJOIN_KIND,
} from '../../../../shared/join.js'
import { withJosa } from '../../../../shared/korean.js'

async function findApplication(env, id) {
  return env.DB.prepare(
    `SELECT id, ticket_no, dept, title, status, current_minutes, current_people, current_frequency
     FROM application WHERE id = ? OR ticket_no = ?`
  )
    .bind(id, id)
    .first()
}

export async function loadJoins(env, applicationId) {
  const { results } = await env.DB.prepare(
    `SELECT id, title, what, why, link_kind, link_id, created_at
     FROM decision_log WHERE application_id = ? AND link_kind IN (?, ?)
     ORDER BY created_at`
  )
    .bind(applicationId, JOIN_KIND, UNJOIN_KIND)
    .all()

  // 푼 것은 지우지 않는다. 담당자가 "이건 다른 건입니다"로 판정한 것도
  // 기록이고, 그 판정이 맞았는지는 나중에 봐야 알 수 있다.
  const released = new Set(
    results.filter((r) => r.link_kind === UNJOIN_KIND).map((r) => r.link_id)
  )

  return results
    .filter((r) => r.link_kind === JOIN_KIND)
    .map((r) => {
      let detail = {}
      try {
        detail = JSON.parse(r.why)
      } catch {
        // 옛 기록이면 숫자가 없다. 그때는 부서 이름만 세고 시간은 못 센다.
      }
      return {
        id: r.id,
        dept: detail.dept ?? r.title,
        by: detail.by ?? null,
        minutes: detail.minutes ?? null,
        people: detail.people ?? null,
        frequency: detail.frequency ?? null,
        story: r.what,
        at: r.created_at,
        released: released.has(r.id),
      }
    })
}

export async function onRequestGet({ env, params }) {
  const app = await findApplication(env, params.id)
  if (!app) return jsonError('그런 신청서가 없습니다.', 404)

  try {
    const joins = await loadJoins(env, app.id)
    const summary = joinSummary({ application: app, joins })
    return jsonResponse({
      application: { ticket_no: app.ticket_no, dept: app.dept, title: app.title, status: app.status },
      joins,
      summary,
      line: joinLine(summary),
    })
  } catch (err) {
    return jsonError(`손든 부서를 불러오지 못했습니다. (${String(err.message).slice(0, 160)})`, 503)
  }
}

export async function onRequestPost({ env, request, params }) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown'
  const ticket = await checkRateLimit(env, `join:${ip}`, 10, 3600)
  if (!ticket) return jsonError('손들기는 시간당 10회까지 가능합니다.', 429)

  const app = await findApplication(env, params.id)
  if (!app) {
    await releaseRateLimit(env, `join:${ip}`, ticket)
    return jsonError('그런 신청서가 없습니다.', 404)
  }

  let body
  try {
    body = await request.json()
  } catch {
    await releaseRateLimit(env, `join:${ip}`, ticket)
    return jsonError('보내주신 내용을 읽지 못했습니다.', 400)
  }

  // 담당자가 "이건 다른 건입니다"로 푸는 길.
  //
  // 이게 없으면 잘못 붙은 것을 영영 못 뗀다. 그러면 그 부서 몫이 남의
  // 신청서에 계속 세어지고, 정작 그 부서는 자기 신청서를 안 냈다.
  if (body.kind === 'release') {
    const joinId = String(body.join_id ?? '').trim()
    if (!joinId) return jsonError('어느 것을 푸실지 알 수 없습니다.', 400)
    const reason = String(body.reason ?? '').trim()
    if (reason.length < 5) {
      return failFields(
        { reason: '왜 다른 건인지 적어주세요. 이 문장이 그 부서에 갑니다.' },
        '적어 주신 내용을 확인해주세요.'
      )
    }
    try {
      await env.DB.prepare(
        `INSERT INTO decision_log
           (id, application_id, stage, actor, title, what, why, link_kind, link_id)
         VALUES (?, ?, '검토', 'human', ?, ?, ?, ?, ?)`
      )
        .bind(
          newId('dec'),
          app.id,
          String(body.by ?? 'AX 담당자').trim().slice(0, 60),
          reason.slice(0, 1000),
          '잘못 붙은 것을 못 떼면 그 부서 몫이 남의 신청서에 계속 세어지고, 정작 그 부서는 자기 신청서를 안 낸 상태로 남는다.',
          UNJOIN_KIND,
          joinId
        )
        .run()

      const joins = await loadJoins(env, app.id)
      const summary = joinSummary({ application: app, joins })
      return jsonResponse({
        ok: true,
        joins,
        summary,
        line: joinLine(summary),
        message: '풀었습니다. 그 부서에는 따로 내 주시라고 알려야 합니다.',
      })
    } catch (err) {
      return failUnexpected(err, '풀지 못했습니다.')
    }
  }

  const errors = validateJoin(body)
  if (Object.keys(errors).length > 0) {
    await releaseRateLimit(env, `join:${ip}`, ticket)
    return failFields(errors, '적어 주신 내용을 확인해주세요.')
  }

  const t = (v) => String(v ?? '').trim()
  const detail = {
    dept: t(body.dept).slice(0, 40),
    by: t(body.by).slice(0, 40),
    minutes: Number(body.minutes),
    people: Number(body.people) > 0 ? Number(body.people) : 1,
    frequency: t(body.frequency) || null,
  }

  try {
    // 같은 부서가 이미 손들었으면 또 안 받는다. 한 부서가 두 번 세어지면
    // 이 병목이 실제보다 커 보인다.
    //
    // 완전일치로만 보다가 "마케팅"과 "마케팅팀"이 둘 다 접수됐다.
    // 표기 흔들림을 흡수해서 본다.
    const joins = await loadJoins(env, app.id)
    const key = normDept(detail.dept)

    // 낸 부서가 자기 신청서에 다시 손드는 것도 막는다. 손들기 폼의 부서
    // 칸이 쓰던 초안의 부서로 미리 채워져 있어서 실제로 일어난다.
    if (key && key === normDept(app.dept)) {
      await releaseRateLimit(env, `join:${ip}`, ticket)
      return jsonError(
        `${withJosa(app.dept, '가')} 낸 신청서입니다. 손드실 필요 없이 이미 그쪽 일로 세고 있습니다.`,
        409
      )
    }
    if (joins.some((j) => !j.released && normDept(j.dept) === key)) {
      await releaseRateLimit(env, `join:${ip}`, ticket)
      return jsonError(`${withJosa(detail.dept, '는')} 이미 손드셨습니다. 두 번 세지 않습니다.`, 409)
    }

    await env.DB.prepare(
      `INSERT INTO decision_log
         (id, application_id, stage, actor, title, what, why, link_kind, link_id)
       VALUES (?, ?, '신청서', 'human', ?, ?, ?, ?, ?)`
    )
      .bind(
        newId('dec'),
        app.id,
        `${detail.dept} — 우리도 같은 일을 겪는다`,
        t(body.story).slice(0, 1000),
        // 숫자는 JSON으로 넣는다. 문장에 섞어 넣으면 나중에 다시 셀 때
        // 글자를 뒤져야 하고, 문구를 고치는 날 조용히 틀린다.
        JSON.stringify(detail),
        JOIN_KIND,
        app.id
      )
      .run()

    const after = await loadJoins(env, app.id)
    const summary = joinSummary({ application: app, joins: after })
    return jsonResponse(
      {
        ok: true,
        ticket_no: app.ticket_no,
        summary,
        message: joinReceipt({
          ticket: app.ticket_no,
          dept: detail.dept,
          deptCount: summary.deptCount,
        }),
      },
      201
    )
  } catch (err) {
    await releaseRateLimit(env, `join:${ip}`, ticket)
    return failUnexpected(err, '손드신 것을 남기지 못했습니다.')
  }
}
