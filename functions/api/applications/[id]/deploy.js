// 7단계 — 인수인계 기록.
//
// 넘긴 것으로 끝나지 않는다. 넘긴 뒤에 실제로 쓰이는지, 실패하는지, 부서가
// 받았다고 확인했는지가 남아야 인수인계다. 아무도 안 쓰는 도구를 만들어 놓고
// 성과를 말하는 일이 흔하다.

import { jsonResponse, jsonError, failFields } from '../../../_lib/http.js'
import { slugify } from '../../../_lib/ids.js'
import { logDecision } from '../../../_lib/decisions.js'

async function findApplication(env, id) {
  return env.DB.prepare(
    'SELECT id, ticket_no, dept, title, status FROM application WHERE id = ? OR ticket_no = ?'
  )
    .bind(id, id)
    .first()
}

export async function onRequestGet({ env, params }) {
  const app = await findApplication(env, params.id)
  if (!app) return jsonError('그런 신청서가 없습니다.', 404)

  try {
    const [handover, uses, stats, manual, lastBeta, stakeholders] = await Promise.all([
      env.DB.prepare('SELECT * FROM handover WHERE application_id = ?').bind(app.id).first(),
      env.DB.prepare(
        'SELECT * FROM tool_use WHERE application_id = ? ORDER BY used_at DESC LIMIT 50'
      )
        .bind(app.id)
        .all(),
      env.DB.prepare(
        `SELECT COUNT(*) AS runs,
                SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) AS failures,
                SUM(rows_out) AS rows_total,
                SUM(quarantined) AS quarantine_total,
                AVG(duration_ms) AS avg_ms,
                MAX(used_at) AS last_used
         FROM tool_use WHERE application_id = ?`
      )
        .bind(app.id)
        .first(),
      env.DB.prepare('SELECT published_at FROM manual WHERE application_id = ?')
        .bind(app.id)
        .first(),
      env.DB.prepare(
        'SELECT seq, overall FROM beta_round WHERE application_id = ? ORDER BY seq DESC LIMIT 1'
      )
        .bind(app.id)
        .first(),
      env.DB.prepare('SELECT dept, person_label FROM stakeholder WHERE application_id = ?')
        .bind(app.id)
        .all(),
    ])

    // 넘기기 전에 지켜야 할 것들. 서버가 판단한다.
    const blockers = []
    if (lastBeta?.overall !== '통과') blockers.push('베타 테스트를 아직 통과하지 않았습니다.')
    if (!manual?.published_at) blockers.push('사용법서를 아직 확정하지 않았습니다.')

    return jsonResponse({
      application: app,
      handover: handover ?? null,
      uses: uses.results.map((u) => ({ ...u, files: safeParse(u.files_json, []) })),
      stats: {
        runs: stats?.runs ?? 0,
        failures: stats?.failures ?? 0,
        rowsTotal: stats?.rows_total ?? 0,
        quarantineTotal: stats?.quarantine_total ?? 0,
        avgMs: stats?.avg_ms ?? null,
        lastUsed: stats?.last_used ?? null,
      },
      stakeholders: stakeholders.results,
      canHandOver: blockers.length === 0,
      blockers,
    })
  } catch (err) {
    return jsonError(`인수인계 기록을 불러오지 못했습니다. (${String(err.message).slice(0, 160)})`, 503)
  }
}

export async function onRequestPost({ env, params, request }) {
  const app = await findApplication(env, params.id)
  if (!app) return jsonError('그런 신청서가 없습니다.', 404)

  let body
  try {
    body = await request.json()
  } catch {
    return jsonError('요청 형식이 올바르지 않습니다.', 400)
  }

  const t = (v) => String(v ?? '').trim()

  try {
    // 넘기기
    if (body.kind === 'hand_over') {
      const [manual, lastBeta] = await Promise.all([
        env.DB.prepare('SELECT published_at FROM manual WHERE application_id = ?')
          .bind(app.id)
          .first(),
        env.DB.prepare(
          'SELECT overall FROM beta_round WHERE application_id = ? ORDER BY seq DESC LIMIT 1'
        )
          .bind(app.id)
          .first(),
      ])
      const blockers = []
      if (lastBeta?.overall !== '통과') blockers.push('베타 테스트를 아직 통과하지 않았습니다.')
      if (!manual?.published_at) blockers.push('사용법서를 아직 확정하지 않았습니다.')
      if (blockers.length > 0) {
        return jsonResponse({ error: '아직 넘길 수 없습니다.', blockers }, 400)
      }

      if (!t(body.handed_to_dept) || !t(body.handed_to_person)) {
        return failFields({ handed_to_person: '누구에게 넘기는지 적어주세요.' })
      }

      const existing = await env.DB.prepare('SELECT slug FROM handover WHERE application_id = ?')
        .bind(app.id)
        .first()
      // 주소는 한 번 정해지면 바꾸지 않는다. 부서가 즐겨찾기에 넣어 뒀을 것이다.
      const slug = existing?.slug ?? slugify(t(body.slug) || 'settlement', 'tool')

      await env.DB.prepare(
        `INSERT INTO handover
           (application_id, slug, title, handed_to_dept, handed_to_person,
            daily_limit, max_file_mb, note, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(application_id) DO UPDATE SET
           title = excluded.title,
           handed_to_dept = excluded.handed_to_dept,
           handed_to_person = excluded.handed_to_person,
           daily_limit = excluded.daily_limit,
           max_file_mb = excluded.max_file_mb,
           note = excluded.note,
           rolled_back_at = NULL,
           rollback_reason = NULL,
           updated_at = datetime('now')`
      )
        .bind(
          app.id,
          slug,
          t(body.title) || app.title,
          t(body.handed_to_dept),
          t(body.handed_to_person),
          Number(body.daily_limit) || 20,
          Number(body.max_file_mb) || 10,
          t(body.note) || null
        )
        .run()

      await logDecision(env, {
        applicationId: app.id,
        stage: '배포',
        title: '부서에 넘겼다',
        what: `${t(body.handed_to_dept)} ${t(body.handed_to_person)}에게 넘겼다. 주소 /t/${slug}`,
        why: '베타를 통과했고 사용법서를 확정했다. 여기서부터 이 도구의 주인은 부서다.',
        linkKind: 'handover',
        linkId: app.id,
      }).catch(() => {})

      return jsonResponse({ ok: true, slug }, 201)
    }

    // 부서가 받았다고 확인
    if (body.kind === 'accept') {
      await env.DB.prepare(
        `UPDATE handover SET accepted_at = datetime('now'), accepted_by = ?, updated_at = datetime('now')
         WHERE application_id = ?`
      )
        .bind(t(body.accepted_by) || '부서 담당자', app.id)
        .run()
      await env.DB.prepare(
        "UPDATE application SET status = '완료', updated_at = datetime('now') WHERE id = ?"
      )
        .bind(app.id)
        .run()
      return jsonResponse({ ok: true })
    }

    // 되돌리기
    if (body.kind === 'rollback') {
      if (!t(body.reason)) return failFields({ reason: '왜 되돌리는지 적어주세요.' })
      await env.DB.prepare(
        `UPDATE handover SET rolled_back_at = datetime('now'), rollback_reason = ?, updated_at = datetime('now')
         WHERE application_id = ?`
      )
        .bind(t(body.reason), app.id)
        .run()
      await logDecision(env, {
        applicationId: app.id,
        stage: '배포',
        title: '넘긴 것을 되돌렸다',
        what: '부서가 쓰던 도구를 내렸다.',
        why: t(body.reason),
        linkKind: 'handover',
        linkId: app.id,
      }).catch(() => {})
      return jsonResponse({ ok: true })
    }

    // 사람이 검토함을 보고 처리한 시간 기록.
    // 이 시간을 빼지 않으면 8단계 절감이 부풀려진다.
    if (body.kind === 'review_time') {
      await env.DB.prepare(
        `UPDATE tool_use SET human_review_seconds = ?, rework_seconds = ?
         WHERE id = ? AND application_id = ?`
      )
        .bind(
          Number(body.human_review_seconds) || 0,
          Number(body.rework_seconds) || 0,
          t(body.id),
          app.id
        )
        .run()
      return jsonResponse({ ok: true })
    }

    return jsonError('무엇을 저장할지 알 수 없습니다.', 400)
  } catch (err) {
    return jsonError(`저장하지 못했습니다. (${String(err.message).slice(0, 200)})`, 500)
  }
}

function safeParse(text, fallback) {
  try {
    return text ? JSON.parse(text) : fallback
  } catch {
    return fallback
  }
}
