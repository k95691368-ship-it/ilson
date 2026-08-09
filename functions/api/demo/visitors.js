// 보러 오신 분들이 시험 삼아 낸 신청서를 치운다.
//
// 첫 화면에 "직접 눌러 보셔도 됩니다"를 걸어 두고 나니 새 문제가 생겼다.
// 스무 명이 신청서를 한 번씩 내 보면 접수함에 스무 건이 쌓이고, 첫 화면은
// 그걸 "하루 넘게 못 본 신청서 20건"이라고 띄운다. **초대한 결과가 초대한
// 화면을 망친다.**
//
// 치우는 방식이 둘이다.
//
// ① 손 안 댄 것만 — 접수 상태이고 기록이 하나도 안 달린 것. 누가 냈는데
//    그 뒤로 아무 일도 안 일어난 것이 정확히 시험 삼아 낸 것이다. 안전해서
//    확인 없이 지운다.
//
// ② 만져 본 것까지 — 판정하고 되묻고 협의까지 해 본 것도 함께. 이게 없으면
//    초대문의 "어지르셔도 됩니다"가 거짓말이 된다. **초대를 실제로 따라간
//    사람이 만드는 것이 정확히 ①이 못 지우는 자료**이기 때문이다. 읽기만
//    하고 나간 사람의 흔적은 지워지는데, 시키는 대로 눌러 본 사람의 흔적은
//    영영 남는 셈이었다.
//
//    이쪽은 되돌릴 수 없으므로 몸에 뜻을 적어야 실행된다.
//
// 시연 시드(AX-DEM-*)는 어느 쪽에서도 안 건드린다. 그건 옆의 되돌리기 몫이다.

import { jsonResponse, jsonError } from '../../_lib/http.js'
import { DEMO_PREFIX } from '../../../shared/provenance.js'

// 지울 것을 고르는 단 하나의 규칙. 세는 쪽과 지우는 쪽이 같은 문장을 쓴다 —
// 따로 쓰면 "3건 지웁니다" 해 놓고 5건이 사라진다.
const PICK = `
  SELECT a.id, a.ticket_no, a.dept, a.title, a.created_at
  FROM application a
  WHERE a.status = '접수'
    AND a.ticket_no NOT LIKE ?
    AND NOT EXISTS (SELECT 1 FROM decision_log d WHERE d.application_id = a.id)
  ORDER BY a.created_at DESC
`

// 만져 본 것까지. 시연 시드가 아닌 것 전부다.
const PICK_ALL = `
  SELECT a.id, a.ticket_no, a.dept, a.title, a.status, a.created_at
  FROM application a
  WHERE a.ticket_no NOT LIKE ?
  ORDER BY a.created_at DESC
`

// 신청서에 딸린 것들. 자식부터 지운다.
//
// 외래키에 ON DELETE CASCADE 를 걸어 뒀지만 그것에만 기대지 않는다 —
// 마이그레이션이 부분 적용된 환경에서 캐스케이드가 안 걸린 표가 남으면
// 고아 행이 조용히 남는다.
// 신청서를 손자로 두는 표. application_id 가 없어서 부모를 거쳐 지운다.
//
// beta_result 가 그렇다. 이걸 모르고 `DELETE FROM beta_result WHERE
// application_id IN (...)` 을 붙였다가 배치 전체가 터져서 503 이 났다.
// 아래 CHILD_TABLES 는 전부 application_id 를 갖고 있어야 하고,
// tests/schema.test.js 가 그걸 센다.
const GRANDCHILD = [
  { table: 'beta_result', via: 'round_id', parent: 'beta_round' },
]

const CHILD_TABLES = [
  'beta_feedback',
  'beta_round',
  'build_run',
  'tool_use',
  'outcome_challenge',
  'outcome',
  'handover',
  'manual_faq',
  'manual',
  'acceptance_criterion',
  'requirement_conflict',
  'requirement',
  'meeting',
  'stakeholder',
  'shadow_run',
  'baseline',
  'review_ai_draft',
  'review',
  'decision_log',
]

async function pick(env, sql = PICK) {
  const { results } = await env.DB.prepare(sql).bind(`${DEMO_PREFIX}%`).all()
  return results
}

export async function onRequestGet({ env }) {
  try {
    const rows = await pick(env)
    const all = await pick(env, PICK_ALL)
    const touched = all.length - rows.length

    return jsonResponse({
      count: rows.length,
      items: rows,
      // 만져 본 것이 몇 건인지도 같이 준다. 화면이 두 번째 단추를 보일지
      // 말지를 이 숫자로 정한다.
      touched,
      total: all.length,
      // note·touchedNote 로 안내 문장까지 여기서 만들어 보냈었다. 화면은 그
      // 문장을 안 읽는다 — shared/tryit.js 에 적힌 것을 쓴다. 같은 말을 두
      // 군데 두면 한쪽만 고치는 날 서로 다른 말을 하게 된다.
    })
  } catch (err) {
    return jsonError(`세지 못했습니다. (${String(err.message).slice(0, 160)})`, 503)
  }
}

export async function onRequestDelete({ env, request }) {
  // 몸이 없으면 ①이다. 여태 그렇게 불러 왔으므로 그 동작을 안 바꾼다.
  let body = {}
  try {
    body = (await request.json()) ?? {}
  } catch {
    // 몸 없이 부르는 것이 정상이다.
  }

  const deep = body?.deep === true

  try {
    if (!deep) {
      const rows = await pick(env)
      if (rows.length === 0) {
        return jsonResponse({ ok: true, removed: 0, message: '지울 것이 없습니다.' })
      }
      const ids = rows.map((r) => r.id)
      const holes = ids.map(() => '?').join(', ')
      await env.DB.batch([
        env.DB.prepare(`DELETE FROM application WHERE id IN (${holes})`).bind(...ids),
      ])
      return jsonResponse({
        ok: true,
        removed: ids.length,
        message: `시험 삼아 낸 신청서 ${ids.length}건을 지웠습니다.`,
      })
    }

    // 되돌릴 수 없는 쪽. 실수로 눌리지 않게 몸에 뜻을 적게 한다.
    if (body?.confirm !== '만져 본 것까지 지웁니다') {
      return jsonError(
        '되돌릴 수 없습니다. confirm 에 "만져 본 것까지 지웁니다"를 넣어 주세요.',
        400
      )
    }

    const rows = await pick(env, PICK_ALL)
    if (rows.length === 0) {
      return jsonResponse({ ok: true, removed: 0, message: '지울 것이 없습니다.' })
    }

    const ids = rows.map((r) => r.id)
    const holes = ids.map(() => '?').join(', ')
    const statements = []
    // 손자부터. 부모를 거쳐 찾는다.
    for (const g of GRANDCHILD) {
      try {
        await env.DB.prepare(`SELECT 1 FROM ${g.table} LIMIT 1`).first()
      } catch {
        continue
      }
      statements.push(
        env.DB.prepare(
          `DELETE FROM ${g.table} WHERE ${g.via} IN (
             SELECT id FROM ${g.parent} WHERE application_id IN (${holes})
           )`
        ).bind(...ids)
      )
    }
    for (const t of CHILD_TABLES) {
      try {
        // 없는 표가 있을 수 있다. 미리 한 번 두드려 본다.
        await env.DB.prepare(`SELECT 1 FROM ${t} LIMIT 1`).first()
      } catch {
        continue
      }
      statements.push(
        env.DB.prepare(`DELETE FROM ${t} WHERE application_id IN (${holes})`).bind(...ids)
      )
    }
    statements.push(
      env.DB.prepare(`DELETE FROM application WHERE id IN (${holes})`).bind(...ids)
    )
    await env.DB.batch(statements)

    const left = await pick(env, PICK_ALL)
    return jsonResponse({
      ok: true,
      removed: ids.length,
      left: left.length,
      message:
        left.length === 0
          ? `만져 보신 것까지 ${ids.length}건을 지웠습니다. 처음 화면으로 돌아갔습니다.`
          : `${ids.length}건을 지웠지만 ${left.length}건이 남았습니다.`,
    })
  } catch (err) {
    return jsonError(`지우지 못했습니다. (${String(err.message).slice(0, 160)})`, 503)
  }
}
