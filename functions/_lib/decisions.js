// 의사결정 로그.
//
// 이 앱에서 가장 중요한 표가 여기 붙어 있다. 여덟 단계 어디에서든 무언가를
// 정하면 그 기록이 남고, 나중에 "왜 그때 그렇게 정했나"에 답할 수 있다.
//
// 두 가지를 특히 신경 써서 남긴다.
//   why          : 근거. 이게 비어 있으면 결정이 아니라 클릭이다.
//   alternatives : 무엇을 고르지 않았는가. 대안을 적어야 판단이 판단이 된다.
//
// unrequested는 "아무도 요청하지 않았는데 내가 먼저 제안한 것"이다. 별도로
// 세어 화면에 따로 보여준다 — 시킨 일을 했는지와 먼저 움직였는지는 다른 이야기다.

import { newId } from './ids.js'

export const STAGES = [
  '접수',
  '발굴회의',
  '충돌판정',
  '기준선',
  '제작',
  '품질기준',
  '성과정의',
  '인수인계',
]

export async function logDecision(env, entry) {
  const {
    requestId = null,
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

  const id = newId('dec')
  await env.DB.prepare(
    `INSERT INTO decision_log
       (id, request_id, stage, actor, title, what, why, alternatives, unrequested, link_kind, link_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      requestId,
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

// AI가 낸 초안도 로그에 남긴다. actor='ai'이므로 화면에서 사람의 결정과
// 섞이지 않는다. 남기는 이유는 "무엇을 AI가 제안했고 사람이 그중 무엇을
// 받아들였나"가 이 포트폴리오의 서사이기 때문이다.
export async function logAiDraft(env, { requestId, stage, title, what, usage, linkKind, linkId }) {
  return logDecision(env, {
    requestId,
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
