// @vitest-environment node
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { createSupabaseDb } from '../functions/_lib/dbBridge.ts'
import { seedOverrideWorkspace } from '../functions/_lib/override.js'
import { assertClusterClosable } from '../functions/_lib/issueWorkflow.js'
import { onRequestPost as capture } from '../functions/api/override.js'
import { onRequestPost as mutate, onRequestGet as list } from '../functions/api/feedback.js'

vi.mock('../functions/_lib/access.js', () => ({ verifiedAccessEmail: async env => env.TEST_EMAIL || null }))
const pg = new PGlite()
const DB = createSupabaseDb('https://workflow-test.supabase.co', 'test-only')
const env = email => ({ DB: DB.forActor(email), UNSCOPED_DB: DB, OVERRIDE_DEMO_MODE: 'false', TEST_EMAIL: email })
const today = () => new Date().toISOString().slice(0, 10)
const oldToken = '1'.repeat(64)
let queue = Promise.resolve()
const install = file => pg.exec(readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'))
const post = (body, email = 'manager@test.invalid', key = crypto.randomUUID()) => mutate({
  env: env(email), request: new Request('https://test.invalid/api/feedback', {
    method: 'POST', headers: { 'X-Idempotency-Key': key }, body: JSON.stringify(body),
  }),
})
const get = (email = 'manager@test.invalid') => list({ env: env(email), request: new Request('https://test.invalid/api/feedback') })
async function ok(response, status = 200) {
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(status)
  return response.json()
}
async function record(action = 'modify') {
  return ok(await capture({ env: env('owner@test.invalid'), request: new Request('https://test.invalid/api/override', {
    method: 'POST', headers: { 'X-Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify({ action: 'capture_event', productId: 'olp_loan', decisionAction: action,
      aiDecision: '기존 정책', humanDecision: action === 'approve' ? '기존 정책' : '새 정책', reasonDetail: '원본 내규 확인', policyRefs: ['policy-original'] }),
  }) }), 201)
}
async function appliedNotice(eventId) {
  const item = await DB.prepare('SELECT id FROM field_feedback_case WHERE event_id=?').bind(eventId).first()
  return ok(await post({ action: 'publish_update', caseId: item.id, kind: 'applied', message: '개선 적용 안내', effectiveOn: today(), confirmedApplied: true }), 201)
}

beforeAll(async () => {
  await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;')
  for (const file of ['0000_schema.sql', '0001_execute_sql.sql', '0002_override_loop.sql', '0003_journey_workspaces.sql', '0004_audit_hardening.sql', '0005_field_feedback.sql']) await install(file)
  vi.stubGlobal('fetch', (url, options) => {
    if (!String(url).startsWith('https://workflow-test.supabase.co/rest/v1/rpc/')) throw Error('External call blocked')
    const task = queue.then(async () => {
      try {
        await pg.exec('SET ROLE service_role')
        const args = Object.values(JSON.parse(options.body)), name = new URL(url).pathname.split('/').at(-1)
        return Response.json((await pg.query(`SELECT public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) AS data`, args)).rows[0].data)
      } catch (error) { return Response.json({ code: error.code }, { status: 400 }) }
      finally { await pg.exec('RESET ROLE') }
    })
    queue = task.catch(() => {})
    return task
  })
  await seedOverrideWorkspace({ DB, OVERRIDE_DEMO_MODE: 'true' })
  await DB.workspaceOpen(oldToken, [])
  const legacyDb = createSupabaseDb('https://workflow-test.supabase.co', 'test-only', oldToken)
  await seedOverrideWorkspace({ DB: legacyDb, DEMO_WORKSPACE: true })
  for (const db of [DB, legacyDb]) {
    await db.prepare("INSERT INTO field_feedback_case(id,event_id,reporter_key) VALUES('legacy-case','ole_01','legacy-reporter')").run()
    await db.prepare("INSERT INTO field_feedback_update(id,case_id,kind,body,actor_label) VALUES('legacy-update','legacy-case','applied','기존 안내','담당자')").run()
    await db.prepare("INSERT INTO field_feedback_receipt(update_id,verdict,note,responded_at) VALUES('legacy-update','not_resolved','기존 미해결 근거',datetime('now'))").run()
    await db.prepare("UPDATE issue_cluster SET status='resolved' WHERE id='olc_policy'").run()
    await db.prepare("INSERT INTO quality_sample_batch(id,product_id,start_at,end_at,requested_size,sample_size,eligible_count,seed,created_by) VALUES('legacy-batch','olp_loan','2026-01-01','2026-01-02',1,1,1,'seed','점검자')").run()
    await db.prepare(`INSERT INTO quality_sample_item(id,batch_id,event_id,snapshot_json,verdict,reason,evidence_refs,reviewed_by,reviewed_at)
      VALUES('legacy-sample','legacy-batch','ole_02','{"ai_decision":"보존한 원문","human_decision":"당시 승인"}','issue','기존 표본 오류','정책 원문','점검자',datetime('now'))`).run()
  }
  await install('0006_access_scope.sql')
  // Exercise a pre-existing acknowledgment during the additive upgrade as well
  // as the post-migration API transition. Other ownership columns are installed
  // normally by migration 0007.
  const oldSchema = (await pg.query('SELECT public.ilson_workspace_schema($1) AS name', [oldToken])).rows[0].name
  for (const schema of ['public', oldSchema]) {
    await pg.exec(`ALTER TABLE "${schema}".issue_cluster ADD COLUMN acknowledged_at text;
      UPDATE "${schema}".issue_cluster SET acknowledged_at='2026-01-01 00:00:00' WHERE id='olc_policy';`)
  }
  await install('0007_issue_workflow.sql')
  await install('0008_feedback_rechecks.sql')
  await install('0009_participation_quota.sql')
  for (const [email, role] of [['owner@test.invalid', 'reviewer'], ['other@test.invalid', 'reviewer'], ['manager@test.invalid', 'product'], ['audit@test.invalid', 'audit']]) {
    await DB.prepare('INSERT INTO override_actor(email,display_name,role,product_ids_json) VALUES(?,?,?,?)').bind(email, email.split('@')[0], role, role === 'product' ? '["olp_loan"]' : '[]').run()
  }
}, 60000)
afterAll(async () => { vi.unstubAllGlobals(); await pg.close() })

describe.sequential('follow-up workflow with real PostgreSQL handlers and migrations', () => {
  it('backfills old unresolved reports in public and existing demo schemas without losing evidence', async () => {
    for (const db of [DB, createSupabaseDb('https://workflow-test.supabase.co', 'test-only', oldToken)]) {
      const rows = (await db.prepare('SELECT source_kind,reason,evidence_refs,status FROM issue_followup ORDER BY source_kind').all()).results
      expect(rows).toHaveLength(2)
      expect(rows[0]).toMatchObject({ source_kind: 'feedback', reason: '기존 미해결 근거', status: 'open' })
      expect(rows[1]).toMatchObject({ source_kind: 'quality_sample', reason: '기존 표본 오류', evidence_refs: '정책 원문', status: 'open' })
      expect(await db.prepare("SELECT status,acknowledged_at FROM issue_cluster WHERE id='olc_policy'").first()).toEqual({ status: 'open', acknowledged_at: null })
    }
    expect(await DB.readiness()).toMatchObject({ migration: '0009', schemaReady: true, ready: true })
    expect(await createSupabaseDb('https://workflow-test.supabase.co', 'test-only', oldToken).readiness()).toMatchObject({ migration: '0009', schemaReady: true, ready: true })
  })

  it('creates local foreign keys, ownership fields and closure triggers in newly opened demo workspaces', async () => {
    const token = '2'.repeat(64)
    await DB.workspaceOpen(token, [])
    const target = (await pg.query('SELECT public.ilson_workspace_schema($1) AS name', [token])).rows[0].name
    const columns = (await pg.query("SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='issue_cluster'", [target])).rows.map(r => r.column_name)
    expect(columns).toEqual(expect.arrayContaining(['assignee_email', 'assignee_label', 'assigned_at', 'acknowledged_at', 'next_response_on']))
    const optional = (await pg.query("SELECT column_name,is_nullable FROM information_schema.columns WHERE table_schema=$1 AND table_name='override_event' AND column_name IN ('customer_impact_score','operations_cost_krw','regulatory_risk_score','recording_seconds')", [target])).rows
    expect(optional).toHaveLength(4)
    expect(optional.every(column => column.is_nullable === 'YES')).toBe(true)
    expect((await pg.query("SELECT count(*)::int AS n FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND t.tgname='issue_closure_guard'", [target])).rows[0].n).toBe(1)
    expect((await pg.query("SELECT count(*)::int AS n FROM pg_constraint c JOIN pg_class a ON a.oid=c.conrelid JOIN pg_namespace n ON n.oid=a.relnamespace JOIN pg_class b ON b.oid=c.confrelid JOIN pg_namespace m ON m.oid=b.relnamespace WHERE c.contype='f' AND n.nspname=$1 AND a.relname='issue_followup' AND n.nspname<>m.nspname", [target])).rows[0].n).toBe(0)
  })

  it('reopens a resolved cluster once for unresolved feedback and refuses premature closure', async () => {
    const event = await record()
    // Capture may join a cluster already carrying a migrated task; use a new
    // empty terminal cluster to verify the actual reopening transition.
    await DB.prepare(`INSERT INTO issue_cluster(id,title,summary,owner_team,status,scope_product_id,created_by_email,assignee_email,assignee_label,assigned_at,acknowledged_at,next_response_on)
      VALUES('closed-test','닫힌 문제','근거','운영','resolved','olp_loan','owner@test.invalid','manager@test.invalid','manager','2026-01-01 00:00:00','2026-01-02 00:00:00','2026-12-31')`).run()
    await DB.prepare("UPDATE override_event SET cluster_id='closed-test' WHERE id=?").bind(event.id).run()
    const update = await appliedNotice(event.id), key = crypto.randomUUID()
    const body = { action: 'confirm_update', updateId: update.id, verdict: 'not_resolved', note: '같은 조건에서 재발했습니다.' }
    const results = await Promise.all([post(body, 'owner@test.invalid', key), post(body, 'owner@test.invalid', key)])
    for (const response of results) await ok(response)
    const tasks = (await DB.prepare('SELECT * FROM issue_followup WHERE source_id=?').bind(update.id).all()).results
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({ source_kind: 'feedback', event_id: event.id, cluster_id: 'closed-test', status: 'open', reason: body.note })
    expect(await DB.prepare("SELECT status,acknowledged_at,assignee_email,assigned_at,next_response_on FROM issue_cluster WHERE id='closed-test'").first())
      .toEqual({ status: 'open', acknowledged_at: null, assignee_email: 'manager@test.invalid', assigned_at: '2026-01-01 00:00:00', next_response_on: '2026-12-31' })
    await expect(assertClusterClosable(DB, 'closed-test', 'resolved')).rejects.toMatchObject({ status: 409 })
    await expect(DB.prepare("UPDATE issue_cluster SET status='accepted_exception' WHERE id='closed-test'").run()).rejects.toThrow('/23514')
    expect((await post(body, 'other@test.invalid')).status).toBe(404)
    const mine = await ok(await get('owner@test.invalid'))
    expect(mine.cases.find(c => c.event_id === event.id).followups).toHaveLength(1)
    expect((await ok(await get('other@test.invalid'))).followups).toHaveLength(0)
  })

  it.each(['accepted_exception', 'open', 'experiment', 'monitoring'])('resets acknowledgment only when reopening the terminal state %s', async status => {
    const event = await record(), clusterId = `ack-${status}`
    const priorAck = '2026-01-02 00:00:00'
    await DB.prepare(`INSERT INTO issue_cluster(id,title,summary,owner_team,status,scope_product_id,created_by_email,assignee_email,assignee_label,assigned_at,acknowledged_at,next_response_on)
      VALUES(?,'접수 확인','근거','운영',?,'olp_loan','owner@test.invalid','manager@test.invalid','manager','2026-01-01 00:00:00',?,'2026-12-31')`)
      .bind(clusterId, status, priorAck).run()
    await DB.prepare('UPDATE override_event SET cluster_id=? WHERE id=?').bind(clusterId, event.id).run()
    const update = await appliedNotice(event.id)
    await ok(await post({ action: 'confirm_update', updateId: update.id, verdict: 'not_resolved', note: '현장에서 다시 확인해도 문제가 있습니다.' }, 'owner@test.invalid'))
    expect(await DB.prepare('SELECT status,acknowledged_at,assignee_email,next_response_on FROM issue_cluster WHERE id=?').bind(clusterId).first())
      .toEqual({ status: status === 'accepted_exception' ? 'open' : status, acknowledged_at: status === 'accepted_exception' ? null : priorAck,
        assignee_email: 'manager@test.invalid', next_response_on: '2026-12-31' })
  })

  it('keeps the approved event and sample snapshot while creating one actionable quality issue', async () => {
    const event = await record('approve')
    const original = await DB.prepare('SELECT * FROM override_event WHERE id=?').bind(event.id).first()
    const batch = await ok(await post({ action: 'create_sample', productId: 'olp_loan', startDate: today(), endDate: today(), size: 30 }), 201)
    const sample = await DB.prepare('SELECT * FROM quality_sample_item WHERE batch_id=? AND event_id=?').bind(batch.id, event.id).first()
    const body = { action: 'review_sample', itemId: sample.id, verdict: 'issue', reason: '새 정책과 다릅니다.', evidenceRefs: '정책 제3조' }
    const results = await Promise.all([post(body, 'audit@test.invalid'), post(body, 'audit@test.invalid')])
    expect(results.map(r => r.status).sort()).toEqual([200, 409])
    const tasks = (await DB.prepare('SELECT * FROM issue_followup WHERE source_kind=? AND source_id=?').bind('quality_sample', sample.id).all()).results
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({ status: 'open', product_id: original.product_id, event_id: event.id, evidence_refs: body.evidenceRefs })
    expect(await DB.prepare('SELECT * FROM override_event WHERE id=?').bind(event.id).first()).toEqual(original)
    expect((await DB.prepare('SELECT snapshot_json FROM quality_sample_item WHERE id=?').bind(sample.id).first()).snapshot_json).toBe(sample.snapshot_json)
    const taskCluster = await DB.prepare('SELECT status,scope_product_id FROM issue_cluster WHERE id=?').bind(tasks[0].cluster_id).first()
    expect(taskCluster).toMatchObject({ status: 'open', scope_product_id: original.product_id })
    expect((await ok(await get('audit@test.invalid'))).samples.find(s => s.id === sample.id).followup.id).toBe(tasks[0].id)
  })

  it('requires a permitted person and resolution evidence before closing a task', async () => {
    const task = await DB.prepare("SELECT id FROM issue_followup WHERE cluster_id='closed-test'").first()
    const body = { action: 'resolve_followup', followupId: task.id, resolution: '동일 입력을 재현하여 정책 원문과 일치함을 확인했습니다.' }
    expect((await post(body, 'owner@test.invalid')).status).toBe(403)
    expect((await post({ ...body, resolution: '' })).status).toBe(400)
    await ok(await post(body))
    expect((await post(body)).status).toBe(409)
    await expect(assertClusterClosable(DB, 'closed-test', 'resolved')).resolves.toBeUndefined()
    await DB.prepare("UPDATE issue_cluster SET status='resolved' WHERE id='closed-test'").run()
    expect((await DB.prepare('SELECT status,resolution,resolved_by FROM issue_followup WHERE id=?').bind(task.id).first())).toMatchObject({ status: 'resolved', resolution: body.resolution, resolved_by: 'manager' })
  })

  it('revalidates assignee access in the database when account access changes before a write', async () => {
    await DB.prepare("INSERT INTO issue_cluster(id,title,summary,owner_team,scope_product_id) VALUES('assignment-test','배정 확인','근거','운영','olp_loan')").run()
    await DB.prepare("INSERT INTO override_actor(email,display_name,role,product_ids_json) VALUES('worker@test.invalid','담당자','operations','[\"olp_loan\"]')").run()
    const assignment = () => DB.prepare("UPDATE issue_cluster SET assignee_email='worker@test.invalid',assignee_label='담당자',assigned_at=datetime('now'),next_response_on=? WHERE id='assignment-test'").bind(today()).run()
    await assignment()
    await DB.prepare("UPDATE override_actor SET active=0 WHERE email='worker@test.invalid'").run()
    await expect(assignment()).rejects.toThrow('/23514')
    await DB.prepare("UPDATE override_actor SET active=1,product_ids_json='[]' WHERE email='worker@test.invalid'").run()
    await expect(assignment()).rejects.toThrow('/23514')
    await DB.prepare("UPDATE override_actor SET product_ids_json='[\"olp_loan\"]',role='reviewer' WHERE email='worker@test.invalid'").run()
    await expect(assignment()).rejects.toThrow('/23514')
  })
})
