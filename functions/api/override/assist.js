import { jsonResponse, jsonError, failUnexpected } from '../../_lib/http.js'
import { newId } from '../../_lib/ids.js'
import {
  ensureOverrideSchema,
  resolveOverrideActor,
  requireOverridePermission,
  auditOverride,
} from '../../_lib/override.js'

const MODEL = 'claude-opus-5'
const PROMPT_VERSION = 'override-assist-v1'

function redactSensitive(value) {
  return String(value ?? '')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[이메일 삭제]')
    .replace(/\b01[016789][- ]?\d{3,4}[- ]?\d{4}\b/g, '[전화번호 삭제]')
    .replace(/\b\d{6}[- ]?[1-4]\d{6}\b/g, '[주민번호 삭제]')
    .replace(/\b(?:\d[ -]*?){13,19}\b/g, '[결제번호 삭제]')
    .slice(0, 12000)
}

function promptFor(kind, context) {
  const common = `당신은 사내 AI 운영 개선 시스템 OverrideLoop의 분석 보조자다.
사람의 수정이 반드시 정답이라고 가정하지 않는다. 모델 문제로 성급히 단정하지 않는다.
모델·데이터·정책 검색·정책 공백·업무 절차·시스템·UX·정당한 예외·사람 오류를 모두 검토한다.
제안은 초안이며 원문 근거와 담당자의 최종 확인이 필요하다는 전제를 지킨다.
응답은 설명 없이 유효한 JSON 객체 하나만 반환한다.`

  if (kind === 'event') {
    return `${common}
다음 사건을 분석해 summary, reason_candidates(최대 3개: cause_code, confidence, evidence),
cluster_keywords(최대 6개), missing_evidence(배열)를 반환하라.
<event>${context}</event>`
  }
  if (kind === 'cluster') {
    return `${common}
다음 반복 문제를 분석해 cause_hypotheses(최대 3개: cause_code, confidence, evidence, disconfirming_evidence),
affected_surfaces(배열), owner_team, investigation_steps(배열)를 반환하라.
<cluster>${context}</cluster>`
  }
  return `${common}
다음 문제 군집을 해결하는 실험 카드 초안을 작성하라.
title, change_target, hypothesis, scope, comparator, success_metric, metric_direction(lower|higher),
target_improvement, guardrails(배열), stop_conditions(배열), rollback_plan을 반환하라.
고위험 변경을 자동 승인하거나 자동 확대하지 마라.
<experiment_context>${context}</experiment_context>`
}

function parseJsonText(value) {
  const raw = String(value ?? '').trim()
  const unfenced = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
  return JSON.parse(unfenced)
}

export async function onRequestPost({ env, request }) {
  let body
  try {
    body = await request.json()
  } catch {
    return jsonError('보내주신 내용을 읽지 못했습니다.', 400)
  }

  try {
    await ensureOverrideSchema(env)
    const actor = await resolveOverrideActor(env, request, body)
    requireOverridePermission(actor, 'ai_assist')
    if (!env.CLAUDE_API_KEY) {
      return jsonError('Claude Opus 5 연결이 아직 설정되지 않았습니다.', 503)
    }

    const kind = ['event', 'cluster', 'experiment'].includes(body.kind) ? body.kind : 'event'
    const context = redactSensitive(JSON.stringify(body.context ?? {}))
    if (context.length < 8) return jsonError('분석할 사건이나 문제 내용을 넣어주세요.', 400)
    const started = Date.now()
    let response
    try {
      response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.CLAUDE_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 1600,
          messages: [{ role: 'user', content: promptFor(kind, context) }],
        }),
        signal: AbortSignal.timeout(45000),
      })
    } catch (error) {
      await env.DB.prepare(
        `INSERT INTO override_ai_call
         (id, purpose, entity_kind, entity_id, model, prompt_version, duration_ms, ok,
          fail_reason, actor_label)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
      )
        .bind(
          newId('olai'),
          kind,
          body.entityKind ?? null,
          body.entityId ?? null,
          MODEL,
          PROMPT_VERSION,
          Date.now() - started,
          String(error.message ?? '').slice(0, 180),
          actor.label
        )
        .run()
      throw error
    }

    const payload = await response.json().catch(() => null)
    if (!response.ok) {
      const message = payload?.error?.message ?? `Claude API ${response.status}`
      await env.DB.prepare(
        `INSERT INTO override_ai_call
         (id, purpose, entity_kind, entity_id, model, prompt_version, input_tokens,
          output_tokens, duration_ms, ok, fail_reason, actor_label)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
      )
        .bind(
          newId('olai'),
          kind,
          body.entityKind ?? null,
          body.entityId ?? null,
          MODEL,
          PROMPT_VERSION,
          Number(payload?.usage?.input_tokens) || 0,
          Number(payload?.usage?.output_tokens) || 0,
          Date.now() - started,
          String(message).slice(0, 180),
          actor.label
        )
        .run()
      return jsonError('Claude Opus 5가 분석 초안을 만들지 못했습니다.', 502)
    }

    const answer = payload?.content?.find((block) => block.type === 'text')?.text
    let draft
    try {
      draft = parseJsonText(answer)
    } catch {
      return jsonError('AI 응답을 구조화된 초안으로 읽지 못했습니다.', 502)
    }
    const callId = newId('olai')
    await env.DB.prepare(
      `INSERT INTO override_ai_call
       (id, purpose, entity_kind, entity_id, model, prompt_version, input_tokens,
        output_tokens, duration_ms, ok, actor_label)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
    )
      .bind(
        callId,
        kind,
        body.entityKind ?? null,
        body.entityId ?? null,
        MODEL,
        PROMPT_VERSION,
        Number(payload?.usage?.input_tokens) || 0,
        Number(payload?.usage?.output_tokens) || 0,
        Date.now() - started,
        actor.label
      )
      .run()
    await auditOverride(env, actor, 'ai_assist', body.entityKind ?? kind, body.entityId ?? null, {
      call_id: callId,
      model: MODEL,
      prompt_version: PROMPT_VERSION,
    })
    return jsonResponse({
      draft,
      model: MODEL,
      prompt_version: PROMPT_VERSION,
      sensitive_values_redacted: true,
      requires_human_confirmation: true,
    })
  } catch (error) {
    if (error?.status) return jsonError(error.message, error.status)
    return failUnexpected(error, 'AI 분석 초안을 만들지 못했습니다.')
  }
}
