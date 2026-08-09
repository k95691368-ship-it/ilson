// 무엇을 먼저 할 것인가.
//
// 판정은 한 건씩 한다. 그런데 "수용"이 여러 건 쌓이면 그다음 질문이 온다 —
// 이 중에 무엇부터 하나. 판단 재료는 이미 다 있는데(임팩트·난이도 점수,
// 부서들이 적어 준 연간 시간) 한 판에 놓고 보는 자리가 없었다.
//
// 표를 새로 만들지 않는다. 점수는 review에 있고, 시간은 손들기 기록에
// 있고, 먼저 하기로 정한 것은 decision_log에 남긴다.

import { jsonResponse, jsonError, failFields, failUnexpected } from '../_lib/http.js'
import { newId } from '../_lib/ids.js'
import { annualHours } from '../_lib/applications.js'
import {
  boardItems,
  boardNotes,
  validatePick,
  pickedState,
  PICK_KIND,
  UNPICK_KIND,
} from '../../shared/priority.js'
import { JOIN_KIND, UNJOIN_KIND, annualHoursOf, normDept } from '../../shared/join.js'

async function load(env) {
  const [apps, reviews, logs] = await Promise.all([
    env.DB.prepare(
      `SELECT id, ticket_no, dept, title, status,
              current_minutes, current_people, current_frequency
       FROM application ORDER BY created_at DESC`
    ).all(),
    env.DB.prepare(
      'SELECT application_id, impact_score, difficulty_score FROM review'
    ).all(),
    env.DB.prepare(
      `SELECT id, application_id, title, what, why, alternatives, link_kind, link_id, created_at
       FROM decision_log WHERE link_kind IN (?, ?, ?, ?)
       ORDER BY created_at`
    )
      .bind(JOIN_KIND, UNJOIN_KIND, PICK_KIND, UNPICK_KIND)
      .all(),
  ])

  const scoreBy = new Map(reviews.results.map((r) => [r.application_id, r]))

  // 손든 부서까지 더한 연간 시간. 신청서 한 건이 실제로 몇 시간짜리인지는
  // 낸 부서 것만으로는 모른다.
  const released = new Set(
    logs.results.filter((l) => l.link_kind === UNJOIN_KIND).map((l) => l.link_id)
  )
  const hours = {}
  const deptCount = {}
  for (const a of apps.results) {
    hours[a.id] = annualHours(a)
    deptCount[a.id] = 1
  }
  for (const l of logs.results) {
    if (l.link_kind !== JOIN_KIND || released.has(l.id)) continue
    let d = {}
    try {
      d = JSON.parse(l.alternatives || l.why)
    } catch {
      // 옛 기록에는 숫자가 없다. 부서 수만 세고 시간은 못 더한다.
    }
    // 낸 부서가 자기 신청서에 손든 옛 기록은 두 번 안 센다.
    const own = apps.results.find((a) => a.id === l.application_id)
    if (own && normDept(d.dept) === normDept(own.dept)) continue

    deptCount[l.application_id] = (deptCount[l.application_id] ?? 1) + 1
    const h = annualHoursOf(d)
    // 하나라도 못 세면 합계를 안 쓴다. 일부만 더한 값을 크기로 그리면
    // 실제보다 작은 점이 된다.
    if (h == null || hours[l.application_id] == null) hours[l.application_id] = null
    else hours[l.application_id] += h
  }

  const applications = apps.results.map((a) => ({
    ...a,
    impact_score: scoreBy.get(a.id)?.impact_score ?? null,
    difficulty_score: scoreBy.get(a.id)?.difficulty_score ?? null,
    dept_count: deptCount[a.id] ?? 1,
  }))

  const picks = logs.results
    .filter((l) => l.link_kind === PICK_KIND || l.link_kind === UNPICK_KIND)
    .map((l) => ({
      id: l.id,
      application_id: l.link_id,
      by: l.title,
      why: l.what,
      at: l.created_at,
      cancelled: l.link_kind === UNPICK_KIND,
    }))

  return { applications, hours, picks }
}

export async function onRequestGet({ env }) {
  try {
    const { applications, hours, picks } = await load(env)
    const board = boardItems({ applications, joins: hours })
    const state = pickedState({ items: board.items, picks })

    return jsonResponse({
      ...board,
      notes: boardNotes(board.items),
      picked: state.picked,
      line: state.line,
      summary: {
        // onBoard·offBoard 를 함께 세고 있었다. 화면은 판 위의 카드를 직접
        // 그리므로 그 둘을 한 번도 안 읽는다.
        picked: state.picked.length,
      },
    })
  } catch (err) {
    return jsonError(`우선순위 판을 만들지 못했습니다. (${String(err.message).slice(0, 160)})`, 503)
  }
}

export async function onRequestPost({ env, request }) {
  let body
  try {
    body = await request.json()
  } catch {
    return jsonError('보내주신 내용을 읽지 못했습니다.', 400)
  }

  const id = String(body.application_id ?? '').trim()
  if (!id) return jsonError('어느 신청서인지 알 수 없습니다.', 400)

  const app = await env.DB.prepare(
    'SELECT id, ticket_no, dept, title FROM application WHERE id = ? OR ticket_no = ?'
  )
    .bind(id, id)
    .first()
  if (!app) return jsonError('그런 신청서가 없습니다.', 404)

  // 정한 것을 무르는 길.
  //
  // 이게 없으면 한 번 정한 순서를 영영 못 바꾼다. 그러면 담당자는 정하기
  // 자체를 안 하게 된다 — 되돌릴 수 없는 것은 아무도 안 누른다.
  if (body.kind === 'cancel') {
    const why = String(body.why ?? '').trim()
    if (why.length < 5) {
      return failFields(
        { why: '왜 무르시는지 적어주세요. 앞서 적으신 이유와 나란히 남습니다.' },
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
          why.slice(0, 1000),
          '정한 것을 무를 수 없으면 담당자는 정하기 자체를 안 한다. 되돌릴 수 없는 것은 아무도 안 누른다.',
          UNPICK_KIND,
          app.id
        )
        .run()
      return jsonResponse({ ok: true, message: '먼저 할 것에서 뺐습니다. 무른 이유도 기록에 남습니다.' })
    } catch (err) {
      return failUnexpected(err, '무르지 못했습니다.')
    }
  }

  const errors = validatePick(body)
  if (Object.keys(errors).length > 0) {
    return failFields(errors, '적어 주신 내용을 확인해주세요.')
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
        String(body.why).trim().slice(0, 1000),
        // 왜 이 기록을 남기는지. 이 사이트가 보여주려는 것이 바로 이것이다.
        '무엇을 먼저 할지 고른 것이 이 일에서 가장 사람다운 판단이다. 점수는 재료일 뿐 순서를 정하지 않는다. 뒤로 밀린 부서가 물어볼 때 답할 것이 있어야 한다.',
        PICK_KIND,
        app.id
      )
      .run()

    return jsonResponse(
      {
        ok: true,
        message: `${app.ticket_no}을 먼저 하기로 정했습니다. 이유가 결정 기록에 남았습니다.`,
      },
      201
    )
  } catch (err) {
    return failUnexpected(err, '정하지 못했습니다.')
  }
}
