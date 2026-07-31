// 배포가 실제로 살아 있는지 확인하는 자리.
//
// 화면이 뜨는 것과 백엔드가 도는 것은 다른 이야기다. 정적 파일은 D1 바인딩이
// 없어도 200으로 나오므로, 무엇이 준비되고 무엇이 안 됐는지를 여기서 말한다.

import { jsonResponse } from '../_lib/http.js'
import { hasApiKey, MODEL, PROMPT_VERSION } from '../_lib/claude.js'

export async function onRequestGet({ env }) {
  const checks = { db: false, r2: false, claudeKey: hasApiKey(env), seeded: false }
  const notes = []

  try {
    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM request').first()
    checks.db = true
    checks.seeded = (row?.n ?? 0) > 0
    if (!checks.seeded) notes.push('데이터베이스는 연결됐지만 비어 있습니다. 시연 데이터를 심어주세요.')
  } catch (err) {
    notes.push(`D1을 읽지 못했습니다: ${String(err.message).slice(0, 120)}`)
  }

  try {
    // 존재하지 않는 키를 읽는 것만으로 바인딩 여부를 알 수 있다. 쓰기를 하지 않는다.
    await env.SOURCES.head('__healthcheck__')
    checks.r2 = true
  } catch (err) {
    notes.push(`R2를 읽지 못했습니다: ${String(err.message).slice(0, 120)}`)
  }

  if (!checks.claudeKey) {
    notes.push('CLAUDE_API_KEY가 없습니다. AI 초안 기능은 막히고 나머지는 그대로 동작합니다.')
  }

  const ready = checks.db && checks.claudeKey
  return jsonResponse(
    { ready, checks, notes, engine: { model: MODEL, promptVersion: PROMPT_VERSION } },
    ready ? 200 : 200 // 준비가 덜 됐다는 것도 정상 응답이다. 무엇이 없는지가 본문에 있다.
  )
}
