// @vitest-environment node
// Current migrations, signed middleware and real scoped RPCs in memory PG.
// Interleavings use one queued connection, not multi-session/production load.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { createSupabaseDb } from '../functions/_lib/dbBridge.ts'
import { onRequest } from '../functions/api/_middleware.js'
import { onRequestPost, FEEDBACK_ACTOR_SQL } from '../functions/api/feedback.js'
import { feedbackActorKey } from '../functions/_lib/fieldFeedback.js'

const pg=new PGlite(),base='https://feedback-authority-memory.supabase.co'
const issuer='https://feedback-authority-memory.cloudflareaccess.com'
const email='feedback-manager@local.invalid',other='feedback-other@local.invalid',label='현재 현장 담당자'
const DB=createSupabaseDb(base,'synthetic-only')
const env={DB,DBBridgeApplied:true,SUPABASE_URL:base,SUPABASE_SERVICE_ROLE_KEY:'synthetic-only',ACCESS_TEAM_DOMAIN:issuer,
  ACCESS_AUD:'feedback-authority-memory',DEMO_WORKSPACES:'false',OVERRIDE_DEMO_MODE:'false'}
let queue=Promise.resolve(),pair,jwk,sequence=0,beforeReceipt,afterReceipt,beforeCommit,beforeActorRead,dropResponse,barrier
const commits=[],directWrites=[]
beforeAll(async()=>{
  await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;')
  const directory=new URL('../supabase/migrations/',import.meta.url)
  for(const file of readdirSync(directory).filter(name=>/^\d+.*\.sql$/.test(name)).sort())await pg.exec(readFileSync(new URL(file,directory),'utf8'))
  await pg.query("INSERT INTO override_actor(email,display_name,role,departments_json) VALUES($1,$2,'product','[\"Finance\"]'),($3,'다른 사원','reviewer','[]')",[email,label,other])
  pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify'])
  jwk={...await crypto.subtle.exportKey('jwk',pair.publicKey),kid:env.ACCESS_AUD,alg:'RS256',use:'sig'}
  vi.stubGlobal('fetch',(url,options)=>{
    if(String(url)===issuer+'/cdn-cgi/access/certs')return Promise.resolve(Response.json({keys:[jwk]}))
    if(!String(url).startsWith(base+'/rest/v1/rpc/'))throw Error('External network prohibited')
    const name=new URL(url).pathname.split('/').at(-1),args=JSON.parse(options.body),sql=args.p_sql??''
    const receipt=name==='ilson_actor_receipt'||name==='ilson_mutation_receipt',commit=name==='ilson_actor_commit'||name==='ilson_commit_mutation'
    if(commit)commits.push(args)
    if(/^(INSERT|UPDATE|DELETE)/.test(sql))directWrites.push(sql)
    const execute=()=>{
      const task=queue.then(async()=>{
        let response
        try{
          if(receipt&&beforeReceipt){const hook=beforeReceipt;beforeReceipt=null;await hook()}
          if(commit&&beforeCommit){const hook=beforeCommit;beforeCommit=null;await hook(args)}
          if(name==='ilson_actor_query'&&sql.startsWith(FEEDBACK_ACTOR_SQL.split('?')[0])&&beforeActorRead){const hook=beforeActorRead;beforeActorRead=null;await hook()}
          await pg.exec('SET ROLE service_role')
          const values=Object.values(args)
          response=Response.json((await pg.query(`SELECT public.${name}(${values.map((_,i)=>'$'+(i+1)).join(',')}) AS data`,values)).rows[0].data)
        }catch(error){response=Response.json({code:error.code},{status:400})}
        finally{await pg.exec('RESET ROLE')}
        if(receipt&&afterReceipt){const hook=afterReceipt;afterReceipt=null;await hook()}
        if(commit&&dropResponse&&response.ok){dropResponse=false;throw new TypeError('Synthetic committed response lost')}
        return response
      })
      queue=task.catch(()=>{})
      return task
    }
    if(commit&&barrier){const current=barrier;if(++current.arrivals===2){barrier=null;current.release()}return current.ready.then(execute)}
    return execute()
  })
},60000)
afterEach(async()=>{
  await queue
  beforeReceipt=null;afterReceipt=null;beforeCommit=null;beforeActorRead=null;dropResponse=false;barrier=null
  commits.length=0;directWrites.length=0
  await pg.exec('TRUNCATE public.override_product CASCADE; DELETE FROM public.rate_limit_hits; DELETE FROM ilson_private.actor_rate_tickets;')
  await pg.query("UPDATE override_actor SET role='product',active=1,display_name=$2,departments_json='[\"Finance\"]',product_ids_json='[]',updated_at='2026-01-01 00:00:00' WHERE email=$1",[email,label])
})
afterAll(async()=>{await queue;vi.unstubAllGlobals();await pg.close()})
async function jwt(identity){
  const enc=value=>Buffer.from(JSON.stringify(value)).toString('base64url'),now=Math.floor(Date.now()/1000)
  const text=enc({alg:'RS256',kid:jwk.kid})+'.'+enc({iss:issuer,aud:[jwk.kid],email:identity,iat:now,exp:now+600})
  return text+'.'+Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,new TextEncoder().encode(text))).toString('base64url')
}
async function invoke(body,{key=crypto.randomUUID(),identity=email,token,adapter,actorOverride}={}){
  const database=token?createSupabaseDb(base,'synthetic-only',token):DB.forActor(identity)
  const headers={'Content-Type':'application/json',Origin:'https://local.invalid','X-Ilson-Request':'1','X-Ilson-Scope':await database.toolRunScope(),
    'X-Idempotency-Key':key,'CF-Connecting-IP':'synthetic-feedback-authority'}
  if(token)headers.Cookie='ilson_workspace='+token
  else headers['Cf-Access-Jwt-Assertion']=await jwt(identity)
  const bindings=token?{...env,DEMO_WORKSPACES:'true',OVERRIDE_DEMO_MODE:'true'}:env
  const request=new Request('https://local.invalid/api/feedback',{method:'POST',headers,body:JSON.stringify(body)})
  const context={env:bindings,request,data:{}}
  context.next=forwarded=>{
    if(adapter)context.data.requestEnv={...context.data.requestEnv,DB:adapter}
    if(actorOverride!==undefined)context.data.requestEnv={...context.data.requestEnv,AUTH_ACTOR:actorOverride}
    return onRequestPost({env:bindings,data:context.data,request:forwarded??request})
  }
  const response=await onRequest(context)
  return{status:response.status,body:await response.json(),replayed:response.headers.get('X-Idempotency-Replayed')}
}
async function fixture({database=DB,owner=email}={}){
  const suffix=++sequence,item={productId:'authority-product-'+suffix,eventId:'authority-event-'+suffix,caseId:'authority-case-'+suffix,
    updateId:'authority-update-'+suffix,batchId:'authority-batch-'+suffix,itemId:'authority-item-'+suffix,followupId:'authority-followup-'+suffix,clusterId:'authority-cluster-'+suffix}
  await database.prepare("INSERT INTO override_product(id,name,domain,owner_team,model_name,model_version,prompt_version,policy_version) VALUES(?,'합성 제품','상담','Finance','합성','v1','p1','policy1')").bind(item.productId).run()
  await database.prepare("INSERT INTO issue_cluster(id,title,summary,owner_team,scope_product_id,created_by_email) VALUES(?,'합성 문제','확인할 현장 근거','Finance',?,?)").bind(item.clusterId,item.productId,owner).run()
  await database.prepare("INSERT INTO override_event(id,product_id,cluster_id,reviewer_label,reviewer_role,decision_action,is_override,ai_decision,human_decision,reason_code,reason_detail,model_version,prompt_version,reporter_email) VALUES(?,?,?,'합성 사원','reviewer','approve',0,'기존 답변','확인한 답변','unknown','현장 근거','v1','p1',?)").bind(item.eventId,item.productId,item.clusterId,owner).run()
  const reporterKey=await feedbackActorKey({mode:database.workspace?'demo':'access',email:owner})
  await database.prepare('INSERT INTO field_feedback_case(id,event_id,reporter_key) VALUES(?,?,?)').bind(item.caseId,item.eventId,reporterKey).run()
  await database.prepare("INSERT INTO field_feedback_update(id,case_id,kind,body,effective_on,actor_label) VALUES(?,?,'applied','이전에 적용한 안내',?,'이전 담당자')").bind(item.updateId,item.caseId,new Date().toISOString().slice(0,10)).run()
  await database.prepare("INSERT INTO quality_sample_batch(id,product_id,start_at,end_at,requested_size,sample_size,eligible_count,seed,created_by) VALUES(?,?,'2026-01-01','2026-01-02',1,1,1,'synthetic','이전 담당자')").bind(item.batchId,item.productId).run()
  await database.prepare('INSERT INTO quality_sample_item(id,batch_id,event_id,snapshot_json) VALUES(?,?,?,?)').bind(item.itemId,item.batchId,item.eventId,JSON.stringify({ai_decision:'원본 답변',human_decision:'원본 판단'})).run()
  await database.prepare("INSERT INTO issue_followup(id,cluster_id,source_kind,source_id,product_id,event_id,reason,created_by) VALUES(?,?,'feedback',?,?,?,'추가 확인 필요','이전 담당자')").bind(item.followupId,item.clusterId,item.updateId,item.productId,item.eventId).run()
  return item
}
const publish=item=>({action:'publish_update',caseId:item.caseId,kind:'reply',message:'현재 담당자의 처리 안내',role:'product',actorLabel:'위조한 이름'})
const roleChange=role=>pg.query('UPDATE override_actor SET role=$2 WHERE email=$1',[email,role])
const receipts=async key=>Number((await pg.query('SELECT count(*) AS n FROM ilson_private.mutation_receipts WHERE request_id=$1',[key])).rows[0].n)
const updates=async item=>(await pg.query('SELECT * FROM field_feedback_update WHERE case_id=$1 AND id<>$2 ORDER BY id',[item.caseId,item.updateId])).rows
const audits=async item=>(await pg.query("SELECT * FROM override_audit WHERE entity_kind='field_feedback' AND entity_id IN(SELECT id FROM field_feedback_update WHERE case_id=$1 AND id<>$2) ORDER BY id",[item.caseId,item.updateId])).rows
async function noWrites(item,key){expect(await updates(item)).toEqual([]);expect(await audits(item)).toEqual([]);expect(await receipts(key)).toBe(0)}
function rendezvous(){let release;const ready=new Promise(resolve=>{release=resolve});barrier={arrivals:0,ready,release}}

describe.sequential('field feedback current authority joins the atomic action read set',()=>{
  it('stores server-owned attribution and the explicit seven-field authority CAS',async()=>{
    const item=await fixture(),key=crypto.randomUUID();directWrites.length=0
    const result=await invoke(publish(item),{key})
    expect(result).toMatchObject({status:201,replayed:'0',body:{ok:true}})
    expect(result.body.id).toMatch(/^ffu_[a-f0-9]{20}$/)
    expect(await updates(item)).toEqual([expect.objectContaining({id:result.body.id,actor_label:label})])
    expect(await audits(item)).toEqual([expect.objectContaining({actor_label:label,actor_role:'product',actor_email:email,detail_json:'{}'})])
    expect(commits[0].p_reads).toContainEqual(expect.objectContaining({sql:FEEDBACK_ACTOR_SQL.replace('?',"E'"+email+"'"),rows:[expect.objectContaining({display_name:label,role:'product',active:1})]}))
    expect(await receipts(key)).toBe(1);expect(directWrites).toEqual([])
  })
  it.each(['before receipt','before actor read'])('rejects a management-role revocation %s while its own case remains visible',async timing=>{
    const item=await fixture(),key=crypto.randomUUID()
    if(timing==='before receipt')beforeReceipt=()=>roleChange('reviewer')
    else beforeActorRead=()=>roleChange('reviewer')
    expect(await invoke(publish(item),{key})).toMatchObject({status:403})
    await noWrites(item,key)
  })
  it.each(['publish_update','create_sample','review_sample','resolve_followup'])('rejects revoked %s action policy on an otherwise visible own row',async action=>{
    const item=await fixture(),key=crypto.randomUUID()
    beforeActorRead=()=>roleChange('reviewer')
    const date=new Date().toISOString().slice(0,10)
    const body=action==='publish_update'?publish(item):action==='create_sample'?{action,productId:item.productId,startDate:date,endDate:date,size:1}:action==='review_sample'?{action,itemId:item.itemId,verdict:'correct',reason:'원문과 결과를 비교했습니다.',evidenceRefs:'원본 문서'}:{action,followupId:item.followupId,resolution:'후속 근거를 확인했습니다.'}
    expect((await invoke(body,{key})).status).toBe(403)
    expect(await receipts(key)).toBe(0)
    expect((await pg.query('SELECT verdict FROM quality_sample_item WHERE id=$1',[item.itemId])).rows[0].verdict).toBeNull()
    expect((await pg.query('SELECT status FROM issue_followup WHERE id=$1',[item.followupId])).rows[0].status).toBe('open')
  })
  it.each([
    ['forbidden role',"role='reviewer'"],['allowed role',"role='engineer'"],['label',"display_name='직후 이름'"],
    ['assignment',"product_ids_json='[\"changed\"]'"],['departments',"departments_json='[]'"],['revision',"updated_at='2099-01-01 00:00:00'"],
  ])('rejects %s changes after staged reads without partial action/audit/receipt',async(_name,change)=>{
    const item=await fixture(),key=crypto.randomUUID()
    beforeCommit=()=>pg.query('UPDATE override_actor SET '+change+' WHERE email=$1',[email])
    expect((await invoke(publish(item),{key})).status).toBe(409)
    await noWrites(item,key)
  })
  it.each(['before actor read','before commit'])('preserves branded active revocation %s',async timing=>{
    const item=await fixture(),key=crypto.randomUUID(),hook=()=>pg.query('UPDATE override_actor SET active=0 WHERE email=$1',[email])
    if(timing==='before actor read')beforeActorRead=hook;else beforeCommit=hook
    expect(await invoke(publish(item),{key})).toMatchObject({status:401,body:{code:'ACCESS_REVOKED'}})
    await noWrites(item,key)
  })
  it('uses a label changed before authority read; does not invent a name length cap',async()=>{
    const item=await fixture(),current='현재 이름😀'.repeat(20)
    beforeActorRead=()=>pg.query('UPDATE override_actor SET display_name=$2 WHERE email=$1',[email,current])
    expect((await invoke(publish(item))).status).toBe(201)
    expect((await updates(item))[0].actor_label).toBe(current)
    expect((await audits(item))[0].actor_label).toBe(current)
  })
  it('rejects a newly allowed role before action rather than storing an old-role fingerprint',async()=>{
    const item=await fixture(),key=crypto.randomUUID()
    beforeActorRead=()=>roleChange('engineer')
    expect((await invoke(publish(item),{key})).status).toBe(409);await noWrites(item,key)
    // A fresh request observes the current role, uses its own scoped identity,
    // and retains the original action policy. A client role cannot restore it.
    const result=await invoke(publish(item),{key})
    expect(result.status).toBe(201)
    expect((await audits(item))[0].actor_role).toBe('engineer')
    expect((await invoke(publish(item),{key})).body).toEqual(result.body)
  })
  it('keeps already-read success valid without a second receipt row',async()=>{
    const item=await fixture()
    await pg.query("UPDATE override_actor SET role='reviewer' WHERE email=$1",[email])
    const body={action:'read_update',updateId:item.updateId,role:'product'}
    expect(await invoke(body)).toMatchObject({status:200,body:{ok:true,id:item.updateId}})
    expect(await invoke(body)).toMatchObject({status:200,body:{ok:true,id:item.updateId}})
    expect((await pg.query('SELECT count(*)::int AS n FROM field_feedback_receipt WHERE update_id=$1',[item.updateId])).rows[0].n).toBe(1)
    expect((await invoke({...body,action:'confirm_update',verdict:'resolved'})).status).toBe(200)
  })
  it('does not let a manager acknowledge another employee’s update',async()=>{
    const item=await fixture({owner:other}),key=crypto.randomUUID()
    expect((await invoke({action:'read_update',updateId:item.updateId},{key})).status).toBe(404)
    expect(await receipts(key)).toBe(0)
  })
  it('commits a voluntary non-use report under the existing reporter policy',async()=>{
    const item=await fixture()
    const result=await invoke({action:'record_nonuse',productId:item.productId,usageState:'paused',reason:'workflow',occurredOn:new Date().toISOString().slice(0,10),note:''})
    expect(result).toMatchObject({status:201,body:{ok:true}})
    expect(result.body.id).toMatch(/^nur_[a-f0-9]{20}$/)
  })
  it('keeps the existing quality sampling action and current batch attribution',async()=>{
    const item=await fixture(),date=new Date().toISOString().slice(0,10)
    await pg.query('DELETE FROM quality_sample_item WHERE id=$1',[item.itemId])
    const result=await invoke({action:'create_sample',productId:item.productId,startDate:date,endDate:date,size:1})
    expect(result).toMatchObject({status:201,body:{ok:true}})
    expect(result.body.id).toMatch(/^qsb_[a-f0-9]{20}$/)
    expect((await pg.query('SELECT created_by,sample_size,eligible_count FROM quality_sample_batch WHERE id=$1',[result.body.id])).rows[0]).toEqual({created_by:label,sample_size:1,eligible_count:1})
  })
  it.each(['review_sample','resolve_followup'])('keeps allowed %s and its current server attribution',async action=>{
    const item=await fixture()
    const body=action==='review_sample'?{action,itemId:item.itemId,verdict:'correct',reason:'현장 근거를 확인했습니다.',evidenceRefs:'원본 정책'}:{action,followupId:item.followupId,resolution:'후속 근거를 확인했습니다.'}
    expect(await invoke(body)).toMatchObject({status:200,body:{ok:true,id:action==='review_sample'?item.itemId:item.followupId}})
    const sql=action==='review_sample'?'SELECT reviewed_by AS actor FROM quality_sample_item WHERE id=$1':'SELECT resolved_by AS actor FROM issue_followup WHERE id=$1'
    expect((await pg.query(sql,[action==='review_sample'?item.itemId:item.followupId])).rows[0].actor).toBe(label)
  })
  it('a forged cached role cannot replace the current registered role',async()=>{
    const item=await fixture(),key=crypto.randomUUID()
    const actorOverride={mode:'access',email,role:'unknown-role',label}
    expect((await invoke({action:'read_update',updateId:item.updateId},{key,actorOverride})).status).toBe(409)
    expect(await receipts(key)).toBe(0)
    expect((await pg.query('SELECT update_id FROM field_feedback_receipt WHERE update_id=$1',[item.updateId])).rows).toEqual([])
  })
  it.each(['read_update','confirm_update','record_nonuse','publish_update'])('rejects unknown current role for %s even when its own source is visible',async action=>{
    const item=await fixture(),key=crypto.randomUUID()
    // Current 0000 creates this legacy table without a role CHECK before
    // 0002's CREATE IF NOT EXISTS; do not mistake that SQL text for enforcement.
    await roleChange('unknown-role')
    expect((await pg.query('SELECT role FROM override_actor WHERE email=$1',[email])).rows[0].role).toBe('unknown-role')
    const body=action==='publish_update'?publish(item):action==='record_nonuse'?{action,productId:item.productId,usageState:'paused',reason:'workflow',occurredOn:new Date().toISOString().slice(0,10)}:{action,updateId:item.updateId,verdict:'resolved'}
    expect((await invoke(body,{key})).status).toBe(403)
    await noWrites(item,key)
    expect((await pg.query('SELECT update_id FROM field_feedback_receipt WHERE update_id=$1',[item.updateId])).rows).toEqual([])
    expect((await pg.query('SELECT id FROM tool_nonuse_report WHERE product_id=$1',[item.productId])).rows).toEqual([])
  })
  it.each([
    ['reviewer',false],['operations',true],['product',true],['ml',true],['engineer',true],['policy',true],['audit',false],['executive',false],
  ])('keeps registered %s own acknowledgement and existing management action policy',async(role,manager)=>{
    const item=await fixture();await roleChange(role)
    expect(await invoke({action:'read_update',updateId:item.updateId})).toMatchObject({status:200,body:{ok:true,id:item.updateId}})
    expect((await invoke(publish(item))).status).toBe(manager?201:403)
  })
  it('recovers response loss from the existing receipt without a duplicate update',async()=>{
    const item=await fixture(),key=crypto.randomUUID();dropResponse=true
    expect((await invoke(publish(item),{key})).status).toBe(503)
    const saved=await updates(item)
    expect(saved).toHaveLength(1);expect(await audits(item)).toHaveLength(1);expect(await receipts(key)).toBe(1)
    expect(await invoke(publish(item),{key})).toMatchObject({status:201,replayed:'1',body:{id:saved[0].id}})
    expect(await updates(item)).toEqual(saved);expect(await audits(item)).toHaveLength(1)
  })
  it('same-key concurrent requests replay one atomic update; changed content conflicts',async()=>{
    const item=await fixture(),key=crypto.randomUUID();rendezvous()
    const result=await Promise.all([invoke(publish(item),{key}),invoke(publish(item),{key})])
    expect(result.map(value=>value.status)).toEqual([201,201])
    expect(result[0].body).toEqual(result[1].body);expect(result.map(value=>value.replayed).sort()).toEqual(['0','1'])
    expect(await updates(item)).toHaveLength(1);expect(await audits(item)).toHaveLength(1);expect(await receipts(key)).toBe(1)
    expect((await invoke({...publish(item),message:'같은 키로 다른 근거'},{key})).status).toBe(409)
  })
  it('separate intentional management replies remain allowed',async()=>{
    const item=await fixture();rendezvous()
    const result=await Promise.all([invoke(publish(item)),invoke({...publish(item),message:'추가 담당자 안내'})])
    expect(result.map(value=>value.status)).toEqual([201,201]);expect(await updates(item)).toHaveLength(2)
  })
  it('an audit SQL failure rolls back the staged update and receipt too',async()=>{
    const item=await fixture(),key=crypto.randomUUID()
    // Alter only this disposable RPC's audit literal, causing a real NOT NULL
    // failure after the preceding action INSERT in the same PG transaction.
    beforeCommit=args=>{const audit=args.p_writes.find(write=>write.sql.includes('INSERT INTO override_audit'));expect(audit.sql).toContain("E'"+label+"'");audit.sql=audit.sql.replace("E'"+label+"'",'NULL')}
    expect((await invoke(publish(item),{key})).status).toBe(503)
    await noWrites(item,key)
  })
  it.each(['role','active'])('scope refuses an old receipt when %s changes before its lookup',async change=>{
    const item=await fixture(),key=crypto.randomUUID(),saved=await invoke(publish(item),{key})
    beforeReceipt=()=>change==='role'?roleChange('reviewer'):pg.query('UPDATE override_actor SET active=0 WHERE email=$1',[email])
    const replay=await invoke(publish(item),{key})
    expect(replay.status).toBe(change==='role'?409:401);expect(replay.body).not.toHaveProperty('id')
    expect(saved.status).toBe(201);expect(await updates(item)).toHaveLength(1);expect(await audits(item)).toHaveLength(1);expect(await receipts(key)).toBe(1)
  })
  it.each(['role','active'])('historical receipt after lookup and %s revocation adds no new write',async change=>{
    const item=await fixture(),key=crypto.randomUUID(),saved=await invoke(publish(item),{key})
    afterReceipt=()=>change==='role'?roleChange('reviewer'):pg.query('UPDATE override_actor SET active=0 WHERE email=$1',[email])
    const replay=await invoke(publish(item),{key})
    expect(replay).toMatchObject({status:201,replayed:'1',body:saved.body})
    expect(await updates(item)).toHaveLength(1);expect(await audits(item)).toHaveLength(1);expect(await receipts(key)).toBe(1)
  })
  it.each(['unscoped','other actor','workspace unspecified'])('rejects %s DB even behind a signed request',async mode=>{
    const item=await fixture(),key=crypto.randomUUID()
    const adapter=mode==='unscoped'?DB:mode==='other actor'?DB.forActor(other):{...DB.forActor(email),workspace:undefined}
    expect((await invoke(publish(item),{key,adapter})).status).toBe(401);await noWrites(item,key)
  })
  it.each([{}, {mode:'invalid',email}, {mode:'demo',email}])('rejects malformed actor context %j rather than using the role selector',async actorOverride=>{
    const item=await fixture(),key=crypto.randomUUID()
    expect((await invoke(publish(item),{key,actorOverride})).status).toBe(503);await noWrites(item,key)
  })
  it('keeps demo role simulation inside its private workspace and cannot write real rows',async()=>{
    const token='fe'.repeat(32);await DB.workspaceOpen(token,[])
    const database=createSupabaseDb(base,'synthetic-only',token),item=await fixture({database,owner:null})
    const denied=await invoke({...publish(item),role:'reviewer'},{token})
    expect(denied.status).toBe(403)
    const saved=await invoke(publish(item),{token})
    expect(saved.status).toBe(201)
    expect((await database.prepare('SELECT actor_label FROM field_feedback_update WHERE id=?').bind(saved.body.id).first()).actor_label).toBe('위조한 이름')
    expect((await pg.query('SELECT id FROM public.field_feedback_update WHERE id=$1',[saved.body.id])).rows).toEqual([])
    expect((await invoke(publish(item),{token,actorOverride:{mode:'demo',role:'product',email:null,label:'잘못된 혼합 환경'}})).status).toBe(503)
  })
})
