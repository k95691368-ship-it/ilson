-- 보류를 한 곳에만 적는다.
--
-- 여태 보류가 두 길로 들어왔다. 한 건씩 판정하면 review 표에
-- hold_until_condition 이 적히고, 접수함에서 여러 건을 한 번에 미루면
-- decision_log 에만 남았다.
--
-- 왜 그렇게 됐나: review 표가 점수 네 칸을 NOT NULL 로 받는다. 한 번에
-- 미루는 것은 점수를 매기는 일이 아니라서 넣을 값이 없었다. 그래서 기록만
-- 남기고 표는 건드리지 않았고, 그 결과 담당자가 **의무로 적은** 다시 볼
-- 조건을 읽는 자리가 넷 다 비어 있었다. 30일 넘김 경보도 안 켜졌다.
--
-- 읽는 쪽에서 두 자리를 다 보게 해서 급한 불은 껐다. 하지만 한 가지 사실이
-- 두 곳에 나뉘어 있는 것은 그대로였다 — 새 화면을 만들 때마다 두 곳을
-- 기억해야 하고, 한 곳만 보면 조용히 빈 값이 된다.
--
-- 점수 칸을 비워 둘 수 있게 한다. **점수를 안 매긴 것은 안 매겼다고
-- 적는다** — 0이나 3 같은 값을 넣어 채우면 우선순위 화면이 그 신청서를
-- 실제로 견줘 본 것처럼 그린다. 그건 이 사이트가 하지 말라는 것이다.
--
-- SQLite 는 컬럼의 NOT NULL 을 떼는 문법이 없다. 표를 새로 만들고 옮긴다.
-- 그동안 외래키를 꺼 두면 참조하던 행이 조용히 끊어지므로 켠 채로 한다.

CREATE TABLE review_new (
  application_id TEXT PRIMARY KEY REFERENCES application(id) ON DELETE CASCADE,

  -- 1~5. 담당자가 매긴다.
  --
  -- 비어 있을 수 있다. 한 번에 여러 건을 미룰 때는 점수를 매기지 않는다 —
  -- 그때 하는 판단은 "지금은 못 한다"뿐이고, 그건 내용을 깊이 안 봐도 설
  -- 때가 있다(분기 마감이라 손이 없다든지).
  impact_score REAL CHECK (impact_score IS NULL OR impact_score BETWEEN 1 AND 5),
  impact_reason TEXT,
  difficulty_score REAL CHECK (difficulty_score IS NULL OR difficulty_score BETWEEN 1 AND 5),
  difficulty_reason TEXT,

  verdict TEXT NOT NULL CHECK (verdict IN ('수용', '반려', '보류')),
  verdict_reason TEXT NOT NULL,
  -- 고르지 않은 길. 이걸 적어야 판단이 판단이 된다.
  --
  -- 이것도 비울 수 있게 한다. 한 번에 미룬 것은 대안을 견준 것이 아니다.
  -- 견주지 않았는데 견준 것처럼 적으면 그 줄이 거짓말이 된다.
  alternatives_considered TEXT,

  -- 반려일 때만.
  refuse_code TEXT CHECK (refuse_code IN (
    'external_write', 'auth_crawl', 'realtime', 'human_judgment',
    'media_gen', 'unstructured_only', 'other'
  )),
  refuse_alternative TEXT,

  -- 보류일 때만. 무엇이 풀리면 다시 볼 것인지.
  hold_until_condition TEXT,

  -- 한 번에 미루면서 남긴 것인가.
  --
  -- 이 칸이 있어야 화면이 "점수는 아직 안 매겼습니다"라고 말할 수 있다.
  -- 점수가 비었다는 것만으로 짐작하면, 나중에 점수를 선택 입력으로 바꾸는
  -- 날 뜻이 달라진다.
  bulk INTEGER NOT NULL DEFAULT 0,

  -- 수용된 것들 사이의 순번. 비어 있으면 아직 순서를 정하지 않은 것.
  priority_rank INTEGER,

  reviewer_label TEXT NOT NULL DEFAULT 'AX 담당자',
  decided_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO review_new (
  application_id, impact_score, impact_reason, difficulty_score, difficulty_reason,
  verdict, verdict_reason, alternatives_considered,
  refuse_code, refuse_alternative, hold_until_condition,
  bulk, priority_rank, reviewer_label, decided_at, updated_at
)
SELECT
  application_id, impact_score, impact_reason, difficulty_score, difficulty_reason,
  verdict, verdict_reason, alternatives_considered,
  refuse_code, refuse_alternative, hold_until_condition,
  0, priority_rank, reviewer_label, decided_at, updated_at
FROM review;

DROP TABLE review;
ALTER TABLE review_new RENAME TO review;
