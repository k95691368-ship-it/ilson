// 의사결정 로그.
//
// 여덟 단계 어디에서든 무언가를 정하면 여기 남는다. 나중에 "왜 그때 그렇게
// 정했나"에 답할 수 있어야 하고, 그 답이 이 포트폴리오의 알맹이다.
//
// 두 가지를 특히 신경 써서 남긴다.
//   why          : 근거. 이게 비어 있으면 결정이 아니라 클릭이다.
//   alternatives : 무엇을 고르지 않았는가. 대안을 적어야 판단이 판단이 된다.
//
// unrequested는 "아무도 요청하지 않았는데 내가 먼저 제안한 것"이다. 따로 세어
// 화면에 보여준다 — 시킨 일을 했는지와 먼저 움직였는지는 다른 이야기다.

import { newId } from './ids.js'

export const STAGES = [
  '신청서',
  '검토',
  '협의안',
  '제작',
  '베타테스트',
  '사용법서',
  '배포',
  '성과',
]

export async function logDecision(env, entry) {
  const {
    applicationId = null,
    stage,
    actor = 'human',
    title,
    what,
    why,
    alternatives = null,
    unrequested = false,
    linkKind = null,
    linkId = null,
  } = entry

  if (!STAGES.includes(stage)) {
    throw new Error(`알 수 없는 단계: ${stage}`)
  }
  if (!why) {
    // 근거 없는 결정은 기록할 가치가 없다. 여기서 막지 않으면 나중에
    // "왜?"라는 칸이 빈 로그가 쌓이고, 그러면 이 표가 있으나 마나 해진다.
    throw new Error('결정을 기록하려면 근거(why)가 필요합니다.')
  }

  const id = newId('dec')
  await env.DB.prepare(
    `INSERT INTO decision_log
       (id, application_id, stage, actor, title, what, why, alternatives, unrequested, link_kind, link_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      applicationId,
      stage,
      actor,
      title,
      what,
      why,
      alternatives,
      unrequested ? 1 : 0,
      linkKind,
      linkId
    )
    .run()
  return id
}

// AI가 낸 초안도 남긴다. actor='ai'라 화면에서 사람의 결정과 섞이지 않는다.
// 남기는 이유는 "무엇을 AI가 제안했고 사람이 그중 무엇을 받아들였나"가
// 이 포트폴리오의 서사이기 때문이다.
export async function logAiDraft(env, { applicationId, stage, title, what, usage, linkKind, linkId }) {
  return logDecision(env, {
    applicationId,
    stage,
    actor: 'ai',
    title,
    what,
    why: usage
      ? `${usage.model} · 입력 ${usage.inputTokens} / 출력 ${usage.outputTokens} 토큰 · 약 ${usage.costKrw}원 · 프롬프트 ${usage.promptVersion}`
      : '초안 생성',
    linkKind,
    linkId,
  })
}

// AI 호출 자체의 기록. 성과 정산에서 운영 비용을 차감하려면 얼마를 썼는지
// 알아야 하고, 그 값은 추정이 아니라 실제 응답의 usage여야 한다.
export async function logAiCall(env, { stage, purpose, applicationId = null, usage, durationMs = null, ok = true, failReason = null }) {
  await env.DB.prepare(
    `INSERT INTO ai_call
       (id, stage, purpose, application_id, model, prompt_version,
        input_tokens, output_tokens, cost_krw, duration_ms, ok, fail_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      newId('aic'),
      stage,
      purpose,
      applicationId,
      usage?.model ?? 'unknown',
      usage?.promptVersion ?? 'unknown',
      usage?.inputTokens ?? 0,
      usage?.outputTokens ?? 0,
      usage?.costKrw ?? 0,
      durationMs,
      ok ? 1 : 0,
      failReason
    )
    .run()
    // 기록에 실패했다고 사용자의 작업까지 실패시키지는 않는다.
    .catch(() => {})
}
