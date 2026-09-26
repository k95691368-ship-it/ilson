// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { createSupabaseDb } from '../functions/_lib/dbBridge.ts'
import { feedbackActorKey } from '../functions/_lib/fieldFeedback.js'
import { seedOverrideWorkspace } from '../functions/_lib/override.js'
import { onRequestPost as capture } from '../functions/api/override.js'
import { onRequestGet as list, onRequestPost as mutate } from '../functions/api/feedback.js'

vi.mock('../functions/_lib/access.js', () => ({ verifiedAccessEmail: async env => env.TEST_EMAIL || null }))
const pg = new PGlite()
const url = 'https://continuity-test.supabase.co'
const DB = createSupabaseDb(url, 'test-only')
const date = () => new Date().toISOString().slice(0, 10)
const oldToken = 'a1'.repeat(32), newToken = 'b2'.repeat(32)
const legacyDb = createSupabaseDb(url, 'test-only', oldToken)
const demoDb = createSupabaseDb(url, 'test-only', newToken)
const demoEnv = db => ({ DB: db, DEMO_WORKSPACE: true, OVERRIDE_DEMO_MODE: 'true' })
const realEnv = email => ({ DB: DB.forActor(email), UNSCOPED_DB: DB, OVERRIDE_DEMO_MODE: 'false', TEST_EMAIL: email })
const contexts = {
  access: { db: DB, owner: realEnv('owner@test.invalid'), manager: realEnv('manager@test.invalid'), other: realEnv('other@test.invalid'), email: 'owner@test.invalid' },
  demo: { db: demoDb, owner: demoEnv(demoDb), manager: demoEnv(demoDb), other: demoEnv(legacyDb), email: null },
}
let queue = Promise.resolve()
const install = file => pg.exec(readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'))
const get = (env, cursor = '', role = 'reviewer', batchCursor = '') => list({ env, request: new Request(`https://test.invalid/api/feedback?role=${role}${cursor ? `&caseCursor=${encodeURIComponent(cursor)}` : ''}${batchCursor ? `&batchCursor=${encodeURIComponent(batchCursor)}` : ''}`) })
const post = (env, body, key = crypto.randomUUID()) => mutate({ env, request: new Request('https://test.invalid/api/feedback', {
  method: 'POST', headers: { 'X-Idempotency-Key': key }, body: JSON.stringify({ role: 'product', ...body }),
}) })
async function ok(response, status = 200) {
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(status)
  return response.json()
}
async function sampleFor(context) {
  const event = await ok(await capture({ env: context.owner, request: new Request('https://test.invalid/api/override', {
    method: 'POST', headers: { 'X-Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ action: 'capture_event', role: 'reviewer',
      productId: 'olp_loan', decisionAction: 'approve', aiDecision: '추출 당시 답변', humanDecision: '원문 확인 승인', reasonDetail: '보존할 승인 근거', policyRefs: ['original-policy'] }),
  }) }), 201)
  const batch = await ok(await post(context.manager, { action: 'create_sample', productId: 'olp_loan', startDate: date(), endDate: date(), size: 30 }), 201)
  const item = await context.db.prepare('SELECT * FROM quality_sample_item WHERE batch_id=? AND event_id=?').bind(batch.id, event.id).first()
  return { event, item }
}

beforeAll(async () => {
  await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;')
  for (const file of ['0000_schema.sql', '0001_execute_sql.sql', '0002_override_loop.sql', '0003_journey_workspaces.sql', '0004_audit_hardening.sql', '0005_field_feedback.sql', '0006_access_scope.sql', '0007_issue_workflow.sql']) await install(file)
  vi.stubGlobal('fetch', (target, options) => {
    if (!String(target).startsWith(`${url}/rest/v1/rpc/`)) throw Error('External call blocked')
    const task = queue.then(async () => {
      try {
        await pg.exec('SET ROLE service_role')
        const args = Object.values(JSON.parse(options.body)), name = new URL(target).pathname.split('/').at(-1)
        return Response.json((await pg.query(`SELECT public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) AS data`, args)).rows[0].data)
      } catch (error) { return Response.json({ code: error.code }, { status: 400 }) }
      finally { await pg.exec('RESET ROLE') }
    })
    queue = task.catch(() => {})
    return task
  })
  await seedOverrideWorkspace({ DB, OVERRIDE_DEMO_MODE: 'true' })
  await DB.workspaceOpen(oldToken, [])
  await seedOverrideWorkspace(demoEnv(legacyDb))
  for (const db of [DB, legacyDb]) {
    await db.prepare("INSERT INTO quality_sample_batch(id,product_id,start_at,end_at,requested_size,sample_size,eligible_count,seed,created_by) VALUES('old-batch','olp_loan','2026-01-01','2026-01-02',1,1,1,'seed','이전 담당자')").run()
    await db.prepare(`INSERT INTO quality_sample_item(id,batch_id,event_id,snapshot_json,verdict,reason,evidence_refs,reviewed_by,reviewed_at)
      VALUES('old-item','old-batch','ole_01','{"ai_decision":"기존 스냅샷"}','insufficient','이전 근거 부족','당시 확보한 근거','이전 담당자','2026-01-02 01:02:03')`).run()
  }
  await install('0008_feedback_rechecks.sql')
  await install('0009_participation_quota.sql')
  for (const [email, role, productIds] of [['owner@test.invalid', 'reviewer', '[]'], ['other@test.invalid', 'reviewer', '[]'], ['manager@test.invalid', 'product', '["olp_loan"]'], ['outsider@test.invalid', 'product', '["olp_commerce"]']])
    await DB.prepare('INSERT INTO override_actor(email,display_name,role,product_ids_json) VALUES(?,?,?,?)').bind(email, email.split('@')[0], role, productIds).run()
  await DB.workspaceOpen(newToken, [])
  await seedOverrideWorkspace(demoEnv(demoDb))
}, 60000)
afterAll(async () => { vi.unstubAllGlobals(); await pg.close() })

describe.sequential('feedback continuity in scoped PostgreSQL and private workspaces', () => {
  it('backfills exact old reviews and installs local, private append-only history in old and new demos', async () => {
    for (const db of [DB, legacyDb]) {
      expect((await db.prepare('SELECT * FROM quality_sample_review_history WHERE item_id=?').bind('old-item').all()).results).toEqual([
        { item_id: 'old-item', revision: 1, verdict: 'insufficient', reason: '이전 근거 부족', evidence_refs: '당시 확보한 근거', reviewed_by: '이전 담당자', reviewed_at: '2026-01-02 01:02:03' },
      ])
      expect(await db.readiness()).toMatchObject({ migration: '0009', schemaReady: true })
    }
    expect((await demoDb.prepare('SELECT * FROM quality_sample_review_history').all()).results).toEqual([])
    const isolation = (await pg.query("SELECT count(*)::int n FROM pg_constraint c JOIN pg_class a ON a.oid=c.conrelid JOIN pg_namespace n ON n.oid=a.relnamespace JOIN pg_class b ON b.oid=c.confrelid JOIN pg_namespace m ON m.oid=b.relnamespace WHERE c.contype='f' AND a.relname='quality_sample_review_history' AND n.nspname LIKE 'ilson_demo_%' AND n.nspname<>m.nspname")).rows[0]
    expect(isolation.n).toBe(0)
    for (const role of ['anon', 'authenticated']) expect((await pg.query("SELECT has_table_privilege($1,'public.quality_sample_review_history','SELECT') AS allowed", [role])).rows[0].allowed).toBe(false)
    expect((await pg.query("SELECT has_table_privilege('ilson_scoped_executor','public.quality_sample_review_history','UPDATE') AS allowed")).rows[0].allowed).toBe(false)
  })

  it.each(['access', 'demo'])('%s: reaches every one of 205 unread cases, including the oldest applied notice', async mode => {
    const context = contexts[mode], db = context.db
    const key = await feedbackActorKey({ mode: mode === 'demo' ? 'demo' : 'access', email: context.email })
    await db.prepare(`INSERT INTO override_event(id,product_id,reviewer_label,reviewer_role,decision_action,ai_decision,human_decision,reason_code,reason_detail,model_version,prompt_version,reporter_email)
      SELECT 'page-event-' || lpad(g::text,6,'0'),'olp_loan','제보자','reviewer','modify','기존 답변','현장 판단','unknown','페이지 점검 ' || g,'v1','p1',? FROM generate_series(1,205) g`).bind(context.email).run()
    await db.prepare(`INSERT INTO field_feedback_case(id,event_id,reporter_key,created_at)
      SELECT 'page-case-' || lpad(g::text,6,'0'),'page-event-' || lpad(g::text,6,'0'),?,'2026-01-01 00:00:00' FROM generate_series(1,205) g`).bind(key).run()
    await db.prepare(`INSERT INTO field_feedback_update(id,case_id,kind,body,effective_on,actor_label)
      SELECT 'page-update-' || lpad(g::text,6,'0'),'page-case-' || lpad(g::text,6,'0'),'applied','현장 확인을 기다리는 안내',?,'담당자' FROM generate_series(1,205) g`).bind(date()).run()
    let cursor = '', sizes = [], ids = [], oldest
    do {
      const page = await ok(await get(context.owner, cursor))
      sizes.push(page.cases.length); ids.push(...page.cases.map(item => item.id))
      expect(page.unread).toBe(205)
      expect(page.cases.every(item => item.is_mine && item.updates.length === 1)).toBe(true)
      oldest = page.cases.at(-1)
      cursor = page.casePage.nextCursor
      expect(page.casePage.hasMore).toBe(Boolean(cursor))
    } while (cursor)
    expect(sizes).toEqual([100, 100, 5]); expect(new Set(ids).size).toBe(205)
    expect(oldest.id).toBe('page-case-000001')
    expect((await ok(await get(context.other))).cases).toEqual([])
    const updateId = oldest.updates[0].id
    expect((await post(context.other, { action: 'read_update', updateId })).status).toBe(404)
    await ok(await post(context.owner, { action: 'read_update', updateId }))
    await ok(await post(context.owner, { action: 'confirm_update', updateId, verdict: 'not_resolved', note: '오래된 제보도 개선되지 않았습니다.' }))
    expect((await ok(await get(context.owner))).unread).toBe(204)
    expect((await db.prepare('SELECT * FROM issue_followup WHERE source_id=?').bind(updateId).all()).results).toHaveLength(1)
  })

  it('rejects malformed page cursors rather than interpolating them into SQL', async () => {
    for (const cursor of ['not-base64', btoa(JSON.stringify(['not-a-date', "' OR true --"]))]) expect((await get(contexts.access.owner, cursor)).status).toBe(400)
  })

  it.each(['access', 'demo'])('%s: preserves insufficient reviews, snapshot and final issue; retry creates only one task', async mode => {
    const context = contexts[mode], { event, item } = await sampleFor(context)
    const first = { action: 'review_sample', itemId: item.id, verdict: 'insufficient', reason: '초기 정책 원문 없음', evidenceRefs: '' }
    await ok(await post(context.manager, first))
    const original = await context.db.prepare('SELECT * FROM quality_sample_review_history WHERE item_id=?').bind(item.id).first()
    expect(original).toMatchObject({ revision: 1, verdict: 'insufficient', reason: first.reason, evidence_refs: '', reviewed_by: mode === 'access' ? 'manager' : '공개 시연 사용자' })
    expect(original.reviewed_at).toBeTruthy()
    await ok(await post(context.manager, { ...first, reason: '부분 근거만 확보', evidenceRefs: '정책 초안' }))
    const review = { ...first, verdict: 'issue', reason: '최종 정책과 답변 불일치', evidenceRefs: '승인된 정책 3조' }, requestId = crypto.randomUUID()
    for (const response of await Promise.all([post(context.manager, review, requestId), post(context.manager, review, requestId)])) await ok(response)
    expect((await post(context.manager, { ...review, verdict: 'correct' })).status).toBe(409)
    expect((await post(context.manager, { ...review, verdict: 'insufficient' })).status).toBe(409)
    const history = (await context.db.prepare('SELECT * FROM quality_sample_review_history WHERE item_id=? ORDER BY revision').bind(item.id).all()).results
    expect(history).toHaveLength(3); expect(history[0]).toEqual(original)
    expect(history.map(row => row.verdict)).toEqual(['insufficient', 'insufficient', 'issue'])
    expect(history.map(row => row.evidence_refs)).toEqual(['', '정책 초안', '승인된 정책 3조'])
    const stored = await context.db.prepare('SELECT * FROM quality_sample_item WHERE id=?').bind(item.id).first()
    expect(stored.snapshot_json).toBe(item.snapshot_json)
    expect((await context.db.prepare('SELECT decision_action,is_override FROM override_event WHERE id=?').bind(event.id).first())).toEqual({ decision_action: 'approve', is_override: 0 })
    expect((await context.db.prepare('SELECT * FROM issue_followup WHERE source_kind=? AND source_id=?').bind('quality_sample', item.id).all()).results).toHaveLength(1)
    const visible = (await ok(await get(context.manager, '', 'product'))).samples.find(sample => sample.id === item.id)
    expect(visible.review_history).toEqual(history)
    expect(visible.followup).toMatchObject({ source_id: item.id, evidence_refs: review.evidenceRefs })
    expect((await post(context.other, review)).status).toBe(mode === 'demo' ? 404 : 403)
    if (mode === 'access') {
      expect((await ok(await get(realEnv('outsider@test.invalid'), '', 'product'))).samples).toEqual([])
      expect((await DB.forActor('outsider@test.invalid').prepare('SELECT * FROM quality_sample_review_history WHERE item_id=?').bind(item.id).all()).results).toEqual([])
    }
    await expect(context.db.prepare('UPDATE quality_sample_item SET snapshot_json=? WHERE id=?').bind('{}', item.id).run()).rejects.toThrow('/23514')
    await expect(context.db.prepare('UPDATE quality_sample_item SET verdict=? WHERE id=?').bind('correct', item.id).run()).rejects.toThrow('/23514')
    await expect(context.db.prepare('DELETE FROM quality_sample_review_history WHERE item_id=?').bind(item.id).run()).rejects.toThrow()
  })

  it.each(['access', 'demo'])('%s: conflicting final rechecks serialize and a correct verdict cannot be overwritten', async mode => {
    const context = contexts[mode], { item } = await sampleFor(context)
    const review = { action: 'review_sample', itemId: item.id, verdict: 'insufficient', reason: '추가 근거 요청', evidenceRefs: '' }
    await ok(await post(context.manager, review))
    const responses = await Promise.all([post(context.manager, { ...review, verdict: 'correct', reason: '동일 입력 확인 A', evidenceRefs: '검증 기록 A' }), post(context.manager, { ...review, verdict: 'correct', reason: '동일 입력 확인 B', evidenceRefs: '검증 기록 B' })])
    expect(responses.map(response => response.status).sort()).toEqual([200, 409])
    expect((await context.db.prepare('SELECT * FROM quality_sample_review_history WHERE item_id=?').bind(item.id).all()).results).toHaveLength(2)
    expect((await post(context.manager, { ...review, verdict: 'issue', evidenceRefs: '변경 시도' })).status).toBe(409)
    expect((await context.db.prepare('SELECT * FROM issue_followup WHERE source_id=?').bind(item.id).all()).results).toHaveLength(0)
  })

  it.each(['access', 'demo'])('%s: reaches and rechecks an insufficient sample beyond the latest 50 batches', async mode => {
    const context = contexts[mode], { item } = await sampleFor(context)
    await ok(await post(context.manager, { action: 'review_sample', itemId: item.id, verdict: 'insufficient', reason: '오래된 표본 추가 근거 대기', evidenceRefs: '' }))
    await context.db.prepare("UPDATE quality_sample_batch SET created_at='2000-01-01 00:00:00' WHERE id=?").bind(item.batch_id).run()
    await context.db.prepare(`INSERT INTO override_event(id,product_id,reviewer_label,reviewer_role,decision_action,is_override,ai_decision,human_decision,reason_code,reason_detail,model_version,prompt_version,reporter_email)
      SELECT 'batch-event-' || g,'olp_loan','제보자','reviewer','approve',0,'보존 답변','승인','unknown','묶음 페이지 점검','v1','p1',? FROM generate_series(1,50) g`).bind(context.email).run()
    await context.db.prepare(`INSERT INTO quality_sample_batch(id,product_id,start_at,end_at,requested_size,sample_size,eligible_count,seed,created_by,created_at)
      SELECT 'page-batch-' || lpad(g::text,4,'0'),'olp_loan','2026-01-01','2026-01-02',1,1,1,'seed','담당자','2026-01-02 00:00:00' FROM generate_series(1,50) g`).run()
    await context.db.prepare(`INSERT INTO quality_sample_item(id,batch_id,event_id,snapshot_json)
      SELECT 'page-sample-' || g,'page-batch-' || lpad(g::text,4,'0'),'batch-event-' || g,'{"ai_decision":"보존 답변","human_decision":"승인"}' FROM generate_series(1,50) g`).run()
    let page = await ok(await get(context.manager, '', 'product')), pageCount = 1
    expect(page.batches).toHaveLength(50)
    expect(page.samples.some(sample => sample.id === item.id)).toBe(false)
    const firstCases = page.cases.map(entry => entry.id)
    while (page.batchPage.hasMore) {
      page = await ok(await get(context.manager, '', 'product', page.batchPage.nextCursor)); pageCount++
      expect(page.cases.map(entry => entry.id)).toEqual(firstCases)
      if (page.samples.some(sample => sample.id === item.id)) break
    }
    expect(pageCount).toBeGreaterThan(1)
    const old = page.samples.find(sample => sample.id === item.id)
    expect(old).toMatchObject({ verdict: 'insufficient', reason: '오래된 표본 추가 근거 대기' })
    await ok(await post(context.manager, { action: 'review_sample', itemId: old.id, verdict: 'correct', reason: '뒤늦게 확보한 원문과 일치', evidenceRefs: '확정 정책 원문' }))
    expect((await context.db.prepare('SELECT verdict FROM quality_sample_review_history WHERE item_id=? ORDER BY revision').bind(item.id).all()).results).toEqual([{ verdict: 'insufficient' }, { verdict: 'correct' }])
    expect((await get(context.manager, '', 'product', 'broken-cursor')).status).toBe(400)
  })
})
