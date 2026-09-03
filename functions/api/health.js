// 배포가 실제로 살아 있는지 확인하는 자리.
//
// 화면이 뜨는 것과 백엔드가 도는 것은 다른 이야기다. 정적 파일은 DB 바인딩이
// 없어도 200으로 나오므로, 무엇이 준비되고 무엇이 안 됐는지를 여기서 말한다.
//
// 준비가 덜 된 것도 200으로 답한다. 그래야 무엇이 없는지를 본문으로 읽을 수
// 있다 — 503으로 끊으면 원인이 아니라 증상만 보인다.

import { jsonResponse } from '../_lib/http.js'

// 여섯 단계를 돌려야 하는 필수 표(데이터베이스가 바뀌어도 동일하게 확인)
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
  const checks = { db: false, schema: false, provider: false }
  const notes = []
  let tables = []

  if (!env.DB) {
    notes.push('데이터베이스 바인딩(DB)이 없습니다. wrangler.toml의 바인딩 또는 Supabase 설정을 확인해주세요.')
    return jsonResponse({ ready: false, checks, tables, notes })
  }

  const isSupabase = Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY)
  checks.provider = isSupabase ? 'supabase' : 'd1'

  try {
    if (isSupabase) {
      const rows = await env.DB.prepare(
        `SELECT table_name AS name
         FROM information_schema.tables
         WHERE table_schema = 'public'
           AND table_type = 'BASE TABLE'
         ORDER BY table_name`
      ).all()
      checks.db = true
      tables = rows.results.map((r) => r.name)
    } else {
      const rows = await env.DB.prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name`
      ).all()
      checks.db = true
      tables = rows.results.map((r) => r.name)
    }

    const missing = CORE_TABLES.filter((t) => !tables.includes(t))
    checks.schema = missing.length === 0
    if (missing.length > 0) {
      notes.push(`스키마가 덜 적용됐습니다. 없는 표: ${missing.join(', ')}`)
    }

    if (isSupabase) {
      notes.push('DB provider = Supabase')
    }
  } catch (err) {
    notes.push(`DB를 읽지 못했습니다: ${String(err.message).slice(0, 140)}`)
  }

  const ready = checks.db && checks.schema
  return jsonResponse({
    ready,
    checks,
    tables,
    notes,
  })
}

