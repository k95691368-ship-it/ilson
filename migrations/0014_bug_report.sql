-- 이 사이트 자체의 버그를 받는 자리.
--
-- decision_log 에 얹지 않았다. 그 표는 **신청서 한 건이 여덟(지금은 여섯)
-- 단계를 지나며 무엇을 왜 정했는가**를 담는 자리이고, stage 칸에 CHECK 이
-- 걸려 있다. 사이트 버그는 단계에 속하지 않는다. 억지로 '제작'으로 적어
-- 넣으면 결정 기록 화면이 제작 단계 결정인 척하는 줄을 갖게 된다.
--
-- 그리고 이건 상태가 바뀌는 기록이다 — 접수 → 확인함 → 고침. decision_log
-- 는 append-only 라 상태 변화를 담으려면 줄을 덧붙이고 매번 접어 읽어야
-- 하는데, 여기서는 그럴 이유가 없다. 한 건이 한 줄이다.

CREATE TABLE IF NOT EXISTS bug_report (
  id TEXT PRIMARY KEY,
  area TEXT NOT NULL,
  kind TEXT NOT NULL,
  body TEXT NOT NULL,
  -- 다시 나오게 하는 방법. 없으면 고칠 수가 없어서 물어보지만, 없다고
  -- 접수를 막지는 않는다 — 못 적는다고 돌려보내면 그 버그는 영영 안 온다.
  steps TEXT,
  reporter TEXT,
  status TEXT NOT NULL DEFAULT '접수'
    CHECK (status IN ('접수', '확인함', '고침', '버그아님')),
  -- 고쳤으면 무엇을 고쳤는지, 아니면 왜 아닌지. 근거 없이 닫으면 신고한
  -- 사람은 무시당한 것으로 읽는다.
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_bug_status ON bug_report(status, created_at);
