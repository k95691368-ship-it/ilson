// 보류해 둔 신청서의 조건이 풀렸다고 부서가 알린다.
//
// 검토에서 보류를 하면 조회 화면은 "보류 조건이 풀리면 알려주세요"라고
// 적는다. 그런데 알릴 자리가 아무 데도 없었다.
//
// 수령 확인·시험판 의견과 다른 점이 하나 있다. 저 둘은 담당자가 대신이라도
// 누를 수 있었는데, **조건이 풀렸는지는 부서만 안다.** 담당자가 한 달에 한 번
// 전화를 돌리지 않는 한 보류함은 조용히 무덤이 된다.
//
// 로그인이 없다. 접수번호를 아는 사람이 그 신청서의 부서라고 본다 —
// 수령 확인·성과 확인과 같은 규칙이다.

import { jsonResponse, jsonError, failFields, failUnexpected } from '../../../_lib/http.js'
import { newId } from '../../../_lib/ids.js'
import { checkRateLimit, releaseRateLimit } from '../../../_lib/rateLimit.js'
import {
  validateHoldLift,
  holdState,
  BULK_HOLD_KIND,
  liftKindOf,
  HOLD_LIFT_KIND,
  HOLD_LIFT_CANCEL_KIND,
} from '../../../../shared/holdlift.js'

async function load(env, ticket) {
  const app = await env.DB.prepare(
    'SELECT id, ticket_no, dept, title, status FROM application WHERE ticket_no = ?'
  )
    .bind(ticket)
    .first()
  if (!app) return null

  const [review, records, bulkRows] = await Promise.all([
    env.DB.prepare(
      'SELECT verdict, hold_until_condition, bulk, decided_at, updated_at FROM review WHERE application_id = ?'
    )
      .bind(app.id)
      .first(),
    env.DB.prepare(
      `SELECT id, title, what, alternatives, link_kind, link_id, created_at FROM decision_log
       WHERE application_id = ? AND link_kind IN (?, ?)
       ORDER BY created_at`
    )
      .bind(app.id, HOLD_LIFT_KIND, HOLD_LIFT_CANCEL_KIND)
      .all(),
    // 한 번에 미룬 기록. review 표에 조건이 없는 건은 여기에만 남아 있다.
    // 이걸 안 읽어서 "다시 볼 조건"이 안 보이고 30일 경보도 안 켜졌다.
    env.DB.prepare(
      `SELECT what, link_kind, link_id, created_at FROM decision_log
       WHERE application_id = ? AND link_kind = ?
       ORDER BY created_at`
    )
      .bind(app.id, BULK_HOLD_KIND)
      .all(),
  ])

  const rows = records.results.map((r) => ({
    id: r.id,
    kind: r.link_kind,
    by: r.title,
    body: r.what,
    // 어느 쪽으로 알렸는지는 화면에 안 그려지는 칸에 넣는다. why 칸에 JSON을
    // 넣어 첫 화면에 그대로 찍힌 적이 있다.
    liftKind: r.alternatives || null,
    at: r.created_at,
  }))

  return { app, review, records: rows, decisions: bulkRows.results }
}

export async function onRequestGet({ env, params }) {
  const loaded = await load(env, String(params.ticket ?? '').trim().toUpperCase())
  if (!loaded) return jsonError('그 접수번호를 찾지 못했습니다.', 404)
  return jsonResponse({
    state: holdState({
      application: loaded.app,
      review: loaded.review,
      records: loaded.records,
      decisions: loaded.decisions,
    }),
  })
}

export async function onRequestPost({ env, request, params }) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown'
  const ticket = await checkRateLimit(env, `holdlift:${ip}`, 10, 3600)
  if (!ticket) return jsonError('알림은 시간당 10회까지 가능합니다.', 429)

  const loaded = await load(env, String(params.ticket ?? '').trim().toUpperCase())
  if (!loaded) {
    await releaseRateLimit(env, `holdlift:${ip}`, ticket)
    return jsonError('그 접수번호를 찾지 못했습니다.', 404)
  }

  // 보류가 아닌 것에 "조건이 풀렸다"는 말이 오면 담당자는 무엇을 두고 하신
  // 말인지 모른다.
  if (loaded.app.status !== '보류') {
    await releaseRateLimit(env, `holdlift:${ip}`, ticket)
    return jsonError('이 신청서는 지금 보류 상태가 아닙니다. 화면을 새로 열어 보세요.', 409)
  }

  let body
  try {
    body = await request.json()
  } catch {
    await releaseRateLimit(env, `holdlift:${ip}`, ticket)
    return jsonError('보내주신 내용을 읽지 못했습니다.', 400)
  }

  // 잘못 눌렀을 때 되돌릴 자리가 없으면 부서는 아예 안 누른다.
  if (body.kind === 'cancel') {
    const by = String(body.by ?? '').trim().slice(0, 60)
    if (by.length < 2) {
      await releaseRateLimit(env, `holdlift:${ip}`, ticket)
      return failFields({ by: '취소하시는 분 성함을 적어주세요.' }, '적어 주신 내용을 확인해주세요.')
    }
    try {
      await env.DB.prepare(
        `INSERT INTO decision_log
           (id, application_id, stage, actor, title, what, why, link_kind, link_id)
         VALUES (?, ?, '검토', 'human', ?, ?, ?, ?, ?)`
      )
        .bind(
          newId('dec'),
          loaded.app.id,
          by,
          '앞서 알려주신 것을 거두셨습니다.',
          '잘못 눌렀을 때 되돌릴 자리가 없으면 부서는 아예 안 누른다.',
          HOLD_LIFT_CANCEL_KIND,
          loaded.app.id
        )
        .run()
      const after = await load(env, loaded.app.ticket_no)
      return jsonResponse({
        ok: true,
        state: holdState({
          application: after.app,
          review: after.review,
          records: after.records,
          decisions: after.decisions,
        }),
        message: '거두었습니다. 다시 알려주셔도 됩니다.',
      })
    } catch (err) {
      await releaseRateLimit(env, `holdlift:${ip}`, ticket)
      return failUnexpected(err, '거두지 못했습니다.')
    }
  }

  const errors = validateHoldLift(body)
  if (Object.keys(errors).length > 0) {
    await releaseRateLimit(env, `holdlift:${ip}`, ticket)
    return failFields(errors, '적어 주신 내용을 확인해주세요.')
  }

  const by = String(body.by).trim().slice(0, 60)
  const kind = liftKindOf(body.kind)
  const said = String(body.body).trim().slice(0, 1000)

  try {
    await env.DB.prepare(
      `INSERT INTO decision_log
         (id, application_id, stage, actor, title, what, why, alternatives, link_kind, link_id)
       VALUES (?, ?, '검토', 'human', ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        newId('dec'),
        loaded.app.id,
        by,
        `${kind.label} — ${said}`,
        '조건이 풀린 것은 부서만 안다. 저희가 모르면 이 신청서는 미뤄 둔 채로 그대로 묻힌다.',
        kind.code,
        HOLD_LIFT_KIND,
        loaded.app.id
      )
      .run()

    const after = await load(env, loaded.app.ticket_no)
    return jsonResponse({
      ok: true,
      state: holdState({
          application: after.app,
          review: after.review,
          records: after.records,
          decisions: after.decisions,
        }),
      message: kind.ready
        ? '알려주셔서 고맙습니다. 담당자 할 일 목록에 올려 두었습니다 — 다시 판정하면 이 화면에 뜹니다.'
        : '알려주셔서 고맙습니다. 조건은 그대로여도 사정이 달라진 것은 판정에 반영됩니다.',
    })
  } catch (err) {
    await releaseRateLimit(env, `holdlift:${ip}`, ticket)
    return failUnexpected(err, '알리지 못했습니다.')
  }
}
