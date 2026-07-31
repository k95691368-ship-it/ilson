// 5단계 — 베타 테스트 기록.
//
// 채점은 브라우저에서 돈다(shared/grade.js). 여기는 그 결과를 회차로 남기고,
// 현업 담당자가 실제로 써 보고 한 말을 모으는 자리다.

import { jsonResponse, jsonError, failFields } from '../../../_lib/http.js'
import { newId } from '../../../_lib/ids.js'
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
    const [rounds, criteria, latestBuild, feedback] = await Promise.all([
      env.DB.prepare('SELECT * FROM beta_round WHERE application_id = ? ORDER BY seq DESC')
        .bind(app.id)
        .all(),
      env.DB.prepare(
        `SELECT id, ord, body, check_kind, check_key, is_required_safety, confirmed_at
         FROM acceptance_criterion WHERE application_id = ? AND confirmed_at IS NOT NULL
         ORDER BY ord`
      )
        .bind(app.id)
        .all(),
      env.DB.prepare(
        'SELECT id, seq, rows_out, quarantined, created_at FROM build_run WHERE application_id = ? ORDER BY seq DESC LIMIT 1'
      )
        .bind(app.id)
        .first(),
      env.DB.prepare(
        'SELECT * FROM beta_feedback WHERE application_id = ? ORDER BY created_at DESC'
      )
        .bind(app.id)
        .all(),
    ])

    let results = []
    if (rounds.results.length > 0) {
      const { results: rows } = await env.DB.prepare(
        'SELECT * FROM beta_result WHERE round_id = ? ORDER BY ord'
      )
        .bind(rounds.results[0].id)
        .all()
      results = rows.map((r) => ({ ...r, samples: safeParse(r.samples_json, []) }))
    }

    return jsonResponse({
      application: app,
      criteria: criteria.results,
      rounds: rounds.results,
      latestResults: results,
      latestBuild: latestBuild ?? null,
      feedback: feedback.results,
      // 합격 기준을 확정하지 않았으면 채점할 것이 없다.
      canTest: criteria.results.length > 0,
    })
  } catch (err) {
    return jsonError(`베타 기록을 불러오지 못했습니다. (${String(err.message).slice(0, 160)})`, 503)
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

  // 현업 담당자 피드백
  if (body.kind === 'feedback') {
    if (!t(body.body)) return failFields({ body: '무슨 말씀이었는지 적어주세요.' })
    const id = newId('fbk')
    try {
      await env.DB.prepare(
        `INSERT INTO beta_feedback (id, application_id, round_id, dept, person_label, body, kind)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          id,
          app.id,
          t(body.round_id) || null,
          t(body.dept) || app.dept,
          t(body.person_label) || '담당자',
          t(body.body),
          ['의견', '막힌곳', '요청', '칭찬'].includes(t(body.feedback_kind))
            ? t(body.feedback_kind)
            : '의견'
        )
        .run()
      return jsonResponse({ ok: true, id }, 201)
    } catch (err) {
      return jsonError(`저장하지 못했습니다. (${String(err.message).slice(0, 160)})`, 500)
    }
  }

  if (body.kind === 'resolve_feedback') {
    try {
      await env.DB.prepare(
        `UPDATE beta_feedback SET resolved_at = datetime('now'), resolution = ?
         WHERE id = ? AND application_id = ?`
      )
        .bind(t(body.resolution) || null, t(body.id), app.id)
        .run()
      return jsonResponse({ ok: true })
    } catch (err) {
      return jsonError(`저장하지 못했습니다. (${String(err.message).slice(0, 160)})`, 500)
    }
  }

  // 채점 회차 기록
  if (body.kind !== 'round') return jsonError('무엇을 저장할지 알 수 없습니다.', 400)

  const graded = Array.isArray(body.graded) ? body.graded : []
  const s = body.summary ?? {}
  if (graded.length === 0) return jsonError('채점 결과가 없습니다.', 400)

  try {
    const seq =
      ((
        await env.DB.prepare('SELECT MAX(seq) AS n FROM beta_round WHERE application_id = ?')
          .bind(app.id)
          .first()
      )?.n ?? 0) + 1

    const roundId = newId('bta')

    await env.DB.prepare(
      `INSERT INTO beta_round
         (id, application_id, seq, build_run_id, overall, total, passed, failed,
          safety_failed, human_needed, duration_ms, fixed_what, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        roundId,
        app.id,
        seq,
        t(body.build_run_id) || null,
        ['통과', '조건부', '차단'].includes(s.overall) ? s.overall : '차단',
        s.total ?? graded.length,
        s.passed ?? 0,
        s.failed ?? 0,
        s.safetyFailed ?? 0,
        s.humanNeeded ?? 0,
        s.durationMs ?? null,
        t(body.fixed_what) || null,
        t(body.note) || null
      )
      .run()

    await env.DB.batch(
      graded.map((g) =>
        env.DB.prepare(
          `INSERT INTO beta_result
             (id, round_id, criterion_id, ord, body, check_key, check_kind,
              is_required_safety, verdict, evidence, samples_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          newId('bres'),
          roundId,
          g.id ?? null,
          g.ord ?? 0,
          g.body,
          g.check_key ?? null,
          g.kind ?? 'rule',
          g.is_required_safety ? 1 : 0,
          g.verdict,
          g.evidence ?? null,
          JSON.stringify(g.samples ?? [])
        )
      )
    )

    // 차단된 회차는 기록에 남긴다. 무엇 때문에 막혔는지가 다음에 무엇을
    // 고쳐야 하는지다.
    if (s.overall === '차단') {
      const broken = graded
        .filter((g) => g.verdict === '실패' && g.is_required_safety)
        .map((g) => g.body)
      await logDecision(env, {
        applicationId: app.id,
        stage: '베타테스트',
        title: `${seq}차 베타에서 배포를 막았다`,
        what: `필수 안전 기준 ${broken.length}개가 깨졌다: ${broken.join(' / ')}`,
        why: '필수 안전으로 정한 기준은 하나만 깨져도 막는다. 다른 점수가 아무리 좋아도 마찬가지다. 금액이 틀린 표는 없느니만 못하다.',
        linkKind: 'beta_round',
        linkId: roundId,
      }).catch(() => {})
    }

    if (s.overall === '통과') {
      await env.DB.prepare(
        "UPDATE application SET status = '진행중', updated_at = datetime('now') WHERE id = ?"
      )
        .bind(app.id)
        .run()
        .catch(() => {})
    }

    return jsonResponse({ ok: true, round_id: roundId, seq, overall: s.overall }, 201)
  } catch (err) {
    return jsonError(`채점 결과를 저장하지 못했습니다. (${String(err.message).slice(0, 200)})`, 500)
  }
}

function safeParse(text, fallback) {
  try {
    return text ? JSON.parse(text) : fallback
  } catch {
    return fallback
  }
}
