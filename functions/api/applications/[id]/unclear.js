// 담당자 쪽 — 부서가 짚은 곳을 보고 다시 쓴다.
//
// 짚는 자리만 만들고 고치는 자리를 안 만들면, 짚기는 신고함이 되고 아무도
// 안 읽는다. 그러면 부서는 "말해 봐야 소용없다"를 배우고 그 뒤로는 짚지
// 않는다. 문서는 영영 그대로다.

import { jsonResponse, jsonError, failFields, failUnexpected } from '../../../_lib/http.js'
import { newId } from '../../../_lib/ids.js'
import { loadUnclear } from '../../../_lib/unclear.js'
import {
  validateFix,
  unclearBoard,
  boardLine,
  UNCLEAR_FIXED_KIND,
} from '../../../../shared/unclear.js'
import { faqDrafts, draftLine, FAQ_DISMISS_KIND } from '../../../../shared/faqDraft.js'

// 자주 묻는 것 초안까지 같이 만든다.
//
// 짚힌 곳 화면과 자주 묻는 것 화면이 같은 자리에 있어서, 담당자가 답을
// 적고 나면 바로 "이건 올릴 만한가"를 볼 수 있어야 한다. 화면을 옮겨야
// 하면 그 일은 안 하게 된다.
async function withDrafts(env, applicationId, board) {
  const [faqs, dismissed] = await Promise.all([
    env.DB.prepare('SELECT id, question, answer FROM manual_faq WHERE application_id = ? ORDER BY ord')
      .bind(applicationId)
      .all(),
    env.DB.prepare(
      'SELECT link_id FROM decision_log WHERE application_id = ? AND link_kind = ?'
    )
      .bind(applicationId, FAQ_DISMISS_KIND)
      .all(),
  ])

  const drafts = faqDrafts({
    sections: board.sections,
    faqs: faqs.results,
    dismissed: dismissed.results.map((d) => d.link_id),
  })
  return { drafts, draftLine: draftLine(drafts) }
}

async function findApplication(env, id) {
  return env.DB.prepare(
    'SELECT id, ticket_no, dept, title FROM application WHERE id = ? OR ticket_no = ?'
  )
    .bind(id, id)
    .first()
}

export async function onRequestGet({ env, params }) {
  const app = await findApplication(env, params.id)
  if (!app) return jsonError('그런 신청서가 없습니다.', 404)

  try {
    const board = unclearBoard(await loadUnclear(env, app.id))
    return jsonResponse({
      ...board,
      line: boardLine(board.summary),
      ...(await withDrafts(env, app.id, board)),
    })
  } catch (err) {
    return jsonError(`짚힌 곳을 불러오지 못했습니다. (${String(err.message).slice(0, 160)})`, 503)
  }
}

export async function onRequestPost({ env, request, params }) {
  const app = await findApplication(env, params.id)
  if (!app) return jsonError('그런 신청서가 없습니다.', 404)

  let body
  try {
    body = await request.json()
  } catch {
    return jsonError('보내주신 내용을 읽지 못했습니다.', 400)
  }

  // 자주 묻는 것에 안 올리기로 한 제안을 물린다.
  //
  // 물릴 데가 없으면 안 올릴 제안이 영영 떠 있고, 그러면 담당자는 이 자리를
  // 통째로 안 본다. 지우는 것이 아니라 기록으로 남긴다 — 왜 안 올렸는지가
  // 나중에 같은 판단을 되풀이하지 않게 해 준다.
  if (body.kind === 'dismiss_faq') {
    const key = String(body.key ?? '').trim()
    if (!key) return jsonError('어느 제안인지 알 수 없습니다.', 400)
    try {
      await env.DB.prepare(
        `INSERT INTO decision_log
           (id, application_id, stage, actor, title, what, why, link_kind, link_id)
         VALUES (?, ?, '사용법서', 'human', ?, ?, ?, ?, ?)`
      )
        .bind(
          newId('dec'),
          app.id,
          String(body.by ?? 'AX 담당자').trim().slice(0, 60),
          String(body.reason ?? '').trim().slice(0, 500) || '자주 묻는 것에 올리지 않기로 했다.',
          '올릴 값어치가 없다고 본 것도 판단이다. 남겨 두면 같은 판단을 되풀이하지 않는다.',
          FAQ_DISMISS_KIND,
          key
        )
        .run()
      const board = unclearBoard(await loadUnclear(env, app.id))
      return jsonResponse({
        ok: true,
        ...board,
        line: boardLine(board.summary),
        ...(await withDrafts(env, app.id, board)),
        message: '이 제안은 다시 안 띄웁니다.',
      })
    } catch (err) {
      return failUnexpected(err, '제안을 물리지 못했습니다.')
    }
  }

  const errors = validateFix(body)
  if (Object.keys(errors).length > 0) {
    return failFields(errors, '적어 주신 내용을 확인해주세요.')
  }

  try {
    const { flags, fixes } = await loadUnclear(env, app.id)
    const flag = flags.find((f) => f.id === body.flag_id)
    if (!flag) return jsonError('그 짚은 것을 찾지 못했습니다.', 404)
    if (fixes.some((f) => f.flag_id === flag.id)) {
      return jsonError('이미 다시 쓰신 대목입니다.', 409)
    }

    await env.DB.prepare(
      `INSERT INTO decision_log
         (id, application_id, stage, actor, title, what, why, link_kind, link_id)
       VALUES (?, ?, '사용법서', 'human', ?, ?, ?, ?, ?)`
    )
      .bind(
        newId('dec'),
        app.id,
        String(body.by).trim().slice(0, 60),
        String(body.body).trim().slice(0, 1000),
        // 부서가 짚은 원문을 같이 남긴다. 나중에 이 기록만 보고도
        // 무엇 때문에 고쳤는지 알 수 있어야 한다.
        `부서가 짚은 것: ${flag.body}`,
        UNCLEAR_FIXED_KIND,
        flag.id
      )
      .run()

    const board = unclearBoard(await loadUnclear(env, app.id))
    return jsonResponse({
      ok: true,
      ...board,
      line: boardLine(board.summary),
      ...(await withDrafts(env, app.id, board)),
      // 고친 문장이 그 자리에 그대로 붙는다는 것을 여기서도 말해 준다.
      message: '남겼습니다. 이 문장이 도구 화면 그 대목에 붙습니다.',
    })
  } catch (err) {
    return failUnexpected(err, '다시 썼다고 남기지 못했습니다.')
  }
}
