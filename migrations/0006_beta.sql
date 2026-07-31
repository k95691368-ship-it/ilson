-- 5단계 — 베타 테스트.
--
-- 3단계에서 정한 합격 기준으로 4단계 결과를 채점한다. 사람이 눈으로 맞춰
-- 보지 않는다 — 시험 파일을 만들 때 정답도 같이 만들어 뒀기 때문에 기계가
-- 대조할 수 있다.
--
-- 회차(round)를 남기는 것이 중요하다. 한 번에 통과하는 개발은 없고, 있는 척하면
-- 오히려 가짜로 보인다. 1차에서 무엇이 깨졌고 무엇을 고쳤고 2차에서 어떻게
-- 됐는지가 남아야 진짜 만든 기록이 된다.

CREATE TABLE beta_round (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES application(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  build_run_id TEXT REFERENCES build_run(id) ON DELETE SET NULL,

  -- 통과 / 조건부 / 차단
  -- 차단은 '필수 안전' 기준이 깨진 경우다. 다른 점수가 아무리 좋아도 막는다.
  overall TEXT NOT NULL CHECK (overall IN ('통과', '조건부', '차단')),
  total INTEGER NOT NULL DEFAULT 0,
  passed INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  safety_failed INTEGER NOT NULL DEFAULT 0,
  human_needed INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER,

  -- 이번 회차에서 무엇을 고쳤는지. 1차에는 비어 있고 2차부터 채워진다.
  fixed_what TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (application_id, seq)
);

CREATE INDEX idx_beta_round_app ON beta_round(application_id, seq DESC);

-- 기준 하나에 대한 판정.
--
-- evidence를 반드시 남긴다. "실패"만 있으면 어디를 고쳐야 할지 알 수 없다.
-- samples_json에는 실제로 어긋난 줄 몇 개를 담는다.
CREATE TABLE beta_result (
  id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL REFERENCES beta_round(id) ON DELETE CASCADE,
  criterion_id TEXT,
  ord INTEGER NOT NULL DEFAULT 0,
  body TEXT NOT NULL,
  check_key TEXT,
  check_kind TEXT NOT NULL DEFAULT 'rule',
  is_required_safety INTEGER NOT NULL DEFAULT 0,
  verdict TEXT NOT NULL CHECK (verdict IN ('통과', '실패', '사람확인', '판정불가')),
  evidence TEXT,
  samples_json TEXT
);

CREATE INDEX idx_beta_result_round ON beta_result(round_id, ord);

-- 실제로 써 본 현업 담당자가 한 말.
--
-- 기계 채점이 통과여도 사람이 못 쓰겠다고 하면 못 쓰는 것이다.
-- 여기 적힌 것이 6단계 사용법서의 '자주 묻는 것'이 된다.
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
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_beta_feedback_app ON beta_feedback(application_id, created_at DESC);
