-- 절감액은 만든 사람이 자기 입으로 말하면 아무도 믿지 않는다.
--
-- 그래서 두 가지를 스키마로 강제한다.
-- (1) 차감 항목을 컬럼으로 못 박는다. 순절감은 "기준선 × 실행횟수"가 아니라
--     거기서 자동실행시간·사람검수시간·재작업시간·개발공수 상각·실측 API
--     원가를 뺀 값이다. 컬럼이 있으면 계산식을 화면에 펼칠 수밖에 없다.
-- (2) 봉인된 기준선이 없으면 원화 환산 자체를 하지 않는다. baseline이 없는
--     과제의 savings_month 행은 net_saved_krw를 NULL로 두고 실측 실행 시간만
--     보여준다.
--
-- audit_challenge는 자기 숫자를 스스로 반박하는 장치다. rule_code 8종은
-- 규칙으로 고정되어 있고 LLM은 문장화만 한다 — LLM에게 반박을 만들라고 하면
-- 매번 비슷한 네 가지로 수렴해서 장식이 된다. 미해소 반박이 하나라도 붙으면
-- 그 달의 금액은 '보수적추정' 상태로 강등되어 별도 집계된다.

CREATE TABLE savings_month (
  id TEXT PRIMARY KEY,
  month TEXT NOT NULL,
  recipe_id TEXT NOT NULL REFERENCES recipe(id) ON DELETE CASCADE,
  request_id TEXT REFERENCES request(id) ON DELETE SET NULL,
  baseline_seconds REAL,
  baseline_sample_n INTEGER,
  runs INTEGER NOT NULL DEFAULT 0,
  auto_seconds REAL NOT NULL DEFAULT 0,
  human_review_seconds REAL NOT NULL DEFAULT 0,
  rework_seconds REAL NOT NULL DEFAULT 0,
  dev_amortized_krw REAL NOT NULL DEFAULT 0,
  api_cost_krw REAL NOT NULL DEFAULT 0,
  hourly_wage_krw INTEGER NOT NULL DEFAULT 25000,
  net_saved_seconds REAL,
  net_saved_krw REAL,
  status TEXT NOT NULL DEFAULT '인정' CHECK (status IN ('인정', '보수적추정', '산정불가')),
  computed_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (month, recipe_id)
);

CREATE INDEX idx_savings_month ON savings_month(month);

-- rule_code 8종은 코드에서도 같은 목록으로 고정된다(functions/_lib/audit.js).
--   n_too_small          기준선 표본이 5회 미만이다
--   seasonality          이번 달 물량이 계절적으로 평소와 다르다
--   thin_margin          합격 마진이 2%p 미만이라 다음 달에 뒤집힐 수 있다
--   dev_cost_understated 개발 공수를 과소 계상했을 수 있다
--   small_sample_widget  이 숫자를 만든 위젯의 표본이 30건 미만이다
--   golden_tag_skew      골든셋이 특정 태그에 쏠려 있다
--   judge_position_bias  심판의 위치 편향 불일치율이 임계를 넘었다
--   data_leak            챔피언 프롬프트가 골든셋보다 나중에 만들어졌다
CREATE TABLE audit_challenge (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('month', 'recipe', 'widget')),
  scope_key TEXT NOT NULL,
  rule_code TEXT NOT NULL CHECK (rule_code IN (
    'n_too_small', 'seasonality', 'thin_margin', 'dev_cost_understated',
    'small_sample_widget', 'golden_tag_skew', 'judge_position_bias', 'data_leak'
  )),
  severity TEXT NOT NULL DEFAULT '보통' CHECK (severity IN ('낮음', '보통', '높음')),
  body TEXT NOT NULL,
  evidence_json TEXT,
  resolved INTEGER NOT NULL DEFAULT 0,
  resolution_note TEXT,
  raised_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT,
  UNIQUE (scope, scope_key, rule_code)
);

CREATE INDEX idx_audit_challenge_scope ON audit_challenge(scope, scope_key, resolved);
