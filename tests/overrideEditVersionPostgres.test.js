// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { createSupabaseDb } from '../functions/_lib/dbBridge.js'
import { onRequestGet, onRequestPost } from '../functions/api/override.js'
import { onRequestGet as getEvents } from '../functions/api/override/events.js'

const pg = new PGlite(), base = 'https://override-edit.supabase.co'
const DB = createSupabaseDb(base,'memory-only')
const actors = { manager:{ email:'manager@local.invalid',label:'담당자',role:'product',mode:'access' },
  admin:{ email:'admin@local.invalid',label:'관리자',role:'audit',mode:'access' },
  outsider:{ email:'outsider@local.invalid',label:'다른 담당자',role:'product',mode:'access' } }
const endpoint = 'https://integration.local.invalid/hook'
const env = name => ({ DB:DB.forActor(actors[name].email), UNSCOPED_DB:DB, AUTH_ACTOR:actors[name], OVERRIDE_DEMO_MODE:'false',
  OVERRIDE_INTEGRATIONS:JSON.stringify({ticket:{endpointUrl:endpoint,secretBinding:'OVERRIDE_INTEGRATION_TEST_TOKEN',supportsIdempotency:true}}), OVERRIDE_INTEGRATION_TEST_TOKEN:'not-used' })
let queue = Promise.resolve()
beforeAll(async () => {
  await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;')
  for (const file of readdirSync('supabase/migrations').filter(file => /^\d+.*\.sql$/.test(file)).sort()) await pg.exec(readFileSync('supabase/migrations/'+file,'utf8'))
  vi.stubGlobal('fetch',(url,options) => {
    if (!String(url).startsWith(base+'/rest/v1/rpc/')) throw Error('External network blocked')
    const result = queue.then(async () => {
      try {
        await pg.exec('SET ROLE service_role')
        const args = Object.values(JSON.parse(options.body)), name = new URL(url).pathname.split('/').at(-1)
        return Response.json((await pg.query(`SELECT public.${name}(${args.map((_,index) => '$'+(index+1)).join(',')}) data`,args)).rows[0].data)
      } catch(error) { return Response.json({code:error.code},{status:400}) }
      finally { await pg.exec('RESET ROLE') }
    }); queue = result.catch(() => {}); return result
  })
  await pg.exec(`INSERT INTO override_product(id,name,domain,owner_team,model_name,model_version,prompt_version,policy_version)
    VALUES('p','검증 AI','지원','team','test','v1','p1','policy1');
    INSERT INTO override_actor(email,display_name,role,departments_json,product_ids_json) VALUES
    ('manager@local.invalid','담당자','product','["team"]','["p"]'),('admin@local.invalid','관리자','audit','[]','[]'),
    ('outsider@local.invalid','다른 담당자','product','[]','[]');
    INSERT INTO issue_cluster(id,title,summary,owner_team,scope_product_id) VALUES('cluster','이전 제목','이전 설명','team','p');
    INSERT INTO override_event(id,product_id,cluster_id,reviewer_label,reviewer_role,decision_action,ai_decision,human_decision,reason_code,reason_detail,model_version,prompt_version,reporter_email)
    VALUES('event','p','cluster','직원','reviewer','modify','원문','수정','unknown','근거','v1','p1','manager@local.invalid');`)
},60000)
afterAll(async () => { vi.unstubAllGlobals(); await queue; await pg.close() })
async function response(result) { return {status:result.status, body:await result.json(), replayed:result.headers.get('X-Idempotency-Replayed')} }
async function get(kind,id,actor='manager',extra={}) {
  return response(await onRequestGet({env:env(actor),request:new Request('https://local.invalid/api/override?'+new URLSearchParams({editKind:kind,editId:id,...extra}))}))
}
async function viewed(kind,id,actor='manager',extra={}) {
  const result=await get(kind,id,actor,extra)
  expect(result.status,JSON.stringify(result.body)).toBe(200)
  expect(result.body.entity.edit_version).toMatch(/^[a-f0-9]{64}$/)
  return result.body.entity
}
async function post(body,actor='manager',key=crypto.randomUUID()) {
  return response(await onRequestPost({env:env(actor),request:new Request('https://local.invalid/api/override',{method:'POST',headers:{'X-Idempotency-Key':key},body:JSON.stringify(body)})}))
}
const editCluster = (row,overrides={}) => ({action:'update_cluster',clusterId:row.id,expectedVersion:row.edit_version,title:row.title,summary:row.summary,causeCode:row.cause_code,causeStatus:row.cause_status,status:row.status,ownerTeam:row.owner_team,assigneeEmail:row.assignee_email || '',nextResponseOn:row.next_response_on || '',reason:'확인한 근거',...overrides})
const auditCount = async () => Number((await DB.prepare('SELECT count(*) AS n FROM override_audit').first()).n)
const plan = { metricType:'rate',minimumWindowSeconds:1,minimumSamples:{historical:2,shadow:2,limited:2},rationale:'최소 검증',datasetVersion:'d1',modelVersion:'m1',policyVersion:'p1' }

describe.sequential('user-viewed OverrideLoop state preconditions on real scoped PostgreSQL', () => {
  it('does not let an old cluster form revert a newer confirmed cause, owner or closed status',async () => {
    const old = await viewed('cluster','cluster')
    expect((await post(editCluster(old,{title:'최신 제목',causeCode:'model',causeStatus:'confirmed',status:'resolved',assigneeEmail:'manager@local.invalid',nextResponseOn:'2030-01-01'}))).status).toBe(200)
    const before = await viewed('cluster','cluster'), audit = await auditCount()
    expect(await post(editCluster(old,{summary:'오래된 폼의 설명 변경'}))).toMatchObject({status:409,body:{code:'OVERRIDE_EDIT_CONFLICT'}})
    expect(await viewed('cluster','cluster')).toEqual(before)
    expect(await auditCount()).toBe(audit)
    expect((await post(editCluster(before,{summary:'최신 내용을 확인한 변경'}))).status).toBe(200)
    expect((await viewed('cluster','cluster')).summary).toBe('최신 내용을 확인한 변경')
  })
  it('requires a valid precondition and detects same-second edits without a timestamp-only CAS',async () => {
    const old=await viewed('cluster','cluster')
    for (const expectedVersion of [undefined,'not-a-hash','0'.repeat(64)]) expect((await post(editCluster(old,{expectedVersion}))).status).toBe(409)
    await DB.prepare("UPDATE issue_cluster SET summary='same-second edit' WHERE id='cluster'").run()
    const fresh=await viewed('cluster','cluster')
    expect(fresh.updated_at).toBe(old.updated_at)
    expect(fresh.edit_version).not.toBe(old.edit_version)
    expect((await post(editCluster(old))).status).toBe(409)
  })
  it('keeps the original idempotency receipt usable after further edits',async () => {
    const old=await viewed('cluster','cluster'), key=crypto.randomUUID(), body=editCluster(old,{summary:'첫 저장'})
    const first=await post(body,'manager',key)
    expect(first.status).toBe(200)
    expect((await post(editCluster(await viewed('cluster','cluster'),{summary:'두 번째 저장'}))).status).toBe(200)
    const audit=await auditCount(), retry=await post(body,'manager',key)
    expect(retry).toMatchObject({status:200,body:first.body,replayed:'1'})
    expect((await viewed('cluster','cluster')).summary).toBe('두 번째 저장')
    expect(await auditCount()).toBe(audit)
  })
  it('allows only one concurrent writer from a shared snapshot',async () => {
    const old=await viewed('cluster','cluster')
    const results=await Promise.all([post(editCluster(old,{summary:'동시 저장 A'})),post(editCluster(old,{summary:'동시 저장 B'}))])
    expect(results.map(item=>item.status).sort()).toEqual([200,409])
  })
  it('does not expose another scope or actor settings through conflict reload',async () => {
    expect((await get('cluster','cluster','outsider')).status).toBe(404)
    expect((await get('event','event','outsider')).status).toBe(404)
    expect((await get('actor','manager@local.invalid')).status).toBe(403)
    expect((await get('actor','manager@local.invalid','admin')).status).toBe(200)
    expect((await get('invalid','cluster')).status).toBe(400)
    expect((await post(editCluster(await viewed('cluster','cluster')),'outsider')).status).toBe(404)
  })
  it('uses the same event token for paged evidence and prevents stale validity overwrites',async () => {
    const result=await response(await getEvents({env:env('manager'),request:new Request('https://local.invalid/api/override/events?eventId=event')}))
    const old=await viewed('event','event')
    expect(result.body.events[0].edit_version).toBe(old.edit_version)
    const payload={action:'validate_event',eventId:'event',expectedVersion:old.edit_version,validity:'valid',reason:'최신 검증'}
    expect((await post(payload)).status).toBe(200)
    expect((await post({...payload,validity:'invalid',reason:'옛 폼'})).status).toBe(409)
    expect((await viewed('event','event')).validity).toBe('valid')
  })
  it('rejects old experiment creation context and old approval/run/decision cycles',async () => {
    const cluster=await viewed('cluster','cluster')
    const create={action:'create_experiment',clusterId:'cluster',expectedVersion:cluster.edit_version,title:'주기 검증',changeTarget:'검색',hypothesis:'오류 감소',scope:'시험',comparator:'v1',successMetric:'오류율',approver:'책임자',rollbackPlan:'v1 복원',guardrails:['위반 0'],stopConditions:['위반 1'],targetImprovement:20,evaluationPlan:plan}
    const created=await post(create)
    expect(created.status).toBe(201)
    expect((await post(create)).status).toBe(409)
    const id=created.body.id, draft=await viewed('experiment',id)
    expect((await post({action:'approve_experiment',experimentId:id,expectedVersion:draft.edit_version,basis:'최초 승인'})).status).toBe(200)
    const old=await viewed('experiment',id)
    expect((await post({action:'decide_experiment',experimentId:id,expectedVersion:old.edit_version,decision:'hold',basis:'새 사실 확인'})).status).toBe(200)
    const held=await viewed('experiment',id)
    expect((await post({action:'approve_experiment',experimentId:id,expectedVersion:held.edit_version,basis:'두 번째 승인'})).status).toBe(200)
    for (const extra of [{action:'approve_experiment',basis:'이전 폼'},{action:'record_run',phase:'historical'},{action:'decide_experiment',decision:'stop',basis:'이전 폼'}]) {
      expect((await post({experimentId:id,expectedVersion:old.edit_version,...extra})).status).toBe(409)
    }
    expect((await viewed('experiment',id)).approval_id).not.toBe(old.approval_id)
  })
  it('requires a viewed snapshot before replacing a volume, including a legacy create form',async () => {
    const body={action:'record_volume',productId:'p',measuredOn:'2026-01-01',segment:'검증',totalCases:100,applicableCases:80}
    expect((await post(body)).status).toBe(200)
    const query={productId:body.productId,measuredOn:body.measuredOn,segment:body.segment}, old=await viewed('volume','',undefined,query)
    expect((await post({...body,totalCases:120})).status).toBe(409)
    expect((await post({...body,expectedVersion:old.edit_version,totalCases:120})).status).toBe(200)
    expect((await post({...body,expectedVersion:old.edit_version,totalCases:130})).status).toBe(409)
    expect((await viewed('volume','',undefined,query)).total_cases).toBe(120)
  })
  it('does not let an older actor registration or settings form restore revoked access',async () => {
    const old=await viewed('actor','outsider@local.invalid','admin')
    const body={action:'save_actor',email:old.email,displayName:old.display_name,actorRole:old.role,active:false,departments:[],productIds:[],expectedVersion:old.edit_version}
    expect((await post(body,'admin')).status).toBe(200)
    expect((await post({...body,active:true},'admin')).status).toBe(409)
    expect((await post({...body,expectedVersion:undefined,active:true},'admin')).status).toBe(409)
    expect((await viewed('actor',old.email,'admin')).active).toBe(false)
  })
  it('rejects stale integration updates without making any external request',async () => {
    const body={action:'save_integration',name:'검증 연동',kind:'ticket',endpointUrl:endpoint,secretBinding:'OVERRIDE_INTEGRATION_TEST_TOKEN'}
    const created=await post(body)
    expect(created.status).toBe(200)
    const old=await viewed('integration',created.body.id)
    expect((await post({...body,integrationId:old.id,expectedVersion:old.edit_version,name:'최신 연동'})).status).toBe(200)
    expect((await post({...body,integrationId:old.id,expectedVersion:old.edit_version})).status).toBe(409)
    expect((await post({...body,integrationId:old.id})).status).toBe(409)
    expect((await viewed('integration',old.id)).name).toBe('최신 연동')
  })
})
