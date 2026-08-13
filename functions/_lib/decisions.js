// 의사결정 로그.
//
// 여섯 단계 어디에서든 무언가를 정하면 여기 남는다. 나중에 "왜 그때 그렇게
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
