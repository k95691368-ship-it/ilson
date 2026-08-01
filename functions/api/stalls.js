// 어디서 멈춰 있는가.
//
// 첫 화면은 "어느 단계에 몇 건"까지 센다. 그런데 그 건이 거기 사흘 있었는지
// 3주 있었는지는 아무 데도 안 나온다. 그래서 오래 걸린 건일수록 조용하다 —
// 목록 아래로 내려가고, 아무도 안 물어보고, 부서는 포기한다.
//
// 계산은 shared/stall.js가 한다. 여기서는 기록을 모아 넘긴다.

import { jsonResponse, jsonError } from '../_lib/http.js'
import { stallBoard, boardLine } from '../../shared/stall.js'

export async function onRequestGet({ env }) {
  try {
    const [apps, logs] = await Promise.all([
      env.DB.prepare(
        `SELECT id, ticket_no, dept, title, status, created_at, updated_at
         FROM application ORDER BY created_at`
      ).all(),

      // 단계가 언제 바뀌었는지만 있으면 된다. 본문은 안 읽는다 —
      // 신청서가 늘어나면 그만큼 커지는데 여기서는 쓸 일이 없다.
      env.DB.prepare(
        `SELECT application_id, stage, created_at
         FROM decision_log
         WHERE application_id IS NOT NULL
         ORDER BY created_at`
      ).all(),
    ])

    const byApp = new Map(apps.results.map((a) => [a.id, []]))
    for (const l of logs.results) {
      byApp.get(l.application_id)?.push(l)
    }

    const items = apps.results.map((a) => ({ application: a, logs: byApp.get(a.id) ?? [] }))
    const board = stallBoard(items, Date.now())

    return jsonResponse({
      ...board,
      line: boardLine(board.summary),
    })
  } catch (err) {
    return jsonError(`막힌 곳을 세지 못했습니다. (${String(err.message).slice(0, 160)})`, 503)
  }
}
