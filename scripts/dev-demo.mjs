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
const healthFailureFixture = process.argv.includes('--health-failure-fixture')
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
        context.next = (forwarded = context.request) => handler ? handler({ ...context, request: forwarded, env: bindings }) : Response.json({ error: 'Method not allowed' }, { status: 405 })
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
