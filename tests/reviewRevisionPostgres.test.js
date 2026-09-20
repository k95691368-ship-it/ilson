// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { createSupabaseDb } from '../functions/_lib/dbBridge.js'
import { onRequestPost as review } from '../functions/api/applications/[id]/review.js'
import { onRequestPost as bulk } from '../functions/api/applications/bulk.js'
import { onRequestGet as retryInfo, onRequestPost as retry } from '../functions/api/track/[ticket]/resubmit.js'
import { onRequestGet as detail } from '../functions/api/applications/[id]/index.js'
import { onRequestGet as list } from '../functions/api/applications/index.js'
import { onRequestPost as build } from '../functions/api/applications/[id]/build.js'
import { onRequestPost as accept } from '../functions/api/tools/[slug]/accept.js'

const pg = new PGlite(), base = 'https://review-test.supabase.co'
const rootDB = createSupabaseDb(base, 'memory-only')
const token = 'a'.repeat(64), otherToken = 'b'.repeat(64)
const demoDB = createSupabaseDb(base, 'memory-only', token)
const otherDemo = createSupabaseDb(base, 'memory-only', otherToken)
const actor = 'reviewer@local.invalid', owner = 'owner@local.invalid'
const staffDB = rootDB.forActor(actor), ownerDB = rootDB.forActor(owner)
let queue = Promise.resolve(), beforeCommit = null, seenWrites = []
const env = DB => ({ DB, ...(DB.workspace ? { DEMO_WORKSPACE: true } : {}) })
const request = (path, body, key = crypto.randomUUID()) => new Request('https://local.invalid/api/' + path, {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': key }, body: JSON.stringify(body),
})
const verdict = (expectedRevision, which = '수용') => ({ expectedRevision, impact_score: 3, impact_reason: '현재 반복 업무가 확인되었습니다.',
  difficulty_score: 2, difficulty_reason: '정형 파일만 처리합니다.', verdict: which, verdict_reason: '실제 요청 범위와 권한을 확인했습니다.',
  alternatives_considered: '수작업 유지와 파일 자동화를 비교했습니다.', reviewer_label: '검토자',
  refuse_code: which === '반려' ? 'external_write' : '', refuse_alternative: which === '반려' ? '외부 등록 대신 파일까지만 만듭니다.' : '',
  hold_until_condition: which === '보류' ? '자료와 담당 권한이 준비되면 다시 봅니다.' : '',
})
const app = (DB, id) => DB.prepare('SELECT id,status,review_revision FROM application WHERE id=?').bind(id).first()
const postReview = (DB, id, body, key) => review({ env: env(DB), params: { id }, request: request(`applications/${id}/review`, body, key) })
const postBulk = (DB, body, key) => bulk({ env: env(DB), request: request('applications/bulk', body, key) })
const postRetry = (DB, id, revision, key) => retry({ env: env(DB), params: { ticket: id.toUpperCase() }, request: request(`track/${id}/resubmit`, { expectedRevision: revision, changed: '외부 등록 대신 확인된 파일 생성만 요청하겠습니다.' }, key) })
const insert = (DB, id, status = '접수', who = null, dept = '재무') => DB.prepare("INSERT INTO application(id,ticket_no,dept,applicant_label,title,bottleneck,problem,status,owner_email) VALUES(?,?,?,'신청자','반복 파일 처리','자료 취합','반복 자료 취합에 시간이 걸립니다.',?,?)").bind(id, id.toUpperCase(), dept, status, who).run()
const auditCount = async (DB, id) => Number((await DB.prepare("SELECT count(*) n FROM decision_log WHERE application_id=? AND link_kind='review'").bind(id).first()).n)

beforeAll(async () => {
  await pg.exec('CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;')
  const dir = new URL('../supabase/migrations/', import.meta.url)
  const migrations = readdirSync(dir).filter(file => /^\d+.*\.sql$/.test(file)).sort()
  for (const file of migrations) {
    if (file.startsWith('0013_')) await pg.query('SELECT public.ilson_workspace_open($1,$2)', [token, []])
    await pg.exec(readFileSync(new URL(file, dir), 'utf8'))
  }
  vi.stubGlobal('fetch', (url, options) => {
    if (!String(url).startsWith(base + '/rest/v1/rpc/')) throw Error('External network blocked')
    const result = queue.then(async () => {
      try {
        const name = new URL(url).pathname.split('/').at(-1), body = JSON.parse(options.body)
        if (['ilson_actor_commit', 'ilson_commit_mutation'].includes(name)) {
          seenWrites = body.p_writes
          if (beforeCommit) { const hook = beforeCommit; beforeCommit = null; await hook() }
        }
        await pg.exec('SET ROLE service_role')
        const values = Object.values(body)
        return Response.json((await pg.query(`SELECT public.${name}(${values.map((_, i) => '$' + (i + 1)).join(',')}) data`, values)).rows[0].data)
      } catch (error) { return Response.json({ code: error.code }, { status: 400 }) }
      finally { await pg.exec('RESET ROLE') }
    })
    queue = result.catch(() => {})
    return result
  })
  await rootDB.workspaceOpen(otherToken, [])
  await rootDB.prepare("INSERT INTO override_actor(email,display_name,role,departments_json) VALUES(?,'검토자','product','[\"재무\"]'),(?,'신청자','reviewer','[\"재무\"]')").bind(actor, owner).run()
}, 60000)
afterAll(async () => { vi.unstubAllGlobals(); await pg.close() })

describe.sequential('review revisions and lifecycle writes', () => {
  it('installs on existing and newly opened demo spaces and includes readiness', async () => {
    for (const DB of [rootDB, demoDB, otherDemo]) {
      expect(await DB.readiness()).toMatchObject({ migration: '0013', schemaReady: true })
      await insert(DB, 'installation')
      expect((await app(DB, 'installation')).review_revision).toBe(0)
      await DB.prepare("UPDATE application SET status='검토중' WHERE id='installation'").run()
      expect((await app(DB, 'installation')).review_revision).toBe(1)
    }
  })
  it.each([['demo', demoDB], ['access', staffDB]])('%s rejects an older verdict while retaining both valid decisions', async (mode, DB) => {
    const id = `edit-${mode}`
    await insert(mode === 'access' ? rootDB : DB, id, '접수', owner)
    expect((await postReview(DB, id, verdict(0))).status).toBe(200)
    const stale = (await app(DB, id)).review_revision
    expect((await postReview(DB, id, verdict(stale, '반려'))).status).toBe(200)
    const count = await auditCount(DB, id)
    expect((await postReview(DB, id, { ...verdict(stale), impact_score: 5 })).status).toBe(409)
    expect((await app(DB, id)).status).toBe('반려')
    expect(await auditCount(DB, id)).toBe(count)
    expect((await DB.prepare('SELECT verdict FROM review WHERE application_id=?').bind(id).first()).verdict).toBe('반려')
    expect(seenWrites[0]).toContain('ilson_lock_review_revision')
  })
  it('detects same-second evidence changes, missing tokens and noninteger tokens', async () => {
    const id = 'same-second'; await insert(demoDB, id)
    await postReview(demoDB, id, verdict(0))
    const stale = (await app(demoDB, id)).review_revision
    const prior = await demoDB.prepare('SELECT updated_at FROM review WHERE application_id=?').bind(id).first()
    await demoDB.prepare('UPDATE review SET verdict_reason=?,updated_at=? WHERE application_id=?').bind('새로 확인된 권한 제한', prior.updated_at, id).run()
    expect((await postReview(demoDB, id, verdict(stale))).status).toBe(409)
    for (const value of [undefined, null, '2', -1, 1.2]) expect((await postReview(demoDB, id, verdict(value))).status).toBe(409)
  })
  it.each(['진행중', '완료'])('keeps %s after fresh accepted edits and rejects old or backward verdicts', async status => {
    const id = `stage-${status}`; await insert(demoDB, id)
    await postReview(demoDB, id, verdict(0))
    const stale = (await app(demoDB, id)).review_revision
    await demoDB.prepare('UPDATE application SET status=? WHERE id=?').bind(status, id).run()
    expect((await postReview(demoDB, id, verdict(stale))).status).toBe(409)
    const fresh = (await app(demoDB, id)).review_revision
    for (const which of ['반려', '보류']) expect((await postReview(demoDB, id, verdict(fresh, which))).status).toBe(409)
    expect((await postReview(demoDB, id, { ...verdict(fresh), verdict_reason: '진행 상태를 유지하고 근거를 보완했습니다.' })).status).toBe(200)
    expect((await app(demoDB, id)).status).toBe(status)
  })
  it('replays a lost response once and conflicts on reusing its key for changed content', async () => {
    const id = 'receipt'; await insert(demoDB, id)
    const key = crypto.randomUUID(), body = verdict(0)
    const first = await postReview(demoDB, id, body, key), saved = await app(demoDB, id)
    const replay = await postReview(demoDB, id, body, key)
    expect(first.status).toBe(200); expect(replay.status).toBe(200)
    expect(replay.headers.get('X-Idempotency-Replayed')).toBe('1')
    expect(await app(demoDB, id)).toEqual(saved)
    expect(await auditCount(demoDB, id)).toBe(1)
    expect((await postReview(demoDB, id, { ...body, impact_score: 5 }, key)).status).toBe(409)
  })
  it('rejects an initial review that changed after its read, without a partial audit', async () => {
    const id = 'interleaved'; await insert(rootDB, id, '접수', owner)
    beforeCommit = () => pg.exec("UPDATE application SET status='완료' WHERE id='interleaved'")
    expect((await postReview(staffDB, id, verdict(0))).status).toBe(409)
    expect((await app(staffDB, id)).status).toBe('완료')
    expect(await auditCount(staffDB, id)).toBe(0)
    expect(await staffDB.prepare('SELECT verdict FROM review WHERE application_id=?').bind(id).first()).toBeNull()
  })
  it('enforces the row guard even after an earlier read check, and does not expose other scopes', async () => {
    await expect(demoDB.prepare('SELECT public.ilson_lock_review_revision(?,?)').bind('installation', 0).all()).rejects.toThrow('/40001')
    await insert(rootDB, 'foreign', '접수', 'foreign@local.invalid', '영업')
    expect((await postReview(staffDB, 'foreign', verdict(0))).status).toBe(404)
    expect((await postReview(otherDemo, 'same-second', verdict(0))).status).toBe(404)
    await expect(staffDB.prepare('SELECT public.ilson_lock_review_revision(?,?)').bind('foreign', 0).all()).rejects.toThrow('/40001')
    const rights = (await pg.query("SELECT has_function_privilege('anon','public.ilson_lock_review_revision(text,bigint)','EXECUTE') anon,has_function_privilege('authenticated','public.ilson_lock_review_revision(text,bigint)','EXECUTE') authenticated")).rows[0]
    expect(rights).toEqual({ anon: false, authenticated: false })
  })
  it('returns captured revision in both detail and bulk-list APIs', async () => {
    const response = await detail({ env: env(staffDB), params: { id: 'edit-access' } })
    expect((await response.json()).application.review_revision).toBeGreaterThan(0)
    const listed = await list({ env: env(staffDB), request: new Request('https://local.invalid/api/applications') })
    const data = await listed.json()
    expect(data.items.find(row => row.id === 'edit-access').review_revision).toBeGreaterThan(0)
  })
  it('observes actual build and acceptance handler state transitions, not only direct SQL changes', async () => {
    const id = 'real-transitions'; await insert(demoDB, id)
    await postReview(demoDB, id, verdict(0))
    const original = (await app(demoDB, id)).review_revision
    const built = await build({ env: env(demoDB), params: { id }, request: request(`applications/${id}/build`, {
      kind: 'run', rows: [{ date: '2026-09-19', iso_week: '2026-W38', sku: 'SKU-1', channel: 'A', qty: 1, sales: 10000 }],
    }) })
    expect(built.status, await built.clone().text()).toBe(201)
    expect((await app(demoDB, id)).status).toBe('진행중')
    expect((await postReview(demoDB, id, verdict(original))).status).toBe(409)
    const working = (await app(demoDB, id)).review_revision
    await demoDB.prepare("INSERT INTO handover(application_id,slug,title,handed_to_dept,handed_to_person) VALUES(?,?,?,'재무','신청자')").bind(id, id, '실제 인수 도구').run()
    const accepted = await accept({ env: env(demoDB), params: { slug: id }, request: request(`tools/${id}/accept`, { by: '재무 직원' }) })
    expect(accepted.status, await accepted.clone().text()).toBe(200)
    expect((await app(demoDB, id)).status).toBe('완료')
    expect((await postReview(demoDB, id, verdict(working))).status).toBe(409)
  })
  it('lets only one of two different simultaneous decisions commit', async () => {
    const id = 'concurrent-review'; await insert(demoDB, id)
    const results = await Promise.all([postReview(demoDB, id, verdict(0)), postReview(demoDB, id, verdict(0, '반려'))])
    expect(results.map(response => response.status).sort()).toEqual([200, 409])
    expect(await auditCount(demoDB, id)).toBe(1)
  })
  it('rolls back the review and revision if its required audit fails', async () => {
    const id = 'audit-failure'; await insert(rootDB, id, '접수', owner)
    await pg.exec("CREATE FUNCTION public.test_review_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.application_id='audit-failure' THEN RAISE EXCEPTION 'Test audit failure';END IF;RETURN NEW;END $$;CREATE TRIGGER test_review_audit_failure BEFORE INSERT ON public.decision_log FOR EACH ROW EXECUTE FUNCTION public.test_review_audit_failure();")
    const key = crypto.randomUUID()
    try {
      expect((await postReview(staffDB, id, verdict(0), key)).status).toBe(503)
      expect(await app(staffDB, id)).toMatchObject({ status: '접수', review_revision: 0 })
      expect(await staffDB.prepare('SELECT verdict FROM review WHERE application_id=?').bind(id).first()).toBeNull()
    } finally { await pg.exec('DROP TRIGGER test_review_audit_failure ON public.decision_log;DROP FUNCTION public.test_review_audit_failure();') }
    expect((await postReview(staffDB, id, verdict(0), key)).status).toBe(200)
  })
})

describe.sequential('bulk and resubmission share the same review boundary', () => {
  it('does not bulk-hold an item reviewed after its checkbox snapshot, even with other eligible items', async () => {
    for (const id of ['bulk-a', 'bulk-b']) await insert(demoDB, id)
    await postReview(demoDB, 'bulk-a', verdict(0))
    const response = await postBulk(demoDB, { action: 'hold', ids: ['bulk-a', 'bulk-b'], expectedRevisions: { 'bulk-a': 0, 'bulk-b': 0 }, reason: '입력 자료가 준비되면 검토합니다.' })
    expect(response.status).toBe(409)
    expect((await app(demoDB, 'bulk-a')).status).toBe('수용')
    expect((await app(demoDB, 'bulk-b')).status).toBe('접수')
  })
  it('keeps valid partial skip semantics and writes eligible parents under locks', async () => {
    await insert(demoDB, 'bulk-good'); await insert(demoDB, 'bulk-finished', '완료')
    const response = await postBulk(demoDB, { action: 'hold', ids: ['bulk-good', 'bulk-finished'], expectedRevisions: { 'bulk-good': 0, 'bulk-finished': 0 }, reason: '다시 처리할 입력 자료를 기다립니다.' })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ done: ['BULK-GOOD'], skipped: [{ ticket_no: 'BULK-FINISHED' }] })
    expect((await app(demoDB, 'bulk-good')).status).toBe('보류')
    expect(seenWrites[0]).toContain('ilson_lock_review_revision')
  })
  it('rolls back the whole bulk when a valid item advances after the server read', async () => {
    for (const id of ['bulk-race-a', 'bulk-race-b']) await insert(rootDB, id, '접수', owner)
    beforeCommit = () => pg.exec("UPDATE application SET status='수용' WHERE id='bulk-race-a'")
    const response = await postBulk(staffDB, { action: 'hold', ids: ['bulk-race-b', 'bulk-race-a'], expectedRevisions: { 'bulk-race-a': 0, 'bulk-race-b': 0 }, reason: '필요 자료가 도착하면 검토합니다.' })
    expect(response.status).toBe(409)
    expect((await app(staffDB, 'bulk-race-a')).status).toBe('수용')
    expect((await app(staffDB, 'bulk-race-b')).status).toBe('접수')
  })
  it.each([['demo', demoDB], ['access', ownerDB]])('%s creates a retry and both links exactly once, invalidating earlier parent views', async (mode, DB) => {
    const id = `retry-${mode}`, writer = mode === 'access' ? staffDB : DB
    await insert(mode === 'access' ? rootDB : DB, id, '접수', owner)
    await postReview(writer, id, verdict(0, '반려'))
    const original = (await app(DB, id)).review_revision
    const info = await retryInfo({ env: env(DB), params: { ticket: id.toUpperCase() } })
    expect((await info.json()).previous).toMatchObject({ review_revision: original, status: '반려', verdict: '반려' })
    const key = crypto.randomUUID(), first = await postRetry(DB, id, original, key)
    expect(first.status, await first.clone().text()).toBe(201)
    const saved = await first.json()
    expect((await postRetry(DB, id, original, key)).status).toBe(201)
    expect((await postRetry(DB, id, original)).status).toBe(409)
    expect((await DB.prepare("SELECT id FROM decision_log WHERE application_id=? AND link_kind='재신청됨'").bind(id).all()).results).toHaveLength(1)
    expect((await DB.prepare("SELECT id FROM decision_log WHERE application_id=? AND link_kind='재신청'").bind(saved.id).all()).results).toHaveLength(1)
    expect((await postReview(writer, id, verdict(original))).status).toBe(409)
    expect((await app(DB, id)).status).toBe('반려')
    if (mode === 'access') expect((await rootDB.prepare('SELECT owner_email FROM application WHERE id=?').bind(saved.id).first()).owner_email).toBe(owner)
  })
  it('rejects retry when the parent changes after eligibility check, without a child or orphan links', async () => {
    const id = 'retry-race'; await insert(rootDB, id, '접수', owner)
    await postReview(staffDB, id, verdict(0, '반려'))
    const revision = (await app(ownerDB, id)).review_revision
    const count = Number((await rootDB.prepare('SELECT count(*) n FROM application').first()).n)
    beforeCommit = () => pg.exec("UPDATE application SET status='수용' WHERE id='retry-race';UPDATE review SET verdict='수용' WHERE application_id='retry-race'")
    expect((await postRetry(ownerDB, id, revision)).status).toBe(409)
    expect(Number((await rootDB.prepare('SELECT count(*) n FROM application').first()).n)).toBe(count)
    expect((await rootDB.prepare("SELECT id FROM decision_log WHERE application_id=? AND link_kind='재신청됨'").bind(id).all()).results).toHaveLength(0)
  })
  it('enforces the existing two-retry limit across explicitly refreshed parent snapshots', async () => {
    const id = 'retry-limit'; await insert(demoDB, id)
    await postReview(demoDB, id, verdict(0, '반려'))
    for (let i = 0; i < 2; i++) {
      const revision = (await app(demoDB, id)).review_revision
      expect((await postRetry(demoDB, id, revision)).status).toBe(201)
    }
    expect((await postRetry(demoDB, id, (await app(demoDB, id)).review_revision)).status).toBe(409)
    expect((await demoDB.prepare("SELECT id FROM decision_log WHERE application_id=? AND link_kind='재신청됨'").bind(id).all()).results).toHaveLength(2)
  })
  it('does not leave a child or its first link when the parent resubmission link fails', async () => {
    const id = 'retry-audit-failure'; await insert(rootDB, id, '접수', owner)
    await postReview(staffDB, id, verdict(0, '반려'))
    const original = await app(ownerDB, id)
    const count = Number((await rootDB.prepare('SELECT count(*) n FROM application').first()).n)
    await pg.exec("CREATE FUNCTION public.test_retry_link_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.application_id='retry-audit-failure' AND NEW.link_kind='재신청됨' THEN RAISE EXCEPTION 'Test retry link failure';END IF;RETURN NEW;END $$;CREATE TRIGGER test_retry_link_failure BEFORE INSERT ON public.decision_log FOR EACH ROW EXECUTE FUNCTION public.test_retry_link_failure();")
    const key = crypto.randomUUID()
    try {
      expect((await postRetry(ownerDB, id, original.review_revision, key)).status).toBe(503)
      expect(Number((await rootDB.prepare('SELECT count(*) n FROM application').first()).n)).toBe(count)
      expect(await app(ownerDB, id)).toEqual(original)
      expect((await rootDB.prepare("SELECT id FROM decision_log WHERE link_id=? AND link_kind='재신청'").bind(id).all()).results).toHaveLength(0)
    } finally { await pg.exec('DROP TRIGGER test_retry_link_failure ON public.decision_log;DROP FUNCTION public.test_retry_link_failure();') }
    expect((await postRetry(ownerDB, id, original.review_revision, key)).status).toBe(201)
  })
})
