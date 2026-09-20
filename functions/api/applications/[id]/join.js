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
import { DEPTS } from '../../../../shared/depts.js'

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
    `SELECT id, title, what, why, alternatives, link_kind, link_id, created_at
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
  const grants = env.DB.actorEmail
    ? (await env.DB.prepare('SELECT id FROM application_participation WHERE application_id = ? AND revoked_at IS NULL').bind(applicationId).all()).results
    : null
  const verified = grants && new Set(grants.map(row => row.id))

  return results
    .filter((r) => r.link_kind === JOIN_KIND)
    .map((r) => {
      // 숫자는 alternatives에 있다. 옛 기록에는 why에 들어 있어서
      // 둘 다 본다 — 안 그러면 이미 손든 부서의 시간이 통째로 사라진다.
      let detail = {}
      for (const raw of [r.alternatives, r.why]) {
        try {
          const v = JSON.parse(raw)
          if (v && typeof v === 'object') {
            detail = v
            break
          }
        } catch {
          // 이 칸이 아니면 다음 칸을 본다.
        }
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
        ...(verified ? { accessVerified: verified.has(r.id) } : {}),
      }
    })
}

export async function onRequestGet({ env, data: requestData, params }) {
  env = requestData?.requestEnv ?? env
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
      capabilities: { canAuthorizeParticipation: Boolean(env.DB.actorEmail && ['audit', 'executive'].includes(env.AUTH_ACTOR?.role)) },
    })
  } catch (error) {
    return failUnexpected(error, '손든 부서를 불러오지 못했습니다.')
  }
}

export async function onRequestPost({ env, data: requestData, request, params }) {
  env = requestData?.requestEnv ?? env
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown'
  const ticket = await checkRateLimit(env, `join:${ip}`, 10, 3600)
  if (!ticket) return jsonError('손들기는 시간당 10회까지 가능합니다.', 429)
  const refund = async response => {
    await releaseRateLimit(env, `join:${ip}`, ticket)
    return response
  }

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
    if (!joinId) return refund(jsonError('어느 것을 푸실지 알 수 없습니다.', 400))
    const reason = String(body.reason ?? '').trim()
    if (reason.length < 5) {
      return refund(failFields(
        { reason: '왜 다른 건인지 적어주세요. 이 문장이 그 부서에 갑니다.' },
        '적어 주신 내용을 확인해주세요.'
      ))
    }
    try {
      const current = (await loadJoins(env, app.id)).find(join => join.id === joinId && !join.released)
      if (!current) return refund(jsonError('이 신청서에 연결된 참여 기록을 찾지 못했습니다.', 404))
      const statements = [env.DB.prepare(
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
        ]
      if (env.DB.actorEmail) statements.push(env.DB.prepare(
        "UPDATE application_participation SET revoked_at = datetime('now'), revoked_by_email = ? WHERE id = ? AND application_id = ? AND revoked_at IS NULL"
      ).bind(env.AUTH_ACTOR.email, joinId, app.id))
      await env.DB.batch(statements)

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
      return refund(failUnexpected(err, '풀지 못했습니다.'))
    }
  }

  // Old free-form join logs remain evidence, not access grants. An administrator
  // must explicitly confirm their department before enabling collaboration.
  if (body.kind === 'authorize') {
    if (!env.DB.actorEmail || !['audit', 'executive'].includes(env.AUTH_ACTOR?.role)) return refund(jsonError('기존 참여 기록의 권한 확인은 관리자만 할 수 있습니다.', 403))
    try {
      const existing = (await loadJoins(env, app.id)).find(join => join.id === body.join_id && !join.released)
      const department = String(body.dept ?? '').trim()
      if (!existing || !DEPTS.includes(department) || normDept(existing.dept) !== normDept(department)) return refund(jsonError('참여 기록과 확인할 부서를 다시 선택해주세요.', 400))
      if (existing.accessVerified) return refund(jsonResponse({ ok: true, already: true }))
      await env.DB.prepare('INSERT INTO application_participation(id,application_id,department_id,granted_by_email) VALUES(?,?,?,?)')
        .bind(existing.id, app.id, department, env.AUTH_ACTOR.email).run()
      return jsonResponse({ ok: true, message: '확인한 부서에 이 신청서의 기준 조회·서명 권한을 부여했습니다.' }, 201)
    } catch (error) {
      if (error.message.includes('/22023')) return refund(jsonError('관리자가 먼저 이 신청서의 소유 계정을 확인해야 합니다.', 409))
      return refund(failUnexpected(error, '참여 권한을 확인하지 못했습니다.'))
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
  if (env.DB.actorEmail && !DEPTS.includes(detail.dept)) {
    await releaseRateLimit(env, `join:${ip}`, ticket)
    return failFields({ dept: '등록된 부서 목록에서 정확한 부서명을 선택해주세요.' })
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
    const previous = joins.find((j) => !j.released && normDept(j.dept) === key)
    if (previous) {
      await releaseRateLimit(env, `join:${ip}`, ticket)
      if (env.DB.actorEmail && !previous.accessVerified) return jsonError('기존 참여 기록은 접근 권한이 확인되지 않았습니다. 관리자에게 해당 부서의 참여 권한 확인을 요청해주세요.', 409)
      return jsonError(`${withJosa(detail.dept, '는')} 이미 손드셨습니다. 두 번 세지 않습니다.`, 409)
    }

    const joinId = newId('dec')
    const statements = [env.DB.prepare(
      `INSERT INTO decision_log
         (id, application_id, stage, actor, title, what, why, alternatives, link_kind, link_id)
       VALUES (?, ?, '신청서', 'human', ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        joinId,
        app.id,
        `${detail.dept} — 우리도 같은 일을 겪는다`,
        t(body.story).slice(0, 1000),
        // why는 결정 기록 화면에 "왜"로 그대로 그려지는 칸이다.
        //
        // 여기에 JSON을 넣어 뒀었다. 그래서 첫 화면 "최근 결정"과 /log에
        // `{"dept":"재무","minutes":90,...}`이 통째로 찍혔다. 이 사이트가
        // 스스로 핵심 증거라고 내세운 자리에 원시 데이터가 노출됐다.
        '두 부서가 같은 일을 따로 겪고 있으면, 그것은 한 부서 일이 아니라 그만큼 큰 병목이다.',
        // 숫자는 여기 넣는다. 이 칸은 화면에 안 그려진다.
        JSON.stringify(detail),
        JOIN_KIND,
        app.id
      )
      ]
    if (env.DB.actorEmail) statements.push(env.DB.prepare(
      'INSERT INTO application_participation(id,application_id,department_id,granted_by_email) VALUES(?,?,?,?)'
    ).bind(joinId, app.id, detail.dept, env.AUTH_ACTOR.email))
    await env.DB.batch(statements)

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
    if (err.message.includes('/22023')) return jsonError('관리자가 먼저 이 신청서의 소유 계정을 확인해야 합니다.', 409)
    return failUnexpected(err, '손드신 것을 남기지 못했습니다.')
  }
}
