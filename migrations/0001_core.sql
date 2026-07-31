-- 이 앱은 로그인 없이도 대부분이 동작한다. 접수·시운전·공개 도구 실행은
-- 누구나 할 수 있고, 로그인은 "되돌릴 수 없는 일"에만 요구한다 — 도구 발행,
-- 삭제, 평가 승격, 결산 확정. 그래서 계정 테이블은 있되 앱의 관문이 아니다.
--
-- rate_limit_hits는 계정과 무관하게 IP 단위로도 세야 해서 users를 참조하지
-- 않는다. 공개 도구 URL이 로그인 없이 열리는 이상, 남용 방어는 계정이 아니라
-- 요청 자체에 걸려야 한다.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  display_name TEXT NOT NULL,
  dept TEXT,
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

-- 한도 초과 판정은 "몇 번 해냈는가"를 세는 것이지 "몇 번 시도했는가"가 아니다.
-- 외부 호출이 실패하면 releaseRateLimit(id)으로 그 한 건만 되돌린다.
CREATE TABLE rate_limit_hits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bucket TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_rate_limit_bucket ON rate_limit_hits(bucket, created_at);

-- 발행 통과·차단·롤백처럼 나중에 "왜 그때 그렇게 됐나"를 물을 수 있는 일은
-- 전부 여기에 남는다. 화면에서 지워도 이 표에는 남아야 한다.
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

-- 이메일 발송은 쓰지 않는다. 알림은 전부 앱 안에서만 끝난다.
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
