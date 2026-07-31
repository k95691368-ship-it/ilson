// 2단계 — AI에게 검토 초안을 부탁한다.
//
// 초안일 뿐이다. 이 라우트는 review 표를 건드리지 않는다. review_ai_draft에만
// 쓰고, 담당자가 화면에서 값을 가져다 고쳐서 낼 때 비로소 판정이 된다.
//
// 호출 한도를 IP 단위와 신청서 단위 둘 다 건다. 같은 신청서를 계속 다시
// 부르는 것은 대개 결과가 마음에 안 들어서인데, 그건 프롬프트가 아니라 신청서
// 내용이 부족한 것이라 다시 불러도 나아지지 않는다.

import { jsonResponse, jsonError } from '../../../_lib/http.js'
import { checkRateLimit, releaseRateLimit } from '../../../_lib/rateLimit.js'
import { hasApiKey } from '../../../_lib/claude.js'
import { draftReview } from '../../../_lib/ai/review.js'
import { logAiCall, logDecision } from '../../../_lib/decisions.js'

export async function onRequestPost({ env, params, request }) {
  if (!hasApiKey(env)) {
    return jsonError(
      'CLAUDE_API_KEY가 설정되지 않아 AI 초안을 만들 수 없습니다. 검토와 판정은 그대로 하실 수 있습니다.',
      503
    )
  }

  const id = params.id
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown'

  const application = await env.DB.prepare(
    `SELECT * FROM application WHERE id = ? OR ticket_no = ?`
  )
    .bind(id, id)
    .first()
  if (!application) return jsonError('그런 신청서가 없습니다.', 404)

  const ipTicket = await checkRateLimit(env, `ai-draft:${ip}`, 20, 3600)
  if (!ipTicket) {
    return jsonError('AI 초안은 시간당 20회까지 부를 수 있습니다.', 429)
  }
  const appTicket = await checkRateLimit(env, `ai-draft-app:${application.id}`, 3, 3600)
  if (!appTicket) {
    await releaseRateLimit(env, `ai-draft:${ip}`, ipTicket)
    return jsonError(
      '이 신청서로는 시간당 3회까지 부를 수 있습니다. 결과가 부족하다면 대개 프롬프트가 아니라 신청서 내용이 부족한 것이라, 부서에 되묻는 편이 빠릅니다.',
      429
    )
  }

  const [{ results: files }, { results: others }] = await Promise.all([
    env.DB.prepare('SELECT name FROM application_file WHERE application_id = ?')
      .bind(application.id)
      .all(),
    env.DB.prepare(
      `SELECT id, dept, title, status FROM application WHERE id <> ? ORDER BY created_at DESC LIMIT 20`
    )
      .bind(application.id)
      .all(),
  ])

  const started = Date.now()
  let draft
  try {
    draft = await draftReview(env, {
      application: { ...application, file_names: files.map((f) => f.name) },
      others,
    })
  } catch (err) {
    // 실패한 호출은 한도를 소모하지 않는다. 한도는 "몇 번 해냈는가"를 세는 것이다.
    await releaseRateLimit(env, `ai-draft:${ip}`, ipTicket)
    await releaseRateLimit(env, `ai-draft-app:${application.id}`, appTicket)
    await logAiCall(env, {
      stage: '검토',
      purpose: 'review_draft',
      applicationId: application.id,
      usage: null,
      durationMs: Date.now() - started,
      ok: false,
      failReason: String(err.message).slice(0, 200),
    })
    return jsonError(err.message, 502)
  }

  const usage = draft._usage
  await logAiCall(env, {
    stage: '검토',
    purpose: 'review_draft',
    applicationId: application.id,
    usage,
    durationMs: Date.now() - started,
  })

  try {
    await env.DB.prepare(
      `INSERT INTO review_ai_draft
         (application_id, summary, feasible, feasible_reason, blocked_by, suggested_alternative,
          partial_note, suggested_impact, suggested_impact_reason,
          suggested_difficulty, suggested_difficulty_reason,
          similar_ids_json, confidence, model, prompt_version, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(application_id) DO UPDATE SET
         summary = excluded.summary,
         feasible = excluded.feasible,
         feasible_reason = excluded.feasible_reason,
         blocked_by = excluded.blocked_by,
         suggested_alternative = excluded.suggested_alternative,
         partial_note = excluded.partial_note,
         suggested_impact = excluded.suggested_impact,
         suggested_impact_reason = excluded.suggested_impact_reason,
         suggested_difficulty = excluded.suggested_difficulty,
         suggested_difficulty_reason = excluded.suggested_difficulty_reason,
         similar_ids_json = excluded.similar_ids_json,
         confidence = excluded.confidence,
         model = excluded.model,
         prompt_version = excluded.prompt_version,
         created_at = datetime('now'),
         accepted_at = NULL`
    )
      .bind(
        application.id,
        draft.summary,
        draft.feasible ? 1 : 0,
        draft.feasible_reason,
        draft.blocked_by ?? null,
        draft.suggested_alternative ?? null,
        draft.partial_note ?? null,
        draft.suggested_impact ?? null,
        draft.suggested_impact_reason ?? null,
        draft.suggested_difficulty ?? null,
        draft.suggested_difficulty_reason ?? null,
        JSON.stringify(draft.similar_ids ?? []),
        draft.confidence ?? null,
        usage.model,
        usage.promptVersion
      )
      .run()
  } catch (err) {
    return jsonError(`초안을 저장하지 못했습니다. (${String(err.message).slice(0, 160)})`, 500)
  }

  // AI가 무엇을 제안했는지도 기록에 남긴다. actor='ai'라 사람의 결정과 섞이지
  // 않고, "무엇을 제안했고 사람이 그중 무엇을 받아들였나"가 남는다.
  await logDecision(env, {
    applicationId: application.id,
    stage: '검토',
    actor: 'ai',
    title: draft.feasible ? '만들 수 있는 일로 봄 (초안)' : '범위 밖으로 봄 (초안)',
    what: draft.feasible_reason,
    why: `${usage.model} · 입력 ${usage.inputTokens} / 출력 ${usage.outputTokens} 토큰 · 약 ${usage.costKrw}원 · 확신도 ${draft.confidence ?? '—'}`,
    linkKind: 'review_ai_draft',
    linkId: application.id,
  }).catch(() => {})

  return jsonResponse({
    ...draft,
    _usage: undefined,
    usage: {
      model: usage.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costKrw: usage.costKrw,
      durationMs: Date.now() - started,
    },
  })
}
