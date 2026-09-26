// @vitest-environment node
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { createSupabaseDb } from '../functions/_lib/dbBridge.js'
import { departmentAuthority } from '../functions/_lib/departmentAuthority.js'
import { loadCriteriaEvidence } from '../functions/_lib/agreementEvidence.js'
import { loadOutcomeEvidence } from '../functions/_lib/outcomeEvidence.js'
import { onRequest } from '../functions/api/_middleware.js'
import { onRequestPost as signoff } from '../functions/api/track/[ticket]/signoff.js'
import { onRequestPost as accept } from '../functions/api/tools/[slug]/accept.js'
import { onRequestPost as outcome } from '../functions/api/track/[ticket]/outcome.js'
import { onRequestPost as hold } from '../functions/api/track/[ticket]/hold.js'
import { onRequestPost as beta } from '../functions/api/track/[ticket]/beta.js'

const pg = new PGlite(), base = 'https://department-local.supabase.co'
const issuer = 'https://department-local.cloudflareaccess.com'
const DB = createSupabaseDb(base, 'test-only')
const env = { DB, DBBridgeApplied: true, SUPABASE_URL: base, SUPABASE_SERVICE_ROLE_KEY: 'test-only',
  ACCESS_TEAM_DOMAIN: issuer, ACCESS_AUD: 'department-local', OVERRIDE_DEMO_MODE: 'false', DEMO_WORKSPACES: 'false' }
let queue = Promise.resolve(), pair, jwk, beforeCommit = null
const cases = [
  ['signoff', '/api/track/AX-TEST/signoff', signoff, { by: '이름 위조', dept: '재무', verdicts: { criterion: 'ok' }, reasons: {} }],
  ['accept', '/api/tools/department-test/accept', accept, { by: '이름 위조' }],
  ['outcome', '/api/track/AX-TEST/outcome', outcome, { by: '이름 위조', agree: true }],
  ['hold', '/api/track/AX-TEST/hold', hold, { by: '이름 위조', kind: 'met', body: '필요한 조건이 해소되었습니다.' }],
  ['beta', '/api/track/AX-TEST/beta', beta, { by: '이름 위조', kind: '의견', body: '업무에 적용해 확인했습니다.' }],
]
beforeAll(async () => {
  await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;')
  for (const file of ['0000_schema.sql', '0001_execute_sql.sql', '0002_override_loop.sql', '0003_journey_workspaces.sql', '0004_audit_hardening.sql', '0005_field_feedback.sql', '0006_access_scope.sql', '0007_issue_workflow.sql', '0008_feedback_rechecks.sql', '0009_participation_quota.sql','0010_application_ownership.sql','0011_tool_run_receipts.sql','0012_beta_round_receipts.sql','0013_review_revision.sql']) {
    await pg.exec(readFileSync(new URL('../supabase/migrations/' + file, import.meta.url), 'utf8'))
  }
  vi.stubGlobal('fetch', (url, options) => {
    if (String(url) === issuer + '/cdn-cgi/access/certs') return Promise.resolve(Response.json({ keys: [jwk] }))
    if (!String(url).startsWith(base + '/rest/v1/rpc/')) throw Error('External network blocked')
    const task = queue.then(async () => {
      try {
        const args = Object.values(JSON.parse(options.body)), name = new URL(url).pathname.split('/').at(-1)
        if (name === 'ilson_actor_commit' && beforeCommit) {
          const change = beforeCommit
          beforeCommit = null
          await change()
        }
        await pg.exec('SET ROLE service_role')
        return Response.json((await pg.query(`SELECT public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) data`, args)).rows[0].data)
      } catch (error) { return Response.json({ code: error.code }, { status: 400 }) }
      finally { await pg.exec('RESET ROLE') }
    })
    queue = task.catch(() => {})
    return task
  })
  pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])
  jwk = { ...await crypto.subtle.exportKey('jwk', pair.publicKey), kid: 'department-local', alg: 'RS256', use: 'sig' }
  for (const [email, role, departments] of [['owner@local.invalid', 'reviewer', ['인사']], ['finance@local.invalid', 'operations', ['재무']], ['admin@local.invalid', 'audit', []]]) {
    await DB.prepare('INSERT INTO override_actor(email,display_name,role,departments_json) VALUES(?,?,?,?)')
      .bind(email, email.split('@')[0], role, JSON.stringify(departments)).run()
  }
  await DB.prepare("INSERT INTO application(id,ticket_no,dept,applicant_label,title,bottleneck,problem,status,owner_email) VALUES('app-dept','AX-TEST','재무','owner','업무 확인','병목','문제','보류','owner@local.invalid')").run()
  await DB.prepare("INSERT INTO acceptance_criterion(id,application_id,ord,body,confirmed_at) VALUES('criterion','app-dept',1,'서류 확인',datetime('now'))").run()
  await DB.prepare("INSERT INTO decision_log(id,application_id,stage,actor,title,what,why,link_kind) VALUES('join-hr','app-dept','검토','human','인사 — 참여','같은 업무','{\"dept\":\"인사\"}','같은건손듦')").run()
  await DB.forActor('admin@local.invalid').prepare("INSERT INTO application_participation(id,application_id,department_id,granted_by_email) VALUES('join-hr','app-dept','인사','admin@local.invalid')").run()
  await DB.prepare("INSERT INTO handover(application_id,slug,title,handed_to_dept,handed_to_person) VALUES('app-dept','department-test','도구','재무','담당자')").run()
  await DB.prepare("INSERT INTO beta_round(id,application_id,seq,overall) VALUES('round','app-dept',1,'통과')").run()
  await DB.prepare("INSERT INTO baseline(application_id,median_seconds,min_seconds,max_seconds,sample_n,people) VALUES('app-dept',600,600,600,5,1)").run()
  await DB.prepare("INSERT INTO tool_use(id,application_id,ok,duration_ms) VALUES('dept-run','app-dept',1,1000)").run()
}, 60000)
afterAll(async () => { vi.unstubAllGlobals(); await pg.close() })
const enc = value => Buffer.from(JSON.stringify(value)).toString('base64url')
async function invoke(email, path, handler, body) {
  if(path.endsWith('/signoff')) body={...body,expectedVersion:(await loadCriteriaEvidence(DB.forActor(email),'app-dept'))?.sourceVersion}
  if(path.endsWith('/outcome')) body={...body,expectedEvidence:(await loadOutcomeEvidence(DB.forActor(email),'app-dept')).mutationToken}
  const now = Math.floor(Date.now() / 1000)
  const unsigned = enc({ alg: 'RS256', kid: 'department-local' }) + '.' + enc({ iss: issuer, aud: ['department-local'], iat: now, exp: now + 300, email })
  const jwt = unsigned + '.' + Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(unsigned))).toString('base64url')
  const request = new Request('https://local.invalid' + path, { method: 'POST', headers: { 'Cf-Access-Jwt-Assertion': jwt, Origin: 'https://local.invalid', 'X-Ilson-Request': '1', 'X-Ilson-Scope': await DB.forActor(email).toolRunScope(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const context = { env, request, data: {}, next: forwarded => handler({ env, data: context.data, request: forwarded, params: { ticket: 'AX-TEST', slug: 'department-test' } }) }
  const response = await onRequest(context)
  return { status: response.status, body: await response.json() }
}

describe.sequential('department attestations through signed middleware and PostgreSQL', () => {
  it.each(cases)('%s denies a different department even on the employee-owned application', async (_name, path, handler, body) => {
    const before = Number((await DB.prepare("SELECT count(*) n FROM decision_log WHERE application_id='app-dept'").first()).n)
    const result = await invoke('owner@local.invalid', path, handler, { ...body, departments: ['재무'], role: 'audit' })
    expect(result.status, JSON.stringify(result.body)).toBe(403)
    expect(Number((await DB.prepare("SELECT count(*) n FROM decision_log WHERE application_id='app-dept'").first()).n)).toBe(before)
  })
  it.each(cases)('%s accepts an account assigned to the actual department', async (_name, path, handler, body) => {
    await DB.prepare("UPDATE application SET status='보류' WHERE id='app-dept'").run()
    const result = await invoke('finance@local.invalid', path, handler, body)
    expect(result.status, JSON.stringify(result.body)).toBe(200)
  })
  it('allows the required department assigned to the signer but never another required department', async () => {
    const result = await invoke('owner@local.invalid', cases[0][1], signoff, { ...cases[0][3], dept: '인사' })
    expect(result.status, JSON.stringify(result.body)).toBe(200)
    const signatures = (await DB.prepare("SELECT title,link_id FROM decision_log WHERE application_id='app-dept' AND link_kind='기준서명' ORDER BY title").all()).results
    expect(signatures).toEqual([{ title: 'finance', link_id: '재무' }, { title: 'owner', link_id: '인사' }])
  })
  it('allows the explicit account administrator exception', async () => {
    expect((await invoke('admin@local.invalid', cases[0][1], signoff, cases[0][3])).status).toBe(200)
  })
  it.each([
    ['department revoked', "UPDATE override_actor SET departments_json='[]' WHERE email='owner@local.invalid'", 'operations', '["재무"]'],
    ['administrator downgraded', "UPDATE override_actor SET role='operations' WHERE email='owner@local.invalid'", 'audit', '[]'],
    ['account disabled', "UPDATE override_actor SET active=0 WHERE email='owner@local.invalid'", 'operations', '["재무"]'],
  ])('outcome rejects %s before commit despite retained application ownership', async (_label, change, role, departments) => {
    await DB.prepare('UPDATE override_actor SET role=?,departments_json=?,active=1 WHERE email=?')
      .bind(role, departments, 'owner@local.invalid').run()
    const prior = await DB.prepare("SELECT * FROM outcome WHERE application_id='app-dept'").first()
    const before = Number((await DB.prepare("SELECT count(*) n FROM decision_log WHERE application_id='app-dept'").first()).n)
    beforeCommit = () => pg.exec(change)
    try {
      const result = await invoke('owner@local.invalid', cases[2][1], outcome, cases[2][3])
      expect(result.status, JSON.stringify(result.body)).toBe(409)
      expect(beforeCommit).toBeNull()
      expect(await DB.prepare("SELECT * FROM outcome WHERE application_id='app-dept'").first()).toEqual(prior)
      expect(Number((await DB.prepare("SELECT count(*) n FROM decision_log WHERE application_id='app-dept'").first()).n)).toBe(before)
    } finally {
      beforeCommit = null
      await DB.prepare("UPDATE override_actor SET role='reviewer',departments_json='[\"인사\"]',active=1 WHERE email='owner@local.invalid'").run()
    }
  })
  it('fails closed without a verified account and keeps isolated demo behavior', () => {
    expect(departmentAuthority({ OVERRIDE_DEMO_MODE: 'false' }, '재무').status).toBe(401)
    expect(departmentAuthority({ AUTH_ACTOR: { mode: 'access', email: 'unassigned@local.invalid', role: 'reviewer', departments: [] } }, '재무').status).toBe(403)
    expect(departmentAuthority({ DEMO_WORKSPACE: true, OVERRIDE_DEMO_MODE: 'true' }, '재무')).toBeNull()
    expect(departmentAuthority({ AUTH_ACTOR: { mode: 'access', email: 'raw@local.invalid', role: 'reviewer', departments_json: '["재무"]' } }, '재무')).toBeNull()
  })
})
