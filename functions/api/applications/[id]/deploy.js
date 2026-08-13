// 7단계 — 인수인계 기록.
//
// 넘긴 것으로 끝나지 않는다. 넘긴 뒤에 실제로 쓰이는지, 실패하는지, 부서가
// 받았다고 확인했는지가 남아야 인수인계다. 아무도 안 쓰는 도구를 만들어 놓고
// 성과를 말하는 일이 흔하다.

import { jsonResponse, jsonError, failFields } from '../../../_lib/http.js'
import { slugify, newId } from '../../../_lib/ids.js'
import { logDecision } from '../../../_lib/decisions.js'
import { ACCEPT_PROXY_KIND } from '../../../../shared/accept.js'
import { RESTORE_KIND, validateRestore } from '../../../../shared/rollback.js'

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
        quarantineTotal: stats?.quarantine_total ?? 0,
        avgMs: stats?.avg_ms ?? null,
      },
      stakeholders: stakeholders.results,
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

    // 담당자가 **대신** 받았다고 확인
    //
    // 이 버튼을 없애지 않는다. 전화로 확인받고 대신 눌러야 할 때가 실제로
    // 있다. 다만 **대신 눌렀다고 적는다.**
    //
    // 예전에는 여기서 부서 사람 이름을 담당자가 타이핑해 넣었고, 기록에는
    // 그 부서 사람이 확인한 것으로 남았다. 이 사이트가 "넘겼다고 받은 것이
    // 아니다"라고 되풀이하는데, 정작 부서에게는 누를 자리를 안 주고
    // 담당자가 부서 이름으로 대신 눌러 온 것이다.
    //
    // 부서가 직접 누르는 자리는 functions/api/tools/[slug]/accept.js 다.
    if (body.kind === 'accept') {
      const who = t(body.accepted_by) || 'AX 담당자'
      await env.DB.batch([
        env.DB.prepare(
          `UPDATE handover SET accepted_at = datetime('now'), accepted_by = ?, updated_at = datetime('now')
           WHERE application_id = ?`
        ).bind(who, app.id),
        env.DB.prepare(
          "UPDATE application SET status = '완료', updated_at = datetime('now') WHERE id = ?"
        ).bind(app.id),
        env.DB.prepare(
          `INSERT INTO decision_log
             (id, application_id, stage, actor, title, what, why, link_kind, link_id)
           VALUES (?, ?, '배포', 'human', ?, ?, ?, ?, ?)`
        ).bind(
          newId('dec'),
          app.id,
          who,
          t(body.heard_from)
            ? `${t(body.heard_from)}에게 받았다는 말을 듣고 담당자가 대신 확인했습니다.`
            : '담당자가 대신 확인했습니다. 부서가 직접 누른 것은 아닙니다.',
          '대신 누른 확인을 부서 확인과 같은 것으로 세면, "부서가 확인해 줘야 성과다"가 자기 입으로 한 말이 된다.',
          ACCEPT_PROXY_KIND,
          app.id
        ),
      ])
      return jsonResponse({
        ok: true,
        message:
          '대신 확인한 것으로 남겼습니다. 부서가 도구 화면에서 직접 누르면 그때 부서 확인으로 바뀝니다.',
      })
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

    // 고쳐서 다시 올리기.
    //
    // 여태 이 자리가 없었다. 되돌리는 길은 있는데 다시 올리는 길이 없었다.
    // 정확히는 있었는데 아무도 몰랐다 — 위의 넘기기 폼이 저장될 때
    // rolled_back_at 을 조용히 NULL 로 지웠고, 그 버튼 이름이 "고치기"였다.
    //
    // 그게 두 방향으로 나빴다. 다시 올리려는 사람은 그 방법을 모르고,
    // 메모 한 줄만 고치려던 사람은 **자기도 모르게 부서에게 다시 열어 준다.**
    // 일부러 내려 둔 도구가 저장 한 번에 살아난다.
    //
    // 이제 지우는 것은 여기서만 한다. 그리고 무엇을 고쳤는지 받는다 —
    // 부서는 그 도구를 못 믿게 된 채로 기다리고 있었으므로, 다시 열렸다는
    // 말만으로는 안 쓴다.
    if (body.kind === 'restore') {
      const errors = validateRestore({ fixed: body.fixed })
      if (Object.keys(errors).length > 0) return failFields(errors)
      const before = await env.DB.prepare(
        'SELECT rolled_back_at, rollback_reason FROM handover WHERE application_id = ?'
      )
        .bind(app.id)
        .first()
      if (!before?.rolled_back_at) {
        return jsonError('이 도구는 지금 내려가 있지 않습니다. 화면을 새로 열어 보세요.', 409)
      }

      await env.DB.prepare(
        `UPDATE handover
            SET rolled_back_at = NULL, rollback_reason = NULL, updated_at = datetime('now')
          WHERE application_id = ?`
      )
        .bind(app.id)
        .run()

      await logDecision(env, {
        applicationId: app.id,
        stage: '배포',
        title: '고쳐서 다시 올렸다',
        // 내린 이유를 같이 남긴다. 이 두 줄이 붙어 있어야 나중에 "무엇이
        // 문제였고 무엇을 고쳤나"가 한눈에 읽힌다.
        what: t(body.fixed),
        why: `${before.rollback_reason ?? '이유 없이 내렸던 것'} — 이것을 고쳤습니다.`,
        linkKind: RESTORE_KIND,
        linkId: app.id,
      }).catch(() => {})

      return jsonResponse({
        ok: true,
        message: '다시 올렸습니다. 부서 도구 화면에 무엇을 고쳤는지 함께 뜹니다.',
      })
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
