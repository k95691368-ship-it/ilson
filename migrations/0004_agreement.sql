-- 3단계 — 협의안.
--
-- 수용된 신청서를 놓고 부서와 마주 앉아 정하는 것들이다.
--
-- 이 단계가 없으면 나머지가 전부 흔들린다. 무엇을 만들지 합의하지 않고
-- 만들면 다 만든 뒤에 "이게 아닌데요"가 나오고, 무엇을 통과로 볼지 정하지
-- 않고 만들면 5단계에서 결과에 맞춰 기준이 움직인다.
--
-- 특히 baseline이 중요하다. 8단계에서 "97분이 3분이 됐습니다"를 말하려면
-- 자동화하기 **전에** 재 둬야 한다. 신청서에 적힌 값은 신청자의 체감이라
-- 근거가 되지 못한다. 여기서 실제로 재고 봉인한다.

-- 이 과제에 이해관계가 있는 사람들. 각자 원하는 것이 다르고, 그 차이가
-- 다음 표(requirement_conflict)의 재료가 된다.
CREATE TABLE stakeholder (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES application(id) ON DELETE CASCADE,
  dept TEXT NOT NULL,
  role_label TEXT NOT NULL,
  person_label TEXT NOT NULL,
  wants TEXT NOT NULL,
  is_owner INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_stakeholder_app ON stakeholder(application_id, is_owner DESC);

-- 회의. minutes_text는 담당자가 직접 적은 회의록 원문이다.
-- 아래 requirement의 quote가 이 원문 안에 실제로 있는지 대조한다.
CREATE TABLE meeting (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES application(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  title TEXT NOT NULL,
  depts_json TEXT,
  held_at TEXT,
  minutes_text TEXT,
  status TEXT NOT NULL DEFAULT '준비' CHECK (status IN ('준비', '진행', '정리중', '완료')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (application_id, seq)
);

CREATE INDEX idx_meeting_app ON meeting(application_id, seq);

-- 회의에서 나온 것들.
--
-- kind를 넷으로 나눈 이유:
--   요구 = 해달라는 것
--   제약 = 지켜야 하는 한계
--   미결 = 아직 정해지지 않은 것
--   가정 = 확인 없이 전제하고 있는 것  ← 나중에 깨지는 것은 대개 이것이다
--
-- quote는 회의록 원문 인용이다. 이게 있으면 나중에 "그런 말 한 적 없는데요"를
-- 회의록으로 확인할 수 있다.
CREATE TABLE requirement (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES application(id) ON DELETE CASCADE,
  meeting_id TEXT REFERENCES meeting(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('요구', '제약', '미결', '가정')),
  dept TEXT NOT NULL,
  body TEXT NOT NULL,
  quote TEXT,
  priority TEXT NOT NULL DEFAULT '보통' CHECK (priority IN ('필수', '보통', '있으면좋음')),
  measurable TEXT,
  status TEXT NOT NULL DEFAULT '초안'
    CHECK (status IN ('초안', '채택', '수정채택', '기각')),
  decided_body TEXT,
  reject_reason TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_requirement_app ON requirement(application_id, status, kind);

-- 동시에 만족시킬 수 없는 요구 두 개.
--
-- verdict가 비어 있으면 아직 사람이 판정하지 않은 것이다. 판정하지 않은
-- 충돌이 남아 있으면 합격 기준을 확정할 수 없다 — 무엇을 통과로 볼지가
-- 그 판정에 달려 있기 때문이다.
CREATE TABLE requirement_conflict (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES application(id) ON DELETE CASCADE,
  req_a_id TEXT NOT NULL REFERENCES requirement(id) ON DELETE CASCADE,
  req_b_id TEXT NOT NULL REFERENCES requirement(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  tradeoff_axis TEXT,
  severity TEXT NOT NULL DEFAULT '보통' CHECK (severity IN ('낮음', '보통', '높음')),
  verdict TEXT CHECK (verdict IN ('A우선', 'B우선', '절충', '충돌아님')),
  verdict_reason TEXT,
  tradeoff_note TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (req_a_id, req_b_id)
);

CREATE INDEX idx_conflict_app ON requirement_conflict(application_id, verdict);

-- 무엇을 통과로 볼 것인가. **만들기 전에** 정한다.
--
-- check_kind가 'rule'이면 5단계 베타 테스트에서 기계가 자동으로 판정한다.
-- check_key가 그 판정 코드다(shared/acceptance.js 참고).
-- is_required_safety가 붙은 기준은 하나만 깨져도 배포를 막는다.
CREATE TABLE acceptance_criterion (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES application(id) ON DELETE CASCADE,
  ord INTEGER NOT NULL,
  body TEXT NOT NULL,
  from_requirement_id TEXT REFERENCES requirement(id) ON DELETE SET NULL,
  from_conflict_id TEXT REFERENCES requirement_conflict(id) ON DELETE SET NULL,
  check_kind TEXT NOT NULL DEFAULT 'rule' CHECK (check_kind IN ('rule', 'human')),
  check_key TEXT,
  is_required_safety INTEGER NOT NULL DEFAULT 0,
  confirmed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_criterion_app ON acceptance_criterion(application_id, ord);

-- 자동화하기 전에 사람이 그 일을 직접 해 보고 잰 기록.
--
-- 화면의 스톱워치로 실제로 잰다. 나중에 기억으로 적는 것이 아니라,
-- 그 자리에서 시작 버튼을 누르고 끝나면 정지 버튼을 누른다.
CREATE TABLE shadow_run (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES application(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  total_seconds REAL NOT NULL,
  error_count INTEGER NOT NULL DEFAULT 0,
  step_timings_json TEXT,
  note TEXT,
  run_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (application_id, seq)
);

-- 봉인된 기준선. 이후 모든 절감 주장이 이 값 위에서 계산된다.
--
-- sample_n을 굳이 저장하는 이유: 화면에 "표본 3회"를 항상 함께 보여주기
-- 위해서다. 세 번은 통계적으로 약하고, 그 사실을 숨기면 안 된다.
-- 이 값에는 신뢰구간을 붙이지 않는다.
CREATE TABLE baseline (
  application_id TEXT PRIMARY KEY REFERENCES application(id) ON DELETE CASCADE,
  median_seconds REAL NOT NULL,
  min_seconds REAL NOT NULL,
  max_seconds REAL NOT NULL,
  sample_n INTEGER NOT NULL,
  error_rate REAL NOT NULL DEFAULT 0,
  people INTEGER NOT NULL DEFAULT 1,
  frequency TEXT,
  hourly_wage_krw INTEGER NOT NULL DEFAULT 25000,
  sealed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
