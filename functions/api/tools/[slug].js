// 부서에 넘긴 도구가 열리는 자리.
//
// 이 화면은 현업 담당자가 연다. 로그인이 없다 — 계정을 만들게 하면 안 쓴다.
// 대신 하루 실행 횟수를 제한하고, 남은 횟수를 화면에 항상 보여 준다.
//
// 계산 자체는 브라우저에서 돈다. 여기는 "누가 언제 돌렸고 무엇이 나왔는지"를
// 기록으로 남기는 자리다. 그 기록이 8단계 성과의 재료가 된다.

import { jsonResponse, jsonError } from '../../_lib/http.js'
import { checkRateLimit, remainingQuota } from '../../_lib/rateLimit.js'
import { newId } from '../../_lib/ids.js'

const DAY_SECONDS = 86400

async function findHandover(env, slug) {
  return env.DB.prepare(
    `SELECT h.*, a.title AS application_title, a.dept AS application_dept,
            a.ticket_no AS application_ticket
     FROM handover h JOIN application a ON a.id = h.application_id
     WHERE h.slug = ?`
  )
    .bind(slug)
    .first()
}

export async function onRequestGet({ env, params, request }) {
  const h = await findHandover(env, params.slug)
  if (!h) return jsonError('그런 도구가 없습니다. 주소를 확인해주세요.', 404)

  if (h.rolled_back_at) {
    return jsonResponse(
      {
        rolledBack: true,
        title: h.title,
        reason: h.rollback_reason,
        message: '이 도구는 잠시 내려가 있습니다. 담당자에게 문의해주세요.',
      },
      200
    )
  }

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown'
  const bucket = `tool:${h.slug}:${ip}`

  try {
    const [remaining, manual, recent, aliases, nextFree] = await Promise.all([
      remainingQuota(env, bucket, h.daily_limit, DAY_SECONDS),
      env.DB.prepare(
        'SELECT title, intro, when_to_run, what_to_do_after, contact FROM manual WHERE application_id = ?'
      )
        .bind(h.application_id)
        .first(),
      env.DB.prepare(
        `SELECT id, used_at, actor_label, files_json, rows_out, quarantined,
                duration_ms, human_review_seconds, rework_seconds, ok, fail_reason
         FROM tool_use WHERE application_id = ? ORDER BY used_at DESC LIMIT 40`
      )
        .bind(h.application_id)
        .all(),
      // 사람이 알려 준 상품코드. 이걸 안 내려보내면 알려줘도 다음 실행에
      // 반영되지 않는다. 알려주고 나서 그대로 또 밀려나면, 부서는 그
      // 뒤로 아무것도 안 알려준다.
      env.DB.prepare('SELECT external_code, canonical_code, product_name, taught_by FROM sku_alias').all(),
      // 언제 한 칸이 풀리는가.
      //
      // 한도는 자정에 초기화되는 것이 아니라 최근 24시간 안에 몇 번 썼는지로
      // 센다. 가장 오래된 실행이 24시간을 넘기는 그때 한 칸이 풀린다.
      // "기다리세요"만 하면 얼마나 기다릴지 몰라 결국 담당자에게 전화한다.
      env.DB.prepare(
        `SELECT datetime(MIN(created_at), '+' || ? || ' seconds') AS next_free
         FROM rate_limit_hits
         WHERE bucket = ? AND created_at >= datetime('now', '-' || ? || ' seconds')`
      )
        .bind(DAY_SECONDS, bucket, DAY_SECONDS)
        .first(),
    ])

    return jsonResponse({
      slug: h.slug,
      // 이 도구가 어느 신청서에서 나왔는지.
      //
      // 부서는 이 화면 주소 하나만 받는다. 여기서 나가는 길이 하나도
      // 없어서, 자기 신청서가 어떻게 됐는지 보려면 접수번호를 어딘가에서
      // 다시 찾아야 했다. 넘긴 뒤로 이 화면만 여는 사람에게는 그 번호가
      // 기억에 없다.
      ticket: h.application_ticket,
      title: h.title,
      handedTo: { dept: h.handed_to_dept, person: h.handed_to_person },
      handedAt: h.handed_at,
      acceptedAt: h.accepted_at,
      limits: {
        dailyLimit: h.daily_limit,
        remainingToday: remaining,
        maxFileMb: h.max_file_mb,
        // 하루 단위가 아니라 최근 24시간 기준이라는 것을 이름에도 남긴다.
        windowHours: DAY_SECONDS / 3600,
        nextFreeAt: remaining > 0 ? null : (nextFree?.next_free ?? null),
      },
      manual: manual ?? null,
      note: h.note,
      recent: recent.results,
      // 계산은 브라우저에서 하므로 알려 준 코드도 함께 보낸다.
      aliases: Object.fromEntries(aliases.results.map((a) => [a.external_code, a.canonical_code])),
      taught: aliases.results,
    })
  } catch (err) {
    return jsonError(`도구를 불러오지 못했습니다. (${String(err.message).slice(0, 160)})`, 503)
  }
}

// 브라우저에서 계산이 끝난 뒤 결과를 기록한다.
export async function onRequestPost({ env, params, request }) {
  const h = await findHandover(env, params.slug)
  if (!h) return jsonError('그런 도구가 없습니다.', 404)
  if (h.rolled_back_at) return jsonError('이 도구는 잠시 내려가 있습니다.', 409)

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown'
  const bucket = `tool:${h.slug}:${ip}`

  const ticket = await checkRateLimit(env, bucket, h.daily_limit, DAY_SECONDS)
  if (!ticket) {
    return jsonError(
      // '오늘·내일'이라고 하지 않는다. 자정에 초기화되는 것이 아니라 최근
      // 24시간 기준이라, 내일 아침에 오면 여전히 막혀 있을 수 있다.
      `지금은 더 돌리실 수 없습니다(24시간에 ${h.daily_limit}회). 가장 오래된 실행이 24시간을 넘기면 한 번씩 풀립니다. 급하시면 담당자에게 말씀해주세요.`,
      429
    )
  }

  let body
  try {
    body = await request.json()
  } catch {
    return jsonError('요청 형식이 올바르지 않습니다.', 400)
  }

  try {
    const id = newId('use')
    await env.DB.prepare(
      `INSERT INTO tool_use
         (id, application_id, actor_label, files_json, rows_out, quarantined,
          duration_ms, ok, fail_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        id,
        h.application_id,
        String(body.actor_label ?? h.handed_to_person).slice(0, 40),
        JSON.stringify(body.files ?? []),
        Number(body.rows_out) || 0,
        Number(body.quarantined) || 0,
        Number(body.duration_ms) || null,
        body.ok === false ? 0 : 1,
        String(body.fail_reason ?? '').slice(0, 200) || null
      )
      .run()

    const remaining = await remainingQuota(env, bucket, h.daily_limit, DAY_SECONDS)
    return jsonResponse({ ok: true, id, remainingToday: remaining }, 201)
  } catch (err) {
    return jsonError(`기록하지 못했습니다. (${String(err.message).slice(0, 160)})`, 500)
  }
}
