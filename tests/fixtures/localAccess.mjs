// Disposable browser verification data. All identities and signing keys are local,
// generated in memory, and never accepted by a production deployment.
import { feedbackActorKey } from '../../functions/_lib/fieldFeedback.js'

export async function localAccessFixture(pg, { role = 'audit', revokeAfterFeedback = false, restoreAfterRevocation = false, switchAfterFeedback = false } = {}) {
  const email = 'verification@local.invalid'
  await pg.exec(`INSERT INTO override_actor(email,display_name,role) VALUES
    ('verification@local.invalid','로컬 검증 관리자','audit'),('employee@local.invalid','가상 신청자','reviewer');
    INSERT INTO application(id,ticket_no,dept,applicant_label,title,bottleneck,problem,status,owner_email)
      VALUES('app-local-verify','AX-ABC-234','재무','가상 신청자','참여 권한 검증 신청','자료 취합','같은 업무를 반복합니다.','접수','employee@local.invalid');
    INSERT INTO acceptance_criterion(id,application_id,ord,body,confirmed_at) VALUES('criterion-local','app-local-verify',1,'원본과 금액 일치',public.datetime('now'));
    INSERT INTO decision_log(id,application_id,stage,actor,title,what,why,alternatives,link_kind,link_id)
      VALUES('join-local','app-local-verify','신청서','human','마케팅 — 우리도 같은 일을 겪는다','동일한 자료 취합을 합니다.','과거 참여 기록','{"dept":"마케팅","by":"가상 담당자","minutes":30,"people":1,"frequency":"주 1회"}','같은건손듦','app-local-verify');
    INSERT INTO override_product(id,name,domain,owner_team,model_name,model_version,prompt_version,policy_version)
      VALUES('product-local','로컬 검증 AI','가상 업무','검증팀','로컬 모형','fixture-1','fixture-1','fixture-1');
    INSERT INTO issue_cluster(id,title,summary,owner_team,scope_product_id)
      VALUES('cluster-local','공유 문제 집계 검증','검증용 연결 사건입니다.','검증팀','product-local');
    INSERT INTO override_event(id,product_id,cluster_id,reviewer_label,reviewer_role,decision_action,is_override,ai_decision,human_decision,reason_code,reason_detail,model_version,prompt_version,validity,reporter_email)
      SELECT 'case-event-'||n,'product-local','cluster-local','로컬 검증 관리자','audit','modify',1,'검증 AI 답변','근거에 맞춘 수정','other','로컬 제보 '||n,'fixture-1','fixture-1','valid','verification@local.invalid' FROM generate_series(1,101) n;
    INSERT INTO override_event(id,product_id,reviewer_label,reviewer_role,decision_action,is_override,ai_decision,human_decision,reason_code,reason_detail,model_version,prompt_version,reporter_email)
      SELECT 'sample-event-'||n,'product-local','로컬 검증 관리자','audit','approve',0,'추출 당시 AI 원문','추출 당시 직원 판단','other','승인 표본 검증','fixture-1','fixture-1','verification@local.invalid' FROM generate_series(1,51) n;
    INSERT INTO quality_sample_batch(id,product_id,start_at,end_at,requested_size,sample_size,eligible_count,seed,created_by,created_at)
      SELECT 'batch-local-'||lpad(n::text,3,'0'),'product-local','2026-09-01','2026-09-01',1,1,1,'local-'||n,'로컬 검증 관리자',public.datetime('2026-09-01','+'||n||' minutes') FROM generate_series(1,51) n;
    INSERT INTO quality_sample_item(id,batch_id,event_id,snapshot_json,verdict,reason,evidence_refs,reviewed_by,reviewed_at)
      SELECT 'sample-local-'||n,'batch-local-'||lpad(n::text,3,'0'),'sample-event-'||n,'{"ai_decision":"추출 당시 AI 원문","human_decision":"추출 당시 직원 판단","model_version":"fixture-1","prompt_version":"fixture-1","policy_refs_json":"[]","occurred_at":"2026-09-01 00:00:00"}',
      CASE WHEN n=1 THEN 'insufficient' ELSE NULL END,CASE WHEN n=1 THEN '초기 점검은 원본 자료가 부족했습니다.' ELSE NULL END,NULL,
      CASE WHEN n=1 THEN '로컬 검증 관리자' ELSE NULL END,CASE WHEN n=1 THEN public.datetime('2026-09-01') ELSE NULL END FROM generate_series(1,51) n;`)
  const key = await feedbackActorKey({ email, mode: 'access' })
  await pg.query(`INSERT INTO field_feedback_case(id,event_id,reporter_key,created_at)
    SELECT 'case-local-'||lpad(n::text,3,'0'),'case-event-'||n,$1,public.datetime('2026-09-01','+'||n||' minutes') FROM generate_series(1,101) n`, [key])
  await pg.exec(`INSERT INTO field_feedback_update(id,case_id,kind,body,effective_on,actor_label)
    VALUES('update-local-old','case-local-001','applied','오래된 제보에 도착한 개선 적용 안내입니다.','2026-09-01','가상 개선 담당자')`)
  await pg.exec(`UPDATE override_actor SET departments_json='["재무"]' WHERE email='employee@local.invalid';
    INSERT INTO application(id,ticket_no,dept,applicant_label,title,bottleneck,problem,status,owner_email)
      VALUES('app-local-beta','AX-CDE-456','재무','가상 신청자','베타 저장 연속성 검증','자료 취합','안전 기준 전체를 확인합니다.','진행중','employee@local.invalid');
    INSERT INTO acceptance_criterion(id,application_id,ord,body,check_kind,check_key,is_required_safety,confirmed_at) VALUES
      ('beta-local-idempotent','app-local-beta',1,'같은 파일을 다시 넣어도 합계가 유지됩니다.','rule','idempotent',1,public.datetime('now')),
      ('beta-local-traceable','app-local-beta',2,'결과를 원본 파일과 줄로 확인할 수 있습니다.','rule','traceable',0,public.datetime('now'));
    INSERT INTO application(id,ticket_no,dept,applicant_label,title,bottleneck,problem,status)
      VALUES('app-local-legacy','AX-BCD-345','재무','이전 신청자','소유계정 미확인 신청','자료 취합','이전 자료의 담당 계정을 확인합니다.','접수');
    INSERT INTO handover(application_id,slug,title,handed_to_dept,handed_to_person,daily_limit)
      VALUES('app-local-verify','local-retry-tool','실행 기록 재시도 검증','재무','가상 신청자',3);
    INSERT INTO baseline(application_id,median_seconds,min_seconds,max_seconds,sample_n,people,frequency,hourly_wage_krw)
      VALUES('app-local-verify',600,500,700,5,1,'주 1회',3600);
    INSERT INTO tool_use(id,application_id,actor_label,duration_ms,human_review_seconds,rework_seconds,ok,fail_reason)
      VALUES('local-failed-run','app-local-verify','가상 신청자',1000,30,60,0,'가상 계산 실패');
    INSERT INTO override_event(id,product_id,reviewer_label,reviewer_role,decision_action,is_override,ai_decision,human_decision,reason_code,reason_detail,model_version,prompt_version,validity,reporter_email,occurred_at)
      SELECT 'recent-event-'||n,'product-local','로컬 검증 관리자','audit','modify',1,'최신 원안','수정한 판단','other','최신 페이지 검증 '||n,'fixture-1','fixture-1','valid','verification@local.invalid','2026-09-18 00:00:00' FROM generate_series(1,450) n;
    UPDATE override_event SET occurred_at='2026-01-01 00:00:00',validity='pending',ai_decision='오래된 사건의 AI 원안',human_decision='원본 대조 후 보류',reason_detail='오래된 원본 근거를 확인합니다.' WHERE id='case-event-1';`)
  await pg.exec(`INSERT INTO field_feedback_update(id,case_id,kind,body,effective_on,actor_label)
      SELECT 'summary-update-'||n,'case-local-101','applied','가상 최신 개선 안내','2026-09-18','가상 담당자' FROM generate_series(1,200) n;
    INSERT INTO issue_followup(id,cluster_id,source_kind,source_id,product_id,event_id,reason,created_by,created_at)
      SELECT 'summary-followup-'||n,'cluster-local','feedback','summary-update-'||n,'product-local','case-event-101','전역 요약 경계 검증 '||n,'가상 담당자','2026-09-18 00:00:00' FROM generate_series(1,200) n;
    INSERT INTO issue_followup(id,cluster_id,source_kind,source_id,product_id,event_id,reason,created_by,created_at)
      VALUES('old-linked-followup','cluster-local','feedback','update-local-old','product-local','case-event-1','200건 밖의 과거 후속 검토입니다.','가상 담당자','2026-09-01 00:00:00');`)
  const plan = JSON.stringify({ metricType: 'rate', minimumWindowSeconds: 60, minimumSamples: { historical: 10, shadow: 10, limited: 10 }, rationale: '가상 현장 측정', datasetVersion: 'd1', modelVersion: 'm1', policyVersion: 'p1' })
  for (const [id, title, status] of [['local-expanded', '확대 후 롤백 기록 검증', 'expanded'], ['local-timing', '실험 측정 시각 검증', 'approved']]) {
    await pg.query(`INSERT INTO change_experiment(id,cluster_id,title,change_target,hypothesis,scope,comparator,success_metric,metric_direction,target_improvement,
      guardrails_json,stop_conditions_json,approver,rollback_plan,risk_level,status,current_phase,approved_by,approved_at,approval_id,evaluation_plan_json,change_version)
      VALUES($1,'cluster-local',$2,'정책 검색','재발 감소','가상 입력 20건','기존 정책','오류율','lower',20,'["위반 0건"]','["위반 1건"]','가상 책임자','이전 정책 복귀','medium',$3,'historical','가상 책임자','2026-09-18 00:00:00',$4,$5,'v1')`, [id, title, status, id+'-approval', plan])
  }
  await pg.exec(`INSERT INTO override_decision_record(id,experiment_id,decision,basis,metrics_snapshot_json,decided_by,created_at)
    VALUES('local-first-expansion','local-expanded','expand','최초 확대 시 보존한 가상 근거','{"scope":"가상 입력 20건","runs":[]}','가상 책임자','2026-09-18 00:00:00');`)
  if (role === 'product') await pg.query("UPDATE override_actor SET role='product',display_name='로컬 실험 담당자',departments_json='[\"재무\"]',product_ids_json='[\"product-local\"]' WHERE email=$1", [email])
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1,0,1]), hash: 'SHA-256' }, true, ['sign','verify'])
  const jwk = { ...await crypto.subtle.exportKey('jwk', pair.publicKey), kid: 'local-browser-fixture', alg: 'RS256', use: 'sig' }
  const issuer = 'https://local-verification.cloudflareaccess.com'
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url')
  const now = Math.floor(Date.now()/1000)
  const unsigned = encode({ alg: 'RS256', kid: jwk.kid }) + '.' + encode({ iss: issuer, aud: ['local-browser-fixture'], email, iat: now, exp: now+3600 })
  const signature = Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(unsigned))).toString('base64url')
  let identity = unsigned + '.' + signature
  let otherIdentity
  if (switchAfterFeedback) {
    await pg.query(`INSERT INTO override_actor(email,display_name,role,departments_json,product_ids_json)
      VALUES('verification-b@local.invalid','로컬 두 번째 담당자','product','["재무"]','["product-local"]')`)
    const otherUnsigned = encode({ alg: 'RS256', kid: jwk.kid }) + '.' + encode({ iss: issuer, aud: ['local-browser-fixture'], email: 'verification-b@local.invalid', iat: now, exp: now + 3600 })
    otherIdentity = otherUnsigned + '.' + Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(otherUnsigned))).toString('base64url')
  }
  let loseToolReply = true
  let loseBetaReply = true
  let revoked = false
  let restored = false
  let feedbackReads = 0
  let switched = false
  let switchReads = 0
  return {
    bindings: { DEMO_WORKSPACES: 'false', OVERRIDE_DEMO_MODE: 'false', ACCESS_TEAM_DOMAIN: issuer, ACCESS_AUD: 'local-browser-fixture' },
    certificates: url => String(url) === issuer + '/cdn-cgi/access/certs' ? Response.json({ keys: [jwk] }) : null,
    headers: original => { const headers = new Headers(original); headers.set('Cf-Access-Jwt-Assertion', identity); return headers },
    afterResponse: async ({ method, path, status }) => {
      // Simulate another tab replacing valid Access identity. Neither account
      // is revoked; only a scope precondition can reject the old tab's input.
      if (switchAfterFeedback && !switched && method === 'GET' && path === '/api/feedback' && status === 200) {
        switchReads += 1
        if (switchReads >= 2) { identity = otherIdentity; switched = true }
      }
      // Test-only restoration of the synthetic account after one rejected
      // recovery attempt. It exercises both failed and successful re-entry.
      if (restoreAfterRevocation && revoked && !restored && method === 'GET' && path === '/api/session' && status === 401) {
        await pg.query('UPDATE override_actor SET active=1 WHERE email=$1', [email])
        restored = true
        return
      }
      if (!revokeAfterFeedback || revoked || method !== 'GET' || path !== '/api/feedback' || status !== 200) return
      // Development StrictMode can mount the read twice. Leave both initial
      // snapshots visible, then exercise a real denied refresh.
      feedbackReads += 1
      if (feedbackReads < 2) return
      revoked = true
      // Only this synthetic memory account is affected. Its next real API read
      // must fail authentication, allowing the browser to exercise cache removal.
      await pg.query('UPDATE override_actor SET active=0 WHERE email=$1', [email])
    },
    // Exercise browser recovery after an actual commit; never enabled on 5187
    // or any production build. The next identical run reads its DB receipt.
    loseReply: (name, args, result) => {
      if (loseToolReply && name === 'ilson_record_tool_run' && args[2] === 'local-retry-tool' && result.response?.status === 201) {
        loseToolReply = false
        return true
      }
      if (loseBetaReply && name === 'ilson_record_beta_round' && args[2] === 'app-local-beta' && result.response?.status === 201) {
        loseBetaReply = false
        return true
      }
      return false
    },
  }
}
