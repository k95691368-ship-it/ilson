-- 여덟 단계 전부가 함께 쓰는 것들.
--
-- 단계별 표(신청서·협의안·제작 기록·베타 결과·성과)는 그 단계를 만들 때
-- 새 번호의 마이그레이션으로 추가한다. 이 파일에는 어느 단계에서든 필요한
-- 것만 둔다.
--
-- 로그인은 앱의 관문이 아니다. 신청서 제출과 인수인계된 도구 실행은 누구나
-- 할 수 있고, 계정은 "되돌릴 수 없는 일"에만 요구한다 — 반려 판정, 합격 기준
-- 확정, 배포 승인. 그래서 users는 있되 첫 화면에 로그인이 없다.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  display_name TEXT NOT NULL,
  dept TEXT,
  role TEXT NOT NULL DEFAULT 'ax' CHECK (role IN ('ax', 'dept')),
  is_suspended INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expiry ON sessions(expires_at);

-- 한도는 "몇 번 해냈는가"를 세는 것이지 "몇 번 시도했는가"가 아니다.
-- 외부 호출이 실패하면 그 한 건만 되돌린다(releaseRateLimit).
CREATE TABLE rate_limit_hits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bucket TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_rate_limit_bucket ON rate_limit_hits(bucket, created_at);

-- 나중에 "왜 그때 그렇게 됐나"를 물을 수 있는 일은 전부 여기 남는다.
-- 화면에서 지워도 이 표에는 남아야 한다.
CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  actor_label TEXT,
  action TEXT NOT NULL,
  target_kind TEXT,
  target_id TEXT,
  detail_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_audit_log_target ON audit_log(target_kind, target_id, created_at);
CREATE INDEX idx_audit_log_created ON audit_log(created_at);

-- 의사결정 로그. 여덟 단계를 관통하는 단 하나의 표다.
--
-- 남기는 것 중 둘이 특히 중요하다.
--   why          : 근거. 이게 비어 있으면 결정이 아니라 클릭이다.
--   alternatives : 무엇을 고르지 않았는가. 대안을 적어야 판단이 판단이 된다.
--
-- actor로 사람과 AI를 가른다. AI가 낸 것도 남기는 이유는 "무엇을 AI가 제안했고
-- 사람이 그중 무엇을 받아들였나"가 이 포트폴리오의 서사이기 때문이다.
-- unrequested는 "아무도 요청하지 않았는데 내가 먼저 제안한 것"이다.
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
  unrequested INTEGER NOT NULL DEFAULT 0,
  link_kind TEXT,
  link_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_decision_application ON decision_log(application_id, created_at);
CREATE INDEX idx_decision_stage ON decision_log(stage, created_at);
CREATE INDEX idx_decision_unrequested ON decision_log(unrequested, created_at);

-- 이메일은 쓰지 않는다. 알림은 앱 안에서만 끝난다.
CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  link TEXT,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_notifications_user ON notifications(user_id, read_at, created_at);

-- AI 호출은 전부 여기 기록된다. 어느 단계에서 무슨 초안을 만들려고 얼마를
-- 썼는지가 남아야, 성과를 정산할 때 운영 비용을 차감할 수 있다.
CREATE TABLE ai_call (
  id TEXT PRIMARY KEY,
  stage TEXT NOT NULL,
  purpose TEXT NOT NULL,
  application_id TEXT,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_krw REAL NOT NULL DEFAULT 0,
  duration_ms INTEGER,
  ok INTEGER NOT NULL DEFAULT 1,
  fail_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_ai_call_stage ON ai_call(stage, created_at);
CREATE INDEX idx_ai_call_application ON ai_call(application_id, created_at);
