// @vitest-environment node
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { createSupabaseDb } from '../functions/_lib/dbBridge.js'
import { seedOverrideWorkspace } from '../functions/_lib/override.js'
import { onRequestPost as capture } from '../functions/api/override.js'
import { onRequestPost as mutate, onRequestGet as list } from '../functions/api/feedback.js'
import { validDate, qualitySummary } from '../shared/fieldFeedback.js'
vi.mock('../functions/_lib/access.js', () => ({ verifiedAccessEmail: async env => env.TEST_EMAIL || null }))
const pg = new PGlite()
const DB = createSupabaseDb('https://feedback-test.supabase.co', 'test-only')
const root = { DB, OVERRIDE_DEMO_MODE: 'false' }
const env = email => ({ ...root, TEST_EMAIL: email })
let queue = Promise.resolve()
beforeAll(async () => {
  await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;')
  for (const file of ['0000_schema.sql','0001_execute_sql.sql','0002_override_loop.sql','0003_journey_workspaces.sql','0004_audit_hardening.sql','0005_field_feedback.sql'])
    await pg.exec(readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'))
  vi.stubGlobal('fetch', (url, options) => {
    if (!String(url).startsWith('https://feedback-test.supabase.co/rest/v1/rpc/')) throw Error('External call blocked')
    const result = queue.then(async () => {
      try {
        await pg.exec('SET ROLE service_role')
        const args = Object.values(JSON.parse(options.body))
        const name = new URL(url).pathname.split('/').at(-1)
        return Response.json((await pg.query(`SELECT public.${name}(${args.map((_,i) => '$'+(i+1)).join(',')}) AS data`, args)).rows[0].data)
      } catch (error) { return Response.json({ code: error.code }, { status: 400 }) }
      finally { await pg.exec('RESET ROLE') }
    })
    queue = result.catch(() => {})
    return result
  })
  await seedOverrideWorkspace({ DB, OVERRIDE_DEMO_MODE: 'true' })
  for (const [email, role] of [['owner@test.invalid','reviewer'],['other@test.invalid','reviewer'],['manager@test.invalid','product'],['audit@test.invalid','audit']])
    await DB.prepare('INSERT INTO override_actor(email,display_name,role) VALUES(?,?,?)').bind(email,email.split('@')[0],role).run()
},60000)
afterAll(async () => { vi.unstubAllGlobals(); await pg.close() })
const post = (body, email='manager@test.invalid', key=crypto.randomUUID(), bindings) => mutate({ env: bindings ?? env(email), request: new Request('https://test.invalid/api/feedback', { method:'POST', headers:{'X-Idempotency-Key':key}, body:JSON.stringify(body) }) })
const get = (email='owner@test.invalid', bindings) => list({ env:bindings ?? env(email), request:new Request('https://test.invalid/api/feedback?role=product') })
const record = (decisionAction='modify', bindings=env('owner@test.invalid')) => capture({ env:bindings, request:new Request('https://test.invalid/api/override', {method:'POST',headers:{'X-Idempotency-Key':crypto.randomUUID()},body:JSON.stringify({action:'capture_event',productId:'olp_loan',decisionAction,aiDecision:'기존 내규에 따른 답변',humanDecision:'원본 문서를 확인한 판단',reasonDetail:'새 내규를 반영해야 합니다.',policyRefs:['policy-local-1']})}) })
async function ok(response, status=201) { expect(response.status,JSON.stringify(await response.clone().json())).toBe(status); return response.json() }
let caseId, updateId
describe.sequential('field feedback: real PostgreSQL and authenticated handlers', () => {
  it('validates calendar dates and keeps sample counts explicit', () => {
    expect(validDate('2026-02-30')).toBe(false); expect(validDate('2024-02-29')).toBe(true)
    expect(qualitySummary([{verdict:'issue'},{verdict:'insufficient'},{}])).toEqual({selected:3,reviewed:2,issues:1,insufficient:1})
  })
  it('requires authentication and creates an owner-linked case atomically with the event', async () => {
    expect((await get(null)).status).toBe(401)
    const saved = await ok(await record())
    const mine = await ok(await get(),200)
    expect(mine.cases).toHaveLength(1); caseId = mine.cases[0].id
    expect(mine.cases[0]).toMatchObject({event_id:saved.id,is_mine:true,updates:[]})
    expect(JSON.stringify(mine)).not.toContain('reporter_key')
    expect((await ok(await get('other@test.invalid'),200)).cases).toHaveLength(0)
    expect((await ok(await get('manager@test.invalid'),200)).cases).toHaveLength(1)
  })
  it('does not trust a client role; applied notices require date and actual-application attestation', async () => {
    const body = {action:'publish_update',caseId,kind:'applied',message:'검색 정책을 적용했습니다.',effectiveOn:new Date().toISOString().slice(0,10)}
    expect((await post({...body,role:'product',confirmedApplied:true},'other@test.invalid')).status).toBe(403)
    expect((await post(body)).status).toBe(400)
    expect((await post({...body,confirmedApplied:true,effectiveOn:'2099-01-01'})).status).toBe(400)
    const key=crypto.randomUUID()
    updateId=(await ok(await post({...body,confirmedApplied:true},undefined,key))).id
    expect((await ok(await post({...body,confirmedApplied:true},undefined,key))).id).toBe(updateId)
    expect((await post({...body,confirmedApplied:true,message:'다른 본문'},undefined,key)).status).toBe(409)
    expect((await ok(await get(),200)).unread).toBe(1)
  })
  it('only the reporter can mark read and confirm, and untested may be revisited', async () => {
    const read={action:'read_update',updateId}
    expect((await post(read,'other@test.invalid')).status).toBe(404)
    expect((await post(read,'manager@test.invalid')).status).toBe(404)
    await ok(await post(read,'owner@test.invalid'),200)
    expect((await ok(await get(),200)).unread).toBe(0)
    const confirm={action:'confirm_update',updateId,verdict:'not_resolved',note:''}
    expect((await post(confirm,'owner@test.invalid')).status).toBe(400)
    await ok(await post({...confirm,verdict:'untested'},'owner@test.invalid'),200)
    await ok(await post({...confirm,verdict:'resolved'},'owner@test.invalid'),200)
    expect((await post({...confirm,note:'변경 시도'},'owner@test.invalid')).status).toBe(409)
    expect((await ok(await get(),200)).cases[0].updates[0].verdict).toBe('resolved')
  })
  it('samples only recorded approvals once, preserving evidence snapshots and denominators', async () => {
    const first=await ok(await record('approve')), second=await ok(await record('approve'))
    const date=new Date().toISOString().slice(0,10)
    const body={action:'create_sample',productId:'olp_loan',startDate:date,endDate:date,size:30}
    expect((await post(body,'owner@test.invalid')).status).toBe(403)
    expect((await post({...body,size:31})).status).toBe(400)
    const batch=await ok(await post(body))
    const snapshot=await ok(await get('manager@test.invalid'),200)
    expect(snapshot.batches[0]).toMatchObject({id:batch.id,eligible_count:2,sample_size:2,requested_size:30})
    expect(snapshot.samples.map(s=>s.event_id).sort()).toEqual([first.id,second.id].sort())
    expect((await post(body)).status).toBe(400)
    const item=snapshot.samples[0]
    await DB.prepare('UPDATE override_event SET ai_decision=? WHERE id=?').bind('나중에 바뀐 기록',item.event_id).run()
    expect((await ok(await get('audit@test.invalid'),200)).samples[0].snapshot.ai_decision).toBe('기존 내규에 따른 답변')
    const review={action:'review_sample',itemId:item.id,verdict:'issue',reason:'현재 정책과 다릅니다.',evidenceRefs:''}
    expect((await post(review)).status).toBe(400)
    await ok(await post({...review,evidenceRefs:'원본 정책 1조'},'audit@test.invalid'),200)
    expect((await post({...review,evidenceRefs:'다른 근거'})).status).toBe(409)
    expect((await ok(await get(),200)).samples).toHaveLength(0)
    expect((await ok(await get(),200)).cases).toHaveLength(1)
  })
  it('stores voluntary non-use reasons privately and returns aggregate response counts', async () => {
    const body={action:'record_nonuse',productId:'olp_loan',usageState:'paused',reason:'other',occurredOn:new Date().toISOString().slice(0,10),note:''}
    expect((await post(body,'owner@test.invalid')).status).toBe(400)
    const key=crypto.randomUUID()
    await ok(await post({...body,note:'내 업무 양식에 맞지 않습니다.'},'owner@test.invalid',key))
    await ok(await post({...body,note:'내 업무 양식에 맞지 않습니다.'},'owner@test.invalid',key))
    const mine=await ok(await get(),200), other=await ok(await get('other@test.invalid'),200), manager=await ok(await get('manager@test.invalid'),200)
    expect(mine.nonuse).toHaveLength(1); expect(other.nonuse).toHaveLength(0); expect(manager.nonuse).toHaveLength(0)
    expect(manager.nonuseSummary).toHaveLength(1); expect(Number(manager.nonuseSummary[0].reports)).toBe(1)
    expect(JSON.stringify(manager.nonuseSummary)).not.toContain('owner')
    const audit=(await DB.prepare("SELECT detail_json FROM override_audit WHERE entity_kind='field_feedback'").all()).results
    expect(audit.every(row=>row.detail_json==='{}')).toBe(true)
  })
  it('isolates demo visitors independently of role switching and preserves private foreign keys', async () => {
    const tokens=['d'.repeat(64),'e'.repeat(64)]
    const spaces=[]
    for (const token of tokens) {
      await DB.workspaceOpen(token,[])
      const db=createSupabaseDb('https://feedback-test.supabase.co','test-only',token)
      const bindings={DB:db,DEMO_WORKSPACE:true,OVERRIDE_DEMO_MODE:'true'}
      await seedOverrideWorkspace(bindings); spaces.push(bindings)
    }
    await ok(await record('modify',spaces[0]))
    expect((await ok(await get(null,spaces[0]),200)).cases).toHaveLength(1)
    expect((await ok(await get(null,spaces[1]),200)).cases).toHaveLength(0)
    const cross=(await pg.query("SELECT count(*)::int n FROM pg_constraint c JOIN pg_class a ON a.oid=c.conrelid JOIN pg_namespace n ON n.oid=a.relnamespace JOIN pg_class b ON b.oid=c.confrelid JOIN pg_namespace m ON m.oid=b.relnamespace WHERE c.contype='f' AND n.nspname LIKE 'ilson_demo_%' AND n.nspname<>m.nspname")).rows[0]
    expect(cross.n).toBe(0)
    const access=(await pg.query("SELECT has_table_privilege('anon','public.field_feedback_case','SELECT') allowed, has_function_privilege('service_role','public.ilson_install_field_feedback(text)','EXECUTE') helper")).rows[0]
    expect(access).toEqual({allowed:false,helper:false})
  },60000)
})
