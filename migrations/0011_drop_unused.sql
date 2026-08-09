-- 쓰지 않는 표를 내린다.
--
-- 둘 다 걷어낸 기능의 잔재다.
--
--   application_file  — 신청서에 파일을 붙이는 기능. 파일은 브라우저에서
--                       읽고 서버로 안 보내기로 하면서 걷어냈다.
--   application_ai_draft — AI 초안. 이 제품은 AI도 외부 API도 안 쓴다.
--
-- 둘 다 코드에서 한 줄도 안 읽고 안 쓰고, 라이브에 줄이 0개다. 그런데
-- 정직 화면은 "표 몇 개"를 세어 보여 주므로, 없는 기능의 표까지 세어
-- 놓고 있었다. 스키마를 읽는 사람도 "아, 여기 AI가 있구나"로 읽는다 —
-- 이 제품이 하지 않는 일 목록의 맨 위에 적어 둔 바로 그것이다.

DROP INDEX IF EXISTS idx_application_file_app;
DROP TABLE IF EXISTS application_file;
DROP TABLE IF EXISTS application_ai_draft;
