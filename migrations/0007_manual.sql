-- 6단계 — 사용법서.
--
-- 만든 사람이 없어도 부서가 계속 쓸 수 있게 하는 문서다. 이게 없으면
-- 인수인계가 아니라 "내가 만든 걸 보여준 것"으로 끝난다.
--
-- 문서의 절반은 여기 저장하지 않는다. 받는 파일 형식, 처리 단계, 검토함에
-- 뜨는 이유는 실제로 도는 코드에서 그때그때 뽑는다(shared/manual.js).
-- 문서가 낡는 것을 막는 유일한 방법이다.
--
-- 여기 저장하는 것은 코드가 알 수 없는 것들이다 — 언제 돌리는지, 결과를
-- 누구에게 주는지, 막혔을 때 누구에게 연락하는지.

CREATE TABLE manual (
  application_id TEXT PRIMARY KEY REFERENCES application(id) ON DELETE CASCADE,
  title TEXT NOT NULL,

  -- 이 도구가 무엇인지 한 문단
  intro TEXT,
  -- 언제 돌리는지 (예: 매주 월요일 아침, 정산서 다섯 개가 다 왔을 때)
  when_to_run TEXT,
  -- 결과를 누구에게 어떻게 주는지
  what_to_do_after TEXT,
  -- 막혔을 때 연락처
  contact TEXT,
  -- 부서가 알아야 할 그 밖의 것
  notes TEXT,

  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  published_at TEXT
);

-- 자주 묻는 것.
--
-- 지어내지 않는다. 5단계 베타 테스트에서 현업이 실제로 한 말에서 가져온다.
-- from_feedback_id가 그 출처다. 담당자가 상상한 질문보다 실제로 나온 질문이
-- 훨씬 쓸모 있다.
CREATE TABLE manual_faq (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES application(id) ON DELETE CASCADE,
  ord INTEGER NOT NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  from_feedback_id TEXT REFERENCES beta_feedback(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_manual_faq_app ON manual_faq(application_id, ord);
