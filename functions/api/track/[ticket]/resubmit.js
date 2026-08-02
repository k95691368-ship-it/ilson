// 반려당한 신청서를 부서가 고쳐서 다시 낸다.
//
// 앞 신청서를 고치지 않는다. 새로 하나를 만들고 앞 것과 잇는다. 앞 것을
// 되살리면 "반려했다"는 기록이 사라지고, 그러면 담당자가 무엇을 왜 반려했는지
// 남지 않는다. 반려도 기록이다.
//
// 규칙은 shared/resubmit.js가 정한다. 화면과 서버가 그 파일 하나를 같이 쓴다.

import { jsonResponse, jsonError, failFields, failUnexpected } from '../../../_lib/http.js'
import { newId, newTicketNo } from '../../../_lib/ids.js'
import { checkRateLimit, releaseRateLimit } from '../../../_lib/rateLimit.js'
import { logDecision } from '../../../_lib/decisions.js'
import {
  retryPlan,
  validateResubmit,
  carryOver,
  resubmitNote,
  RESUBMIT_KIND,
  RESUBMIT_BACK_KIND,
} from '../../../../shared/resubmit.js'

async function loadPrevious(env, ticket) {
  const app = await env.DB.prepare(
    `SELECT id, ticket_no, dept, applicant_label, contact, title, bottleneck, problem, wish,
            current_minutes, current_people, current_frequency, impact_if_wrong, status
     FROM application WHERE ticket_no = ?`
  )
    .bind(ticket)
    .first()
  if (!app) return null

  const [review, again] = await Promise.all([
    env.DB.prepare(
      'SELECT verdict, refuse_code, refuse_alternative FROM review WHERE application_id = ?'
    )
      .bind(app.id)
      .first(),
    // 이 신청서를 몇 번이나 고쳐 냈는가. 다시 낼 때마다 앞 신청서에
    // 기록을 하나 남기므로 그것을 센다.
    env.DB.prepare(
      'SELECT COUNT(*) AS n FROM decision_log WHERE application_id = ? AND link_kind = ?'
    )
      .bind(app.id, RESUBMIT_BACK_KIND)
      .first(),
  ])

  return { app, review, times: again?.n ?? 0 }
}

// 이 건을 다시 낼 수 있는지, 낸다면 무엇을 바꾸면 되는지.
export async function onRequestGet({ env, params }) {
  const prev = await loadPrevious(env, String(params.ticket ?? '').trim().toUpperCase())
  if (!prev) return jsonError('그 접수번호를 찾지 못했습니다.', 404)

  if (prev.review?.verdict !== '반려') {
    return jsonResponse({
      eligible: false,
      // 반려가 아닌 건에까지 "다시 내기"를 띄우면, 진행 중인 건을 새로 내는
      // 일이 생긴다. 그러면 같은 일이 두 줄이 된다.
      why: '반려된 신청서만 고쳐서 다시 내실 수 있습니다.',
    })
  }

  return jsonResponse({
    eligible: true,
    previous: {
      ticket_no: prev.app.ticket_no,
      title: prev.app.title,
      dept: prev.app.dept,
    },
    plan: retryPlan({
      refuseCode: prev.review.refuse_code,
      refuseAlternative: prev.review.refuse_alternative,
      timesResubmitted: prev.times,
    }),
    // 부서가 처음부터 다시 쓰지 않도록 앞 내용을 그대로 돌려준다.
    draft: carryOver(prev.app),
  })
}

export async function onRequestPost({ env, request, params }) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown'
  const ticket = await checkRateLimit(env, `resubmit:${ip}`, 6, 3600)
  if (!ticket) return jsonError('다시 내기는 시간당 6회까지 가능합니다.', 429)

  let body
  try {
    body = await request.json()
  } catch {
    await releaseRateLimit(env, `resubmit:${ip}`, ticket)
    return jsonError('보내주신 내용을 읽지 못했습니다.', 400)
  }

  const prev = await loadPrevious(env, String(params.ticket ?? '').trim().toUpperCase())
  if (!prev) {
    await releaseRateLimit(env, `resubmit:${ip}`, ticket)
    return jsonError('그 접수번호를 찾지 못했습니다.', 404)
  }

  if (prev.review?.verdict !== '반려') {
    await releaseRateLimit(env, `resubmit:${ip}`, ticket)
    return jsonError('반려된 신청서만 고쳐서 다시 내실 수 있습니다.', 409)
  }

  // 화면이 막았어도 서버가 다시 본다. 화면만 믿으면 주소를 직접 두드려
  // 우회할 수 있고, 그러면 "안 된다"고 적어 둔 것이 거짓말이 된다.
  const plan = retryPlan({
    refuseCode: prev.review.refuse_code,
    refuseAlternative: prev.review.refuse_alternative,
    timesResubmitted: prev.times,
  })
  if (!plan.canRetry) {
    await releaseRateLimit(env, `resubmit:${ip}`, ticket)
    return jsonError(`${plan.headline}. ${plan.change}`, 409)
  }

  const t = (v) => String(v ?? '').trim()
  const draft = { ...carryOver(prev.app), ...body }
  const errors = validateResubmit(draft)
  if (Object.keys(errors).length > 0) {
    await releaseRateLimit(env, `resubmit:${ip}`, ticket)
    return failFields(errors, '적어 주신 내용을 확인해주세요.')
  }

  const id = newId('app')
  const ticketNo = newTicketNo()
  const times = prev.times + 1
  const note = resubmitNote({
    previousTicket: prev.app.ticket_no,
    changed: t(draft.changed),
    times,
  })

  try {
    await env.DB.prepare(
      `INSERT INTO application
         (id, ticket_no, dept, applicant_label, contact, title, bottleneck, problem, wish,
          current_minutes, current_people, current_frequency, impact_if_wrong, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '접수')`
    )
      .bind(
        id,
        ticketNo,
        t(draft.dept),
        t(draft.applicant_label),
        t(draft.contact) || null,
        t(draft.title),
        t(draft.bottleneck),
        t(draft.problem),
        t(draft.wish) || null,
        Number(draft.current_minutes) || null,
        Number(draft.current_people) || null,
        t(draft.current_frequency) || null,
        t(draft.impact_if_wrong) || null
      )
      .run()

    // 양쪽에 다 남긴다.
    //
    // 새 신청서 쪽 — 담당자가 접수함에서 처음 열었을 때 앞에서 자기가 반려한
    //   것인 줄 알아야 한다. 모르면 처음부터 다시 읽는다.
    // 앞 신청서 쪽 — 부서가 조회 화면으로 앞 접수번호를 다시 볼 때, 그 뒤에
    //   어떻게 됐는지가 거기 있어야 한다. 없으면 반려에서 이야기가 끊긴다.
    await Promise.all([
      logDecision(env, {
        applicationId: id,
        stage: '신청서',
        title: '반려된 신청서를 고쳐서 다시 냈다',
        what: note,
        why: '앞 판정을 모르고 처음부터 다시 읽으면, 부서가 고쳐 낸 수고가 담당자에게 전해지지 않는다.',
        linkKind: RESUBMIT_KIND,
        linkId: prev.app.id,
      }),
      logDecision(env, {
        applicationId: prev.app.id,
        stage: '신청서',
        title: `고쳐서 다시 내셨습니다 — ${ticketNo}`,
        what: `${t(draft.changed)}`,
        why: '반려에서 이야기가 끊기면, 부서는 그 뒤에 무슨 일이 있었는지 알 수 없다.',
        linkKind: RESUBMIT_BACK_KIND,
        linkId: id,
      }),
    ]).catch(() => {})

    return jsonResponse(
      {
        ok: true,
        id,
        ticket_no: ticketNo,
        previous_ticket: prev.app.ticket_no,
        times,
        message: `새 접수번호는 ${ticketNo}입니다. 앞 신청서(${prev.app.ticket_no})와 이어서 기록됩니다.`,
      },
      201
    )
  } catch (err) {
    await releaseRateLimit(env, `resubmit:${ip}`, ticket)
    return failUnexpected(err, '다시 내지 못했습니다.')
  }
}
