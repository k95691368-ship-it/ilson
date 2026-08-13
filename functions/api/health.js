// 배포가 실제로 살아 있는지 확인하는 자리.
//
// 화면이 뜨는 것과 백엔드가 도는 것은 다른 이야기다. 정적 파일은 D1 바인딩이
// 없어도 200으로 나오므로, 무엇이 준비되고 무엇이 안 됐는지를 여기서 말한다.
//
// 준비가 덜 된 것도 200으로 답한다. 그래야 무엇이 없는지를 본문으로 읽을 수
// 있다 — 503으로 끊으면 원인이 아니라 증상만 보인다.

import { jsonResponse } from '../_lib/http.js'

// 이 표들이 있으면 스키마가 적용된 것으로 본다.
//
// 여기 users·sessions·audit_log·notifications 가 적혀 있었다. **이 사이트에는
// 로그인이 없다.** 접수번호 하나가 열쇠이고 계정도 세션도 안 만든다. 앞
// 저장소에서 공용 부품을 가져올 때 딸려 온 표들이고, 이 제품의 코드는 그
// 넷을 한 줄도 안 읽고 안 쓴다.
//
// 그런데 준비됐는지를 그 넷으로 판정하고 있었다. 그러면 두 방향으로 틀린다 —
// 그 표 없이 새로 배포하면 멀쩡히 도는 배포를 "덜 준비됐습니다"라고 신고하고,
// 반대로 여섯 단계에 실제로 쓰는 표가 통째로 빠져 있어도 "준비된 상태입니다"
// 라고 답한다. 확인한다는 말만 있고 확인하는 것은 딴것이었다.
//
// 한 건을 여섯 단계로 굴리는 데 반드시 있어야 하는 표로 바꾼다.
const CORE_TABLES = [
  'application',
  'review',
  'decision_log',
  'acceptance_criterion',
  'baseline',
  'build_run',
  'beta_round',
  'manual',
  'handover',
  'tool_use',
  'outcome',
  'rate_limit_hits',
]

export async function onRequestGet({ env }) {
  const checks = { db: false, schema: false }
  const notes = []
  let tables = []

  if (!env.DB) {
    notes.push('D1 바인딩(DB)이 없습니다. wrangler.toml의 d1_databases 설정과 배포본을 확인해주세요.')
  } else {
    try {
      const { results } = await env.DB.prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name`
      ).all()
      checks.db = true
      tables = results.map((r) => r.name)
      const missing = CORE_TABLES.filter((t) => !tables.includes(t))
      checks.schema = missing.length === 0
      if (missing.length > 0) {
        notes.push(`스키마가 덜 적용됐습니다. 없는 표: ${missing.join(', ')}`)
      }
    } catch (err) {
      notes.push(`D1을 읽지 못했습니다: ${String(err.message).slice(0, 140)}`)
    }
  }

  // R2 바인딩도 여기서 봤었다. 첨부 기능을 걷어낸 뒤로는 아무 데서도
  // 파일을 저장하지 않으므로, 그 바인딩이 없다고 "준비 안 됨"이라고 답하면
  // 멀쩡한 배포를 고장으로 신고하는 셈이 된다.
  const ready = checks.db && checks.schema
  return jsonResponse({
    ready,
    checks,
    tables,
    notes,
  })
}
