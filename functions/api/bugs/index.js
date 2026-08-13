// 이 사이트 자체의 버그를 받고 보여준다.
//
// 로그인을 요구하지 않는다. 요구하는 순간 아무도 신고하지 않고, 신고가
// 없으면 이 사이트가 멀쩡한 줄 알게 된다. 도구 신고를 그렇게 만들어 뒀고
// 같은 이유가 여기에도 그대로 걸린다.
//
// 그리고 **들어온 것을 그대로 다 보여준다.** 골라서 보여주면 이 사이트가
// 다른 자리에서 하는 말("못 한 것은 데이터에서 자동으로 만들어지므로 잘
// 보이려고 손댈 수 없습니다")이 자기 버그 앞에서 깨진다.

import { jsonResponse, jsonError, failFields, failUnexpected } from '../../_lib/http.js'
import { checkRateLimit } from '../../_lib/rateLimit.js'
import { newId } from '../../_lib/ids.js'
import { validateBug, toBugs, bugSummary } from '../../../shared/bug.js'

export async function onRequestGet({ env }) {
  try {
    const rows = await env.DB.prepare(
      `SELECT id, area, kind, body, steps, reporter, status, note, created_at, updated_at
       FROM bug_report ORDER BY created_at DESC LIMIT 200`
    ).all()

    const bugs = toBugs(rows.results)
    return jsonResponse({ bugs, summary: bugSummary(bugs) })
  } catch (err) {
    return failUnexpected(err, '버그 신고를 불러오지 못했습니다.')
  }
}

export async function onRequestPost({ env, request }) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown'
  const allowed = await checkRateLimit(env, `bug:${ip}`, 20, 600)
  if (!allowed) {
    return jsonError('버그 신고는 십 분에 20건까지 받습니다. 잠시 후 다시 시도해주세요.', 429)
  }

  let body
  try {
    body = await request.json()
  } catch {
    return jsonError('내용을 읽지 못했습니다.', 400)
  }

  const fields = validateBug(body)
  if (Object.keys(fields).length > 0) return failFields(fields)

  try {
    const id = newId('bug')
    await env.DB.prepare(
      `INSERT INTO bug_report (id, area, kind, body, steps, reporter)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
      .bind(
        id,
        String(body.area),
        String(body.kind),
        String(body.body).trim(),
        String(body.steps ?? '').trim() || null,
        String(body.reporter ?? '').trim() || null
      )
      .run()

    return jsonResponse({ ok: true, id })
  } catch (err) {
    return failUnexpected(err, '버그 신고를 저장하지 못했습니다.')
  }
}
