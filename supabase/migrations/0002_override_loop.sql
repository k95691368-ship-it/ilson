-- Supabase용 OverrideLoop 스키마. 0001_execute_sql.sql을 먼저 적용하면
-- Cloudflare Functions와 같은 SQL 및 datetime() 계약을 사용합니다.

CREATE TABLE IF NOT EXISTS override_product (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  domain TEXT NOT NULL,
  owner_team TEXT NOT NULL,
  model_name TEXT NOT NULL,
  model_version TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  agent_version TEXT,
  policy_version TEXT NOT NULL,
  tool_version TEXT,
  status TEXT NOT NULL DEFAULT '운영' CHECK (status IN ('시험', '운영', '중단')),
  total_cases INTEGER NOT NULL DEFAULT 0,
  applicable_cases INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS issue_cluster (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  sample_text TEXT,
  cause_code TEXT NOT NULL DEFAULT 'unknown',
  cause_status TEXT NOT NULL DEFAULT 'candidate' CHECK (cause_status IN ('candidate', 'confirmed', 'disputed')),
  cause_candidates_json TEXT,
  policy_refs_json TEXT,
  affected_workflow TEXT,
  affected_customer_count INTEGER NOT NULL DEFAULT 0,
  customer_impact_score REAL NOT NULL DEFAULT 0,
  operations_cost_krw REAL NOT NULL DEFAULT 0,
  regulatory_risk_score REAL NOT NULL DEFAULT 0,
  recurrence_count INTEGER NOT NULL DEFAULT 0,
  owner_team TEXT NOT NULL,
  priority_score REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'experiment', 'monitoring', 'resolved', 'accepted_exception')),
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  cause_confirmed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_issue_cluster_priority ON issue_cluster(status, priority_score, last_seen_at);
CREATE INDEX IF NOT EXISTS idx_issue_cluster_cause ON issue_cluster(cause_code, status);

CREATE TABLE IF NOT EXISTS override_event (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES override_product(id) ON DELETE CASCADE,
  cluster_id TEXT REFERENCES issue_cluster(id) ON DELETE SET NULL,
  external_ref TEXT,
  source_kind TEXT NOT NULL DEFAULT 'work_ui' CHECK (source_kind IN ('work_ui', 'api', 'appeal', 'ticket', 'import')),
  occurred_at TEXT NOT NULL DEFAULT (datetime('now')),
  reviewer_label TEXT NOT NULL,
  reviewer_role TEXT NOT NULL,
  decision_action TEXT NOT NULL CHECK (decision_action IN ('approve', 'modify', 'reject', 'escalate', 'correct_after')),
  is_override INTEGER NOT NULL DEFAULT 1,
  ai_decision TEXT NOT NULL,
  human_decision TEXT NOT NULL,
  changed_fields_json TEXT,
  reason_code TEXT NOT NULL,
  reason_detail TEXT NOT NULL,
  policy_refs_json TEXT,
  model_version TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  agent_version TEXT,
  tool_version TEXT,
  data_refs_json TEXT,
  tools_json TEXT,
  segment TEXT,
  customer_impact_score REAL NOT NULL DEFAULT 0,
  operations_cost_krw REAL NOT NULL DEFAULT 0,
  regulatory_risk_score REAL NOT NULL DEFAULT 0,
  customer_outcome TEXT,
  business_outcome TEXT,
  recording_seconds INTEGER NOT NULL DEFAULT 0,
  validity TEXT NOT NULL DEFAULT 'pending' CHECK (validity IN ('pending', 'valid', 'invalid', 'uncertain')),
  validity_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_override_event_product ON override_event(product_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_override_event_cluster ON override_event(cluster_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_override_event_validity ON override_event(validity, occurred_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_override_event_external ON override_event(product_id, external_ref);

CREATE TABLE IF NOT EXISTS change_experiment (
  id TEXT PRIMARY KEY,
  cluster_id TEXT NOT NULL REFERENCES issue_cluster(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  change_target TEXT NOT NULL,
  hypothesis TEXT NOT NULL,
  scope TEXT NOT NULL,
  comparator TEXT NOT NULL,
  success_metric TEXT NOT NULL,
  metric_direction TEXT NOT NULL DEFAULT 'lower' CHECK (metric_direction IN ('lower', 'higher')),
  target_improvement REAL NOT NULL DEFAULT 0,
  guardrails_json TEXT NOT NULL,
  stop_conditions_json TEXT NOT NULL,
  approver TEXT NOT NULL,
  rollback_plan TEXT NOT NULL,
  risk_level TEXT NOT NULL DEFAULT 'medium' CHECK (risk_level IN ('low', 'medium', 'high')),
  current_phase TEXT NOT NULL DEFAULT 'draft' CHECK (current_phase IN ('draft', 'historical', 'shadow', 'limited', 'decided')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'running', 'expanded', 'held', 'stopped', 'rolled_back')),
  approved_by TEXT,
  approved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_change_experiment_cluster ON change_experiment(cluster_id, created_at);
CREATE INDEX IF NOT EXISTS idx_change_experiment_status ON change_experiment(status, updated_at);

CREATE TABLE IF NOT EXISTS experiment_run (
  id TEXT PRIMARY KEY,
  experiment_id TEXT NOT NULL REFERENCES change_experiment(id) ON DELETE CASCADE,
  phase TEXT NOT NULL CHECK (phase IN ('historical', 'shadow', 'limited')),
  status TEXT NOT NULL CHECK (status IN ('passed', 'failed', 'blocked', 'insufficient')),
  control_value REAL NOT NULL,
  variant_value REAL NOT NULL,
  improvement_percent REAL NOT NULL,
  sample_size INTEGER NOT NULL,
  guardrail_breaches INTEGER NOT NULL DEFAULT 0,
  cost_before_krw REAL NOT NULL DEFAULT 0,
  cost_after_krw REAL NOT NULL DEFAULT 0,
  notes TEXT,
  run_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_experiment_run_exp ON experiment_run(experiment_id, created_at);

CREATE TABLE IF NOT EXISTS override_decision_record (
  id TEXT PRIMARY KEY,
  experiment_id TEXT NOT NULL REFERENCES change_experiment(id) ON DELETE CASCADE,
  decision TEXT NOT NULL CHECK (decision IN ('expand', 'hold', 'stop', 'rollback')),
  basis TEXT NOT NULL,
  metrics_snapshot_json TEXT NOT NULL,
  decided_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_override_decision_exp ON override_decision_record(experiment_id, created_at);

CREATE TABLE IF NOT EXISTS override_volume (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES override_product(id) ON DELETE CASCADE,
  measured_on TEXT NOT NULL,
  segment TEXT NOT NULL DEFAULT '전체',
  total_cases INTEGER NOT NULL DEFAULT 0,
  applicable_cases INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (product_id, measured_on, segment)
);

CREATE INDEX IF NOT EXISTS idx_override_volume_product ON override_volume(product_id, measured_on);

CREATE TABLE IF NOT EXISTS override_integration (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('mlops', 'policy', 'ticket', 'evaluation', 'webhook')),
  name TEXT NOT NULL,
  endpoint_url TEXT NOT NULL,
  secret_binding TEXT,
  status TEXT NOT NULL DEFAULT 'configured' CHECK (status IN ('configured', 'healthy', 'error', 'paused')),
  last_sync_at TEXT,
  last_result TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS override_actor (
  email TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('reviewer', 'operations', 'product', 'ml', 'engineer', 'policy', 'audit', 'executive')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS override_audit (
  id TEXT PRIMARY KEY,
  actor_label TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_kind TEXT NOT NULL,
  entity_id TEXT,
  detail_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_override_audit_created ON override_audit(created_at);
CREATE INDEX IF NOT EXISTS idx_override_audit_target ON override_audit(entity_kind, entity_id, created_at);

CREATE TABLE IF NOT EXISTS override_ai_call (
  id TEXT PRIMARY KEY,
  purpose TEXT NOT NULL,
  entity_kind TEXT,
  entity_id TEXT,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER,
  ok INTEGER NOT NULL DEFAULT 1,
  fail_reason TEXT,
  actor_label TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_override_ai_call_created ON override_ai_call(created_at);
