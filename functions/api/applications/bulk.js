// 접수함에서 여러 건을 한 번에 처리한다.
//
// 여기서 되는 것은 "읽지 않아도 되는 일"까지다. 판정(수용·반려)은 한 건씩
// 해야 한다 — 한 번에 판정하게 하면 사람은 안 읽고 누르고, 읽지도 않고
// 반려된 신청서가 생기면 부서는 그걸 알아챈다.

import { jsonResponse, jsonError, failFields, failUnexpected } from '../../_lib/http.js'
import { validateBulk, partition, resultText, BULK_BY_CODE } from '../../../shared/bulk.js'

export async function onRequestPost({ env, request }) {
  let body
  try {
    body = await request.json()
  } catch {
    return jsonError('보내주신 내용을 읽지 못했습니다.', 400)
  }

  const action = String(body.action ?? '').trim()
  const ids = [...new Set(Array.isArray(body.ids) ? body.ids.map(String) : [])]
  const reason = String(body.reason ?? '').trim().slice(0, 1000)
  const author = String(body.author ?? '').trim().slice(0, 60) || 'AX 담당자'

  const fields = validateBulk({ action, ids, reason })
  if (Object.keys(fields).length > 0) {
    return failFields(fields, '고르신 것을 다시 확인해주세요.')
  }

  const spec = BULK_BY_CODE[action]

  try {
    const placeholders = ids.map(() => '?').join(',')
    const { results } = await env.DB.prepare(
      `SELECT id, ticket_no, dept, title, status FROM application WHERE id IN (${placeholders})`
    )
      .bind(...ids)
      .all()

    const { ok, skipped, missing } = partition(results, ids, action)
    if (ok.length === 0) {
      return jsonError(
        skipped.length > 0
          ? '고르신 것이 전부 이미 처리된 건입니다.'
          : '처리할 신청서를 찾지 못했습니다.',
        409
      )
    }

    // 한 묶음으로 돌린다. 따로 돌리다 중간에 끊기면 어떤 건 바뀌고 어떤
    // 건 안 바뀐 상태가 남는데, 무엇이 됐는지 아무도 모른다.
    const stmts = []
    for (const app of ok) {
      if (spec.changesStatus) {
        stmts.push(
          env.DB.prepare(
            `UPDATE application SET status = ?, updated_at = datetime('now') WHERE id = ?`
          ).bind(spec.changesStatus, app.id)
        )
      }
      stmts.push(
        env.DB.prepare(
          `INSERT INTO decision_log
             (id, application_id, stage, actor, title, what, why, link_kind, link_id)
           VALUES (?, ?, '검토', 'human', ?, ?, ?, ?, ?)`
        ).bind(
          `dec_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`,
          app.id,
          author,
          spec.code === 'ack'
            ? '읽었습니다. 판정은 아직입니다.'
            : `보류로 미룹니다. ${reason}`,
          // 한 번에 처리한 것이라는 사실을 숨기지 않는다. 나중에 이 기록을
          // 보는 사람이 "이건 한 건씩 본 건가"를 알 수 있어야 한다.
          `${ok.length}건을 한 번에 처리하면서 남긴 기록입니다.${reason ? ` ${reason}` : ''}`,
          `일괄:${spec.code}`,
          spec.code
        )
      )
    }
    await env.DB.batch(stmts)

    return jsonResponse({
      ok: true,
      done: ok.map((a) => a.ticket_no),
      skipped: skipped.map((a) => ({ ticket_no: a.ticket_no, reason: a.reason })),
      missing,
      message: resultText({ action, ok: ok.length, skipped: skipped.length }),
    })
  } catch (err) {
    return failUnexpected(err, '한 번에 처리하지 못했습니다.')
  }
}

// 무엇을 한 번에 할 수 있는지는 화면이 서버에 묻지 않는다.
//
// 처음에는 목록을 내려주는 GET을 뒀었다. "화면에 박아 두면 서버에서 하나
// 빼도 버튼이 남는다"는 이유였는데, 이 프로젝트에서는 그 걱정이 성립하지
// 않는다. 목록이 shared/bulk.js 한 곳에 있고 화면과 서버가 그 파일을 같이
// 쓰기 때문이다. 어긋날 수가 없는 것을 왕복 한 번 더 들여 물어보는 꼴이라
// 지웠다. 아무도 안 부르는 창구를 남겨 두면, 뒤에 읽는 사람이 화면이
// 그걸 쓰는 줄 안다.
