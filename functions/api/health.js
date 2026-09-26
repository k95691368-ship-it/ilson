// 배포가 실제로 살아 있는지 확인하는 자리.
//
// 화면이 뜨는 것과 백엔드가 도는 것은 다른 이야기다. 정적 파일은 DB 바인딩이
// 없어도 200으로 나오므로, 무엇이 준비되고 무엇이 안 됐는지를 여기서 말한다.
//
// 준비되지 않은 경우 JSON 설명과 HTTP 503을 함께 반환한다.

import { jsonResponse } from '../_lib/http.ts'

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
const FEEDBACK_TABLES = [
  'field_feedback_case', 'field_feedback_update', 'field_feedback_receipt',
  'quality_sample_batch', 'quality_sample_item', 'tool_nonuse_report',
  'issue_followup', 'quality_sample_review_history', 'application_participation',
]

export async function onRequestGet({ env, data: requestData }) {
  env = requestData?.requestEnv ?? env
  const checks = { db: false, schema: false, provider: false }
  const notes = []
  let tables = []

  if (!env.DB) {
    notes.push('데이터베이스 바인딩(DB)이 없습니다. wrangler.toml의 바인딩 또는 Supabase 설정을 확인해주세요.')
    return jsonResponse({ ready: false, checks, tables, notes }, 503)
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

    // A healthy legacy schema alone cannot serve the deployed feedback feature.
    const required = isSupabase ? [...CORE_TABLES, ...FEEDBACK_TABLES] : CORE_TABLES
    const missing = required.filter((t) => !tables.includes(t))
    checks.schema = missing.length === 0
    if (missing.length > 0) {
      notes.push(`스키마가 덜 적용됐습니다. 없는 표: ${missing.join(', ')}`)
    }

    if (isSupabase) {
      notes.push('DB provider = Supabase')
      const readiness = await env.DB.readiness()
      checks.runtime = readiness.schemaReady === true
      checks.capacity = env.DEMO_WORKSPACES !== 'true' || readiness.capacityAvailable === true
      if (!checks.runtime) notes.push('운영 RPC 또는 0006~0013 접근 권한·후속 처리·재검토·참여 부서·소유계정·실행·베타·검토 버전 마이그레이션이 준비되지 않았습니다.')
      if (!checks.capacity) notes.push('새 체험 공간 정원이 찼습니다. 소개 화면과 기존 체험 공간은 계속 사용할 수 있습니다.')
    }
  } catch {
    notes.push('DB를 읽지 못했습니다. 서버 연결 설정과 데이터베이스 상태를 확인해주세요.')
  }

  const ready = checks.db && checks.schema && (!isSupabase || (checks.runtime === true && checks.capacity === true))
  return jsonResponse({
    ready,
    checks,
    tables,
    notes,
  }, ready ? 200 : 503)
}
