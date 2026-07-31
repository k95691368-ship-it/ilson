-- 이 파일이 이 제품의 심장이다.
--
-- 자동화 도구는 코드가 어려워서 안 만들어지는 게 아니다. "재무는 금액이 1원도
-- 틀리면 안 된다고 하고, 마케팅은 월요일 아침 전에 나와야 한다고 하고, 운영은
-- 자기가 손댈 일이 없어야 한다고 하는데 셋 다는 안 된다"는 지점을 아무도
-- 판정하지 않아서 안 만들어진다. 그 판정이 AX 담당자의 일이고, 이 표들은
-- 그 일이 실제로 일어났다는 기록이다.
--
-- 설계 원칙 하나가 스키마 전체를 관통한다 — **AI는 확정하지 않는다.**
-- requirement.origin은 그 항목을 AI가 뽑았는지 사람이 적었는지를 남기고,
-- requirement.status는 사람이 채택했는지 기각했는지를 남긴다. AI가 뽑은
-- 초안은 status='초안'인 채로는 다음 단계로 내려가지 못한다.
-- requirement_conflict도 마찬가지다 — AI는 충돌 '후보'만 올리고,
-- verdict 컬럼은 사람이 채우기 전까지 NULL이다. NULL인 충돌이 남아 있으면
-- 수용 기준을 확정할 수 없다.
--
-- decision_log는 전 단계를 관통하는 단 하나의 표다. 나중에 "왜 그때 그렇게
-- 정했나"에 답할 수 있어야 하고, unrequested 컬럼은 "요청받지 않았지만 내가
-- 먼저 제안한 것"을 따로 셀 수 있게 한다.

-- 과제마다 누가 이해관계자인지. wants가 이 사람이 원하는 것 한 줄이다.
CREATE TABLE stakeholder (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES request(id) ON DELETE CASCADE,
  dept TEXT NOT NULL,
  role_label TEXT NOT NULL,
  person_label TEXT NOT NULL,
  wants TEXT NOT NULL,
  is_owner INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_stakeholder_request ON stakeholder(request_id, dept);

CREATE TABLE meeting (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES request(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  title TEXT NOT NULL,
  depts_json TEXT NOT NULL,
  held_at TEXT,
  minutes_text TEXT,
  status TEXT NOT NULL DEFAULT '준비'
    CHECK (status IN ('준비', '진행', '정리중', '완료')),
  questions_generated_at TEXT,
  extracted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (request_id, seq)
);

CREATE INDEX idx_meeting_request ON meeting(request_id, seq);

-- AI가 뽑은 질문지. asked=0인 채로 남은 질문은 "물었어야 했는데 안 물은 것"으로
-- 회의 정리 화면에 남아, 다음 회의 질문지의 입력이 된다.
CREATE TABLE meeting_question (
  id TEXT PRIMARY KEY,
  meeting_id TEXT NOT NULL REFERENCES meeting(id) ON DELETE CASCADE,
  ord INTEGER NOT NULL,
  question TEXT NOT NULL,
  why_ask TEXT NOT NULL,
  target_dept TEXT,
  origin TEXT NOT NULL DEFAULT 'ai' CHECK (origin IN ('ai', 'human')),
  asked INTEGER NOT NULL DEFAULT 0,
  answer TEXT,
  UNIQUE (meeting_id, ord)
);

-- 회의록에서 뽑은 요구·제약·미결. quote는 회의록 원문 인용이며 AI 추출 시
-- 스키마상 필수다 — 근거 없이 지어낸 요구를 만들 수 없게 한다.
CREATE TABLE requirement (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES request(id) ON DELETE CASCADE,
  meeting_id TEXT REFERENCES meeting(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('요구', '제약', '미결', '가정')),
  dept TEXT NOT NULL,
  body TEXT NOT NULL,
  quote TEXT,
  priority TEXT NOT NULL DEFAULT '보통' CHECK (priority IN ('필수', '보통', '있으면좋음')),
  origin TEXT NOT NULL DEFAULT 'ai' CHECK (origin IN ('ai', 'human')),
  status TEXT NOT NULL DEFAULT '초안'
    CHECK (status IN ('초안', '채택', '수정채택', '기각')),
  decided_body TEXT,
  reject_reason TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_requirement_request ON requirement(request_id, status, kind);

-- AI는 후보만 올린다. verdict가 NULL이면 아직 사람이 판정하지 않은 것이고,
-- 미판정 충돌이 있으면 수용 기준을 확정할 수 없다.
CREATE TABLE requirement_conflict (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES request(id) ON DELETE CASCADE,
  req_a_id TEXT NOT NULL REFERENCES requirement(id) ON DELETE CASCADE,
  req_b_id TEXT NOT NULL REFERENCES requirement(id) ON DELETE CASCADE,
  ai_reason TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT '보통' CHECK (severity IN ('낮음', '보통', '높음')),
  verdict TEXT CHECK (verdict IN ('A우선', 'B우선', '절충', '충돌아님')),
  verdict_reason TEXT,
  tradeoff_note TEXT,
  decided_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (req_a_id, req_b_id)
);

CREATE INDEX idx_conflict_request ON requirement_conflict(request_id, verdict);

-- 회의에서 합의한 것이 여기서 "무엇을 통과라고 볼 것인가"로 굳는다.
-- check_kind가 rule이면 인수인계 게이트의 규칙 채점으로 그대로 내려간다.
CREATE TABLE acceptance_criterion (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES request(id) ON DELETE CASCADE,
  ord INTEGER NOT NULL,
  body TEXT NOT NULL,
  from_requirement_id TEXT REFERENCES requirement(id) ON DELETE SET NULL,
  from_conflict_id TEXT REFERENCES requirement_conflict(id) ON DELETE SET NULL,
  check_kind TEXT NOT NULL DEFAULT 'rule' CHECK (check_kind IN ('rule', 'judge', 'human')),
  check_config_json TEXT,
  is_required_safety INTEGER NOT NULL DEFAULT 0,
  confirmed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  confirmed_at TEXT,
  UNIQUE (request_id, ord)
);

CREATE INDEX idx_acceptance_request ON acceptance_criterion(request_id, ord);

-- 전 단계를 관통하는 단 하나의 표.
-- stage는 8단계 레일의 위치, actor는 사람인지 AI인지(AI는 '제안'만 기록),
-- alternatives는 "다른 선택지가 무엇이었나", unrequested는 "요청받지 않았지만
-- 내가 먼저 제안한 것"이다. 마지막 컬럼이 두어스 공고의 '주도성'에 답한다.
CREATE TABLE decision_log (
  id TEXT PRIMARY KEY,
  request_id TEXT REFERENCES request(id) ON DELETE CASCADE,
  stage TEXT NOT NULL CHECK (stage IN (
    '접수', '발굴회의', '충돌판정', '기준선', '제작', '품질기준', '성과정의', '인수인계'
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

CREATE INDEX idx_decision_request ON decision_log(request_id, created_at);
CREATE INDEX idx_decision_stage ON decision_log(stage, created_at);
CREATE INDEX idx_decision_unrequested ON decision_log(unrequested, created_at);
