// Local verification only: real route handlers + disposable in-memory PostgreSQL.
// No production credentials, database, network integrations or persisted visitor data.
import { readFile, readdir } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { createServer } from 'vite'
import { PGlite } from '@electric-sql/pglite'
import { onRequest } from '../functions/api/_middleware.js'
import { localAccessFixture } from '../tests/fixtures/localAccess.mjs'
import { compileDemoRoutes } from './lib/demo-routes.mjs'
const pg = new PGlite()
await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;')
for (const file of ['0000_schema.sql', '0001_execute_sql.sql', '0002_override_loop.sql', '0003_journey_workspaces.sql', '0004_audit_hardening.sql','0005_field_feedback.sql','0006_access_scope.sql','0007_issue_workflow.sql','0008_feedback_rechecks.sql','0009_participation_quota.sql','0010_application_ownership.sql','0011_tool_run_receipts.sql','0012_beta_round_receipts.sql','0013_review_revision.sql','0014_application_receipts.sql']) {
  await pg.exec(await readFile(new URL('../supabase/migrations/' + file, import.meta.url), 'utf8'))
}
const fixture = process.argv.includes('--access-fixture') ? await localAccessFixture(pg, {
  role: process.argv.includes('--product-fixture') ? 'product' : 'audit',
  revokeAfterFeedback: process.argv.includes('--revoke-fixture'),
  restoreAfterRevocation: process.argv.includes('--restore-fixture'),
  switchAfterFeedback: process.argv.includes('--switch-fixture'),
}) : null
const port = fixture ? 5188 : 5187
let queue = Promise.resolve()
const applicationRetryFixture = process.argv.includes('--application-retry-fixture')
let applicationReplyLost = false
const teachRetryFixture = process.argv.includes('--teach-retry-fixture')
let teachReplyLost = false
const codeReviewRetryFixture = process.argv.includes('--code-review-retry-fixture')
let codeReviewReplyLost = false
const buildRetryFixture = process.argv.includes('--build-retry-fixture')
let buildReplyLost = false
const healthFailureFixture = process.argv.includes('--health-failure-fixture')
const agreementSaveFixture = Boolean(fixture) && process.argv.includes('--agreement-save-fixture')
const feedbackRetryFixture = Boolean(fixture) && process.argv.includes('--feedback-retry-fixture')
const reportFeedFixture = Boolean(fixture) && process.argv.includes('--report-feed-fixture')
const reportFixFixture = Boolean(fixture) && process.argv.includes('--report-fix-fixture')
const fieldFeedbackSaveFixture = Boolean(fixture) && process.argv.includes('--field-feedback-save-fixture')
const betaReceiptFixture = Boolean(fixture) && process.argv.includes('--beta-receipt-fixture')
const trackBetaRoundFixture = Boolean(fixture) && process.argv.includes('--track-beta-round-fixture')
let betaReceiptMalformed = false
let trackBetaRoundChanged = false
let fieldFeedbackReplyMalformed = false
let fieldFeedbackReadPending = false
let reportFixReplyLost = false
let reportFixSourceChanged = false
let reportPageChanged = false
let reportRefreshPending = false
let agreementWriteRejected = false
let agreementReadRejected = false
let agreementReadPending = false
const feedbackRepliesLost = new Set()
let unclearReadPending = false
if (trackBetaRoundFixture) {
  await pg.exec(`INSERT INTO beta_round(id,application_id,seq,overall,total,human_needed)
    VALUES('c27-local-round-1','app-local-verify',1,'조건부',1,1);`)
}
if (fieldFeedbackSaveFixture) {
  // Add one compact first-page case; keep all previous synthetic rows intact.
  await pg.exec(`INSERT INTO override_event(id,product_id,reviewer_label,reviewer_role,decision_action,is_override,ai_decision,human_decision,reason_code,reason_detail,model_version,prompt_version,validity,reporter_email)
    VALUES('c25-local-event','product-local','로컬 실험 담당자','product','modify',1,'합성 AI 원안','근거 확인 후 수정','other','저장 확인과 입력 보존 검증','fixture-1','fixture-1','valid','verification@local.invalid');
    INSERT INTO field_feedback_case(id,event_id,reporter_key)
    SELECT 'c25-local-case','c25-local-event',reporter_key FROM field_feedback_case WHERE id='case-local-101';
    INSERT INTO field_feedback_update(id,case_id,kind,body,effective_on,actor_label)
    VALUES('c25-local-update','c25-local-case','applied','현장 재확인을 기다리는 합성 개선 안내입니다.','2026-10-01','가상 개선 담당자');`)
}
if (reportFixFixture) {
  await pg.exec(`INSERT INTO decision_log(id,application_id,stage,actor,title,what,why,link_kind,link_id,created_at) VALUES
    ('c24-local-lost','app-local-verify','배포','human','가상 제보자','처리 응답이 끊긴 뒤 같은 의도로 확인하는 합성 신고입니다.','합성 재시도 검증','신고','wrong_number','2026-01-01 00:00:00'),
    ('c24-local-source','app-local-verify','배포','human','가상 제보자','처리 폼을 연 뒤 원문이 바뀌는 합성 신고입니다.','합성 판본 검증','신고','other','2026-01-02 00:00:00'),
    ('c24-local-valid','app-local-beta','제작','human','가상 제보자','도구 인계 전에도 처리할 수 있는 합성 신고입니다.','합성 호환 검증','신고','other','2026-01-03 00:00:00');`)
}
if (reportFeedFixture) {
  // Disposable, explicitly synthetic reports: originals must not share a page
  // budget with fixes, and reports without a handover must remain reachable.
  await pg.exec(`INSERT INTO decision_log(id,application_id,stage,actor,title,what,why,link_kind,link_id,created_at)
    SELECT 'c22-local-recent-'||lpad(n::text,3,'0'),'app-local-verify','배포','human','가상 제보자',
      '로컬 일반 신고 원문 '||n,'합성 페이지 검증','신고','other','2026-09-01 00:00:00'
    FROM generate_series(1,205) n;
    INSERT INTO decision_log(id,application_id,stage,actor,title,what,why,link_kind,link_id,created_at) VALUES
      ('c22-local-old-urgent','app-local-verify','배포','human','가상 제보자','200개 뒤에도 보여야 하는 오래된 긴급 신고입니다.','합성 누락 검증','신고','wrong_number','2026-01-01 00:00:00'),
      ('c22-local-old-fixed','app-local-verify','배포','human','가상 제보자','과거에 처리된 원신고입니다.','합성 처리 연결 검증','신고','other','2026-01-02 00:00:00'),
      ('c22-local-old-fix','app-local-verify','배포','human','가상 담당자','이전 처리 내용입니다.','이전 가상 원인','신고처리','c22-local-old-fixed','2026-02-01 00:00:00'),
      ('c22-local-latest-fix','app-local-verify','배포','human','가상 담당자','최신 처리 내용이 연결됩니다.','최신 가상 원인','신고처리','c22-local-old-fixed','2026-03-01 00:00:00'),
      ('c22-local-no-handover','app-local-beta','제작','human','가상 제보자','도구를 넘기기 전 접수된 신고입니다.','합성 접근 검증','신고','other','2026-09-02 00:00:00');`)
}
if (agreementSaveFixture) {
  await pg.query(`INSERT INTO meeting(id,application_id,seq,title,minutes_text) VALUES($1,$2,1,$3,$4)`,
    ['meeting-local-save', 'app-local-verify', '로컬 협의 저장 검증', '수정 전 가상 회의록입니다.'])
}
if (codeReviewRetryFixture && fixture) {
  // Explicit synthetic legacy mappings for local UI boundaries, never business data.
  await pg.query('INSERT INTO sku_alias(external_code,canonical_code,product_name,taught_by,owner_email) VALUES($1,$2,$3,$4,$5)',
    ['C15-LEGACY-NO-ORIGIN', 'NR-CM-100', '로컬 출처 미연결 예제', 'AX 담당자', 'verification@local.invalid'])
  await pg.query('INSERT INTO sku_alias(external_code,canonical_code,product_name,taught_by,owner_email) VALUES($1,$2,$3,$4,$5)',
    ['C15-INVALID-MAPPING', 'NOT-IN-CATALOG', '로컬 잘못된 연결 예제', 'AX 담당자', 'verification@local.invalid'])
}
globalThis.fetch = (url, options) => {
  const certificates = fixture?.certificates(url)
  if (certificates) return Promise.resolve(certificates)
  if (!String(url).startsWith('https://local-demo.supabase.co/rest/v1/rpc/')) return Promise.reject(new Error('External network disabled in local demo'))
  const run = queue.then(async () => {
    try {
      const name = new URL(url).pathname.split('/').at(-1)
      if (!/^ilson_(execute|batch|workspace_(query|batch|open|reset)|mutation_receipt|commit_mutation|claim_rate_limit|record_tool_run|record_beta_round|record_application|assign_application_owner|actor_(query|batch|receipt|commit|claim_rate_limit|rate_state|release_rate_limit)|readiness)$/.test(name)) throw new Error('Unsupported RPC')
      const args = Object.values(JSON.parse(options.body))
      // Fail local public metadata probes until this test server is restarted
      // without the flag. This is deterministic even under StrictMode's extra
      // effect cycle. No business write or external connection is involved.
      if (healthFailureFixture && name === 'ilson_execute'
        && typeof args[0] === 'string' && /FROM information_schema\.tables/.test(args[0])) {
        return Response.json({ code: 'LOCAL_HEALTH_FAILURE' }, { status: 503 })
      }
      await pg.exec('SET ROLE service_role')
      const result = await pg.query(`SELECT public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) AS data`, args)
      // Local in-memory verification only: commit the first successful form
      // intent, then lose its response once. Its retry must recover the receipt.
      if (applicationRetryFixture && !applicationReplyLost && name === 'ilson_record_application'
        && result.rows[0].data?.response?.status === 201) {
        applicationReplyLost = true
        return Response.json({ code: 'LOCAL_LOST_REPLY' }, { status: 503 })
      }
      // Exercise a teaching retry after the alias, audit and receipt really
      // commit. This opt-in local fixture never runs in deployed Functions.
      if (teachRetryFixture && !teachReplyLost && name === 'ilson_actor_commit'
        && result.rows[0].data?.response?.body?.ok === true
        && Array.isArray(args[4]) && args[4].some(sql => /^\s*INSERT\s+INTO\s+sku_alias\b/i.test(sql))) {
        teachReplyLost = true
        return Response.json({ code: 'LOCAL_LOST_REPLY' }, { status: 503 })
      }
      if (codeReviewRetryFixture && !codeReviewReplyLost && name === 'ilson_actor_commit'
        && result.rows[0].data?.response?.body?.ok === true
        && ['confirm', 'correct'].includes(result.rows[0].data?.response?.body?.action)
        && Array.isArray(args[4]) && args[4].some(sql => sql.includes('ilson-code-review:'))) {
        codeReviewReplyLost = true
        return Response.json({ code: 'LOCAL_LOST_REPLY' }, { status: 503 })
      }
      // After a real synthetic build commit, lose only its first response. The
      // browser must retry the frozen calculation intent, not calculate again.
      if (buildRetryFixture && fixture && !buildReplyLost && name === 'ilson_actor_commit'
        && result.rows[0].data?.response?.status === 201
        && typeof result.rows[0].data?.response?.body?.run_id === 'string'
        && Array.isArray(args[4]) && args[4].some(sql => /^\s*INSERT\s+INTO\s+build_run\b/i.test(sql))) {
        buildReplyLost = true
        return Response.json({ code: 'LOCAL_LOST_REPLY' }, { status: 503 })
      }
      if (reportFixFixture && !reportFixReplyLost && name === 'ilson_actor_commit'
        && result.rows[0].data?.response?.body?.reportId === 'c24-local-lost'
        && result.rows[0].data?.response?.body?.ok === true) {
        reportFixReplyLost = true
        return Response.json({ code: 'LOCAL_LOST_REPLY' }, { status: 503 })
      }
      if (fixture?.loseReply(name, args, result.rows[0].data)) return Response.json({code:'LOCAL_LOST_REPLY'},{status:503})
      return Response.json(result.rows[0].data)
    } catch (error) { return Response.json({ code: error.code || 'LOCAL' }, { status: 400 }) }
    finally { await pg.exec('RESET ROLE') }
  })
  queue = run.catch(() => {})
  return run
}
async function walk(dir) {
  return (await Promise.all((await readdir(dir, { withFileTypes: true })).map(entry => entry.isDirectory() ? walk(dir + '/' + entry.name) : dir + '/' + entry.name))).flat()
}
const routes = compileDemoRoutes(await walk('functions/api'))
const server = await createServer({ server: { host: '127.0.0.1', port, strictPort: true }, plugins: [{
  name: 'local-isolated-api', configureServer(vite) {
    vite.middlewares.use(async (req, res, next) => {
      if (!req.url.startsWith('/api/')) return next()
      try {
        const url = new URL(req.url, `http://127.0.0.1:${port}`)
        const route = routes.find(item => item.regex.test(url.pathname))
        if (!route) { res.statusCode = 404; return res.end() }
        const match = url.pathname.match(route.regex)
        const chunks = []; for await (const chunk of req) chunks.push(chunk)
        const request = new Request(url, { method: req.method, headers: fixture ? fixture.headers(req.headers) : req.headers, ...(['GET','HEAD'].includes(req.method) ? {} : { body: Buffer.concat(chunks) }) })
        const module = await import(pathToFileURL(resolve(route.file)))
        const handler = module['onRequest' + req.method[0] + req.method.slice(1).toLowerCase()]
        const context = { request, env: { DEMO_WORKSPACES: 'true', ...fixture?.bindings, SUPABASE_URL: 'https://local-demo.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'local-only' },
          params: Object.fromEntries(route.names.map((name, i) => [name, decodeURIComponent(match[i+1])])), data: {}, waitUntil: promise => promise.catch(() => {}) }
        const bindings = context.env
        // Reproduce Pages: next() gets original bindings and shared request data.
        context.next = async (forwarded = context.request) => {
          if (betaReceiptFixture && url.pathname === '/api/applications/app-local-beta/beta' && req.method === 'POST' && !betaReceiptMalformed) {
            const input = await forwarded.clone().json().catch(() => null)
            if (input?.kind === 'round') {
              betaReceiptMalformed = true
              // An invalid success before the real round handler writes anything.
              await new Promise(resolve => setTimeout(resolve, 3000))
              return Response.json({}, { status: 200 })
            }
          }
          if (trackBetaRoundFixture && url.pathname === '/api/track/AX-ABC-234/beta' && req.method === 'POST' && !trackBetaRoundChanged) {
            const input = await forwarded.clone().json().catch(() => null)
            if (input?.expectedRoundId === 'c27-local-round-1') {
              trackBetaRoundChanged = true
              // Another synthetic actor publishes a newer round before this
              // handler reads it. Serialize with the local RPC connection.
              const changed = queue.then(() => pg.exec(`INSERT INTO beta_round(id,application_id,seq,overall,total,human_needed)
                VALUES('c27-local-round-2','app-local-verify',2,'조건부',1,1);`))
              queue = changed.catch(() => {})
              await changed
            }
          }
          if (fieldFeedbackSaveFixture && url.pathname === '/api/feedback') {
            if (req.method === 'POST' && !fieldFeedbackReplyMalformed) {
              const input = await forwarded.clone().json().catch(() => null)
              if (input?.action === 'confirm_update' && input.updateId === 'c25-local-update') {
                fieldFeedbackReplyMalformed = true
                // Invalid success BEFORE a write; no production handler is replaced.
                await new Promise(resolve => setTimeout(resolve, 3000))
                return Response.json({}, { status: 200 })
              }
            }
            if (req.method === 'GET' && fieldFeedbackReadPending) {
              fieldFeedbackReadPending = false
              return Response.json({ error: '로컬 검증: 확정 피드백 뒤 목록 조회가 실패했습니다.' }, { status: 503 })
            }
          }
          if (reportFixFixture && url.pathname === '/api/reports') {
            if (req.method === 'POST' && !reportFixSourceChanged) {
              const input = await forwarded.clone().json().catch(() => null)
              if (input?.reportId === 'c24-local-source') {
                reportFixSourceChanged = true
                const change = queue.then(() => pg.query('UPDATE decision_log SET what=$1 WHERE id=$2',
                  ['새 근거로 바뀐 신고입니다. 이전 초안으로 처리하지 않아야 합니다.', 'c24-local-source']))
                queue = change.catch(() => {})
                await change
              }
            }
            if (req.method === 'GET' && reportRefreshPending) {
              reportRefreshPending = false
              return Response.json({ error: '로컬 검증: 처리 저장 뒤 목록 조회가 실패했습니다.' }, { status: 503 })
            }
          }
          if (reportFeedFixture && url.pathname === '/api/reports') {
            if (req.method === 'GET' && url.searchParams.get('page') === '2' && !reportPageChanged) {
              // A concurrent synthetic edit invalidates the previously read
              // basis. This is not a production write or persistent snapshot.
              reportPageChanged = true
              const change = queue.then(() => pg.query('UPDATE decision_log SET what=$1 WHERE id=$2',
                ['다른 조회 사이 변경된 가상 신고 원문입니다.', 'c22-local-recent-001']))
              queue = change.catch(() => {})
              await change
            }
            if (req.method === 'GET' && reportRefreshPending) {
              reportRefreshPending = false
              return Response.json({ error: '로컬 검증: 처리 저장 뒤 목록 조회가 실패했습니다.' }, { status: 503 })
            }
          }
          // Opt-in browser failures after real signed middleware, using only
          // this disposable database. Reject one legacy save BEFORE any write;
          // a successful later save loses only its subsequent read response.
          const agreementPath = url.pathname === '/api/applications/app-local-verify/agreement'
          if (agreementSaveFixture && agreementPath && req.method === 'PATCH' && !agreementWriteRejected) {
            agreementWriteRejected = true
            await new Promise(resolve => setTimeout(resolve, 4000))
            return Response.json({ error: '로컬 검증: 저장 결과를 확인하지 못했습니다.' }, { status: 503 })
          }
          if (agreementSaveFixture && agreementPath && req.method === 'GET' && agreementReadPending && !agreementReadRejected) {
            agreementReadRejected = true
            agreementReadPending = false
            return Response.json({ error: '로컬 검증: 저장 뒤 재조회가 실패했습니다.' }, { status: 503 })
          }
          if (feedbackRetryFixture && req.method === 'GET' && url.pathname === '/api/tools/local-retry-tool/unclear' && unclearReadPending) {
            unclearReadPending = false
            return Response.json({ error: '로컬 검증: 안내 상태 조회가 실패했습니다.' }, { status: 503 })
          }
          const result = handler ? await handler({ ...context, request: forwarded, env: bindings }) : Response.json({ error: 'Method not allowed' }, { status: 405 })
          if (fieldFeedbackSaveFixture && url.pathname === '/api/feedback' && req.method === 'POST' && result.ok) {
            const saved = await result.clone().json()
            if (saved.ok === true && saved.id === 'c25-local-update') fieldFeedbackReadPending = true
          }
          if (reportFeedFixture && url.pathname === '/api/reports' && req.method === 'POST' && result.ok) reportRefreshPending = true
          if (reportFixFixture && url.pathname === '/api/reports' && req.method === 'POST' && result.ok) {
            const saved = await result.clone().json()
            if (saved.reportId === 'c24-local-lost') reportRefreshPending = true
          }
          if (agreementSaveFixture && agreementPath && req.method === 'PATCH' && result.ok) agreementReadPending = true
          if (feedbackRetryFixture && req.method === 'POST' && /^\/api\/tools\/local-retry-tool\/(report|unclear)$/.test(url.pathname) && result.ok) {
            const saved = await result.clone().json()
            if (saved.ok === true && /^dec_[a-f0-9]{20}$/.test(saved.id)) {
              if (!feedbackRepliesLost.has(url.pathname)) {
                feedbackRepliesLost.add(url.pathname)
                // The real handler already committed a decision and receipt.
                return Response.json({ error: '로컬 검증: 저장 응답이 끊겼습니다.' }, { status: 503 })
              }
              if (url.pathname.endsWith('/unclear')) unclearReadPending = true
            }
          }
          return result
        }
        const response = await onRequest(context)
        if (fixture?.afterResponse && !res.destroyed) {
          const after = queue.then(() => fixture.afterResponse({ method: req.method, path: url.pathname, status: response.status }))
          queue = after.catch(() => {})
          await after
        }
        res.statusCode = response.status
        response.headers.forEach((value, name) => res.setHeader(name, value))
        res.end(Buffer.from(await response.arrayBuffer()))
      } catch (error) { res.statusCode = 500; res.end(JSON.stringify({ error: error.message })) }
    })
  },
}] })
await server.listen()
console.log(`Local isolated ${fixture ? 'synthetic-account verification' : 'demo'}: http://127.0.0.1:${port} — all data is in memory`)
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await server.close(); await pg.close(); process.exit(0) })
