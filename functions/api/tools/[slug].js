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
import { computeOutcome, buildChallenges, labelForOutcome } from '../../../shared/outcome.js'
import { toReports, trustLevel, REPORT_KIND, REPORT_FIX } from '../../../shared/report.js'
import { RESTORE_KIND, lastRestore } from '../../../shared/rollback.js'

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
    const [remaining, manual, recent, aliases, nextFree, baseline, saved, reportRows] = await Promise.all([
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

      // 이 도구를 쓰기 전에 사람이 하면 얼마나 걸렸나.
      //
      // 부서는 매주 이 도구를 돌리면서도 그게 얼마나 줄여 줬는지를 못 봤다.
      // 그 숫자는 담당자 화면에만 있었다. 정작 시간을 아낀 쪽은 부서인데,
      // 자기가 뭘 얻었는지는 남의 화면에 있었던 것이다.
      env.DB.prepare(
        'SELECT median_seconds, sample_n, people, hourly_wage_krw FROM baseline WHERE application_id = ?'
      )
        .bind(h.application_id)
        .first(),

      env.DB.prepare(
        'SELECT dev_hours, ops_cost_krw, amortize_months, dept_confirmed_at FROM outcome WHERE application_id = ?'
      )
        .bind(h.application_id)
        .first(),

      // 이 부서가 낸 신고와 그 처리.
      //
      // 부서가 "이 결과 이상합니다"를 누르면 서버는 "담당자가 먼저 봅니다"
      // 라고 답한다. 그리고 거기서 끝이었다. 자기가 낸 것도, 고쳐졌는지도,
      // 무엇을 고쳤는지도 다시 못 봤다.
      //
      // 그러면 부서는 한 번 신고하고 만다. 아무 일도 안 일어나는 것처럼
      // 보이기 때문이다. 그 뒤로는 숫자가 틀려도 그냥 손으로 고쳐 쓴다 —
      // 그리고 그 사실을 아무도 모른다. 넘긴 뒤 들어오는 신고가 이 사이트에서
      // 가장 값진 기록인데, 그 길을 스스로 막아 둔 셈이다.
      //
      // 다시올림도 같이 뽑는다. 도구를 내렸다가 고쳐서 다시 올리면 서버가
      // "부서 도구 화면에 무엇을 고쳤는지 함께 뜹니다"라고 답하는데, 정작
      // 이 화면은 그 기록을 안 읽어서 아무것도 안 떴다. 부서는 도구가 틀린
      // 것을 겪고 못 믿게 된 채 기다리다가, 어느 날 그냥 다시 열린 것만
      // 본다. 그러면 안 쓴다.
      env.DB.prepare(
        `SELECT id, link_kind, link_id, title, what, why, created_at
         FROM decision_log
         WHERE application_id = ? AND link_kind IN (?, ?, ?)
         ORDER BY created_at`
      )
        .bind(h.application_id, REPORT_KIND, REPORT_FIX, RESTORE_KIND)
        .all(),
    ])

    // 이 도구가 부서에게 무엇을 돌려줬나.
    //
    // 담당자 성과 화면과 **같은 함수**로 낸다. 두 벌로 계산하면 부서가 보는
    // 숫자와 담당자가 보는 숫자가 갈라지고, 그날 둘 다 못 믿는다.
    //
    // 딱지도 같이 준다. 미해소 반박이 남아 있으면 '보수적 추정'이다.
    // 숫자만 던져 놓으면 부서는 그걸 확정으로 읽고 위에 보고한다 —
    // 담당자 화면은 같은 값을 잠정이라고 부르고 있는데.
    // 신고와 그 처리. 아래에서 두 번 쓴다 — 목록으로도, 믿을 수 있나
    // 판단으로도. 두 번 만들면 한쪽만 걸러 놓는 날이 온다.
    const reports = toReports(reportRows.results.filter((r) => r.link_kind !== RESTORE_KIND))

    let payoff = null
    if (baseline && recent.results.length > 0) {
      const computed = computeOutcome({
        baseline,
        runs: recent.results,
        devHours: saved?.dev_hours ?? 0,
        opsCostKrw: saved?.ops_cost_krw ?? 0,
        amortizeMonths: saved?.amortize_months ?? 24,
      })
      if (computed.status !== '산정불가') {
        const open = buildChallenges({
          outcome: computed,
          quarantineLeft: recent.results[0]?.quarantined ?? 0,
          // 실제 값을 넘긴다. false 로 굳혀 뒀더니 부서 화면은 "확인 못 한
          // 것 5가지", 담당자 화면은 4가지가 됐다. 같은 것을 두 화면이
          // 다른 숫자로 말하면 읽는 사람은 둘 다 안 믿는다 — 이 저장소가
          // 계속 잡아 온 바로 그 모양을 내가 새로 만들 뻔했다.
          deptConfirmed: Boolean(saved?.dept_confirmed_at),
        })
        payoff = {
          runs: computed.runCount,
          // 부서에게는 시간이 먼저다. 금액은 그다음이다 — 부서가 아낀 것은
          // 자기 시간이고, 원 단위는 위에 보고할 때 쓰는 말이다.
          savedMinutes: Math.round(computed.savedSeconds / 60),
          savedKrw: computed.savedKrw,
          perRunMinutes: Math.round(computed.savedSeconds / 60 / Math.max(1, computed.runCount)),
          // 검수·재작업에 든 시간을 빼고 낸 값이라는 것을 밝힌다. 안 밝히면
          // 부서는 "그만큼 안 줄었는데"라고 느끼고 이 숫자를 안 믿는다.
          reviewMinutes: Math.round(computed.reviewSeconds / 60),
          reworkMinutes: Math.round(computed.reworkSeconds / 60),
          label: labelForOutcome(computed, open.length).label,
          openChallenges: open.length,
        }
      }
    }

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
      limits: {
        dailyLimit: h.daily_limit,
        remainingToday: remaining,
        maxFileMb: h.max_file_mb,
        // 하루 단위가 아니라 최근 24시간 기준이라는 것을 이름에도 남긴다.
        windowHours: DAY_SECONDS / 3600,
        nextFreeAt: remaining > 0 ? null : (nextFree?.next_free ?? null),
      },
      payoff,
      // 부서가 낸 신고와 그 처리. 담당자 화면과 **같은 함수**로 만든다.
      // 다시올림은 신고가 아니므로 빼고 넘긴다.
      reports,
      // 이 도구를 지금 믿을 수 있나.
      //
      // 신고를 받으면 서버가 이렇게 답한다 — "결과를 믿을 수 없는 종류라
      // **이 도구에 표시가 붙습니다.**" 그 표시가 담당자용 목록(/tools)에만
      // 붙었다. 정작 그 도구를 매주 여는 부서 화면에는 없었다.
      //
      // 부서 쪽에서 보면 이렇다. 월요일 아침에 정산을 돌리러 이 화면을
      // 연다. 지난주에 옆자리가 "반품 있는 주에 12,400원 많게 나온다"를
      // 신고해 뒀고 아직 안 고쳐졌다. 그런데 화면 위쪽은 절감 시간과
      // 사용법뿐이고, 그 신고는 한참 아래에 있다. 그대로 돌려서 틀린 줄
      // 아는 숫자를 재무 폴더에 올린다.
      //
      // 도는 것과 맞는 것은 다르다. 담당자 목록과 **같은 함수**로 낸다.
      trust: trustLevel(reports),
      // 내려갔다가 고쳐서 다시 올라온 적이 있는가.
      restored: lastRestore(reportRows.results),
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
