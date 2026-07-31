-- 자동화의 출발점은 명세서가 아니라 불평 한 줄이다. 그래서 request.body_text는
-- 자유 문장이고, 구조화는 역질문(intake_answer)을 거쳐서만 이루어진다.
--
-- 이 파일의 핵심은 baseline이다. 자동화 포트폴리오가 신뢰를 잃는 가장 흔한
-- 지점은 "90분이 40초가 됐습니다"를 만든 사람이 자기 입으로 신고하는 것이다.
-- 그래서 여기서는 자동화하기 **전에** 그 일을 사람이 앱 안에서 3번 하게 하고
-- (shadow_run), 그 측정치의 중앙값만 기준선으로 봉인한다. 봉인된 뒤에는 UPDATE
-- 하지 않는다 — 다시 재려면 새 shadow_run을 쌓고 baseline_history에 이전 값을
-- 남긴 뒤 갈아끼운다.
--
-- 표본이 3이라는 것은 통계적으로 약하다. 그래서 sample_n을 컬럼으로 들고 다니며
-- 화면에 "표본 3회" 배지를 강제로 붙이고, 이 값에는 신뢰구간을 붙이지 않는다.
-- 신뢰구간은 표본이 충분한 실측치(실행 소요시간, A/B 정확도 차이)에만 붙인다.

CREATE TABLE request (
  id TEXT PRIMARY KEY,
  body_text TEXT NOT NULL,
  dept TEXT NOT NULL DEFAULT '미지정',
  source_ip_hash TEXT,
  status TEXT NOT NULL DEFAULT '접수'
    CHECK (status IN ('접수', '거절', '명세', '제작중', '발행', '보류')),
  refuse_reason_code TEXT,
  refuse_reason_text TEXT,
  refuse_alternative TEXT,
  impact_score REAL,
  difficulty_score REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  first_published_at TEXT
);

CREATE INDEX idx_request_status ON request(status, created_at);
CREATE INDEX idx_request_created ON request(created_at);

CREATE TABLE intake_answer (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES request(id) ON DELETE CASCADE,
  ord INTEGER NOT NULL,
  question TEXT NOT NULL,
  why_asked TEXT,
  answer TEXT,
  asked_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_intake_answer_request ON intake_answer(request_id, ord);

CREATE TABLE shadow_run (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES request(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL CHECK (seq BETWEEN 1 AND 10),
  step_timings_json TEXT,
  total_seconds REAL NOT NULL,
  error_count INTEGER NOT NULL DEFAULT 0,
  output_r2_key TEXT,
  run_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (request_id, seq)
);

CREATE TABLE baseline (
  request_id TEXT PRIMARY KEY REFERENCES request(id) ON DELETE CASCADE,
  median_seconds REAL NOT NULL,
  p25_seconds REAL NOT NULL,
  p75_seconds REAL NOT NULL,
  sample_n INTEGER NOT NULL,
  error_rate REAL NOT NULL DEFAULT 0,
  hourly_wage_krw INTEGER NOT NULL DEFAULT 25000,
  sealed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE baseline_history (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES request(id) ON DELETE CASCADE,
  median_seconds REAL NOT NULL,
  sample_n INTEGER NOT NULL,
  replaced_at TEXT NOT NULL DEFAULT (datetime('now')),
  reason TEXT
);
