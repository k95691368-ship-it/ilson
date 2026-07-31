-- 7·8단계 — 인수인계와 성과.
--
-- 둘 다 "신청서 한 건에 붙는 기록"이다. 배포는 누구에게 언제 넘겼고 그 뒤로
-- 몇 번 돌았는지의 기록이고, 성과는 3단계에서 재 둔 기준선과 대조한 기록이다.
--
-- 넘긴 것으로 끝나지 않는다. 넘긴 뒤에 실제로 쓰이는지, 실패하는지, 부서가
-- 받았다고 확인했는지가 남아야 인수인계다. 아무도 안 쓰는 도구를 만들어 놓고
-- 성과를 말하는 일이 흔하다.

CREATE TABLE handover (
  application_id TEXT PRIMARY KEY REFERENCES application(id) ON DELETE CASCADE,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,

  handed_to_dept TEXT NOT NULL,
  handed_to_person TEXT NOT NULL,
  handed_at TEXT NOT NULL DEFAULT (datetime('now')),

  -- 부서가 받았다고 확인한 시각. 넘겼다고 받은 것이 아니다.
  accepted_at TEXT,
  accepted_by TEXT,

  -- 화면에 항상 보여 줄 사용 한도. 누가 봐도 알 수 있어야 한다.
  daily_limit INTEGER NOT NULL DEFAULT 20,
  max_file_mb INTEGER NOT NULL DEFAULT 10,

  note TEXT,
  -- 되돌린 경우
  rolled_back_at TEXT,
  rollback_reason TEXT,

  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_handover_slug ON handover(slug);

-- 넘긴 뒤 실제로 돈 기록.
--
-- 8단계 성과가 이 표를 센다. 사람이 검토한 시간과 다시 한 시간을 여기서
-- 받아야 절감에서 뺄 수 있다. 이 둘을 안 빼면 절감이 부풀려진다.
CREATE TABLE tool_use (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES application(id) ON DELETE CASCADE,
  used_at TEXT NOT NULL DEFAULT (datetime('now')),
  actor_label TEXT NOT NULL DEFAULT '부서 담당자',
  files_json TEXT,
  rows_out INTEGER NOT NULL DEFAULT 0,
  quarantined INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER,
  -- 사람이 검토함을 보고 처리한 시간. 자동화 뒤에도 드는 시간이다.
  human_review_seconds REAL NOT NULL DEFAULT 0,
  rework_seconds REAL NOT NULL DEFAULT 0,
  ok INTEGER NOT NULL DEFAULT 1,
  fail_reason TEXT
);

CREATE INDEX idx_tool_use_app ON tool_use(application_id, used_at DESC);

-- 성과 정리. 계산은 코드가 하고(shared/outcome.js) 여기에는 그 결과와
-- 사람이 넣은 값(만든 공수, 부서 확인)을 남긴다.
CREATE TABLE outcome (
  application_id TEXT PRIMARY KEY REFERENCES application(id) ON DELETE CASCADE,
  dev_hours REAL NOT NULL DEFAULT 0,
  ops_cost_krw REAL NOT NULL DEFAULT 0,
  amortize_months INTEGER NOT NULL DEFAULT 24,

  -- 부서가 이 숫자를 보고 맞다고 했는지. 만든 사람만 아는 성과는 성과가 아니다.
  dept_confirmed_at TEXT,
  dept_confirmed_by TEXT,
  dept_comment TEXT,

  -- 이 과정에서 새로 발견된 병목. 다음 신청서가 된다.
  next_bottleneck TEXT,

  computed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 자기 반박. 규칙 코드는 shared/outcome.js의 CHALLENGE_RULES와 같다.
--
-- 해소하지 못한 것이 하나라도 있으면 금액을 '보수적 추정'으로 낮춰 부른다.
-- 숫자를 몰래 깎지는 않는다 — 부르는 이름만 바꾼다.
CREATE TABLE outcome_challenge (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES application(id) ON DELETE CASCADE,
  rule_code TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  resolved_at TEXT,
  resolution TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (application_id, rule_code)
);

CREATE INDEX idx_outcome_challenge_app ON outcome_challenge(application_id, resolved_at);
