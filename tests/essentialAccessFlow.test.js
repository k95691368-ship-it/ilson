// @vitest-environment node
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { createSupabaseDb } from '../functions/_lib/dbBridge.ts'
import { onRequest } from '../functions/api/_middleware.js'
import { onRequestPost as change, onRequestGet as workspace } from '../functions/api/override.js'
import { onRequestDelete as cleanup } from '../functions/api/demo/visitors.js'
import { onRequestPost as application } from '../functions/api/applications/index.js'
import { onRequestPost as review } from '../functions/api/applications/[id]/review.ts'
import { viewedOverrideRequests } from './fixtures/overrideEdit.js'

const pg = new PGlite()
const base = 'https://essential-local.supabase.co'
const issuer = 'https://essential-local.cloudflareaccess.com'
const DB = createSupabaseDb(base,'test-only')
const env = {DB,DBBridgeApplied:true,SUPABASE_URL:base,SUPABASE_SERVICE_ROLE_KEY:'test-only',
  ACCESS_TEAM_DOMAIN:issuer,ACCESS_AUD:'essential-local',OVERRIDE_DEMO_MODE:'false',DEMO_WORKSPACES:'false'}
let queue=Promise.resolve(), pair, jwk
let remote=()=>{throw Error('External network blocked')}
const actors=[['admin@local.invalid','audit',[],[]],['staff@local.invalid','product',['지원'],['p-one']],
  ['owner@local.invalid','reviewer',[],[]],['other@local.invalid','reviewer',[],[]]]
beforeAll(async()=>{
  await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;')
  for(const file of ['0000_schema.sql','0001_execute_sql.sql','0002_override_loop.sql','0003_journey_workspaces.sql','0004_audit_hardening.sql','0005_field_feedback.sql','0006_access_scope.sql','0007_issue_workflow.sql','0008_feedback_rechecks.sql','0009_participation_quota.sql','0010_application_ownership.sql','0011_tool_run_receipts.sql','0012_beta_round_receipts.sql','0013_review_revision.sql'])
    await pg.exec(readFileSync(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'))
  vi.stubGlobal('fetch',(url,options)=>{
    if(String(url)===issuer+'/cdn-cgi/access/certs')return Promise.resolve(Response.json({keys:[jwk]}))
    if(!String(url).startsWith(base+'/rest/v1/rpc/'))return remote(url,options)
    const result=queue.then(async()=>{
      try {
        await pg.exec('SET ROLE service_role')
        const name=new URL(url).pathname.split('/').at(-1), values=Object.values(JSON.parse(options.body))
        return Response.json((await pg.query(`SELECT public.${name}(${values.map((_,i)=>'$'+(i+1)).join(',')}) data`,values)).rows[0].data)
      }catch(error){return Response.json({code:error.code},{status:400})}
      finally{await pg.exec('RESET ROLE')}
    });queue=result.catch(()=>{});return result
  })
  pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify'])
  jwk={...await crypto.subtle.exportKey('jwk',pair.publicKey),kid:'local',alg:'RS256',use:'sig'}
  for(const [email,role,depts,products] of actors)await DB.prepare('INSERT INTO override_actor(email,display_name,role,departments_json,product_ids_json) VALUES(?,?,?,?,?)')
    .bind(email,email.split('@')[0],role,JSON.stringify(depts),JSON.stringify(products)).run()
  for(const [id,team] of [['p-one','지원'],['p-two','다른부서']])await DB.prepare('INSERT INTO override_product(id,name,domain,owner_team,model_name,model_version,prompt_version,policy_version) VALUES(?,?,?,?,?,?,?,?)')
    .bind(id,id,'상담',team,'test','v1','v1','v1').run()
},60000)
afterAll(async()=>{vi.unstubAllGlobals();await pg.close()})
const enc=value=>Buffer.from(JSON.stringify(value)).toString('base64url')
async function invoke(email,path,method,handler,body,bindings=env,key=crypto.randomUUID(),contentType='application/json'){
  const now=Math.floor(Date.now()/1000)
  const unsigned=enc({alg:'RS256',kid:'local'})+'.'+enc({iss:issuer,aud:['essential-local'],iat:now,exp:now+300,email})
  const jwt=unsigned+'.'+Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,new TextEncoder().encode(unsigned))).toString('base64url')
  const headers={'Cf-Access-Jwt-Assertion':jwt,Origin:'https://local.invalid','X-Ilson-Request':'1','X-Ilson-Scope':await DB.forActor(email).toolRunScope(),'X-Idempotency-Key':key}
  if(body && !(body instanceof FormData) && contentType)headers['Content-Type']=contentType
  const request=new Request('https://local.invalid'+path,{method,headers,...(body?{body:body instanceof FormData?body:JSON.stringify(body)}:{})})
  if(!contentType)request.headers.delete('Content-Type')
  const context={env:bindings,request,data:{},next:forwarded=>handler({env:bindings,data:context.data,request:forwarded,params:{id:'foreign-app'}})}
  const response=await onRequest(context)
  return {status:response.status,body:await response.json()}
}
const viewedRequest = viewedOverrideRequests()
const post=async(email,body,bindings=env,key)=>invoke(email,'/api/override','POST',change,await viewedRequest(DB,body,key),bindings,key)
const capture=productId=>({action:'capture_event',productId,decisionAction:'modify',aiDecision:'기존 답변',humanDecision:'필요한 답변',reasonDetail:'정책 내용을 다시 확인해야 합니다.'})
let captured
describe.sequential('approved essential workflow through signed middleware and real PostgreSQL',()=>{
  it('denies real-mode demo deletion and reviewer approval before reaching handlers',async()=>{
    const reached=vi.fn(cleanup)
    expect((await invoke('owner@local.invalid','/api/demo/visitors','DELETE',reached)).status).toBe(403)
    expect(reached).not.toHaveBeenCalled()
    expect((await invoke('owner@local.invalid','/api/applications/foreign-app/review','POST',review,{})).status).toBe(403)
  })
  it('creates own reports without exposing another employee or unassigned product data',async()=>{
    const result=await post('owner@local.invalid',{...capture('p-one'),reviewerLabel:'forged-name'})
    expect(result.status,JSON.stringify(result.body)).toBe(201);captured=result.body
    await post('other@local.invalid',capture('p-two'))
    const mine=await invoke('owner@local.invalid','/api/override','GET',workspace)
    expect(mine.status,JSON.stringify(mine.body)).toBe(200)
    expect(mine.body.events).toHaveLength(1)
    expect(mine.body.events[0]).toMatchObject({id:captured.id,reviewer_label:'owner',reporter_email:'owner@local.invalid'})
    expect(mine.body.capture_products).toEqual([{id:'p-one',name:'p-one'},{id:'p-two',name:'p-two'}])
    expect(mine.body.actors).toEqual([])
    const staff=await invoke('staff@local.invalid','/api/override','GET',workspace)
    expect(staff.body.events.map(e=>e.product_id)).toEqual(['p-one'])
    expect(staff.body.products.map(p=>p.id)).toEqual(['p-one'])
    expect((await post('staff@local.invalid',capture('p-two'))).status).toBe(404)
  })
  it.each(['text/plain', null])('overwrites forged attribution even with Content-Type %s',async(contentType)=>{
    const handler=async context=>Response.json(await context.request.json())
    const result=await invoke('owner@local.invalid','/api/override','POST',handler,{by:'forged',author:'forged',reviewer_label:'forged'},env,crypto.randomUUID(),contentType)
    expect(result.status).toBe(200)
    expect(result.body).toMatchObject({by:'owner',author:'owner',reviewer_label:'owner'})
  })
  it('denies standalone demo mode before accessing a real database',async()=>{
    const reached=vi.fn(workspace)
    expect((await invoke('owner@local.invalid','/api/override','GET',reached,undefined,{...env,OVERRIDE_DEMO_MODE:'true'})).status).toBe(503)
    expect(reached).not.toHaveBeenCalled()
  })
  it('assigns a permitted person, requires a reply date, and only the assignee acknowledges',async()=>{
    const body={action:'update_cluster',clusterId:captured.cluster_id,reason:'실제 담당자 배정',assigneeEmail:'staff@local.invalid'}
    expect((await post('staff@local.invalid',body)).status).toBe(400)
    expect((await post('staff@local.invalid',{...body,nextResponseOn:'2026-12-31'})).status).toBe(200)
    expect((await post('owner@local.invalid',{action:'acknowledge_cluster',clusterId:captured.cluster_id})).status).toBe(403)
    expect((await post('staff@local.invalid',{action:'acknowledge_cluster',clusterId:captured.cluster_id})).status).toBe(200)
    const row=await DB.prepare('SELECT assignee_email,acknowledged_at FROM issue_cluster WHERE id=?').bind(captured.cluster_id).first()
    expect(row.assignee_email).toBe('staff@local.invalid');expect(row.acknowledged_at).toBeTruthy()
  })
  it('uses verified ownership and attribution on the existing application form',async()=>{
    const form=new FormData()
    for(const [k,v]of Object.entries({dept:'재무',applicant_label:'forged',title:'매주 자료를 다시 모읍니다',bottleneck:'반복되는 자료 취합 작업입니다',problem:'기존 자료를 매번 복사합니다',current_people:'1'}))form.set(k,v)
    const result=await invoke('owner@local.invalid','/api/applications','POST',application,form)
    expect(result.status,JSON.stringify(result.body)).toBe(201)
    const row=await DB.prepare('SELECT owner_email,applicant_label FROM application WHERE id=?').bind(result.body.id).first()
    expect(row).toEqual({owner_email:'owner@local.invalid',applicant_label:'owner'})
  })
  it('retries a temporary integration failure with the original remote key and payload',async()=>{
    const endpoint='https://integration.local.invalid/hooks'
    const bindings={...env,OVERRIDE_INTEGRATIONS:JSON.stringify({ticket:{endpointUrl:endpoint,secretBinding:'OVERRIDE_INTEGRATION_TEST_TOKEN',supportsIdempotency:true}}),OVERRIDE_INTEGRATION_TEST_TOKEN:'local-only'}
    const saved=await post('staff@local.invalid',{action:'save_integration',kind:'ticket',name:'Local test',endpointUrl:endpoint,secretBinding:'OVERRIDE_INTEGRATION_TEST_TOKEN'},bindings)
    expect(saved.status,JSON.stringify(saved.body)).toBe(200)
    const attempts=[]
    remote=async(url,options)=>{expect(url).toBe(endpoint);attempts.push([options.headers['Idempotency-Key'],options.body]);return Response.json({ok:attempts.length>1},{status:attempts.length===1?503:200})}
    const key=crypto.randomUUID(),body={action:'sync_integration',integrationId:saved.body.id}
    expect((await post('staff@local.invalid',body,bindings,key)).status).toBe(503)
    expect((await post('staff@local.invalid',body,bindings,key)).status).toBe(200)
    expect((await post('staff@local.invalid',body,bindings,key)).status).toBe(200)
    expect(attempts).toHaveLength(2);expect(attempts[0]).toEqual(attempts[1])
  })
  it('revokes access on the next request and prevents self-removal of the administrator',async()=>{
    const revoked=await post('admin@local.invalid',{action:'save_actor',email:'staff@local.invalid',displayName:'staff',actorRole:'product',active:false,departments:[],productIds:[]})
    expect(revoked.status,JSON.stringify(revoked.body)).toBe(200)
    expect((await invoke('staff@local.invalid','/api/override','GET',workspace)).status).toBe(401)
    expect((await post('admin@local.invalid',{action:'save_actor',email:'admin@local.invalid',displayName:'admin',actorRole:'audit',active:false})).status).toBe(409)
  })
})
