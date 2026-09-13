# 2026-09-13 감사 지적 수정과 반영 절차

## 상태와 범위

사용자 승인 후 운영 Supabase에 0004를 적용했다. public과 기존 체험 스키마 2곳의 새 구조, RPC 4개의 service_role 전용 권한, 준비 상태를 확인했다. GitHub 푸시와 최종 사이트 검증 결과는 아래 배포 기록에 추가한다. 대상 저장소는 `k95691368-ship-it/ilson`, Pages 프로젝트는 `ilson`, Supabase 프로젝트는 `iobeygpmcrmdjhkgtkfg`이다. `portfolio` 저장소·Pages 프로젝트와 다른 데이터베이스는 대상이 아니다.

### 운영 DB 반영 기록

2026-09-13 기존 public 36개 테이블·64개 행, 체험 공간 36개 테이블·32개 행, 레지스트리 1개 테이블·1개 행을 CSV로 백업했다. 백업 SHA-256은 `BB843BD2F6376950DB6E631F64711819EF0C307880EC4059A39A396C9CC910E2`이다. 점검 Worker로 일손의 전체 API를 HTTP 503으로 막은 뒤 마이그레이션을 한 번 적용했다. 추가된 열을 제외한 기존 73개 테이블의 JSON 전체를 백업과 비교해 **73개 모두 일치**했다. 새 영수증 테이블은 비어 있다.

운영 PostgreSQL의 service_role로 저장 RPC·동일 요청 재호출·요청 제한 RPC를 실행하고 트랜잭션을 롤백했다. 별도 조회로 시험 영수증과 시험 쓰기가 0건임을 확인했다. `ilson_readiness`는 `ready=true`, `schemaReady=true`, `activeWorkspaces=1`, `capacityAvailable=true`를 반환했다. RPC 4개는 anon·authenticated 실행 불가, service_role 실행 가능이다. 결과 조회 도중 브라우저 연결 시간 초과로 점검 시간이 길어졌으며, 새 연결에서 권한·롤백·데이터 보존 대조를 끝냈다.

## 지적과 수정 근거

| 지적 | 수정 | 코드와 검사 |
| --- | --- | --- |
| 중단·종료 실험 재활성화, 오래된 통과 재사용 | 승인 주기 ID·변경 버전·수정 버전, 현재 주기의 최신 결과만 사용, 종료 상태 봉인 | `functions/api/override.js`, `shared/override.js`, `tests/auditHardeningPostgres.test.js` |
| 표본 1건·잘못된 숫자·근거 없는 판정 | 사전 표본·기간·지표 단위·선정 이유·원본 버전 필수, 결과 입력 시 실제 측정값·원본 참조·기간 필수 | 위 파일과 `src/pages/OverridePage.jsx` |
| 최근 500건을 전체 통계로 사용 | 목록과 PostgreSQL 집계 분리, 유효 확인 사건만 집계, 수정률은 최근 30일 UTC 동일 제품·날짜·고객군 분모 대응 시에만 산출 | `functions/_lib/overrideMetrics.js`, 1,015건 회귀 검사 |
| 업무 저장과 감사 저장 분리 | 읽은 값 재확인 후 동일 트랜잭션으로 쓰기·감사·요청 영수증 저장, 동일 요청 재시도 재사용 | `functions/_lib/atomicMutation.js`, `0004_audit_hardening.sql`, 감사 실패 트리거 검사 |
| 검토 변경과 제품 연결 해제 이력 누락 | `decision_log`의 각 결정을 사용, 연결·해제와 감사 기록 동시 저장 | `shared/journey.js`, `functions/api/applications/[id]/journey.js`, `tests/accessHardening.test.js` |
| 방문만 해도 공간 생성, 한도 경쟁, 불완전한 health | 읽기 전용 소개 후 명시적 시작, 잠금 기반 한도 RPC, 필수 RPC·마이그레이션·정원 검사 및 HTTP 503 | `WorkspaceGate.jsx`, `rateLimit.js`, `health.js`, 공간·동시 요청 검사 |
| 이메일 헤더 위조, 임의 서버 토큰 외부 전송 | Access JWT의 서명·발급자·대상·시간 검증, 실제 모드 읽기도 인증, 서버 허용 주소·전용 토큰 이름만 허용 | `functions/_lib/access.js`, `integrationConfig.js`, `tests/accessHardening.test.js` |
| 실제 자동 중단·롤백처럼 표현 | 가상 자료/수동 근거/외부 제어 미연결 표시, 과거 참고 기록과 현재 승인 주기 구분 | `src/pages/OverridePage.jsx`, 실제 로컬 브라우저 검증 |
| 요청·로컬 변경·배포 간 불일치 | 기존 삭제 요청 영역과 확대된 메뉴 변경 보존, 회귀 검사, 이 반영 체크리스트 | `tests/overrideLayout.test.jsx`, 이 문서 |

## 판정과 외부 실행의 한계

사전 계획의 최소 표본 수를 충족한다는 것은 통계적 유의성이나 현장 효과를 입증한다는 뜻이 아니다. 계획 작성자가 단위·표본·기간의 선정 근거를 제시하고 검토자가 확인한다. 숫자와 원본 참조를 수동 입력하는 시스템이므로 입력의 진실성을 자동 보증하지 않는다. 외부 AI·배포 플랫폼을 실제로 중단하거나 롤백하는 제어기는 연결하지 않았다.

기존 실험에는 계획·승인 주기를 소급해서 만들어 넣지 않는다. 조회와 보류·중단·롤백 결정 기록은 유지하지만 추가 결과·확대에는 계획이 있는 새 실험이 필요하다. 기존 참고 기록도 펼쳐서 볼 수 있다.

연동 전송은 의도와 고정된 페이로드를 먼저 감사 기록에 저장한다. 전송 대상은 `Idempotency-Key`를 실제로 지원해야 하며 같은 키 재시도에서 중복 효과가 없어야 한다. HTTP 전송과 PostgreSQL은 하나의 트랜잭션이 될 수 없다. 네트워크 결과가 불명확하면 성공으로 처리하지 않는다. AI 초안은 요청 기록을 먼저 저장하고 결과와 감사를 함께 저장한다. 응답을 확인할 수 없는 동일 요청은 비용 중복을 피하기 위해 재생성하지 않는다.

공간당 별도 스키마·7일 만료·최대 128개 구조는 유지했다. 이번 수정은 첫 방문 자동 할당을 없애고 가용성을 알리는 조치이며 대규모 다중 조직 서비스 전환이나 운영 부하 실험은 아니다. 비용이 커지는 운영 규모에서는 별도의 테넌트 구조 설계가 필요하다.

## 로컬 검증 방법

`npm ci`, `npm run build`, `npm run lint`, `npm test`를 사용한다. 시간 비율 검사인 `tests/scale.test.js`는 다른 파일과 CPU를 경쟁하지 않도록 별도 프로세스에서 실행한다. 기준 배수는 변경하지 않았다.

`npm run dev:demo`는 `http://127.0.0.1:5187`에서 실제 Pages 핸들러와 메모리 PostgreSQL을 사용한다. 운영 키를 요구하지 않으며 외부 네트워크 호출은 차단된다. 프로세스를 종료하면 해당 검증 자료는 사라진다. 브라우저에서는 소개→개인 체험 시작→새 실험 계획→승인→근거 있는 결과 등록→원본 근거 표시를 확인한다.

자동 검사는 기존 공간을 0004로 올려도 신청 자료가 남는지, 익명 RPC가 거절되는지, 감사 실패 시 업무 쓰기도 취소되는지, 같은 요청 및 경쟁 요청이 어떻게 처리되는지를 검사한다. PGlite 기반 요청 동시성 재현이며 운영 PostgreSQL의 다중 연결 부하·장애 전환 시험을 대체하지 않는다. 실제 AI 제공자와 연동 대상에 대한 호출은 하지 않고 가짜 응답으로 검증한다.

## 승인 후 운영 반영 순서

### 최종 로컬 실행 결과

2026-09-13, Node 24.18.0 환경에서 의존성을 `npm ci`로 다시 설치한 뒤 빌드·린트·테스트를 재실행했다. 동작 검사 76개 파일·1,365개와 별도 시간 측정 검사 1개 파일·6개, 합계 **77개 파일·1,371개**가 통과했다. `git diff --check`도 통과했다. Wrangler 4.131.1로 Pages Functions를 로컬 컴파일해 성공 메시지를 확인했다. 로컬 브라우저에서는 실험 계획 생성·승인·원본 근거가 있는 결과 등록을 실행했고 모바일 페이지 너비 375px에서 문서의 가로 너비도 375px임을 확인했다. 임시 Worker 파일과 검증 브라우저 탭을 삭제하고 메모리 DB 검증 서버를 종료했다.

의존성 재설치에서 발견한 `sharp`→`miniflare`→`wrangler`의 경고는 Wrangler 4.131.1 및 종속 sharp 0.35.4로 갱신한 후 `npm audit` 기준 **0개**다. 관련 수정 근거는 [sharp 보안 공지](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c)다. npm은 esbuild·workerd 설치 스크립트 2개의 허용 목록 미등록 경고를 표시한다. 별도 허용 설정은 변경하지 않았고 로컬 앱 빌드·Pages Functions 컴파일이 성공하는 것을 확인했다. 실제 운영 배포, 실제 제공자 호출, 다중 연결 운영 부하는 검증하지 않았다.

### 반영 체크리스트

1. Git 원격이 `k95691368-ship-it/ilson`인지, Pages가 `ilson`인지 다시 확인한다. 기존 미커밋 파일을 삭제하거나 다른 프로젝트로 덮어쓰지 않는다.
2. Supabase와 Pages의 현재 버전·설정을 확인하고 백업한다. 비밀번호·키는 대화, 저장소, 로그에 출력하지 않는다.
3. 새 쓰기를 잠시 중지한 뒤 Supabase SQL Editor/승인된 연결에서 `supabase/migrations/0004_audit_hardening.sql`을 **한 번만** 적용한다. 0000~0003이 적용된 상태가 전제다. public과 기존 모든 체험 스키마에 열을 추가하며 업무 테이블을 삭제하지 않는다.
4. 새 열·RPC 권한·기존 자료 보존을 확인한다. 실패한 트랜잭션은 취소하고 이전 앱을 유지한다. 이 단계에서는 GitHub 자동 배포를 먼저 유발하지 않는다.
5. 로컬 테스트와 검토를 통과한 변경만 커밋한 뒤 `ilson` 원격에 푸시한다. Pages의 Git 연결 배포가 그 커밋을 사용하는지 확인한다.
6. 새 `/api/health`의 HTTP 200, `checks.runtime`, `checks.capacity`, 실제 체험 생성·기록 저장을 확인한 뒤 쓰기를 재개한다. 운영 검증 자료는 해당 승인된 검증 공간에서만 정리한다.
7. 커밋 SHA, Pages deployment ID, 검증 결과와 미확인 항목을 이 문서에 추가한다. 확인 전에는 운영 반영 완료로 보고하지 않는다.

새 코드는 0004의 RPC에 의존하므로 마이그레이션 전 앱만 배포하면 쓰기가 거절된다. 문제가 생기면 쓰기 중지 상태를 유지한다. 이전 취약한 쓰기 경로를 재개하거나 추가된 열을 삭제하는 방식으로 복귀하지 않는다. 운영 변경 이후의 기록을 보존한 상태에서 호환되는 수정본을 배포한다.

## 실제 사내 운영 설정

공개 포트폴리오는 `DEMO_WORKSPACES=true`를 유지한다. 사내 운영은 별도 승인 후 `DEMO_WORKSPACES=false`, `OVERRIDE_DEMO_MODE=false`, `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` 및 `override_actor`의 실제 역할 매핑을 설정한다. 설정을 생략한 비체험 모드는 기본적으로 인증을 요구한다. 이메일 헤더만으로 인증하지 않는다. 구현 기준은 [Cloudflare 공식 JWT 검증 문서](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)다.

`OVERRIDE_INTEGRATIONS`는 연동 종류별 JSON 설정이다. 각 항목은 `endpointUrl`, `secretBinding`, `supportsIdempotency:true`를 갖는다. 토큰 바인딩 이름은 `OVERRIDE_INTEGRATION_*_TOKEN`이어야 하며 설정 주소와 저장한 주소가 정확히 일치해야 한다. 실제 비밀 값은 Pages Secret에만 둔다. 임의 주소나 `SUPABASE_SERVICE_ROLE_KEY` 같은 다른 기능의 토큰을 선택할 수 없다.
