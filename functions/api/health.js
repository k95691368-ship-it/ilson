// 배포가 실제로 살아 있는지 확인하는 자리.
//
// 화면이 뜨는 것과 백엔드가 도는 것은 다른 이야기다. 정적 파일은 D1 바인딩이
// 없어도 200으로 나오므로, 무엇이 준비되고 무엇이 안 됐는지를 여기서 말한다.
//
// 준비가 덜 된 것도 200으로 답한다. 그래야 무엇이 없는지를 본문으로 읽을 수
// 있다 — 503으로 끊으면 원인이 아니라 증상만 보인다.

import { jsonResponse } from '../_lib/http.js'

// 이 표들이 있으면 스키마가 적용된 것으로 본다.
const CORE_TABLES = ['users', 'sessions', 'rate_limit_hits', 'audit_log', 'decision_log', 'notifications']

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
