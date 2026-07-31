-- 이 파일이 "숫자를 클릭하면 원본 엑셀의 셀이 나온다"를 실제로 가능하게 하는
-- 곳이다. 핵심은 run_row 세 컬럼이다 — source_file_id / source_sheet /
-- source_row_no. 결과 행 하나하나가 자기가 어느 파일 어느 시트 몇 번째 행에서
-- 왔는지를 들고 있어야, 대시보드에서 거꾸로 거슬러 올라갈 수 있다.
--
-- transform_trace_json은 그 여정의 기록이다. [원본 → 헤더 보정 → SKU 매핑 →
-- 통화 환산 → 수수료 공제 → 최종] 6단계의 값이 그대로 배열로 남는다. 최종값만
-- 저장하면 "왜 이 숫자가 됐나"에 답할 수 없다.
--
-- quarantine_row는 실패한 행을 버리지 않기 위한 표다. 파이프라인이 못 붙인 행을
-- 조용히 떨어뜨리면 합계가 조용히 틀린다. 그래서 못 붙인 행은 전부 여기로 오고,
-- 사람이 한 번 고치면 그 교정이 세 갈래로 흘러간다 — alias_map(다음부터 자동),
-- eval_case(정답 케이스로 승격), 그리고 SFT 학습 행.
--
-- column_profile은 "AI를 안 부르도록 설계하는 것"의 실물이다. 같은 소스의 두
-- 번째 파일은 확정된 매핑을 재사용해 LLM 호출 0회로 처리된다. 화면의 호출 절감
-- 곡선이 이 표에서 나온다.

CREATE TABLE source_file (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  checksum TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  sheet_count INTEGER,
  row_count INTEGER,
  encoding TEXT,
  header_offset INTEGER DEFAULT 0,
  r2_key TEXT NOT NULL,
  channel_hint TEXT,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_source_file_checksum ON source_file(checksum);

CREATE TABLE tool_run (
  id TEXT PRIMARY KEY,
  recipe_id TEXT NOT NULL REFERENCES recipe(id) ON DELETE CASCADE,
  recipe_version INTEGER NOT NULL,
  actor TEXT NOT NULL DEFAULT 'owner' CHECK (actor IN ('owner', 'public', 'demo', 'eval')),
  input_hash TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  duration_ms INTEGER,
  rows_in INTEGER NOT NULL DEFAULT 0,
  rows_out INTEGER NOT NULL DEFAULT 0,
  rows_quarantined INTEGER NOT NULL DEFAULT 0,
  human_review_seconds REAL NOT NULL DEFAULT 0,
  rework_flag INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT '실행중'
    CHECK (status IN ('실행중', '성공', '부분성공', '실패')),
  failure_type_id TEXT,
  llm_calls INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_krw REAL NOT NULL DEFAULT 0,
  prompt_version TEXT
);

CREATE INDEX idx_tool_run_recipe ON tool_run(recipe_id, started_at);
CREATE INDEX idx_tool_run_started ON tool_run(started_at);

CREATE TABLE run_row (
  id TEXT PRIMARY KEY,
  tool_run_id TEXT NOT NULL REFERENCES tool_run(id) ON DELETE CASCADE,
  row_no INTEGER NOT NULL,
  out_json TEXT NOT NULL,
  source_file_id TEXT REFERENCES source_file(id) ON DELETE SET NULL,
  source_sheet TEXT,
  source_row_no INTEGER,
  transform_trace_json TEXT NOT NULL
);

CREATE INDEX idx_run_row_run ON run_row(tool_run_id, row_no);
CREATE INDEX idx_run_row_source ON run_row(source_file_id, source_row_no);

CREATE TABLE quarantine_row (
  id TEXT PRIMARY KEY,
  tool_run_id TEXT NOT NULL REFERENCES tool_run(id) ON DELETE CASCADE,
  source_file_id TEXT REFERENCES source_file(id) ON DELETE SET NULL,
  source_sheet TEXT,
  source_row_no INTEGER,
  reason_code TEXT NOT NULL,
  reason_text TEXT NOT NULL,
  raw_row_json TEXT NOT NULL,
  suggestion_json TEXT,
  status TEXT NOT NULL DEFAULT '대기' CHECK (status IN ('대기', '해결', '보류')),
  resolved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  resolved_at TEXT,
  resolve_seconds REAL
);

CREATE INDEX idx_quarantine_run ON quarantine_row(tool_run_id, status, reason_code);

-- 사람이 한 번 고친 것은 두 번 묻지 않는다.
CREATE TABLE alias_map (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('sku', 'column', 'channel', 'unit', 'currency')),
  external_key TEXT NOT NULL,
  canonical_id TEXT NOT NULL,
  evidence TEXT,
  approved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (kind, external_key)
);

-- source_signature_hash는 헤더 문자열 집합의 지문이다. 파일 이름이 달라도
-- 같은 채널의 같은 양식이면 같은 지문이 나와 매핑이 재사용된다.
CREATE TABLE column_profile (
  id TEXT PRIMARY KEY,
  source_signature_hash TEXT NOT NULL,
  channel_hint TEXT,
  mapping_json TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  resolved_by_llm INTEGER NOT NULL DEFAULT 0,
  approved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (source_signature_hash, version)
);

CREATE INDEX idx_column_profile_sig ON column_profile(source_signature_hash, version DESC);
