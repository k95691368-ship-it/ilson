-- PostgreSQL baseline for ILSON. Empty database only; no user data.
BEGIN;
CREATE TABLE application (
  id TEXT PRIMARY KEY,
  
  ticket_no TEXT NOT NULL UNIQUE,

  dept TEXT NOT NULL,
  applicant_label TEXT NOT NULL,
  contact TEXT,

  title TEXT NOT NULL,
  
  bottleneck TEXT NOT NULL,
  
  problem TEXT NOT NULL,
  
  wish TEXT,

  
  current_minutes BIGINT,
  current_people BIGINT,
  current_frequency TEXT,
  
  is_measured BIGINT NOT NULL DEFAULT 0,

  
  impact_if_wrong TEXT,

  status TEXT NOT NULL DEFAULT '접수'
    CHECK (status IN ('접수', '검토중', '수용', '반려', '보류', '진행중', '완료')),

  source_ip_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')),
  updated_at TEXT NOT NULL DEFAULT (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);

ALTER TABLE "application" ENABLE ROW LEVEL SECURITY;

CREATE TABLE meeting (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES application(id) ON DELETE CASCADE,
  seq BIGINT NOT NULL,
  title TEXT NOT NULL,
  depts_json TEXT,
  held_at TEXT,
  minutes_text TEXT,
  status TEXT NOT NULL DEFAULT '준비' CHECK (status IN ('준비', '진행', '정리중', '완료')),
  created_at TEXT NOT NULL DEFAULT (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')),
  UNIQUE (application_id, seq)
);

ALTER TABLE "meeting" ENABLE ROW LEVEL SECURITY;

CREATE TABLE requirement (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES application(id) ON DELETE CASCADE,
  meeting_id TEXT REFERENCES meeting(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('요구', '제약', '미결', '가정')),
  dept TEXT NOT NULL,
  body TEXT NOT NULL,
  quote TEXT,
  priority TEXT NOT NULL DEFAULT '보통' CHECK (priority IN ('필수', '보통', '있으면좋음')),
  measurable TEXT,
  status TEXT NOT NULL DEFAULT '초안'
    CHECK (status IN ('초안', '채택', '수정채택', '기각')),
  decided_body TEXT,
  reject_reason TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);

ALTER TABLE "requirement" ENABLE ROW LEVEL SECURITY;

CREATE TABLE requirement_conflict (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES application(id) ON DELETE CASCADE,
  req_a_id TEXT NOT NULL REFERENCES requirement(id) ON DELETE CASCADE,
  req_b_id TEXT NOT NULL REFERENCES requirement(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  tradeoff_axis TEXT,
  severity TEXT NOT NULL DEFAULT '보통' CHECK (severity IN ('낮음', '보통', '높음')),
  verdict TEXT CHECK (verdict IN ('A우선', 'B우선', '절충', '충돌아님')),
  verdict_reason TEXT,
  tradeoff_note TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')),
  UNIQUE (req_a_id, req_b_id)
);

ALTER TABLE "requirement_conflict" ENABLE ROW LEVEL SECURITY;

CREATE TABLE acceptance_criterion (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES application(id) ON DELETE CASCADE,
  ord BIGINT NOT NULL,
  body TEXT NOT NULL,
  from_requirement_id TEXT REFERENCES requirement(id) ON DELETE SET NULL,
  from_conflict_id TEXT REFERENCES requirement_conflict(id) ON DELETE SET NULL,
  check_kind TEXT NOT NULL DEFAULT 'rule' CHECK (check_kind IN ('rule', 'human')),
  check_key TEXT,
  is_required_safety BIGINT NOT NULL DEFAULT 0,
  confirmed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);

ALTER TABLE "acceptance_criterion" ENABLE ROW LEVEL SECURITY;

CREATE TABLE baseline (
  application_id TEXT PRIMARY KEY REFERENCES application(id) ON DELETE CASCADE,
  median_seconds DOUBLE PRECISION NOT NULL,
  min_seconds DOUBLE PRECISION NOT NULL,
  max_seconds DOUBLE PRECISION NOT NULL,
  sample_n BIGINT NOT NULL,
  error_rate DOUBLE PRECISION NOT NULL DEFAULT 0,
  people BIGINT NOT NULL DEFAULT 1,
  frequency TEXT,
  hourly_wage_krw BIGINT NOT NULL DEFAULT 25000,
  sealed_at TEXT NOT NULL DEFAULT (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);

ALTER TABLE "baseline" ENABLE ROW LEVEL SECURITY;

CREATE TABLE build_run (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES application(id) ON DELETE CASCADE,
  seq BIGINT NOT NULL,
  files_json TEXT NOT NULL,
  rows_out BIGINT NOT NULL DEFAULT 0,
  quarantined BIGINT NOT NULL DEFAULT 0,
  duplicate_suspects BIGINT NOT NULL DEFAULT 0,
  duration_ms BIGINT,
  totals_json TEXT,
  ran_where TEXT NOT NULL DEFAULT 'browser',
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')),
  UNIQUE (application_id, seq)
);

ALTER TABLE "build_run" ENABLE ROW LEVEL SECURITY;

CREATE TABLE beta_round (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES application(id) ON DELETE CASCADE,
  seq BIGINT NOT NULL,
  build_run_id TEXT REFERENCES build_run(id) ON DELETE SET NULL,

  
  
  overall TEXT NOT NULL CHECK (overall IN ('통과', '조건부', '차단')),
  total BIGINT NOT NULL DEFAULT 0,
  passed BIGINT NOT NULL DEFAULT 0,
  failed BIGINT NOT NULL DEFAULT 0,
  safety_failed BIGINT NOT NULL DEFAULT 0,
  human_needed BIGINT NOT NULL DEFAULT 0,
  duration_ms BIGINT,

  
  fixed_what TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')),
  UNIQUE (application_id, seq)
);

ALTER TABLE "beta_round" ENABLE ROW LEVEL SECURITY;

CREATE TABLE beta_feedback (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES application(id) ON DELETE CASCADE,
  round_id TEXT REFERENCES beta_round(id) ON DELETE SET NULL,
  dept TEXT NOT NULL,
  person_label TEXT NOT NULL,
  body TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT '의견'
    CHECK (kind IN ('의견', '막힌곳', '요청', '칭찬')),
  resolved_at TEXT,
  resolution TEXT,
  created_at TEXT NOT NULL DEFAULT (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);

ALTER TABLE "beta_feedback" ENABLE ROW LEVEL SECURITY;

CREATE TABLE beta_result (
  id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL REFERENCES beta_round(id) ON DELETE CASCADE,
  criterion_id TEXT,
  ord BIGINT NOT NULL DEFAULT 0,
  body TEXT NOT NULL,
  check_key TEXT,
  check_kind TEXT NOT NULL DEFAULT 'rule',
  is_required_safety BIGINT NOT NULL DEFAULT 0,
  verdict TEXT NOT NULL CHECK (verdict IN ('통과', '실패', '사람확인', '판정불가')),
  evidence TEXT,
  samples_json TEXT
);

ALTER TABLE "beta_result" ENABLE ROW LEVEL SECURITY;

CREATE TABLE build_quarantine (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES build_run(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  source_file TEXT NOT NULL,
  source_sheet TEXT,
  source_row_no BIGINT NOT NULL,
  external_code TEXT,
  product_name TEXT,
  raw_json TEXT,
  note TEXT,
  resolved_at TEXT
);

ALTER TABLE "build_quarantine" ENABLE ROW LEVEL SECURITY;

CREATE TABLE build_row (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES build_run(id) ON DELETE CASCADE,
  row_no BIGINT NOT NULL,
  date TEXT NOT NULL,
  iso_week TEXT NOT NULL,
  sku TEXT NOT NULL,
  sku_name TEXT,
  channel TEXT NOT NULL,
  qty BIGINT NOT NULL DEFAULT 0,
  return_qty BIGINT NOT NULL DEFAULT 0,
  src_currency TEXT NOT NULL DEFAULT 'KRW',
  fx_rate DOUBLE PRECISION NOT NULL DEFAULT 1,
  gross_krw DOUBLE PRECISION NOT NULL DEFAULT 0,
  discount_krw DOUBLE PRECISION NOT NULL DEFAULT 0,
  return_krw DOUBLE PRECISION NOT NULL DEFAULT 0,
  net_revenue_krw DOUBLE PRECISION NOT NULL DEFAULT 0,
  commission_krw DOUBLE PRECISION NOT NULL DEFAULT 0,
  reported_commission_krw DOUBLE PRECISION,
  cogs_krw DOUBLE PRECISION NOT NULL DEFAULT 0,
  logistics_krw DOUBLE PRECISION NOT NULL DEFAULT 0,
  ad_krw DOUBLE PRECISION NOT NULL DEFAULT 0,
  contribution_krw DOUBLE PRECISION NOT NULL DEFAULT 0,
  source_file TEXT NOT NULL,
  source_sheet TEXT,
  source_row_no BIGINT NOT NULL,
  trace_json TEXT,
  has_duplicate BIGINT NOT NULL DEFAULT 0,
  duplicate_of TEXT
);

ALTER TABLE "build_row" ENABLE ROW LEVEL SECURITY;

CREATE TABLE issue_cluster (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, summary TEXT NOT NULL, sample_text TEXT,
    cause_code TEXT NOT NULL DEFAULT 'unknown', cause_status TEXT NOT NULL DEFAULT 'candidate',
    cause_candidates_json TEXT, policy_refs_json TEXT, affected_workflow TEXT,
    affected_customer_count BIGINT NOT NULL DEFAULT 0,
    customer_impact_score DOUBLE PRECISION NOT NULL DEFAULT 0, operations_cost_krw DOUBLE PRECISION NOT NULL DEFAULT 0,
    regulatory_risk_score DOUBLE PRECISION NOT NULL DEFAULT 0, recurrence_count BIGINT NOT NULL DEFAULT 0,
    owner_team TEXT NOT NULL, priority_score DOUBLE PRECISION NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'open', first_seen_at TEXT NOT NULL DEFAULT (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')),
    last_seen_at TEXT NOT NULL DEFAULT (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')), cause_confirmed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')),
    updated_at TEXT NOT NULL DEFAULT (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
  );

ALTER TABLE "issue_cluster" ENABLE ROW LEVEL SECURITY;

CREATE TABLE change_experiment (
    id TEXT PRIMARY KEY, cluster_id TEXT NOT NULL REFERENCES issue_cluster(id) ON DELETE CASCADE,
    title TEXT NOT NULL, change_target TEXT NOT NULL, hypothesis TEXT NOT NULL, scope TEXT NOT NULL,
    comparator TEXT NOT NULL, success_metric TEXT NOT NULL, metric_direction TEXT NOT NULL DEFAULT 'lower',
    target_improvement DOUBLE PRECISION NOT NULL DEFAULT 0, guardrails_json TEXT NOT NULL,
    stop_conditions_json TEXT NOT NULL, approver TEXT NOT NULL, rollback_plan TEXT NOT NULL,
    risk_level TEXT NOT NULL DEFAULT 'medium', current_phase TEXT NOT NULL DEFAULT 'draft',
    status TEXT NOT NULL DEFAULT 'draft', approved_by TEXT, approved_at TEXT,
    created_at TEXT NOT NULL DEFAULT (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')),
    updated_at TEXT NOT NULL DEFAULT (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
  );

ALTER TABLE "change_experiment" ENABLE ROW LEVEL SECURITY;

CREATE TABLE decision_log (
  id TEXT PRIMARY KEY,
  application_id TEXT,
  stage TEXT NOT NULL CHECK (stage IN (
    '신청서', '검토', '협의안', '제작', '베타테스트', '사용법서', '배포', '성과'
  )),
  actor TEXT NOT NULL DEFAULT 'human' CHECK (actor IN ('human', 'ai')),
  title TEXT NOT NULL,
  what TEXT NOT NULL,
  why TEXT NOT NULL,
  alternatives TEXT,
  unrequested BIGINT NOT NULL DEFAULT 0,
  link_kind TEXT,
  link_id TEXT,
  created_at TEXT NOT NULL DEFAULT (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);

ALTER TABLE "decision_log" ENABLE ROW LEVEL SECURITY;

CREATE TABLE experiment_run (
    id TEXT PRIMARY KEY, experiment_id TEXT NOT NULL REFERENCES change_experiment(id) ON DELETE CASCADE,
    phase TEXT NOT NULL, status TEXT NOT NULL, control_value DOUBLE PRECISION NOT NULL, variant_value DOUBLE PRECISION NOT NULL,
    improvement_percent DOUBLE PRECISION NOT NULL, sample_size BIGINT NOT NULL,
    guardrail_breaches BIGINT NOT NULL DEFAULT 0, cost_before_krw DOUBLE PRECISION NOT NULL DEFAULT 0,
    cost_after_krw DOUBLE PRECISION NOT NULL DEFAULT 0, notes TEXT, run_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
  );

ALTER TABLE "experiment_run" ENABLE ROW LEVEL SECURITY;

CREATE TABLE handover (
  application_id TEXT PRIMARY KEY REFERENCES application(id) ON DELETE CASCADE,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,

  handed_to_dept TEXT NOT NULL,
  handed_to_person TEXT NOT NULL,
  handed_at TEXT NOT NULL DEFAULT (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')),

  
  accepted_at TEXT,
  accepted_by TEXT,

  
  daily_limit BIGINT NOT NULL DEFAULT 20,
  max_file_mb BIGINT NOT NULL DEFAULT 10,

  note TEXT,
  
  rolled_back_at TEXT,
  rollback_reason TEXT,

  updated_at TEXT NOT NULL DEFAULT (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);

ALTER TABLE "handover" ENABLE ROW LEVEL SECURITY;

CREATE TABLE manual (
  application_id TEXT PRIMARY KEY REFERENCES application(id) ON DELETE CASCADE,
  title TEXT NOT NULL,

  
  intro TEXT,
  
  when_to_run TEXT,
  
  what_to_do_after TEXT,
  
  contact TEXT,
  
  notes TEXT,

  updated_at TEXT NOT NULL DEFAULT (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')),
  published_at TEXT
);

ALTER TABLE "manual" ENABLE ROW LEVEL SECURITY;

CREATE TABLE manual_faq (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES application(id) ON DELETE CASCADE,
  ord BIGINT NOT NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  from_feedback_id TEXT REFERENCES beta_feedback(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);

ALTER TABLE "manual_faq" ENABLE ROW LEVEL SECURITY;

CREATE TABLE outcome (
  application_id TEXT PRIMARY KEY REFERENCES application(id) ON DELETE CASCADE,
  dev_hours DOUBLE PRECISION NOT NULL DEFAULT 0,
  ops_cost_krw DOUBLE PRECISION NOT NULL DEFAULT 0,
  amortize_months BIGINT NOT NULL DEFAULT 24,

  
  dept_confirmed_at TEXT,
  dept_confirmed_by TEXT,
  dept_comment TEXT,

  
  next_bottleneck TEXT,

  computed_at TEXT NOT NULL DEFAULT (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);

ALTER TABLE "outcome" ENABLE ROW LEVEL SECURITY;

CREATE TABLE outcome_challenge (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES application(id) ON DELETE CASCADE,
  rule_code TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  resolved_at TEXT,
  resolution TEXT,
  created_at TEXT NOT NULL DEFAULT (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')),
  UNIQUE (application_id, rule_code)
);

ALTER TABLE "outcome_challenge" ENABLE ROW LEVEL SECURITY;

CREATE TABLE override_actor (
    email TEXT PRIMARY KEY, display_name TEXT NOT NULL, role TEXT NOT NULL,
    active BIGINT NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')),
    updated_at TEXT NOT NULL DEFAULT (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
  );

ALTER TABLE "override_actor" ENABLE ROW LEVEL SECURITY;

CREATE TABLE override_ai_call (
    id TEXT PRIMARY KEY, purpose TEXT NOT NULL, entity_kind TEXT, entity_id TEXT,
    model TEXT NOT NULL, prompt_version TEXT NOT NULL, input_tokens BIGINT NOT NULL DEFAULT 0,
    output_tokens BIGINT NOT NULL DEFAULT 0, duration_ms BIGINT, ok BIGINT NOT NULL DEFAULT 1,
    fail_reason TEXT, actor_label TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
  );

ALTER TABLE "override_ai_call" ENABLE ROW LEVEL SECURITY;

CREATE TABLE override_audit (
    id TEXT PRIMARY KEY, actor_label TEXT NOT NULL, actor_role TEXT NOT NULL,
    action TEXT NOT NULL, entity_kind TEXT NOT NULL, entity_id TEXT, detail_json TEXT,
    created_at TEXT NOT NULL DEFAULT (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
  );

ALTER TABLE "override_audit" ENABLE ROW LEVEL SECURITY;

CREATE TABLE override_decision_record (
    id TEXT PRIMARY KEY,
    experiment_id TEXT NOT NULL REFERENCES change_experiment(id) ON DELETE CASCADE,
    decision TEXT NOT NULL, basis TEXT NOT NULL, metrics_snapshot_json TEXT NOT NULL,
    decided_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
  );

ALTER TABLE "override_decision_record" ENABLE ROW LEVEL SECURITY;

CREATE TABLE override_product (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, domain TEXT NOT NULL, owner_team TEXT NOT NULL,
    model_name TEXT NOT NULL, model_version TEXT NOT NULL, prompt_version TEXT NOT NULL,
    agent_version TEXT, policy_version TEXT NOT NULL, tool_version TEXT,
    status TEXT NOT NULL DEFAULT '운영', total_cases BIGINT NOT NULL DEFAULT 0,
    applicable_cases BIGINT NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')),
    updated_at TEXT NOT NULL DEFAULT (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
  );

ALTER TABLE "override_product" ENABLE ROW LEVEL SECURITY;

CREATE TABLE override_event (
    id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES override_product(id) ON DELETE CASCADE,
    cluster_id TEXT REFERENCES issue_cluster(id) ON DELETE SET NULL, external_ref TEXT,
    source_kind TEXT NOT NULL DEFAULT 'work_ui', occurred_at TEXT NOT NULL DEFAULT (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')),
    reviewer_label TEXT NOT NULL, reviewer_role TEXT NOT NULL, decision_action TEXT NOT NULL,
    is_override BIGINT NOT NULL DEFAULT 1, ai_decision TEXT NOT NULL, human_decision TEXT NOT NULL,
    changed_fields_json TEXT, reason_code TEXT NOT NULL, reason_detail TEXT NOT NULL,
    policy_refs_json TEXT, model_version TEXT NOT NULL, prompt_version TEXT NOT NULL,
    agent_version TEXT, tool_version TEXT, data_refs_json TEXT, tools_json TEXT, segment TEXT,
    customer_impact_score DOUBLE PRECISION NOT NULL DEFAULT 0, operations_cost_krw DOUBLE PRECISION NOT NULL DEFAULT 0,
    regulatory_risk_score DOUBLE PRECISION NOT NULL DEFAULT 0, customer_outcome TEXT, business_outcome TEXT,
    recording_seconds BIGINT NOT NULL DEFAULT 0,
    validity TEXT NOT NULL DEFAULT 'pending', validity_reason TEXT,
    created_at TEXT NOT NULL DEFAULT (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')),
    updated_at TEXT NOT NULL DEFAULT (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
  );

ALTER TABLE "override_event" ENABLE ROW LEVEL SECURITY;

CREATE TABLE override_integration (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, endpoint_url TEXT NOT NULL,
    secret_binding TEXT, status TEXT NOT NULL DEFAULT 'configured', last_sync_at TEXT,
    last_result TEXT, created_at TEXT NOT NULL DEFAULT (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')),
    updated_at TEXT NOT NULL DEFAULT (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
  );

ALTER TABLE "override_integration" ENABLE ROW LEVEL SECURITY;

CREATE TABLE override_volume (
    id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES override_product(id) ON DELETE CASCADE,
    measured_on TEXT NOT NULL, segment TEXT NOT NULL DEFAULT '전체',
    total_cases BIGINT NOT NULL DEFAULT 0, applicable_cases BIGINT NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')), UNIQUE (product_id, measured_on, segment)
  );

ALTER TABLE "override_volume" ENABLE ROW LEVEL SECURITY;

CREATE TABLE rate_limit_hits (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY ,
  bucket TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);

ALTER TABLE "rate_limit_hits" ENABLE ROW LEVEL SECURITY;

CREATE TABLE "review" (
  application_id TEXT PRIMARY KEY REFERENCES application(id) ON DELETE CASCADE,

  
  
  
  
  
  impact_score DOUBLE PRECISION CHECK (impact_score IS NULL OR impact_score BETWEEN 1 AND 5),
  impact_reason TEXT,
  difficulty_score DOUBLE PRECISION CHECK (difficulty_score IS NULL OR difficulty_score BETWEEN 1 AND 5),
  difficulty_reason TEXT,

  verdict TEXT NOT NULL CHECK (verdict IN ('수용', '반려', '보류')),
  verdict_reason TEXT NOT NULL,
  
  
  
  
  alternatives_considered TEXT,

  
  refuse_code TEXT CHECK (refuse_code IN (
    'external_write', 'auth_crawl', 'realtime', 'human_judgment',
    'media_gen', 'unstructured_only', 'other'
  )),
  refuse_alternative TEXT,

  
  hold_until_condition TEXT,

  
  
  
  
  
  bulk BIGINT NOT NULL DEFAULT 0,

  
  priority_rank BIGINT,

  reviewer_label TEXT NOT NULL DEFAULT 'AX 담당자',
  decided_at TEXT NOT NULL DEFAULT (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')),
  updated_at TEXT NOT NULL DEFAULT (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);

ALTER TABLE "review" ENABLE ROW LEVEL SECURITY;

CREATE TABLE shadow_run (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES application(id) ON DELETE CASCADE,
  seq BIGINT NOT NULL,
  total_seconds DOUBLE PRECISION NOT NULL,
  error_count BIGINT NOT NULL DEFAULT 0,
  step_timings_json TEXT,
  note TEXT,
  run_at TEXT NOT NULL DEFAULT (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')),
  UNIQUE (application_id, seq)
);

ALTER TABLE "shadow_run" ENABLE ROW LEVEL SECURITY;

CREATE TABLE sku_alias (
  external_code TEXT PRIMARY KEY,
  canonical_code TEXT NOT NULL,
  channel TEXT,
  product_name TEXT,
  note TEXT,
  taught_by TEXT,
  created_at TEXT NOT NULL DEFAULT (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);

ALTER TABLE "sku_alias" ENABLE ROW LEVEL SECURITY;

CREATE TABLE stakeholder (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES application(id) ON DELETE CASCADE,
  dept TEXT NOT NULL,
  role_label TEXT NOT NULL,
  person_label TEXT NOT NULL,
  wants TEXT NOT NULL,
  is_owner BIGINT NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);

ALTER TABLE "stakeholder" ENABLE ROW LEVEL SECURITY;

CREATE TABLE tool_use (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES application(id) ON DELETE CASCADE,
  used_at TEXT NOT NULL DEFAULT (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')),
  actor_label TEXT NOT NULL DEFAULT '부서 담당자',
  files_json TEXT,
  rows_out BIGINT NOT NULL DEFAULT 0,
  quarantined BIGINT NOT NULL DEFAULT 0,
  duration_ms BIGINT,
  
  human_review_seconds DOUBLE PRECISION NOT NULL DEFAULT 0,
  rework_seconds DOUBLE PRECISION NOT NULL DEFAULT 0,
  ok BIGINT NOT NULL DEFAULT 1,
  fail_reason TEXT
);

ALTER TABLE "tool_use" ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_application_created ON application(created_at);

CREATE INDEX idx_application_dept ON application(dept, created_at);

CREATE INDEX idx_application_status ON application(status, created_at);

CREATE INDEX idx_beta_feedback_app ON beta_feedback(application_id, created_at DESC);

CREATE INDEX idx_beta_result_round ON beta_result(round_id, ord);

CREATE INDEX idx_beta_round_app ON beta_round(application_id, seq DESC);

CREATE INDEX idx_build_quarantine_run ON build_quarantine(run_id, reason);

CREATE INDEX idx_build_row_channel ON build_row(run_id, channel);

CREATE INDEX idx_build_row_run ON build_row(run_id, row_no);

CREATE INDEX idx_build_row_source ON build_row(run_id, source_file, source_row_no);

CREATE INDEX idx_build_run_app ON build_run(application_id, seq DESC);

CREATE INDEX idx_change_experiment_cluster ON change_experiment(cluster_id, created_at);

CREATE INDEX idx_conflict_app ON requirement_conflict(application_id, verdict);

CREATE INDEX idx_criterion_app ON acceptance_criterion(application_id, ord);

CREATE INDEX idx_decision_application ON decision_log(application_id, created_at);

CREATE INDEX idx_decision_link ON decision_log(link_kind, link_id);

CREATE INDEX idx_decision_stage ON decision_log(stage, created_at);

CREATE INDEX idx_decision_unrequested ON decision_log(unrequested, created_at);

CREATE INDEX idx_experiment_run_exp ON experiment_run(experiment_id, created_at);

CREATE INDEX idx_handover_slug ON handover(slug);

CREATE INDEX idx_issue_cluster_priority ON issue_cluster(status, priority_score, last_seen_at);

CREATE INDEX idx_manual_faq_app ON manual_faq(application_id, ord);

CREATE INDEX idx_meeting_app ON meeting(application_id, seq);

CREATE INDEX idx_outcome_challenge_app ON outcome_challenge(application_id, resolved_at);

CREATE INDEX idx_override_ai_call_created ON override_ai_call(created_at);

CREATE INDEX idx_override_audit_created ON override_audit(created_at);

CREATE INDEX idx_override_audit_target ON override_audit(entity_kind, entity_id, created_at);

CREATE INDEX idx_override_decision_exp ON override_decision_record(experiment_id, created_at);

CREATE INDEX idx_override_event_cluster ON override_event(cluster_id, occurred_at);

CREATE UNIQUE INDEX idx_override_event_external ON override_event(product_id, external_ref);

CREATE INDEX idx_override_event_product ON override_event(product_id, occurred_at);

CREATE INDEX idx_override_event_validity ON override_event(validity, occurred_at);

CREATE INDEX idx_override_volume_product ON override_volume(product_id, measured_on);

CREATE INDEX idx_rate_limit_bucket ON rate_limit_hits(bucket, created_at);

CREATE INDEX idx_requirement_app ON requirement(application_id, status, kind);

CREATE INDEX idx_stakeholder_app ON stakeholder(application_id, is_owner DESC);

CREATE INDEX idx_tool_use_app ON tool_use(application_id, used_at DESC);
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, anon, authenticated;
COMMIT;
