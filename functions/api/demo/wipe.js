// 예시 자료를 전부 지운다.
//
// 사용자가 "기존에 있던 예시 자료들도 전부 삭제"를 지시했다. 이 사이트의
// 데이터는 전부 예시다 — 실존하는 회사·부서·사람이 아니다. 그래서 이건
// 신청서 전체를 지우는 일이 된다.
//
// **되돌릴 수 없다.** 여덟 단계를 끝까지 간 기록 한 건(결정 40건, 합격기준
// 6개, 기준선 실측 3회, 시험판, 도구 실행 3회)도 함께 사라진다. 그걸 알고
// 내린 결정이라 그대로 실행한다.
//
// 지우는 순서가 중요하다. D1은 외래키 ON DELETE CASCADE 를 걸어 뒀지만
// 그것에만 기대지 않는다 — 마이그레이션이 부분 적용된 환경에서 캐스케이드가
// 안 걸린 표가 남으면 고아 행이 조용히 남는다. 자식부터 손으로 지운다.
//
// R2에 올라간 원본 파일은 표에서만 지운다. 객체까지 지우다 실패하면 표는
// 사라졌는데 파일은 남아 어느 것이 고아인지 알 수 없게 된다. 그건 별도
// 정리 작업의 몫이다.

import { jsonResponse, jsonError } from '../../_lib/http.js'

// 신청서에 딸린 것들. 자식부터 지운다.
//
// 이 목록이 실제 표와 어긋나면 고아 행이 남는다. tests/schema.test.js 가
// 없는 표를 쓰면 잡아 준다.
const CHILD_TABLES = [
  'beta_result',
  'beta_feedback',
  'beta_round',
  'build_run',
  'tool_use',
  'outcome_challenge',
  'outcome',
  'handover',
  'manual_faq',
  'manual',
  'acceptance_criterion',
  'requirement_conflict',
  'requirement',
  'meeting',
  'stakeholder',
  'shadow_run',
  'baseline',
  'review_ai_draft',
  'review',
  'application_file',
  'decision_log',
]

async function countAll(env) {
  const out = {}
  for (const t of ['application', ...CHILD_TABLES]) {
    try {
      const r = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first()
      if ((r?.n ?? 0) > 0) out[t] = r.n
    } catch {
      // 그 표가 없는 환경일 수 있다. 없는 것은 셀 것도 없다.
    }
  }
  return out
}

export async function onRequestGet({ env }) {
  try {
    const counts = await countAll(env)
    const total = Object.values(counts).reduce((n, v) => n + v, 0)
    return jsonResponse({
      counts,
      total,
      note:
        total === 0
          ? '지울 것이 없습니다.'
          : `표 ${Object.keys(counts).length}곳에 걸쳐 ${total}줄입니다. 되돌릴 수 없습니다.`,
    })
  } catch (err) {
    return jsonError(`세지 못했습니다. (${String(err.message).slice(0, 160)})`, 503)
  }
}

export async function onRequestDelete({ env, request }) {
  // 실수로 눌리는 것을 막는다. 주소만 알면 누구나 부를 수 있는 자리라,
  // 지운다는 뜻을 몸에 적어야 실행된다.
  let body = {}
  try {
    body = await request.json()
  } catch {
    // 몸이 없으면 아래에서 막힌다.
  }
  if (body?.confirm !== '전부 지웁니다') {
    return jsonError('되돌릴 수 없는 일입니다. confirm 에 "전부 지웁니다"를 넣어 주세요.', 400)
  }

  try {
    const before = await countAll(env)
    const statements = []
    for (const t of CHILD_TABLES) {
      // 없는 표는 건너뛴다. 마이그레이션이 부분 적용된 환경이 있다.
      if (before[t] === undefined) continue
      statements.push(env.DB.prepare(`DELETE FROM ${t}`))
    }
    statements.push(env.DB.prepare('DELETE FROM application'))
    await env.DB.batch(statements)

    const after = await countAll(env)
    const left = Object.values(after).reduce((n, v) => n + v, 0)
    return jsonResponse({
      ok: true,
      removed: before,
      left: after,
      message:
        left === 0
          ? '예시 자료를 전부 지웠습니다. 되돌릴 수 없습니다.'
          : `${left}줄이 남았습니다. 지우는 목록에 없는 표가 있습니다.`,
    })
  } catch (err) {
    return jsonError(`지우지 못했습니다. (${String(err.message).slice(0, 160)})`, 503)
  }
}
