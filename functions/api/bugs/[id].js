// 들어온 버그 신고를 처리한다.
//
// 이 사이트에는 로그인이 없으므로 누가 눌러도 눌린다. 그래서 **닫을 때는
// 반드시 근거를 적게** 한다. 근거 없이 닫히면 신고한 사람은 그게 고쳐진
// 것인지 무시당한 것인지 알 수 없고, 다음부터는 안 적는다.

import { jsonResponse, jsonError, failFields, failUnexpected } from '../../_lib/http.js'
import { validateBugUpdate, BUG_DONE } from '../../../shared/bug.js'

export async function onRequestPatch({ env, params, request }) {
  const id = String(params?.id ?? '')
  if (!id.startsWith('bug_')) return jsonError('그런 신고가 없습니다.', 400)

  let body
  try {
    body = await request.json()
  } catch {
    return jsonError('내용을 읽지 못했습니다.', 400)
  }

  const fields = validateBugUpdate(body)
  if (Object.keys(fields).length > 0) return failFields(fields)

  try {
    const found = await env.DB.prepare('SELECT id, status FROM bug_report WHERE id = ?')
      .bind(id)
      .first()
    if (!found) return jsonError('그런 신고가 없습니다.', 404)

    const status = String(body.status)
    const note = String(body.note ?? '').trim() || null

    // 닫힌 것을 다시 여는 것은 막지 않는다. 고쳤다고 눌렀는데 또 나오는
    // 일이 실제로 있고, 그때 되돌릴 길이 없으면 새 신고를 또 내게 된다.
    await env.DB.prepare(
      `UPDATE bug_report
       SET status = ?, note = ?, updated_at = datetime('now')
       WHERE id = ?`
    )
      .bind(status, note, id)
      .run()

    return jsonResponse({ ok: true, id, status, done: BUG_DONE.includes(status) })
  } catch (err) {
    return failUnexpected(err, '신고를 처리하지 못했습니다.')
  }
}
