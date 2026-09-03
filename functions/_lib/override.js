import { newId } from './ids.js'
import { OVERRIDE_ROLES, roleCan } from '../../shared/override.js'

// Pages Functions는 새 격리 프로세스가 뜰 때마다 파일을 다시 읽는다. 같은
// 프로세스 안에서는 한 번만 확인하고, 새 배포나 새 Supabase 프로젝트에서도
// 첫 요청이 필요한 표를 스스로 보장한다. D1 마이그레이션은 별도로 남겨
// 스키마 이력과 로컬 재현도 유지한다.
let schemaPromise = null

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS override_product (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, domain TEXT NOT NULL, owner_team TEXT NOT NULL,
    model_name TEXT NOT NULL, model_version TEXT NOT NULL, prompt_version TEXT NOT NULL,
    agent_version TEXT, policy_version TEXT NOT NULL, tool_version TEXT,
    status TEXT NOT NULL DEFAULT '운영', total_cases INTEGER NOT NULL DEFAULT 0,
    applicable_cases INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS issue_cluster (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, summary TEXT NOT NULL, sample_text TEXT,
    cause_code TEXT NOT NULL DEFAULT 'unknown', cause_status TEXT NOT NULL DEFAULT 'candidate',
    cause_candidates_json TEXT, policy_refs_json TEXT, affected_workflow TEXT,
    affected_customer_count INTEGER NOT NULL DEFAULT 0,
    customer_impact_score REAL NOT NULL DEFAULT 0, operations_cost_krw REAL NOT NULL DEFAULT 0,
    regulatory_risk_score REAL NOT NULL DEFAULT 0, recurrence_count INTEGER NOT NULL DEFAULT 0,
    owner_team TEXT NOT NULL, priority_score REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'open', first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen_at TEXT NOT NULL DEFAULT (datetime('now')), cause_confirmed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS override_event (
    id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES override_product(id) ON DELETE CASCADE,
    cluster_id TEXT REFERENCES issue_cluster(id) ON DELETE SET NULL, external_ref TEXT,
    source_kind TEXT NOT NULL DEFAULT 'work_ui', occurred_at TEXT NOT NULL DEFAULT (datetime('now')),
    reviewer_label TEXT NOT NULL, reviewer_role TEXT NOT NULL, decision_action TEXT NOT NULL,
    is_override INTEGER NOT NULL DEFAULT 1, ai_decision TEXT NOT NULL, human_decision TEXT NOT NULL,
    changed_fields_json TEXT, reason_code TEXT NOT NULL, reason_detail TEXT NOT NULL,
    policy_refs_json TEXT, model_version TEXT NOT NULL, prompt_version TEXT NOT NULL,
    agent_version TEXT, tool_version TEXT, data_refs_json TEXT, tools_json TEXT, segment TEXT,
    customer_impact_score REAL NOT NULL DEFAULT 0, operations_cost_krw REAL NOT NULL DEFAULT 0,
    regulatory_risk_score REAL NOT NULL DEFAULT 0, customer_outcome TEXT, business_outcome TEXT,
    recording_seconds INTEGER NOT NULL DEFAULT 0,
    validity TEXT NOT NULL DEFAULT 'pending', validity_reason TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS change_experiment (
    id TEXT PRIMARY KEY, cluster_id TEXT NOT NULL REFERENCES issue_cluster(id) ON DELETE CASCADE,
    title TEXT NOT NULL, change_target TEXT NOT NULL, hypothesis TEXT NOT NULL, scope TEXT NOT NULL,
    comparator TEXT NOT NULL, success_metric TEXT NOT NULL, metric_direction TEXT NOT NULL DEFAULT 'lower',
    target_improvement REAL NOT NULL DEFAULT 0, guardrails_json TEXT NOT NULL,
    stop_conditions_json TEXT NOT NULL, approver TEXT NOT NULL, rollback_plan TEXT NOT NULL,
    risk_level TEXT NOT NULL DEFAULT 'medium', current_phase TEXT NOT NULL DEFAULT 'draft',
    status TEXT NOT NULL DEFAULT 'draft', approved_by TEXT, approved_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS experiment_run (
    id TEXT PRIMARY KEY, experiment_id TEXT NOT NULL REFERENCES change_experiment(id) ON DELETE CASCADE,
    phase TEXT NOT NULL, status TEXT NOT NULL, control_value REAL NOT NULL, variant_value REAL NOT NULL,
    improvement_percent REAL NOT NULL, sample_size INTEGER NOT NULL,
    guardrail_breaches INTEGER NOT NULL DEFAULT 0, cost_before_krw REAL NOT NULL DEFAULT 0,
    cost_after_krw REAL NOT NULL DEFAULT 0, notes TEXT, run_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS override_decision_record (
    id TEXT PRIMARY KEY,
    experiment_id TEXT NOT NULL REFERENCES change_experiment(id) ON DELETE CASCADE,
    decision TEXT NOT NULL, basis TEXT NOT NULL, metrics_snapshot_json TEXT NOT NULL,
    decided_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS override_volume (
    id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES override_product(id) ON DELETE CASCADE,
    measured_on TEXT NOT NULL, segment TEXT NOT NULL DEFAULT '전체',
    total_cases INTEGER NOT NULL DEFAULT 0, applicable_cases INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE (product_id, measured_on, segment)
  )`,
  `CREATE TABLE IF NOT EXISTS override_integration (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, endpoint_url TEXT NOT NULL,
    secret_binding TEXT, status TEXT NOT NULL DEFAULT 'configured', last_sync_at TEXT,
    last_result TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS override_actor (
    email TEXT PRIMARY KEY, display_name TEXT NOT NULL, role TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS override_audit (
    id TEXT PRIMARY KEY, actor_label TEXT NOT NULL, actor_role TEXT NOT NULL,
    action TEXT NOT NULL, entity_kind TEXT NOT NULL, entity_id TEXT, detail_json TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS override_ai_call (
    id TEXT PRIMARY KEY, purpose TEXT NOT NULL, entity_kind TEXT, entity_id TEXT,
    model TEXT NOT NULL, prompt_version TEXT NOT NULL, input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0, duration_ms INTEGER, ok INTEGER NOT NULL DEFAULT 1,
    fail_reason TEXT, actor_label TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  'CREATE INDEX IF NOT EXISTS idx_override_event_product ON override_event(product_id, occurred_at)',
  'CREATE INDEX IF NOT EXISTS idx_override_event_cluster ON override_event(cluster_id, occurred_at)',
  'CREATE INDEX IF NOT EXISTS idx_override_event_validity ON override_event(validity, occurred_at)',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_override_event_external ON override_event(product_id, external_ref)',
  'CREATE INDEX IF NOT EXISTS idx_issue_cluster_priority ON issue_cluster(status, priority_score, last_seen_at)',
  'CREATE INDEX IF NOT EXISTS idx_change_experiment_cluster ON change_experiment(cluster_id, created_at)',
  'CREATE INDEX IF NOT EXISTS idx_experiment_run_exp ON experiment_run(experiment_id, created_at)',
  'CREATE INDEX IF NOT EXISTS idx_override_decision_exp ON override_decision_record(experiment_id, created_at)',
  'CREATE INDEX IF NOT EXISTS idx_override_volume_product ON override_volume(product_id, measured_on)',
  'CREATE INDEX IF NOT EXISTS idx_override_audit_created ON override_audit(created_at)',
  'CREATE INDEX IF NOT EXISTS idx_override_audit_target ON override_audit(entity_kind, entity_id, created_at)',
  'CREATE INDEX IF NOT EXISTS idx_override_ai_call_created ON override_ai_call(created_at)',
]

export async function ensureOverrideSchema(env) {
  if (!env?.DB) throw new Error('데이터베이스 연결이 없습니다.')
  if (!schemaPromise) {
    schemaPromise = (async () => {
      for (const sql of SCHEMA) await env.DB.prepare(sql).run()
      return true
    })().catch((error) => {
      schemaPromise = null
      throw error
    })
  }
  return schemaPromise
}

function statement(env, sql, ...values) {
  const placeholders = (sql.match(/\?/g) ?? []).length
  if (placeholders !== values.length) {
    throw new Error(`Override seed binding mismatch: expected ${placeholders}, received ${values.length} (${sql.trim().slice(0, 36)})`)
  }
  return env.DB.prepare(sql).bind(...values)
}

export function overrideDemoMode(env) {
  return String(env?.OVERRIDE_DEMO_MODE ?? 'true').toLowerCase() !== 'false'
}

export async function seedOverrideWorkspace(env) {
  // 사내 운영 모드에는 시연 사건을 만들지 않는다. 공개 포트폴리오에서만
  // 재현 가능한 시작 데이터를 넣는다.
  if (!overrideDemoMode(env)) return false
  const marker = await env.DB.prepare(
    "SELECT id FROM override_audit WHERE action = 'workspace_seeded' LIMIT 1"
  ).first()
  if (marker) return false
  const hasRows = async (table) => {
    const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()
    return Number(row?.n) > 0
  }

  const products = [
    ['olp_loan', '상환 일정 상담 AI', '금융 상담', '고객경험', 'Claude Opus 5', 'opus-5.0', 'loan-v12', 'agent-v7', '대출내규-2026.08', 'crm-tool-v4', 3240, 2960],
    ['olp_order', '주문 보상 Agent', '커머스 운영', 'CS 운영', 'Claude Opus 5', 'opus-5.0', 'refund-v9', 'agent-v5', '보상정책-2026.07', 'order-tool-v11', 1820, 1680],
    ['olp_claim', '보험 서류 분류 AI', '보험 심사', '보험운영', 'Claude Opus 5', 'opus-5.0', 'claim-v21', 'agent-v10', '심사내규-2026.08', 'claim-tool-v8', 910, 884],
  ]

  const clusters = [
    ['olc_policy', '최신 상환 서류가 검색되지 않음', '최신 내규의 고객 유형별 서류가 검색 인덱스에 늦게 반영됩니다.', '서류 A가 아니라 고객 유형에 맞는 서류 B가 필요함 최신 정책 검색', 'policy_retrieval', 'confirmed', '[{"key":"policy_retrieval","confidence":91},{"key":"data","confidence":46}]', '["대출내규-2026.08-14"]', '상환 일정 변경 상담', 17, 4, 1280000, 5, 17, '정책 데이터', 82.4, 'experiment', '-19 days', '-1 day', '-16 days'],
    ['olc_segment', '해외 판매자 세그먼트 누락', '주문 데이터에 판매자 유형이 비어 과도한 보상이 추천됩니다.', '판매자 유형 데이터 누락 보상 한도 오류', 'data', 'confirmed', '[{"key":"data","confidence":88},{"key":"model","confidence":41}]', '["보상정책-2026.07"]', '주문 보상', 11, 3, 740000, 3, 11, '데이터 플랫폼', 60.7, 'experiment', '-24 days', '-2 days', '-20 days'],
    ['olc_permission', '심사 문서 조회 권한 만료', '분류 Agent가 보조 문서를 열지 못해 전문 심사자에게 이관됩니다.', '권한 만료 문서 API 접근 실패 이관', 'system', 'confirmed', '[{"key":"system","confidence":94},{"key":"process","confidence":35}]', '["심사내규-2026.08"]', '보험 서류 분류', 6, 3, 410000, 4, 6, '서비스 개발', 56.3, 'monitoring', '-11 days', '-1 day', '-9 days'],
    ['olc_wording', '확신도를 단정적으로 표현', '근거가 약한 답변도 확정형 문장으로 보여 상담원이 표현을 수정합니다.', '확신도 문구 이해 어려움 단정 표현', 'ux', 'candidate', '[{"key":"ux","confidence":72},{"key":"model","confidence":44}]', '["상담표현-2026.06"]', '고객 안내 문구', 4, 2, 160000, 2, 4, 'Product Design', 35.1, 'open', '-8 days', '-1 day', null],
  ]

  const productStmts = products.map((p) =>
    statement(
      env,
      `INSERT INTO override_product
       (id, name, domain, owner_team, model_name, model_version, prompt_version, agent_version,
        policy_version, tool_version, status, total_cases, applicable_cases)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '운영', ?, ?)`,
      ...p
    )
  )

  const clusterStmts = clusters.map((c) =>
    statement(
      env,
      `INSERT INTO issue_cluster
       (id, title, summary, sample_text, cause_code, cause_status, cause_candidates_json,
        policy_refs_json, affected_workflow, affected_customer_count, customer_impact_score,
        operations_cost_krw, regulatory_risk_score, recurrence_count, owner_team, priority_score,
        status, first_seen_at, last_seen_at, cause_confirmed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
               datetime('now', ?), datetime('now', ?), CASE WHEN ? IS NULL THEN NULL ELSE datetime('now', ?) END)`,
      ...c.slice(0, 19),
      c[19],
      c[19]
    )
  )

  if (!(await hasRows('override_product'))) await env.DB.batch(productStmts)
  if (!(await hasRows('issue_cluster'))) await env.DB.batch(clusterStmts)

  const events = [
    ['ole_01', 'olp_loan', 'olc_policy', 'LOAN-8821', '-19 days', '김상담', 'reviewer', 'modify', '추가 서류 A를 제출해 주세요.', '해당 고객 유형에는 추가 서류 B가 필요합니다.', '["요구 서류"]', 'policy_outdated', '고객 유형별 최신 내규와 검색 결과가 다릅니다.', '["대출내규-2026.08-14"]', 'VIP', 4, 92000, 5, '재문의 후 올바른 서류 접수', '처리 지연 1일', 'valid', '정책 원문으로 확인'],
    ['ole_02', 'olp_loan', 'olc_policy', 'LOAN-8894', '-14 days', '박상담', 'reviewer', 'modify', '서류 A가 필요합니다.', '신혼 특례 고객은 서류 B와 C가 필요합니다.', '["요구 서류","근거 문서"]', 'policy_outdated', '검색 색인에 8월 14일 개정본이 없습니다.', '["대출내규-2026.08-14"]', '신혼특례', 5, 118000, 5, '사후 정정', '재작업 24분', 'valid', '정책 담당자 확인'],
    ['ole_03', 'olp_order', 'olc_segment', 'ORDER-1291', '-12 days', '이운영', 'operations', 'reject', '전액 보상을 실행합니다.', '해외 판매자 건으로 전문 운영자에게 이관합니다.', '["보상 금액","처리 경로"]', 'missing_data', '판매자 유형 값이 비어 보상 한도를 계산할 수 없습니다.', '["보상정책-2026.07"]', '해외판매자', 3, 67000, 3, '고객 안내 전 차단', '과다 보상 방지', 'valid', '원 주문 데이터와 대조'],
    ['ole_04', 'olp_claim', 'olc_permission', 'CLAIM-7702', '-9 days', '최심사', 'reviewer', 'escalate', '일반 서류로 자동 분류합니다.', '보조 문서를 열 수 없어 전문 심사자에게 이관합니다.', '["분류","담당자"]', 'tool_failure', '문서 API의 서비스 계정 권한이 만료되었습니다.', '["심사내규-2026.08"]', '고액청구', 4, 81000, 4, '전문 심사 진행', '자동 처리 18분 지연', 'valid', '접근 로그 확인'],
    ['ole_05', 'olp_loan', 'olc_wording', 'LOAN-9012', '-6 days', '김상담', 'reviewer', 'modify', '일정 변경이 가능합니다.', '현재 정보만으로는 가능 여부를 확정할 수 없습니다.', '["답변 표현"]', 'unclear_ux', '확신도 0.54인데 확정형으로 표시됩니다.', '["상담표현-2026.06"]', '일반', 2, 36000, 2, '추가 확인 요청', '오안내 예방', 'pending', null],
    ['ole_06', 'olp_order', 'olc_segment', 'ORDER-1340', '-4 days', '정운영', 'operations', 'correct_after', '부분 보상 30%를 실행합니다.', '정책상 보상 대상이 아니므로 사후 회수합니다.', '["보상 금액","결과"]', 'missing_data', '판매자 유형 누락으로 다른 정책이 적용됐습니다.', '["보상정책-2026.07"]', '해외판매자', 5, 145000, 4, '사후 정정 및 사과', '보상금 회수', 'valid', '정책과 거래 원장 대조'],
    ['ole_07', 'olp_claim', 'olc_permission', 'CLAIM-7820', '-2 days', '최심사', 'reviewer', 'escalate', '추가 확인 없이 자동 승인합니다.', '첨부 문서를 조회할 수 없어 수동 심사합니다.', '["심사 방식"]', 'tool_failure', '문서 조회 토큰 갱신이 실패했습니다.', '["심사내규-2026.08"]', '일반', 3, 54000, 4, '수동 심사 완료', '처리 11분 지연', 'valid', '시스템 로그 확인'],
    ['ole_08', 'olp_loan', null, 'LOAN-9090', '-1 day', '박상담', 'reviewer', 'approve', '추가 서류가 필요하지 않습니다.', '추가 서류가 필요하지 않습니다.', '[]', 'approved', '정책과 고객 상태를 확인했습니다.', '["대출내규-2026.08"]', '일반', 0, 0, 0, '첫 문의에서 해결', '추가 작업 없음', 'valid', '승인 사례 표본'],
  ]

  if (!(await hasRows('override_event'))) {
    await env.DB.batch(
      events.map((e) =>
      statement(
        env,
        `INSERT INTO override_event
         (id, product_id, cluster_id, external_ref, source_kind, occurred_at, reviewer_label,
          reviewer_role, decision_action, is_override, ai_decision, human_decision,
          changed_fields_json, reason_code, reason_detail, policy_refs_json, model_version,
          prompt_version, agent_version, tool_version, data_refs_json, tools_json, segment,
          customer_impact_score, operations_cost_krw, regulatory_risk_score, customer_outcome,
          business_outcome, recording_seconds, validity, validity_reason)
         VALUES (?, ?, ?, ?, 'work_ui', datetime('now', ?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                 'opus-5.0', 'production-v12', 'agent-v7', 'tool-v4', '["업무 원본"]',
                 '["CRM","정책 검색"]', ?, ?, ?, ?, ?, ?, 18, ?, ?)`,
        ...e.slice(0, 8),
        e[7] === 'approve' ? 0 : 1,
        ...e.slice(8)
        )
      )
    )
  }

  if (!(await hasRows('change_experiment'))) await env.DB.batch([
    statement(
      env,
      `INSERT INTO change_experiment
       (id, cluster_id, title, change_target, hypothesis, scope, comparator, success_metric,
        metric_direction, target_improvement, guardrails_json, stop_conditions_json, approver,
        rollback_plan, risk_level, current_phase, status, approved_by, approved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '-13 days'))`,
      'olx_policy',
      'olc_policy',
      '정책 색인 반영 시간을 10분 이내로',
      '정책 검색 파이프라인',
      '증분 색인을 쓰면 최신 정책 미반영 수정률이 줄어든다.',
      '상환 일정 상담의 20%',
      '기존 일괄 색인',
      '동일 원인 수정률',
      'lower',
      30,
      '["중대한 정책 위반 0건","미승인 고위험 변경 0건"]',
      '["정책 위반 1건","검색 실패율 1% 초과"]',
      '준법 책임자',
      '색인 라우팅을 기존 버전으로 즉시 전환',
      'high',
      'limited',
      'running',
      '윤준법'
    ),
    statement(
      env,
      `INSERT INTO change_experiment
       (id, cluster_id, title, change_target, hypothesis, scope, comparator, success_metric,
        metric_direction, target_improvement, guardrails_json, stop_conditions_json, approver,
        rollback_plan, risk_level, current_phase, status, approved_by, approved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '-8 days'))`,
      'olx_segment',
      'olc_segment',
      '판매자 유형 누락 차단',
      '주문 데이터 검증',
      '유형이 없을 때 자동 보상을 멈추면 과다 보상이 줄어든다.',
      '해외 판매자 주문',
      '현재 null 허용 흐름',
      '과다 보상률',
      'lower',
      25,
      '["고객 응답 지연 5분 이하","정당 보상 누락 0건"]',
      '["정당 보상 누락 1건"]',
      'CS 운영 책임자',
      '검증 규칙을 비활성화하고 기존 흐름 복원',
      'medium',
      'shadow',
      'running',
      '이Product'
    ),
  ])

  if (!(await hasRows('experiment_run'))) await env.DB.batch([
    statement(env, `INSERT INTO experiment_run VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '-10 days'))`, 'olr_01', 'olx_policy', 'historical', 'passed', 8.8, 3.1, 64.8, 42, 0, 980000, 370000, '과거 42건 재생', '한ML'),
    statement(env, `INSERT INTO experiment_run VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '-5 days'))`, 'olr_02', 'olx_policy', 'shadow', 'passed', 7.9, 4.2, 46.8, 260, 0, 840000, 510000, '운영 트래픽 복제', '한ML'),
    statement(env, `INSERT INTO experiment_run VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '-3 days'))`, 'olr_03', 'olx_segment', 'historical', 'passed', 3.4, 1.6, 52.9, 58, 0, 690000, 330000, '과다 보상 이력 재생', '최Data'),
    statement(env, `INSERT INTO experiment_run VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '-1 day'))`, 'olr_04', 'olx_segment', 'shadow', 'blocked', 3.1, 1.9, 38.7, 310, 1, 620000, 390000, '정당 보상 누락 1건으로 자동 차단', '최Data'),
  ])

  const volumeRows = [
    ['olv_01', 'olp_loan', '-7 days', '일반', 1100, 1020],
    ['olv_02', 'olp_loan', '-7 days', 'VIP', 280, 248],
    ['olv_03', 'olp_loan', '-7 days', '신혼특례', 190, 171],
    ['olv_04', 'olp_order', '-7 days', '국내판매자', 760, 710],
    ['olv_05', 'olp_order', '-7 days', '해외판매자', 240, 211],
    ['olv_06', 'olp_claim', '-7 days', '일반', 430, 414],
    ['olv_07', 'olp_claim', '-7 days', '고액청구', 94, 88],
  ]
  if (!(await hasRows('override_volume'))) {
    await env.DB.batch(
      volumeRows.map((v) =>
      statement(
        env,
        `INSERT INTO override_volume
         (id, product_id, measured_on, segment, total_cases, applicable_cases)
         VALUES (?, ?, date(datetime('now', ?)), ?, ?, ?)`,
        ...v
        )
      )
    )
  }

  await env.DB.prepare(
    `INSERT INTO override_audit
     (id, actor_label, actor_role, action, entity_kind, entity_id, detail_json)
     VALUES (?, '시스템', 'system', 'workspace_seeded', 'workspace', 'default', ?)`
  )
    .bind(newId('ola'), JSON.stringify({ source: '재현 가능한 시연 시나리오' }))
    .run()
  return true
}

export async function resolveOverrideActor(env, request, body = {}) {
  const email = request?.headers?.get('CF-Access-Authenticated-User-Email')?.trim().toLowerCase()
  if (email) {
    const actor = await env.DB.prepare(
      'SELECT email, display_name, role FROM override_actor WHERE email = ? AND active = 1'
    )
      .bind(email)
      .first()
    if (actor) return { label: actor.display_name, role: actor.role, email, mode: 'access' }
  }

  // 공개 포트폴리오에서는 역할별 화면과 권한 거절까지 직접 시험할 수 있게 한다.
  // 실제 사내 배포는 OVERRIDE_DEMO_MODE=false로 두면 Cloudflare Access의 인증
  // 메일과 override_actor 매핑 없이는 쓰기 요청이 전부 거절된다.
  if (!overrideDemoMode(env)) return null
  const requestedRole = String(body.role ?? request?.headers?.get('X-Override-Role') ?? 'reviewer')
  const role = OVERRIDE_ROLES.some((item) => item.key === requestedRole) ? requestedRole : 'reviewer'
  const label = String(body.actorLabel ?? '공개 시연 사용자').trim().slice(0, 60)
  return { label, role, email: null, mode: 'demo' }
}

export function requireOverridePermission(actor, action) {
  if (!actor) {
    const error = new Error('인증된 사내 계정만 이 작업을 할 수 있습니다.')
    error.status = 401
    throw error
  }
  if (!roleCan(actor.role, action)) {
    const error = new Error('현재 역할에는 이 작업 권한이 없습니다.')
    error.status = 403
    throw error
  }
}

export async function auditOverride(env, actor, action, entityKind, entityId, detail = {}) {
  const id = newId('ola')
  await env.DB.prepare(
    `INSERT INTO override_audit
     (id, actor_label, actor_role, action, entity_kind, entity_id, detail_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      actor?.label ?? '시스템',
      actor?.role ?? 'system',
      action,
      entityKind,
      entityId ?? null,
      JSON.stringify(detail ?? {})
    )
    .run()
  return id
}

export function isSafeIntegrationUrl(value) {
  let url
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.protocol !== 'https:') return false
  const host = url.hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return false
  if (/^(127\.|10\.|0\.|169\.254\.|192\.168\.)/.test(host)) return false
  const private172 = /^172\.(\d+)\./.exec(host)
  if (private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31) return false
  return true
}
