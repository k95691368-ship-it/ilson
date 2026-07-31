-- 이 앱에서 평가는 탭이 아니라 관문이다. [발행]을 누르면 여기 있는 표들이
-- 전부 돌고, 통과하지 못하면 도구는 주소를 받지 못한다. 그래서 일정이 밀려도
-- 평가가 형해화될 수 없다 — 평가가 죽으면 발행이 죽는다.
--
-- eval_case.origin이 중요하다. 골든셋 120건을 손으로 라벨링했다는 주장은
-- 신입 포트폴리오에서 거의 항상 거짓이고, 면접관은 그걸 안다. 그래서 여기서는
-- 케이스가 어디서 왔는지를 스키마에 박아 항상 특정 가능하게 한다 —
--   seed:       시드 생성기가 ground_truth와 함께 낳은 것 (라벨링 비용 0)
--   shadow:     사람이 섀도 런 3회로 실제로 만든 산출물
--   correction: 검토함에서 사람이 고친 것이 정답으로 승격된 것
--   external:   외부 공개 스펙을 재현한 앵커 케이스
-- 그리고 자작(seed/shadow/correction)과 외부(external)의 정확도를 반드시
-- 따로 보고한다. 내가 낸 문제를 내가 푸는 폐루프를 스스로 드러내기 위해서다.
--
-- is_required_safety는 "평균이 올라도 이건 절대 깨지면 안 된다"는 케이스다.
-- 금액 반올림, 통화 미변환, 개인정보 컬럼 유출, 그리고 파일 셀 안에 지시문이
-- 심긴 프롬프트 인젝션. 하나라도 실패하면 발행이 막힌다.
--
-- human_label.round가 2인 이유: 라벨러가 1명이라 라벨러 간 신뢰도를 낼 수 없다.
-- 대신 시간을 두고 같은 케이스를 다시 라벨링해 자기 자신과의 일치도를 재고,
-- 그 수치도 숨기지 않고 공개한다.

CREATE TABLE failure_type (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name_ko TEXT NOT NULL,
  description TEXT
);

INSERT INTO failure_type (id, code, name_ko, description) VALUES
  ('ft_col',  'column_mismatch',  '컬럼 오매핑',     '원본 헤더를 표준 필드에 잘못 붙였다'),
  ('ft_join', 'join_key',         '조인 키 오판',     'SKU·채널 키를 잘못 잡아 엉뚱한 행끼리 붙었다'),
  ('ft_axis', 'missing_axis',     '집계 축 누락',     '기간·채널 같은 그룹 기준을 빠뜨렸다'),
  ('ft_unit', 'unit_currency',    '단위·통화 미변환', '외화·수량 단위를 환산하지 않고 그대로 더했다'),
  ('ft_schema','schema_violation','스키마 위반',      '출력이 약속한 형식을 지키지 않았다'),
  ('ft_extra','excess_block',     '과잉 블록',        '요청에 없는 처리를 추가해 결과를 바꿨다'),
  ('ft_intent','misread_intent',  '요청 오해',        '무엇을 만들어야 하는지 자체를 잘못 읽었다');

CREATE TABLE eval_case (
  id TEXT PRIMARY KEY,
  recipe_slug TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('plan', 'output', 'refusal', 'safety')),
  title TEXT NOT NULL,
  input_json TEXT NOT NULL,
  expected_json TEXT NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('seed', 'shadow', 'correction', 'external')),
  difficulty TEXT NOT NULL DEFAULT '보통' CHECK (difficulty IN ('쉬움', '보통', '어려움')),
  tags_json TEXT,
  is_required_safety INTEGER NOT NULL DEFAULT 0,
  golden_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_eval_case_slug ON eval_case(recipe_slug, kind, golden_version);
CREATE INDEX idx_eval_case_origin ON eval_case(origin);

-- 실험 변형. 프롬프트 버전 × 샘플 행수 × 스키마 요약 방식 × 검색기 × 모델.
-- adapter가 채워지면 그건 LoRA 어댑터의 오프라인 예측이다 — 같은 채점기를
-- 통과해 같은 리더보드에 오른다.
CREATE TABLE variant (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  sample_rows INTEGER NOT NULL DEFAULT 10,
  schema_summary_mode TEXT NOT NULL DEFAULT 'A',
  model_id TEXT NOT NULL DEFAULT 'claude-opus-5',
  adapter TEXT,
  retriever TEXT CHECK (retriever IN ('bm25', 'embedding')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE eval_run (
  id TEXT PRIMARY KEY,
  recipe_id TEXT REFERENCES recipe(id) ON DELETE CASCADE,
  recipe_slug TEXT NOT NULL,
  variant_id TEXT NOT NULL REFERENCES variant(id) ON DELETE CASCADE,
  golden_version INTEGER NOT NULL DEFAULT 1,
  n_cases INTEGER NOT NULL DEFAULT 0,
  is_publish_gate INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  note TEXT
);

CREATE INDEX idx_eval_run_slug ON eval_run(recipe_slug, started_at);

CREATE TABLE eval_result (
  id TEXT PRIMARY KEY,
  eval_run_id TEXT NOT NULL REFERENCES eval_run(id) ON DELETE CASCADE,
  case_id TEXT NOT NULL REFERENCES eval_case(id) ON DELETE CASCADE,
  rule_score REAL,
  judge_score REAL,
  judge_position_swap_agree INTEGER,
  human_score REAL,
  verdict TEXT NOT NULL CHECK (verdict IN ('통과', '실패', '보류')),
  failure_type_id TEXT REFERENCES failure_type(id),
  detail_json TEXT,
  latency_ms INTEGER,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_krw REAL NOT NULL DEFAULT 0,
  UNIQUE (eval_run_id, case_id)
);

CREATE INDEX idx_eval_result_run ON eval_result(eval_run_id, verdict);

CREATE TABLE human_label (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES eval_case(id) ON DELETE CASCADE,
  labeler TEXT NOT NULL,
  label REAL NOT NULL,
  round INTEGER NOT NULL DEFAULT 1 CHECK (round IN (1, 2)),
  note TEXT,
  labeled_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (case_id, labeler, round)
);

CREATE TABLE publish_gate_log (
  id TEXT PRIMARY KEY,
  recipe_id TEXT NOT NULL REFERENCES recipe(id) ON DELETE CASCADE,
  recipe_slug TEXT NOT NULL,
  version INTEGER NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('통과', '차단', '롤백')),
  verdict_text TEXT NOT NULL,
  blocked_reason_codes_json TEXT,
  regressed_case_ids_json TEXT,
  pass_rate REAL,
  prev_pass_rate REAL,
  kappa REAL,
  eval_run_id TEXT REFERENCES eval_run(id) ON DELETE SET NULL,
  decided_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_publish_gate_recipe ON publish_gate_log(recipe_slug, decided_at);

-- 진 실험은 지우지 않는다. "무엇이 안 통했는가"가 리더보드보다 자주 더 유용하다.
CREATE TABLE experiment_archive (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  hypothesis TEXT NOT NULL,
  result_summary TEXT NOT NULL,
  why_wrong TEXT NOT NULL,
  eval_run_id TEXT REFERENCES eval_run(id) ON DELETE SET NULL,
  archived_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 검토함 교정이 학습 데이터로 흘러가는 경로. sft_dataset.jsonl 내보내기의 원천.
CREATE TABLE sft_row (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('correction', 'plan', 'refusal')),
  instruction TEXT NOT NULL,
  input_text TEXT NOT NULL,
  output_text TEXT NOT NULL,
  evidence_span TEXT,
  is_refusal INTEGER NOT NULL DEFAULT 0,
  dedupe_hash TEXT NOT NULL UNIQUE,
  split TEXT NOT NULL DEFAULT 'train' CHECK (split IN ('train', 'valid')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_sft_row_split ON sft_row(split, source);
