// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { createSupabaseDb } from '../functions/_lib/dbBridge.js'
import { onRequestPost } from '../functions/api/override.js'
import { onRequestPost as feedbackPost } from '../functions/api/feedback.js'
import { canExpandExperiment, experimentRunTimingError } from '../shared/override.js'

const pg = new PGlite(), base = 'https://experiment-continuity.supabase.co'
const DB = createSupabaseDb(base, 'memory-only')
const token = 'c'.repeat(64), demoDB = createSupabaseDb(base, 'memory-only', token)
const plan = { metricType: 'rate', minimumWindowSeconds: 60, minimumSamples: { historical: 10, shadow: 10, limited: 10 }, rationale: '단계별 관측', datasetVersion: 'd1', modelVersion: 'm1', policyVersion: 'p1' }
let queue = Promise.resolve(), clock, testNow
const scopes = [
  { name: 'access', DB, clusterId: 'c', mode: 'access' },
  { name: 'private demo', DB: demoDB, clusterId: 'olc_policy', mode: 'demo' },
]
beforeAll(async () => {
  await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;')
  for (const file of readdirSync('supabase/migrations').filter(file => /^\d+.*\.sql$/.test(file)).sort()) await pg.exec(readFileSync('supabase/migrations/' + file, 'utf8'))
  vi.stubGlobal('fetch', (url, options) => {
    if (!String(url).startsWith(base + '/rest/v1/rpc/')) throw Error('External network forbidden')
    const result = queue.then(async () => {
      try {
        await pg.exec('SET ROLE service_role')
        const args = Object.values(JSON.parse(options.body)), name = new URL(url).pathname.split('/').at(-1)
        return Response.json((await pg.query(`SELECT public.${name}(${args.map((_, index) => '$' + (index + 1)).join(',')}) data`, args)).rows[0].data)
      } catch (error) { return Response.json({ code: error.code }, { status: 400 }) }
      finally { await pg.exec('RESET ROLE') }
    })
    queue = result.catch(() => {})
    return result
  })
  await DB.workspaceOpen(token, [])
  await pg.exec(`INSERT INTO override_product(id,name,domain,owner_team,model_name,model_version,prompt_version,policy_version)
    VALUES('p','시험 AI','지원','team','model','m1','prompt1','policy1');
    INSERT INTO issue_cluster(id,title,summary,owner_team,scope_product_id) VALUES('c','시험 문제','근거 점검','team','p');
    INSERT INTO override_actor(email,display_name,role,departments_json,product_ids_json) VALUES
    ('product@local.invalid','실험 담당자','product','["team"]','["p"]'),
    ('policy@local.invalid','정책 담당자','policy','["team"]','["p"]'),
    ('reviewer@local.invalid','신고 직원','reviewer','[]','[]'),
    ('other@local.invalid','다른 담당자','product','[]','[]');`)
  // Advance the local measurement clock when results arrive, without a
  // minute-long wall wait. PostgreSQL records the preceding approval first.
  testNow = Date.now()
  clock = vi.spyOn(Date, 'now').mockImplementation(() => testNow)
}, 60000)
afterAll(async () => { clock?.mockRestore(); vi.unstubAllGlobals(); await queue; await pg.close() })

async function post(scope, body, role = 'product', key = crypto.randomUUID()) {
  if (body.action === 'record_run') testNow = Math.max(testNow, Date.parse(body.measurementEnd) + 1)
  const actor = { email: role + '@local.invalid', role: role === 'other' ? 'product' : role, label: role, mode: 'access' }
  const env = scope.mode === 'demo' ? { DB: scope.DB, OVERRIDE_DEMO_MODE: 'true' }
    : { DB: DB.forActor(actor.email), UNSCOPED_DB: DB, AUTH_ACTOR: actor, OVERRIDE_DEMO_MODE: 'false' }
  const feedback = ['publish_update','confirm_update'].includes(body.action)
  const response = await (feedback ? feedbackPost : onRequestPost)({ env, request: new Request('https://local.invalid/api/' + (feedback ? 'feedback' : 'override'), {
    method: 'POST', headers: { 'X-Idempotency-Key': key }, body: JSON.stringify({ role, ...body }),
  }) })
  return { status: response.status, body: await response.json(), replayed: response.headers.get('X-Idempotency-Replayed') }
}
async function experiment(scope, riskLevel = 'medium') {
  const created = await post(scope, { action: 'create_experiment', clusterId: scope.clusterId, title: '시간·결정 연속성', changeTarget: '정책 검색', hypothesis: '수정률 감소', scope: '검증 표본', comparator: 'v1', successMetric: '수정률', approver: '책임자', rollbackPlan: 'v1로 복귀', guardrails: ['위반 0건'], stopConditions: ['위반 1건'], metricDirection: 'lower', targetImprovement: 20, evaluationPlan: plan, riskLevel })
  expect(created.status, JSON.stringify(created)).toBe(201)
  const id = created.body.id
  expect((await post(scope, { action: 'approve_experiment', experimentId: id, basis: '사전 계획 확인' }, riskLevel === 'high' ? 'policy' : 'product')).status).toBe(200)
  const row = await scope.DB.prepare('SELECT * FROM change_experiment WHERE id=?').bind(id).first()
  return { id, approved: Date.parse(row.approved_at.replace(' ', 'T') + 'Z') }
}
function run(experiment, phase, overrides = {}) {
  const start = phase === 'historical' ? Date.parse('2000-01-01T00:00:00Z') : experiment.approved + (phase === 'limited' ? 60000 : 0)
  return { action: 'record_run', experimentId: experiment.id, phase, controlValue: 10, variantValue: 7, sampleSize: 20, guardrailBreaches: 0, evidenceRefs: ['local/' + phase], measurementStart: new Date(start).toISOString(), measurementEnd: new Date(start + 60000).toISOString(), ...overrides }
}
async function pass(scope, exp) {
  for (const phase of ['historical', 'shadow', 'limited']) expect(await post(scope, run(exp, phase))).toMatchObject({ status: 201, body: { status: 'passed' } })
}
async function decide(scope, exp, decision, role = 'product', key) {
  return post(scope, { action: 'decide_experiment', experimentId: exp.id, decision, basis: '현장 재확인 근거' }, role, key)
}

for (const scope of scopes) describe.sequential(scope.name + ' experiment continuity', () => {
  it('accepts historical data before approval, UTC-equivalent offsets and adjacent live windows', async () => {
    const exp = await experiment(scope)
    expect((await post(scope, run(exp, 'historical'))).status).toBe(201)
    const shadow = run(exp, 'shadow')
    const asKst = value => new Date(Date.parse(value) + 9 * 3600000).toISOString().replace('Z', '+09:00')
    expect((await post(scope, { ...shadow, measurementStart: asKst(shadow.measurementStart), measurementEnd: asKst(shadow.measurementEnd) })).status).toBe(201)
    expect((await post(scope, run(exp, 'limited'))).status).toBe(201)
    expect((await decide(scope, exp, 'expand')).status).toBe(200)
  })
  it('rejects live measurement before approval without writing a run or changing the experiment', async () => {
    const exp = await experiment(scope)
    await post(scope, run(exp, 'historical'))
    const before = await scope.DB.prepare('SELECT * FROM change_experiment WHERE id=?').bind(exp.id).first()
    const stale = { measurementStart: '2001-01-01T00:00:00Z', measurementEnd: '2001-01-01T01:00:00Z' }
    expect((await post(scope, run(exp, 'shadow', stale))).status).toBe(400)
    expect(await scope.DB.prepare('SELECT * FROM change_experiment WHERE id=?').bind(exp.id).first()).toEqual(before)
    expect((await scope.DB.prepare('SELECT count(*) AS n FROM experiment_run WHERE experiment_id=?').bind(exp.id).first()).n).toBe(1)
  })
  it('rejects reverse or overlapping live phases but allows their shared boundary', async () => {
    const exp = await experiment(scope)
    await post(scope, run(exp, 'historical'))
    await post(scope, run(exp, 'shadow'))
    expect((await post(scope, run(exp, 'limited', { measurementStart: new Date(exp.approved + 30000).toISOString(), measurementEnd: new Date(exp.approved + 90000).toISOString() }))).status).toBe(400)
    expect((await post(scope, run(exp, 'limited'))).status).toBe(201)
  })
  it('rechecks already stored temporal evidence before expansion', async () => {
    const exp = await experiment(scope)
    await pass(scope, exp)
    // Model a legacy passed row saved before temporal validation existed.
    await scope.DB.prepare("UPDATE experiment_run SET measurement_start='1999-01-01T00:00:00Z',measurement_end='1999-01-01T01:00:00Z' WHERE experiment_id=? AND phase='limited'").bind(exp.id).run()
    expect((await decide(scope, exp, 'expand')).status).toBe(409)
    expect((await scope.DB.prepare('SELECT count(*) AS n FROM override_decision_record WHERE experiment_id=?').bind(exp.id).first()).n).toBe(0)
  })
  it('appends rollback after expansion, keeps its original snapshot and replays lost responses once', async () => {
    const exp = await experiment(scope)
    await pass(scope, exp)
    expect((await decide(scope, exp, 'expand')).status).toBe(200)
    const expansion = await scope.DB.prepare("SELECT * FROM override_decision_record WHERE experiment_id=? AND decision='expand'").bind(exp.id).first()
    expect((await decide(scope, exp, 'hold')).status).toBe(409)
    expect((await decide(scope, exp, 'stop')).status).toBe(409)
    expect((await post(scope, { action: 'approve_experiment', experimentId: exp.id, basis: '종료 재승인 금지' })).status).toBe(409)
    await scope.DB.prepare("UPDATE issue_cluster SET status='resolved',acknowledged_at='2026-01-01T00:00:00Z' WHERE id=?").bind(scope.clusterId).run()
    const key = crypto.randomUUID(), first = await decide(scope, exp, 'rollback', 'product', key)
    expect(first.status).toBe(200)
    const retry = await decide(scope, exp, 'rollback', 'product', key)
    expect(retry).toMatchObject({ status: 200, body: { id: first.body.id }, replayed: '1' })
    expect(await scope.DB.prepare("SELECT * FROM override_decision_record WHERE experiment_id=? AND decision='expand'").bind(exp.id).first()).toEqual(expansion)
    expect((await scope.DB.prepare('SELECT count(*) AS n FROM override_decision_record WHERE experiment_id=?').bind(exp.id).first()).n).toBe(2)
    expect(await scope.DB.prepare('SELECT status FROM change_experiment WHERE id=?').bind(exp.id).first()).toEqual({ status: 'rolled_back' })
    expect(await scope.DB.prepare('SELECT status,acknowledged_at FROM issue_cluster WHERE id=?').bind(scope.clusterId).first()).toEqual({ status: 'open', acknowledged_at: null })
    expect((await decide(scope, exp, 'rollback')).status).toBe(409)
    expect((await decide(scope, exp, 'expand')).status).toBe(409)
    expect((await post(scope, run(exp, 'limited'))).status).toBe(409)
  })
  it('keeps role and high-risk boundaries on rollback after expansion', async () => {
    const exp = await experiment(scope, 'high')
    await pass(scope, exp)
    expect((await decide(scope, exp, 'expand', 'policy')).status).toBe(200)
    expect((await decide(scope, exp, 'rollback', 'reviewer')).status).toBe(403)
    expect((await decide(scope, exp, 'rollback', 'product')).status).toBe(403)
    if (scope.mode === 'access') expect((await decide(scope, exp, 'rollback', 'other')).status).toBe(404)
    expect((await decide(scope, exp, 'rollback', 'policy')).status).toBe(200)
  })
  it('records rollback after the employee reports an applied change unresolved, without discarding their open follow-up', async () => {
    const captured = await post(scope, { action: 'capture_event', productId: scope.mode === 'demo' ? 'olp_loan' : 'p', decisionAction: 'modify', aiDecision: '기존 정책', humanDecision: '최신 정책', reasonDetail: '최신 정책 반영 필요' }, 'reviewer')
    expect(captured.status).toBe(201)
    const caseRow = await scope.DB.prepare('SELECT id FROM field_feedback_case WHERE event_id=?').bind(captured.body.id).first()
    const exp = await experiment({ ...scope, clusterId: captured.body.cluster_id })
    await pass(scope, exp)
    expect((await decide(scope, exp, 'expand')).status).toBe(200)
    const update = await post(scope, { action: 'publish_update', caseId: caseRow.id, kind: 'applied', message: '최신 정책 검색 반영', effectiveOn: new Date().toISOString().slice(0,10), confirmedApplied: true })
    expect(update.status).toBe(201)
    expect((await post(scope, { action: 'confirm_update', updateId: update.body.id, verdict: 'not_resolved', note: '반영 후에도 동일한 오류가 발생합니다.' }, 'reviewer')).status).toBe(200)
    const followup = await scope.DB.prepare('SELECT * FROM issue_followup WHERE source_kind=? AND source_id=?').bind('feedback',update.body.id).first()
    expect(followup.status).toBe('open')
    expect((await decide(scope, exp, 'rollback')).status).toBe(200)
    expect(await scope.DB.prepare('SELECT * FROM issue_followup WHERE id=?').bind(followup.id).first()).toEqual(followup)
    expect((await post(scope, { action: 'update_cluster', clusterId: captured.body.cluster_id, status: 'resolved', reason: '롤백만으로 종료 시도' })).status).toBe(409)
    expect((await scope.DB.prepare('SELECT verdict FROM field_feedback_receipt WHERE update_id=?').bind(update.body.id).first()).verdict).toBe('not_resolved')
  })
  it('does not store duplicate rollback decisions from concurrent distinct requests', async () => {
    const exp = await experiment(scope)
    await pass(scope, exp)
    await decide(scope, exp, 'expand')
    const responses = await Promise.all([decide(scope, exp, 'rollback'), decide(scope, exp, 'rollback')])
    expect(responses.map(result => result.status).sort()).toEqual([200, 409])
    expect((await scope.DB.prepare("SELECT count(*) AS n FROM override_decision_record WHERE experiment_id=? AND decision='rollback'").bind(exp.id).first()).n).toBe(1)
  })
})

it('uses the same UTC instant across calendar days and does not let a new approval reuse old live evidence', () => {
  const experiment = { approved_at: '2026-01-01 15:00:00', approval_id: 'new', change_version: 'v1', status: 'running', evaluation_plan_json: JSON.stringify(plan) }
  const prior = { measurement_end: '2025-01-01T00:00:00Z' }
  expect(experimentRunTimingError(experiment, { phase: 'shadow', measurement_start: '2026-01-02T00:00:00+09:00', measurement_end: '2026-01-02T00:01:00+09:00' }, prior)).toBeNull()
  expect(experimentRunTimingError(experiment, { phase: 'shadow', measurement_start: '2026-01-01T14:59:00Z', measurement_end: '2026-01-01T15:00:00Z' }, prior)).toContain('현재 승인')
  const runs = ['historical', 'shadow', 'limited'].map((phase, index) => ({ phase, status: 'passed', guardrail_breaches: 0, approval_id: 'new', change_version: 'v1', run_sequence: index, measurement_start: '2025-01-01T00:00:00Z', measurement_end: '2025-01-01T00:01:00Z' }))
  expect(canExpandExperiment(experiment, runs)).toMatchObject({ ok: false, timingIssues: [{ phase: 'Shadow Test' }, { phase: '제한 배포' }] })
})
