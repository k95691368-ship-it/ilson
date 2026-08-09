// 6단계 — 사용법서.
//
// 문서의 절반은 저장하지 않고 코드에서 그때그때 뽑는다(shared/manual.js).
// 여기 저장하는 것은 코드가 알 수 없는 것들뿐이다 — 언제 돌리는지, 결과를
// 누구에게 주는지, 막혔을 때 누구에게 연락하는지.

import { jsonResponse, jsonError, failFields } from '../../../_lib/http.js'
import { newId } from '../../../_lib/ids.js'
import { logDecision } from '../../../_lib/decisions.js'
import { autoSections } from '../../../../shared/manual.js'

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
    const [manual, faq, feedback, stakeholders, lastBeta] = await Promise.all([
      env.DB.prepare('SELECT * FROM manual WHERE application_id = ?').bind(app.id).first(),
      env.DB.prepare('SELECT * FROM manual_faq WHERE application_id = ? ORDER BY ord')
        .bind(app.id)
        .all(),
      // 아직 자주 묻는 것으로 옮기지 않은 현업 피드백.
      // 지어낸 질문보다 실제로 나온 질문이 훨씬 쓸모 있다.
      env.DB.prepare(
        `SELECT f.* FROM beta_feedback f
         WHERE f.application_id = ?
           AND f.id NOT IN (SELECT COALESCE(from_feedback_id, '') FROM manual_faq WHERE application_id = ?)
         ORDER BY f.created_at DESC`
      )
        .bind(app.id, app.id)
        .all(),
      env.DB.prepare('SELECT dept, person_label, role_label FROM stakeholder WHERE application_id = ?')
        .bind(app.id)
        .all(),
      env.DB.prepare(
        'SELECT seq, overall, created_at FROM beta_round WHERE application_id = ? ORDER BY seq DESC LIMIT 1'
      )
        .bind(app.id)
        .first(),
    ])

    return jsonResponse({
      application: app,
      manual: manual ?? null,
      faq: faq.results,
      unusedFeedback: feedback.results,
      stakeholders: stakeholders.results,
      // 마지막 베타 회차를 통째로 내려보냈었다. 화면이 읽는 것은 바로
      // 아래 betaPassed 하나다.
      // 코드에서 뽑은 부분. 저장하지 않으므로 절대 낡지 않는다.
      auto: autoSections(),
      // 베타를 통과하지 않았으면 아직 넘길 단계가 아니다.
      betaPassed: lastBeta?.overall === '통과',
    })
  } catch (err) {
    return jsonError(`사용법서를 불러오지 못했습니다. (${String(err.message).slice(0, 160)})`, 503)
  }
}

export async function onRequestPut({ env, params, request }) {
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
    await env.DB.prepare(
      `INSERT INTO manual
         (application_id, title, intro, when_to_run, what_to_do_after, contact, notes, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(application_id) DO UPDATE SET
         title = excluded.title,
         intro = excluded.intro,
         when_to_run = excluded.when_to_run,
         what_to_do_after = excluded.what_to_do_after,
         contact = excluded.contact,
         notes = excluded.notes,
         updated_at = datetime('now')`
    )
      .bind(
        app.id,
        t(body.title) || `${app.title} — 사용법`,
        t(body.intro) || null,
        t(body.when_to_run) || null,
        t(body.what_to_do_after) || null,
        t(body.contact) || null,
        t(body.notes) || null
      )
      .run()

    return jsonResponse({ ok: true })
  } catch (err) {
    return jsonError(`저장하지 못했습니다. (${String(err.message).slice(0, 160)})`, 500)
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

  if (body.kind === 'faq') {
    if (!t(body.question) || !t(body.answer)) {
      return failFields({ answer: '질문과 답을 모두 적어주세요.' })
    }
    try {
      const ord =
        ((
          await env.DB.prepare('SELECT MAX(ord) AS n FROM manual_faq WHERE application_id = ?')
            .bind(app.id)
            .first()
        )?.n ?? 0) + 1
      const id = newId('faq')
      await env.DB.prepare(
        `INSERT INTO manual_faq (id, application_id, ord, question, answer, from_feedback_id)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
        .bind(id, app.id, ord, t(body.question), t(body.answer), t(body.from_feedback_id) || null)
        .run()
      return jsonResponse({ ok: true, id, ord }, 201)
    } catch (err) {
      return jsonError(`저장하지 못했습니다. (${String(err.message).slice(0, 160)})`, 500)
    }
  }

  if (body.kind === 'publish') {
    // 사용법서 없이 넘기는 것을 막는다. 만든 사람이 없으면 못 쓰는 도구는
    // 인수인계가 아니다.
    const manual = await env.DB.prepare('SELECT * FROM manual WHERE application_id = ?')
      .bind(app.id)
      .first()
    const missing = []
    if (!manual) missing.push('사용법서를 아직 쓰지 않았습니다.')
    else {
      if (!manual.when_to_run) missing.push('언제 돌리는지가 비어 있습니다.')
      if (!manual.what_to_do_after) missing.push('결과를 어떻게 쓰는지가 비어 있습니다.')
      if (!manual.contact) missing.push('막혔을 때 연락할 곳이 비어 있습니다.')
    }
    if (missing.length > 0) {
      return jsonResponse({ error: '아직 넘길 수 없습니다.', blockers: missing }, 400)
    }

    await env.DB.prepare(
      "UPDATE manual SET published_at = datetime('now') WHERE application_id = ?"
    )
      .bind(app.id)
      .run()

    await logDecision(env, {
      applicationId: app.id,
      stage: '사용법서',
      title: '사용법서를 확정했다',
      what: '언제 돌리는지, 결과를 어떻게 쓰는지, 막혔을 때 누구에게 연락하는지를 적었다.',
      why: '만든 사람이 없어도 부서가 계속 쓸 수 있어야 인수인계다. 문서 없이 넘기면 한 달 뒤에 아무도 못 쓴다.',
      linkKind: 'manual',
      linkId: app.id,
    }).catch(() => {})

    return jsonResponse({ ok: true })
  }

  return jsonError('무엇을 저장할지 알 수 없습니다.', 400)
}

export async function onRequestDelete({ env, params, request }) {
  const app = await findApplication(env, params.id)
  if (!app) return jsonError('그런 신청서가 없습니다.', 404)

  let body
  try {
    body = await request.json()
  } catch {
    return jsonError('요청 형식이 올바르지 않습니다.', 400)
  }

  try {
    await env.DB.prepare('DELETE FROM manual_faq WHERE id = ? AND application_id = ?')
      .bind(String(body.id ?? ''), app.id)
      .run()
    return jsonResponse({ ok: true })
  } catch (err) {
    return jsonError(`지우지 못했습니다. (${String(err.message).slice(0, 160)})`, 500)
  }
}
