// 시연용 신청서를 심는다.
//
// 이미 있는 접수번호는 건드리지 않는다. 여러 번 눌러도 같은 상태가 되어야
// 면접 중에 마음 놓고 누를 수 있다.
//
// 심는 것은 신청서까지다. 검토·판정은 심지 않는다 — 그 화면에서 실제로
// 판정해 보이는 것이 이 포트폴리오가 보여주려는 것이기 때문이다.

import { jsonResponse, jsonError } from '../../_lib/http.js'
import { checkRateLimit } from '../../_lib/rateLimit.js'
import { newId } from '../../_lib/ids.js'
import { DEMO_APPLICATIONS } from '../../_lib/demoApplications.js'

export async function onRequestPost({ env, request }) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown'
  const ticket = await checkRateLimit(env, `demo-seed:${ip}`, 8, 3600)
  if (!ticket) {
    return jsonError('시연 데이터 심기는 시간당 8회까지 가능합니다.', 429)
  }

  try {
    const { results: existing } = await env.DB.prepare(
      'SELECT ticket_no FROM application WHERE ticket_no LIKE ?'
    )
      .bind('AX-DEM-%')
      .all()
    const have = new Set(existing.map((r) => r.ticket_no))

    const statements = []
    let added = 0

    for (const a of DEMO_APPLICATIONS) {
      if (have.has(a.ticket_no)) continue
      added += 1
      statements.push(
        env.DB.prepare(
          `INSERT INTO application
             (id, ticket_no, dept, applicant_label, contact, title, bottleneck, problem, wish,
              current_minutes, current_people, current_frequency, impact_if_wrong,
              status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '접수',
                   datetime('now', '-' || ? || ' days'), datetime('now', '-' || ? || ' days'))`
        ).bind(
          newId('app'),
          a.ticket_no,
          a.dept,
          a.applicant_label,
          a.contact ?? null,
          a.title,
          a.bottleneck,
          a.problem,
          a.wish ?? null,
          a.current_minutes,
          a.current_people,
          a.current_frequency,
          a.impact_if_wrong ?? null,
          a.days_ago,
          a.days_ago
        )
      )
    }

    if (statements.length > 0) await env.DB.batch(statements)

    const { results: all } = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM application'
    ).all()

    return jsonResponse({
      ok: true,
      added,
      skipped: DEMO_APPLICATIONS.length - added,
      total: all[0]?.n ?? 0,
    })
  } catch (err) {
    return jsonError(`시연 데이터를 심지 못했습니다. (${String(err.message).slice(0, 200)})`, 500)
  }
}

// 심은 것만 지운다. 사람이 실제로 낸 신청서는 건드리지 않는다.
//
// 접수번호가 AX-DEM- 으로 시작하는 것만 고른다. 이 조건을 넓히면 시연 중
// 실수 한 번으로 실제 신청서가 날아간다.
//
// 딸린 기록은 대부분 표가 알아서 같이 지운다(ON DELETE CASCADE). 그런데
// **결정 기록은 아니다** — 여덟 단계를 관통하려고 일부러 신청서에 매달지
// 않고 만든 표라, 신청서를 지워도 그대로 남는다. 그러면 결정 기록 화면에
// 없는 신청서를 가리키는 줄이 남는다. 손으로 같이 지운다.
export async function onRequestDelete({ env, request }) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown'
  const ticket = await checkRateLimit(env, `demo-seed:${ip}`, 8, 3600)
  if (!ticket) return jsonError('시간당 8회까지 가능합니다.', 429)

  try {
    const { results: targets } = await env.DB.prepare(
      'SELECT id, ticket_no FROM application WHERE ticket_no LIKE ?'
    )
      .bind('AX-DEM-%')
      .all()

    if (targets.length === 0) {
      return jsonResponse({ ok: true, removed: 0, message: '지울 시연 신청서가 없습니다.' })
    }

    const ids = targets.map((t) => t.id)
    const holes = ids.map(() => '?').join(',')

    // 한 묶음으로 돌린다. 따로 돌리다 중간에 끊기면 신청서는 사라졌는데
    // 결정 기록만 남은 상태가 되고, 그건 지금 고치려는 그 상태다.
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM decision_log WHERE application_id IN (${holes})`).bind(...ids),
      env.DB.prepare(`DELETE FROM application WHERE id IN (${holes})`).bind(...ids),
    ])

    return jsonResponse({
      ok: true,
      removed: targets.length,
      message: `시연 신청서 ${targets.length}건과 거기 딸린 결정 기록을 지웠습니다.`,
    })
  } catch (err) {
    return jsonError(`지우지 못했습니다. (${String(err.message).slice(0, 200)})`, 500)
  }
}
