-- 2단계 — 검토와 판정.
--
-- 신청서 하나에 검토 하나. 여기서 담당자가 세 가지를 한다.
--   무엇을 먼저 할지 정한다 (임팩트 × 난이도)
--   만들 수 있는 일인지 판정한다 (수용 / 반려 / 보류)
--   그 판단의 근거를 남긴다
--
-- 이 표에서 가장 중요한 것은 verdict_reason과 alternatives_considered다.
-- 근거 없는 판정은 판정이 아니라 클릭이고, 무엇을 고르지 않았는지를 적지
-- 않으면 나중에 "왜 그때 그렇게 정했나"에 답할 수 없다. 둘 다 NOT NULL이다.
--
-- 반려일 때 refuse_alternative도 NOT NULL로 강제한다. "안 됩니다"만 돌려보내면
-- 그 부서는 다시 신청하지 않고, 그러면 병목은 그대로 남는다. 못 만드는 것을
-- 못 만든다고 말하되, 대신 무엇을 할 수 있는지는 반드시 같이 말한다.
-- 정말 대안이 없으면 "이 요청은 다른 도구로 가야 합니다"라고 적으면 된다 —
-- 그것도 대답이다.

CREATE TABLE review (
  application_id TEXT PRIMARY KEY REFERENCES application(id) ON DELETE CASCADE,

  -- 1~5. 담당자가 매긴다. AI가 제안할 수는 있지만 확정은 사람이 한다.
  impact_score REAL NOT NULL CHECK (impact_score BETWEEN 1 AND 5),
  impact_reason TEXT NOT NULL,
  difficulty_score REAL NOT NULL CHECK (difficulty_score BETWEEN 1 AND 5),
  difficulty_reason TEXT NOT NULL,

  verdict TEXT NOT NULL CHECK (verdict IN ('수용', '반려', '보류')),
  verdict_reason TEXT NOT NULL,
  -- 고르지 않은 길. 이걸 적어야 판단이 판단이 된다.
  alternatives_considered TEXT NOT NULL,

  -- 반려일 때만. 코드는 blockTypes.js의 OUT_OF_SCOPE와 같은 값을 쓴다.
  refuse_code TEXT CHECK (refuse_code IN (
    'external_write', 'auth_crawl', 'realtime', 'human_judgment',
    'media_gen', 'unstructured_only', 'other'
  )),
  refuse_alternative TEXT,

  -- 보류일 때만. 무엇이 풀리면 다시 볼 것인지.
  hold_until_condition TEXT,

  -- 수용된 것들 사이의 순번. 비어 있으면 아직 순서를 정하지 않은 것.
  priority_rank INTEGER,

  reviewer_label TEXT NOT NULL DEFAULT 'AX 담당자',
  decided_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_review_verdict ON review(verdict, decided_at);
CREATE INDEX idx_review_rank ON review(priority_rank);

-- AI가 신청서를 읽고 낸 초안. review 본체와 섞지 않는다.
--
-- 화면에서 이 표의 값은 점선으로, 담당자가 확정한 review는 실선으로 그린다.
-- accepted_at이 찍히기 전에는 어떤 값도 판정으로 쓰이지 않는다.
CREATE TABLE review_ai_draft (
  application_id TEXT PRIMARY KEY REFERENCES application(id) ON DELETE CASCADE,

  summary TEXT,
  -- 만들 수 있는 일인가에 대한 AI의 의견. 참고일 뿐 판정이 아니다.
  feasible INTEGER,
  feasible_reason TEXT,
  blocked_by TEXT,
  suggested_alternative TEXT,
  partial_note TEXT,

  suggested_impact REAL,
  suggested_impact_reason TEXT,
  suggested_difficulty REAL,
  suggested_difficulty_reason TEXT,

  -- 이미 접수된 것과 겹치는지. 같은 병목이 부서만 다르게 들어오는 일이 흔하다.
  similar_ids_json TEXT,

  confidence REAL,
  model TEXT,
  prompt_version TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  accepted_at TEXT
);
