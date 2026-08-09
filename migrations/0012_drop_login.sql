-- 로그인 시스템의 표를 내린다.
--
-- 이 사이트에는 로그인이 없다. 접수번호(AX-000-000) 하나가 열쇠이고,
-- 계정도 세션도 만들지 않는다. 그게 설계다 — 부서 담당자에게 계정을
-- 만들라고 하면 안 쓴다.
--
-- 그런데 users·sessions·audit_log·notifications 네 표가 데이터베이스에
-- 그대로 있었다. 앞 저장소에서 공용 부품을 가져올 때 딸려 온 것이고,
-- 이 제품의 코드는 그 넷을 한 줄도 읽지 않고 한 줄도 쓰지 않는다.
--
-- 남겨 두면 두 가지가 나쁘다.
--   ① 정직 화면이 "표 몇 개"를 세어 보여 준다. 없는 기능의 표까지 셌다.
--   ② 스키마를 읽는 사람은 "여기 계정과 세션이 있구나"로 읽는다. 이
--      사이트가 "로그인이 없다"를 설계의 앞머리에 적어 두고 있는데,
--      데이터베이스는 다른 말을 하고 있었던 셈이다.
--
-- 자식부터 내린다. sessions·audit_log·notifications 가 users 를 가리킨다.
-- 밖에서 users 를 가리키던 표는 application_ai_draft 하나였고 0011 에서
-- 내렸다.

DROP INDEX IF EXISTS idx_notifications_user;
DROP TABLE IF EXISTS notifications;

DROP INDEX IF EXISTS idx_audit_log_target;
DROP INDEX IF EXISTS idx_audit_log_created;
DROP TABLE IF EXISTS audit_log;

DROP INDEX IF EXISTS idx_sessions_user;
DROP INDEX IF EXISTS idx_sessions_expiry;
DROP TABLE IF EXISTS sessions;

DROP TABLE IF EXISTS users;
