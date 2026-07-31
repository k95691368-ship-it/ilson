-- 1단계 — 신청서.
--
-- 현업 부서가 자기 병목을 적어 내는 자리다. 이 표에서 가장 중요한 것은
-- 마지막 세 컬럼(current_minutes / current_people / current_frequency)이다.
--
-- 8단계에서 "97분이 3분이 됐습니다"를 말하려면 자동화 전의 값이 있어야 하는데,
-- 대부분의 자동화 프로젝트가 이걸 안 받아 둔다. 그래서 나중에 만든 사람이
-- 기억으로 적고, 그 숫자를 아무도 믿지 않는다. 여기서 받는 값은 어디까지나
-- 신청자의 체감이며(is_measured = 0), 3단계에서 실제로 재서 봉인한 값이
-- 따로 있다. 두 값을 나란히 보여 주면 체감과 실측이 얼마나 다른지도 드러난다.
--
-- 신청서는 로그인 없이 낼 수 있다. 부서 담당자에게 계정을 만들게 하는 순간
-- 아무도 신청하지 않는다. 대신 접수번호를 주고, 그 번호로 진행 상황을 본다.

CREATE TABLE application (
  id TEXT PRIMARY KEY,
  -- 부서 담당자에게 알려 줄 짧은 번호. id는 길어서 전화로 불러 줄 수 없다.
  ticket_no TEXT NOT NULL UNIQUE,

  dept TEXT NOT NULL,
  applicant_label TEXT NOT NULL,
  contact TEXT,

  title TEXT NOT NULL,
  -- 신청 이유 = 무엇이 병목인가
  bottleneck TEXT NOT NULL,
  -- 문제 상황 = 그래서 지금 무슨 일이 벌어지고 있는가
  problem TEXT NOT NULL,
  -- 바라는 해결 방안 = 신청자가 생각하는 답 (그대로 만들어 준다는 뜻은 아니다)
  wish TEXT,

  -- 지금 이 일에 드는 비용. 신청자의 체감값이다.
  current_minutes INTEGER,
  current_people INTEGER,
  current_frequency TEXT,
  -- 0이면 체감, 1이면 3단계에서 실측해 봉인한 값으로 갱신되었다는 뜻.
  is_measured INTEGER NOT NULL DEFAULT 0,

  -- 틀렸을 때 무슨 일이 생기는가. 우선순위 판단의 핵심 재료다.
  impact_if_wrong TEXT,

  status TEXT NOT NULL DEFAULT '접수'
    CHECK (status IN ('접수', '검토중', '수용', '반려', '보류', '진행중', '완료')),

  source_ip_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_application_status ON application(status, created_at);
CREATE INDEX idx_application_dept ON application(dept, created_at);
CREATE INDEX idx_application_created ON application(created_at);

-- 지금 손으로 다루고 있는 실제 파일. 말로 듣는 것보다 파일 하나가 정확하다.
-- 원본은 R2에 두고 여기에는 위치와 지문만 남긴다.
CREATE TABLE application_file (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES application(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  content_type TEXT,
  checksum TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  -- 브라우저가 AI 호출 없이 먼저 읽어 낸 구조(시트 수, 헤더, 행 수, 인코딩 추정).
  profile_json TEXT,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_application_file_app ON application_file(application_id);

-- AI가 신청 문장을 읽고 정리한 초안. application 본체에 쓰지 않고 따로 두는
-- 이유는, 부서가 적어 낸 원문과 AI가 추정한 값이 섞이면 안 되기 때문이다.
-- 화면에서 원문은 실선, 이 표의 값은 점선으로 그린다.
CREATE TABLE application_ai_draft (
  application_id TEXT PRIMARY KEY REFERENCES application(id) ON DELETE CASCADE,
  guessed_dept TEXT,
  job_kind TEXT,
  summary TEXT,
  evidence TEXT,
  est_frequency TEXT,
  est_minutes_per_run REAL,
  confidence REAL,
  accepted_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  accepted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
