// 보러 오신 분들이 시험 삼아 낸 신청서를 치운다.
//
// 첫 화면에 "직접 눌러 보셔도 됩니다"를 걸어 두고 나니 새 문제가 생겼다.
// 면접관 스무 명이 신청서를 한 번씩 내 보면 접수함에 스무 건이 쌓이고,
// 첫 화면은 그걸 "하루 넘게 못 본 신청서 20건"이라고 띄운다. **초대한
// 결과가 초대한 화면을 망친다.**
//
// 그렇다고 아무거나 지우면 안 된다. 이 사이트에서 가장 값나가는 것이
// 여덟 단계를 끝까지 밟은 AX-EFD-E58 한 건이고, 그건 시연 시드가 아니라
// 손으로 만든 것이다. 그걸 날리면 시연이 통째로 빈다.
//
// 그래서 선을 하나만 긋는다 — **접수 상태이고 기록이 하나도 안 달린 것.**
// 누가 냈는데 그 뒤로 아무 일도 안 일어난 것이 정확히 시험 삼아 낸
// 것이다. 판정했거나, 되물었거나, 손들었거나, 무엇이든 한 줄이라도
// 달렸으면 그건 보여줄 것이 있는 기록이라 남긴다.
//
// 시연 시드(AX-DEM-*)는 여기서 안 건드린다. 그건 옆의 되돌리기 몫이다.

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

async function pick(env) {
  const { results } = await env.DB.prepare(PICK).bind(`${DEMO_PREFIX}%`).all()
  return results
}

export async function onRequestGet({ env }) {
  try {
    const rows = await pick(env)
    return jsonResponse({
      count: rows.length,
      items: rows,
      // 무엇을 지우는지 화면이 그대로 읽을 수 있게 여기서 문장으로 준다.
      note:
        rows.length === 0
          ? '시험 삼아 낸 신청서는 없습니다.'
          : `${rows.length}건입니다. 낸 뒤로 판정도 되묻기도 없었던 것들만 셉니다 — 한 줄이라도 기록이 달린 것은 안 셉니다.`,
    })
  } catch (err) {
    return jsonError(`세지 못했습니다. (${String(err.message).slice(0, 160)})`, 503)
  }
}

export async function onRequestDelete({ env }) {
  try {
    const rows = await pick(env)
    if (rows.length === 0) {
      return jsonResponse({ ok: true, removed: 0, message: '지울 것이 없습니다.' })
    }

    const ids = rows.map((r) => r.id)
    const holes = ids.map(() => '?').join(', ')
    await env.DB.batch([
      // 첨부는 표에서만 지운다. R2 객체는 그대로 두는데, 지우다 실패하면
      // 표만 사라지고 파일은 남아 어느 것이 고아인지 알 수 없게 된다.
      env.DB.prepare(`DELETE FROM application_file WHERE application_id IN (${holes})`).bind(...ids),
      env.DB.prepare(`DELETE FROM application WHERE id IN (${holes})`).bind(...ids),
    ])

    return jsonResponse({
      ok: true,
      removed: ids.length,
      tickets: rows.map((r) => r.ticket_no),
      message: `시험 삼아 낸 신청서 ${ids.length}건을 지웠습니다.`,
    })
  } catch (err) {
    return jsonError(`지우지 못했습니다. (${String(err.message).slice(0, 160)})`, 503)
  }
}
