-- 담당자가 신청서에 되묻고, 부서가 답한다.
--
-- 지금까지는 한 방향이었다. 부서가 적어 내면 담당자가 읽고 혼자 판정한다.
-- 그런데 신청서는 자주 애매하다. "정산서를 합쳐 주세요"라고만 적혀 있으면
-- 채널이 몇 개인지, 양식이 매달 바뀌는지, 지금은 누가 어떻게 하는지를
-- 모른 채로 판정해야 한다.
--
-- 그러면 담당자는 둘 중 하나를 한다. 짐작으로 판정하거나, 보류로 미룬다.
-- 짐작은 틀리고 보류는 영영 안 풀린다. 물어볼 데가 없어서 생기는 일이다.
--
-- 로그인이 없는 사이트라 "누가 답했나"를 계정으로 증명할 수 없다. 대신
-- 접수번호를 아는 사람만 답할 수 있게 한다. 접수번호는 신청서를 낸 사람에게만
-- 준 것이고, 사내에서 그 정도면 충분하다. 그 대신 답한 사람 이름을 직접
-- 적게 해서 누가 답했는지는 기록에 남긴다.

CREATE TABLE thread_message (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES application(id) ON DELETE CASCADE,

  -- 담당자가 물은 것인가, 부서가 답한 것인가.
  side TEXT NOT NULL CHECK (side IN ('담당자', '부서')),

  -- 로그인이 없으니 계정 대신 스스로 밝힌 이름을 남긴다. 증명은 아니지만
  -- 몇 달 뒤 "이건 누가 답한 거지"에 답할 수는 있다.
  author_label TEXT NOT NULL,
  body TEXT NOT NULL,

  -- 어느 질문에 대한 답인가. 질문이 여럿 쌓였을 때 어느 것에 답한 것인지
  -- 모르면, 답을 받고도 아직 못 받은 질문이 뭔지 셀 수가 없다.
  answers_id TEXT REFERENCES thread_message(id) ON DELETE SET NULL,

  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_thread_application ON thread_message(application_id, created_at);
CREATE INDEX idx_thread_answers ON thread_message(answers_id);
