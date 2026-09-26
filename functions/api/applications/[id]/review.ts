// 2단계 — 판정을 저장한다.
//
// 이 라우트가 하는 일은 셋이다. 검토 기록을 남기고, 신청서 상태를 옮기고,
// 의사결정 로그에 근거를 적는다. 셋이 함께 일어나야 한다 — 판정만 저장되고
// 근거가 없으면 나중에 "왜 반려했나"에 답할 수 없다.
//
// 화면의 revision과 현재 값을 부모행 잠금 안에서 비교한 뒤 세 쓰기를 묶는다.
// 오래된 화면은 최신 판정을 덮어쓰지 않고, 중간 실패도 근거를 분리하지 않는다.

import { jsonResponse, jsonError } from '../../../_lib/http.ts'
import { validReviewRevision, reviewConflict, lockReviewRevision, reviewMutation } from '../../../_lib/reviewMutation.ts'
import { validateReview, statusFromVerdict, REFUSE_LABELS } from '../../../../shared/review.ts'
import { newId } from '../../../_lib/ids.js'
import type { ApplicationContext, Database } from '../../../_lib/runtimeTypes.ts'

type ReviewValue = Extract<ReturnType<typeof validateReview>, { ok: true }>['value']
type ReviewStatus = '접수' | '검토중' | '수용' | '반려' | '보류' | '진행중' | '완료'
interface ReviewApplication {
  id: string
  ticket_no: string
  dept: string
  title: string
  status: ReviewStatus
  review_revision: number
}

export interface ReviewResponse {
  ok: true
  application_id: string
  ticket_no: string
  status: ReviewStatus
  verdict: ReviewValue['verdict']
}

export async function onRequestPost({ env, data: requestData, params, request }: ApplicationContext): Promise<Response> {
  env = requestData?.requestEnv ?? env
  const id = params.id

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonError('요청 형식이 올바르지 않습니다.', 400)
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return jsonError('요청 형식이 올바르지 않습니다.', 400)
  }
  const input = body as Record<string, unknown>
  const check = validateReview(input)
  if (!check.ok) {
    return jsonResponse({ error: '적어 주신 내용을 확인해주세요.', fields: check.errors }, 400)
  }
  const v = check.value
  if (!validReviewRevision(input.expectedRevision)) return reviewConflict()

  return reviewMutation(env.DB, request, `review:${id}`, input, async (DB: Database) => {

  const application = await DB.prepare(
    `SELECT id, ticket_no, dept, title, status, review_revision FROM application WHERE id = ? OR ticket_no = ?`
  )
    .bind(id, id)
    .first<ReviewApplication>()

  if (!application) return jsonError('그런 신청서가 없습니다.', 404)
  if (Number(application.review_revision) !== input.expectedRevision) return reviewConflict()

  const advanced = ['진행중', '완료'].includes(application.status)
  if (advanced && v.verdict !== '수용') return jsonError('이미 제작하거나 인수한 신청서를 검토 판정으로 이전 단계로 되돌릴 수 없습니다.', 409)
  const nextStatus = advanced ? application.status : statusFromVerdict(v.verdict)

  // 판정을 바꾸는 것 자체는 막지 않는다. 검토는 다시 할 수 있는 일이고,
  // 무엇이 어떻게 바뀌었는지는 decision_log에 두 줄로 남는다.
  const isUpdate = Boolean(
    await DB.prepare('SELECT 1 FROM review WHERE application_id = ?')
      .bind(application.id)
      .first()
  )

  await lockReviewRevision(DB, application)
  const statements = [
    DB.prepare(
      `INSERT INTO review
         (application_id, impact_score, impact_reason, difficulty_score, difficulty_reason,
          verdict, verdict_reason, alternatives_considered,
          refuse_code, refuse_alternative, hold_until_condition, reviewer_label, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(application_id) DO UPDATE SET
         impact_score = excluded.impact_score,
         impact_reason = excluded.impact_reason,
         difficulty_score = excluded.difficulty_score,
         difficulty_reason = excluded.difficulty_reason,
         verdict = excluded.verdict,
         verdict_reason = excluded.verdict_reason,
         alternatives_considered = excluded.alternatives_considered,
         refuse_code = excluded.refuse_code,
         refuse_alternative = excluded.refuse_alternative,
         hold_until_condition = excluded.hold_until_condition,
         reviewer_label = excluded.reviewer_label,
         -- 한 번에 미룰 때 세워 둔 표시를 지운다.
         --
         -- 접수함에서 여러 건을 '보류로 미루기'로 처리하면 bulk = 1 로,
         -- 점수 없이 review 행이 생긴다. 나중에 부서가 조건이 풀렸다고
         -- 알려 와 담당자가 이 화면에서 임팩트·난이도를 매겨 다시 저장해도
         -- 여기서 bulk 를 안 건드리니 1로 남았다.
         --
         -- 그러면 부서 조회 화면이 "점수는 아직 안 매겼습니다"라고 적는다.
         -- 담당자는 매겼는데 부서에게는 안 매긴 것으로 보인다.
         --
         -- 이 라우트는 한 건씩 판정하는 자리라 정의상 일괄이 아니다.
         -- 일괄 쪽(bulk.js)이 필요하면 다시 1로 올린다.
         bulk = 0,
         updated_at = datetime('now')`
    ).bind(
      application.id,
      v.impact_score,
      v.impact_reason,
      v.difficulty_score,
      v.difficulty_reason,
      v.verdict,
      v.verdict_reason,
      v.alternatives_considered,
      v.refuse_code,
      v.refuse_alternative,
      v.hold_until_condition,
      v.reviewer_label
    ),

    DB.prepare(
      `UPDATE application SET status = ?, updated_at = datetime('now') WHERE id = ?`
    ).bind(nextStatus, application.id),

    DB.prepare(
      `INSERT INTO decision_log
         (id, application_id, stage, actor, title, what, why, alternatives, unrequested, link_kind, link_id)
       VALUES (?, ?, '검토', 'human', ?, ?, ?, ?, ?, 'review', ?)`
    ).bind(
      newId('dec'),
      application.id,
      isUpdate ? `판정을 ${v.verdict}(으)로 바꿨다` : `${v.verdict} 판정`,
      buildWhat(application, v),
      v.verdict_reason,
      v.alternatives_considered,
      // 요청받지 않았는데 먼저 꺼낸 것.
      //
      // 이 칸은 읽는 자리가 셋인데(/log 거르기, 결정 기록 집계, 첫 화면)
      // **쓰는 자리가 하나도 없었다.** 65건 전부 0이라 "먼저 제안한 것만"
      // 필터는 늘 빈 화면을 보여줬다. 있다고 해 놓고 없는 기능이다.
      //
      // 반려하면서 대안을 함께 낸 것이 정확히 이것이다. 부서는 A를
      // 해달라고 했고 저희는 못 한다고 했다. 그러면서 아무도 안 물어본
      // B를 꺼냈다. 시킨 일을 한 것이 아니라 먼저 움직인 것이다.
      v.verdict === '반려' && v.refuse_alternative ? 1 : 0,
      application.id
    ),
  ]

  await DB.batch(statements)

  const response = {
    ok: true,
    application_id: application.id,
    ticket_no: application.ticket_no,
    status: nextStatus,
    verdict: v.verdict,
  } satisfies ReviewResponse
  return jsonResponse(response)
  }, '판정을 저장하지 못했습니다.')
}

function buildWhat(application: ReviewApplication, v: ReviewValue): string {
  const head = `${application.ticket_no} · ${application.dept} · ${application.title}`
  const score = `임팩트 ${v.impact_score} / 난이도 ${v.difficulty_score}`
  // 빈 값을 그대로 문장에 끼우면 안 된다.
  //
  // shared/review.ts는 사유와 대안을 비워 둬도 저장한다 — 억지로 채운
  // 스무 글자보다 빈 칸이 정직하기 때문이다. 그런데 여기서 그 null을
  // 그대로 템플릿에 넣어서, 지워지지 않는 결정 기록에
  // "반려(null). 대안: null"이 박혀 있었다.
  const said = (value: unknown, whenEmpty: string) => {
    const t = String(value ?? '').trim()
    return t || whenEmpty
  }

  if (v.verdict === '반려') {
    const why = (v.refuse_code ? REFUSE_LABELS[v.refuse_code] : null) ?? said(v.refuse_code, '사유를 안 고름')
    return `${head} — 반려(${why}). 대안: ${said(v.refuse_alternative, '적지 않음')} [${score}]`
  }
  if (v.verdict === '보류') {
    return `${head} — 보류. 다시 볼 조건: ${said(v.hold_until_condition, '적지 않음')} [${score}]`
  }
  return `${head} — 수용 [${score}]`
}
