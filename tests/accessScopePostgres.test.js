// @vitest-environment node
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { createSupabaseDb } from '../functions/_lib/dbBridge.js'
import { atomicMutation, mutationFingerprint } from '../functions/_lib/atomicMutation.js'
import { scopedActorDb, actorAssignments } from '../functions/_lib/dataScope.js'
import { onRequestGet as loadOverride, onRequestPost as mutateOverride } from '../functions/api/override.js'
import { viewedOverrideBody } from './fixtures/overrideEdit.js'

const pg = new PGlite()
const DB = createSupabaseDb('https://access-scope-test.supabase.co','local-test-only')
const db = email => DB.forActor(email)
const a = 'employee-a@test.invalid', b = 'employee-b@test.invalid', staff = 'staff@test.invalid', admin = 'admin@test.invalid'
let queue = Promise.resolve()
beforeAll(async () => {
  await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;')
  for (const file of ['0000_schema.sql','0001_execute_sql.sql','0002_override_loop.sql','0003_journey_workspaces.sql','0004_audit_hardening.sql','0005_field_feedback.sql','0006_access_scope.sql','0007_issue_workflow.sql','0008_feedback_rechecks.sql','0009_participation_quota.sql','0010_application_ownership.sql','0011_tool_run_receipts.sql','0012_beta_round_receipts.sql','0013_review_revision.sql']) {
    if(file==='0007_issue_workflow.sql')await pg.exec("INSERT INTO issue_cluster(id,title,summary,owner_team,customer_impact_score,operations_cost_krw,regulatory_risk_score) VALUES('existing-values','Existing','Recorded values','Finance',0,17,2)")
    await pg.exec(readFileSync(new URL(`../supabase/migrations/${file}`,import.meta.url),'utf8'))
  }
  vi.stubGlobal('fetch',(url,options)=>{
    if(!String(url).startsWith('https://access-scope-test.supabase.co/rest/v1/rpc/'))throw Error('External call blocked')
    const response = queue.then(async()=>{
      try {
        await pg.exec('SET ROLE service_role')
        const args=Object.values(JSON.parse(options.body)), name=new URL(url).pathname.split('/').at(-1)
        return Response.json((await pg.query(`SELECT public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) data`,args)).rows[0].data)
      } catch(error) { return Response.json({code:error.code, message:error.message},{status:400}) }
      finally { await pg.exec('RESET ROLE') }
    })
    queue=response.catch(()=>{})
    return response
  })
  for(const [email,role,depts,products] of [[a,'reviewer',[],[]],[b,'reviewer',[],[]],[staff,'product',['Finance'],['product-b']],[admin,'audit',[],[]]])
    await DB.prepare('INSERT INTO override_actor(email,display_name,role,departments_json,product_ids_json) VALUES(?,?,?,?,?)').bind(email,email,role,JSON.stringify(depts),JSON.stringify(products)).run()
  for(const [id,team] of [['product-a','Finance'],['product-b','Support'],['product-c','HR']])
    await DB.prepare("INSERT INTO override_product(id,name,domain,owner_team,model_name,model_version,prompt_version,policy_version) VALUES(?,?,'Test',?,'model','v1','p1','policy1')").bind(id,id,team).run()
  for(const [id,dept,owner] of [['app-a','Finance',a],['app-b','HR',b],['app-product','Support',b],['app-legacy','Finance',null]])
    await DB.prepare("INSERT INTO application(id,ticket_no,dept,applicant_label,title,bottleneck,problem,owner_email) VALUES(?,?,?,'Employee','Request','block','problem',?)").bind(id,id,dept,owner).run()
  await DB.prepare("INSERT INTO application_product_link(application_id,product_id) VALUES('app-product','product-b')").run()
  for(const [id,product,reporter] of [['event-a','product-a',a],['event-b','product-a',b],['event-c','product-c',b],['event-legacy','product-a',null]])
    await DB.prepare("INSERT INTO override_event(id,product_id,reviewer_label,reviewer_role,decision_action,ai_decision,human_decision,reason_code,reason_detail,model_version,prompt_version,reporter_email) VALUES(?,?,'Employee','reviewer','modify','AI original','Employee answer','unknown','reason','v1','p1',?)").bind(id,product,reporter).run()
  await DB.prepare("INSERT INTO meeting(id,application_id,seq,title) VALUES('meeting-a','app-a',1,'Finance'),('meeting-b','app-b',1,'HR')").run()
},60000)
afterAll(async()=>{vi.unstubAllGlobals();await pg.close()})
const impactColumns='customer_impact_score,operations_cost_krw,regulatory_risk_score'
const missingImpact={customer_impact_score:null,operations_cost_krw:null,regulatory_risk_score:null}
const zeroImpact={customer_impact_score:0,operations_cost_krw:0,regulatory_risk_score:0}
async function changeOverride(body,email=a,bindings) {
  body = await viewedOverrideBody(bindings?.DB ?? DB,body)
  return mutateOverride({env:bindings ?? {DB:db(email),UNSCOPED_DB:DB,OVERRIDE_DEMO_MODE:'false',
    AUTH_ACTOR:{email,label:email,role:email===staff?'product':'reviewer',mode:'access',departments:[],product_ids:[]}},
  request:new Request('https://local.invalid/api/override',{method:'POST',headers:{'X-Idempotency-Key':crypto.randomUUID()},body:JSON.stringify(body)})})
}
const minimalReport=productId=>({action:'capture_event',productId,decisionAction:'modify',aiDecision:'Original answer',humanDecision:'Expected answer',reasonDetail:'Check a newly reported situation'})

describe.sequential('server-verified actor data scope on real PostgreSQL RLS',()=>{
  it('uses a non-owner, NOLOGIN/NOBYPASSRLS RPC role and denies anonymous callers',async()=>{
    const roles=(await pg.query("SELECT rolcanlogin,rolbypassrls,rolsuper FROM pg_roles WHERE rolname='ilson_scoped_executor'")).rows[0]
    expect(roles).toEqual({rolcanlogin:false,rolbypassrls:false,rolsuper:false})
    const grants=(await pg.query("SELECT has_function_privilege('anon','public.ilson_actor_query(text,text)','EXECUTE') anon,has_table_privilege('ilson_scoped_executor','ilson_private.mutation_receipts','SELECT') receipts")).rows[0]
    expect(grants).toEqual({anon:false,receipts:false})
    const owner=(await pg.query("SELECT p.proowner::regrole::text owner FROM pg_proc p WHERE p.oid='public.ilson_actor_query(text,text)'::regprocedure")).rows[0]
    expect(owner.owner).toBe('ilson_scoped_executor')
  })
  it('keeps employee applications, children and raw events private even for public-qualified SQL',async()=>{
    expect((await db(a).prepare('SELECT id FROM public.application ORDER BY id').all()).results.map(r=>r.id)).toEqual(['app-a'])
    expect((await db(a).prepare('SELECT id FROM meeting ORDER BY id').all()).results.map(r=>r.id)).toEqual(['meeting-a'])
    expect((await db(a).prepare('SELECT id FROM override_event ORDER BY id').all()).results.map(r=>r.id)).toEqual(['event-a'])
    expect(await db(a).prepare("SELECT * FROM application WHERE id='app-b'").first()).toBeNull()
    expect((await db(a).prepare("UPDATE application SET title='unauthorized' WHERE id='app-b'").run()).meta.changes).toBe(0)
  })
  it('allows staff assigned departments OR products but not legacy unknown ownership',async()=>{
    expect((await db(staff).prepare('SELECT id FROM application ORDER BY id').all()).results.map(r=>r.id)).toEqual(['app-a','app-product'])
    expect((await db(staff).prepare('SELECT id FROM override_event ORDER BY id').all()).results.map(r=>r.id)).toEqual(['event-a','event-b'])
    expect((await db(staff).prepare('SELECT id FROM override_product ORDER BY id').all()).results.map(r=>r.id)).toEqual(['product-a','product-b'])
    expect((await db(admin).prepare('SELECT id FROM application').all()).results).toHaveLength(4)
    expect((await db(admin).prepare('SELECT id FROM override_event').all()).results).toHaveLength(4)
  })
  it('keeps product joins for own feedback without widening event access',async()=>{
    expect((await db(a).prepare('SELECT id FROM override_product ORDER BY id').all()).results.map(r=>r.id)).toEqual(['product-a'])
    expect((await db(a).prepare('SELECT e.id FROM override_event e JOIN override_product p ON p.id=e.product_id').all()).results.map(r=>r.id)).toEqual(['event-a'])
  })
  it('supports own cluster capture, derived updates and feedback joins without exposing another employee',async()=>{
    const owned=db(a)
    await owned.prepare("INSERT INTO issue_cluster(id,title,summary,owner_team,scope_product_id) VALUES('own-cluster','My issue','Only my report','Finance','product-a')").run()
    expect((await DB.prepare("SELECT created_by_email FROM issue_cluster WHERE id='own-cluster'").first()).created_by_email).toBe(a)
    await owned.prepare("UPDATE override_event SET cluster_id='own-cluster' WHERE id='event-a'").run()
    await owned.prepare("UPDATE issue_cluster SET recurrence_count=(SELECT count(*) FROM override_event WHERE cluster_id='own-cluster') WHERE id='own-cluster'").run()
    expect((await owned.prepare("SELECT recurrence_count FROM issue_cluster WHERE id='own-cluster'").first()).recurrence_count).toBe(1)
    expect(await db(b).prepare("SELECT * FROM issue_cluster WHERE id='own-cluster'").first()).toBeNull()
    expect((await db(staff).prepare("SELECT id FROM issue_cluster WHERE id='own-cluster'").first()).id).toBe('own-cluster')
    const reporter=await mutationFingerprint({identity:a})
    await owned.prepare("INSERT INTO field_feedback_case(id,event_id,reporter_key) VALUES('own-case','event-a',?)").bind(reporter).run()
    await db(staff).prepare("INSERT INTO field_feedback_update(id,case_id,kind,body,actor_label) VALUES('own-reply','own-case','reply','Checking','Staff')").run()
    const rows=(await owned.prepare('SELECT c.id,u.body FROM field_feedback_case c JOIN override_event e ON e.id=c.event_id JOIN override_product p ON p.id=e.product_id JOIN field_feedback_update u ON u.case_id=c.id').all()).results
    expect(rows).toEqual([{id:'own-case',body:'Checking'}])
    expect((await db(b).prepare('SELECT id FROM field_feedback_case').all()).results).toEqual([])
  })
  it('allows staff product creation only within assigned departments',async()=>{
    const insert="INSERT INTO override_product(id,name,domain,owner_team,model_name,model_version,prompt_version,policy_version) VALUES(?,?,'Test',?,'m','v','p','policy')"
    await db(staff).prepare(insert).bind('new-product','New product','Finance').run()
    expect((await db(staff).prepare("SELECT id FROM override_product WHERE id='new-product'").first()).id).toBe('new-product')
    await expect(db(staff).prepare(insert).bind('wrong-team-product','Other product','HR').run()).rejects.toThrow('/42501')
  })
  it('refreshes shared issue totals atomically without replacing them with an employee-only subtotal',async()=>{
    await DB.prepare("UPDATE override_event SET cluster_id='own-cluster',validity='valid',customer_impact_score=4,operations_cost_krw=20,regulatory_risk_score=3 WHERE id='event-b'").run()
    await DB.prepare("UPDATE override_event SET customer_impact_score=2,operations_cost_krw=10,regulatory_risk_score=1 WHERE id='event-a'").run()
    const scoped=db(a)
    const response=await mutateOverride({env:{DB:scoped,UNSCOPED_DB:DB,OVERRIDE_DEMO_MODE:'false',
      AUTH_ACTOR:{email:a,label:'A',role:'reviewer',mode:'access',departments:[],product_ids:[]}},
    request:new Request('https://local.invalid/api/override',{method:'POST',headers:{'X-Idempotency-Key':'scoped-aggregate-00001'},
      body:JSON.stringify(await viewedOverrideBody(scoped,{action:'validate_event',eventId:'event-a',validity:'valid',reason:'Validated original evidence'}))})})
    expect(response.status,await response.clone().text()).toBe(200)
    const totals=await DB.prepare("SELECT recurrence_count,customer_impact_score,operations_cost_krw,regulatory_risk_score FROM issue_cluster WHERE id='own-cluster'").first()
    expect(totals).toEqual({recurrence_count:2,customer_impact_score:3,operations_cost_krw:30,regulatory_risk_score:3})
    expect((await scoped.prepare("SELECT id FROM override_event WHERE cluster_id='own-cluster'").all()).results).toEqual([{id:'event-a'}])
    await expect(db(b).prepare("SELECT * FROM ilson_private.scope_cluster_totals('own-cluster')").all()).rejects.toThrow('/42501')
    expect((await pg.query("SELECT has_function_privilege('anon','ilson_private.scope_cluster_totals(text)','EXECUTE') allowed")).rows[0].allowed).toBe(false)
    const loaded=await loadOverride({env:{DB:scoped,UNSCOPED_DB:DB,OVERRIDE_DEMO_MODE:'false',
      AUTH_ACTOR:{email:a,label:'A',role:'reviewer',mode:'access',departments:[],product_ids:[]}},
      request:new Request('https://local.invalid/api/override')})
    expect(loaded.status).toBe(200)
    const dashboard=await loaded.json(), shared=dashboard.clusters.find(row=>row.id==='own-cluster')
    expect(shared.recurrence_count).toBe(2)
    expect(shared.visible_event_count).toBe(1)
    expect(dashboard.events.map(row=>row.id)).not.toContain('event-b')
  })
  it('preserves missing impact fields through minimal capture, validation and unrelated cluster updates',async()=>{
    const response=await changeOverride(minimalReport('product-a'))
    expect(response.status,await response.clone().text()).toBe(201)
    const saved=await response.json()
    expect(await DB.prepare(`SELECT ${impactColumns} FROM override_event WHERE id=?`).bind(saved.id).first()).toEqual(missingImpact)
    expect(await DB.prepare(`SELECT ${impactColumns},recurrence_count FROM issue_cluster WHERE id=?`).bind(saved.cluster_id).first()).toEqual({...missingImpact,recurrence_count:0})
    expect((await changeOverride({action:'validate_event',eventId:saved.id,validity:'valid',reason:'Checked the original report'})).status).toBe(200)
    expect(await DB.prepare(`SELECT ${impactColumns},recurrence_count FROM issue_cluster WHERE id=?`).bind(saved.cluster_id).first()).toEqual({...missingImpact,recurrence_count:1})
    expect((await changeOverride({action:'update_cluster',clusterId:saved.cluster_id,reason:'Changed the summary only',summary:'New summary'},staff)).status).toBe(200)
    expect(await DB.prepare(`SELECT ${impactColumns} FROM issue_cluster WHERE id=?`).bind(saved.cluster_id).first()).toEqual(missingImpact)
    expect((await changeOverride({action:'update_cluster',clusterId:saved.cluster_id,reason:'Recorded real zero values',customerImpact:0,operationsCost:0,regulatoryRisk:0},staff)).status).toBe(200)
    expect(await DB.prepare(`SELECT ${impactColumns} FROM issue_cluster WHERE id=?`).bind(saved.cluster_id).first()).toEqual(zeroImpact)
    expect((await changeOverride({action:'update_cluster',clusterId:saved.cluster_id,reason:'Another unrelated update'},staff)).status).toBe(200)
    expect(await DB.prepare(`SELECT ${impactColumns} FROM issue_cluster WHERE id=?`).bind(saved.cluster_id).first()).toEqual(zeroImpact)
    expect((await changeOverride({action:'update_cluster',clusterId:saved.cluster_id,reason:'Withdraw unsupported measurements',customerImpact:null,operationsCost:'',regulatoryRisk:null},staff)).status).toBe(200)
    expect(await DB.prepare(`SELECT ${impactColumns} FROM issue_cluster WHERE id=?`).bind(saved.cluster_id).first()).toEqual(missingImpact)
  })
  it('keeps actual zeros and recorded values while ignoring absent measurements in aggregation',async()=>{
    expect(await DB.prepare(`SELECT ${impactColumns} FROM issue_cluster WHERE id='existing-values'`).first()).toEqual({customer_impact_score:0,operations_cost_krw:17,regulatory_risk_score:2})
    for(const values of [{customerImpact:0,operationsCost:0,regulatoryRisk:0},{customerImpact:4,operationsCost:125,regulatoryRisk:3}]) {
      const response=await changeOverride({...minimalReport('product-a'),...values})
      expect(response.status,await response.clone().text()).toBe(201)
      const saved=await response.json()
      expect((await changeOverride({action:'validate_event',eventId:saved.id,validity:'valid',reason:'Confirmed measured impact'})).status).toBe(200)
      expect(await DB.prepare(`SELECT ${impactColumns} FROM issue_cluster WHERE id=?`).bind(saved.cluster_id).first()).toEqual({customer_impact_score:values.customerImpact,operations_cost_krw:values.operationsCost,regulatory_risk_score:values.regulatoryRisk})
      const missingResponse=await changeOverride(minimalReport('product-a')), missing=await missingResponse.json()
      await DB.prepare('UPDATE override_event SET cluster_id=? WHERE id=?').bind(saved.cluster_id,missing.id).run()
      expect((await changeOverride({action:'validate_event',eventId:missing.id,validity:'valid',reason:'Valid report without measurements'})).status).toBe(200)
      expect(await DB.prepare(`SELECT ${impactColumns},recurrence_count FROM issue_cluster WHERE id=?`).bind(saved.cluster_id).first()).toEqual({customer_impact_score:values.customerImpact,operations_cost_krw:values.operationsCost,regulatory_risk_score:values.regulatoryRisk,recurrence_count:2})
    }
  })
  it('keeps unrecorded demo impact null without altering the numeric priority algorithm',async()=>{
    const token='e'.repeat(64)
    await DB.workspaceOpen(token,[])
    const demo=createSupabaseDb('https://access-scope-test.supabase.co','local-test-only',token)
    const bindings={DB:demo,DEMO_WORKSPACE:true,OVERRIDE_DEMO_MODE:'true'}
    // Follow the actual page flow: finish demo initialization before adding a product.
    const initial=await loadOverride({env:bindings,request:new Request('https://local.invalid/api/override')})
    expect(initial.status,await initial.clone().text()).toBe(200)
    await demo.prepare("INSERT INTO override_product(id,name,domain,owner_team,model_name,model_version,prompt_version,policy_version) VALUES('demo-product','Demo','Test','Finance','m','v1','p1','policy1')").run()
    const response=await changeOverride(minimalReport('demo-product'),a,bindings)
    expect(response.status,await response.clone().text()).toBe(201)
    const saved=await response.json()
    expect(await demo.prepare(`SELECT ${impactColumns},priority_score,recurrence_count FROM issue_cluster WHERE id=?`).bind(saved.cluster_id).first()).toEqual({...missingImpact,priority_score:0,recurrence_count:0})
    expect((await changeOverride({action:'validate_event',eventId:saved.id,validity:'valid',reason:'Valid demonstration'},a,bindings)).status).toBe(200)
    const after=await demo.prepare(`SELECT ${impactColumns},priority_score,recurrence_count FROM issue_cluster WHERE id=?`).bind(saved.cluster_id).first()
    expect(after).toMatchObject({...missingImpact,recurrence_count:1})
    expect(Number.isFinite(after.priority_score)).toBe(true)
    await demo.prepare("INSERT INTO issue_cluster(id,title,summary,owner_team) VALUES('empty-followup','Follow-up','No impact measurements','Finance')").run()
    expect(await demo.prepare(`SELECT ${impactColumns} FROM issue_cluster WHERE id='empty-followup'`).first()).toEqual(missingImpact)
  })
  it('stamps new ownership and rejects forged or transferred identity',async()=>{
    await db(a).prepare("INSERT INTO application(id,ticket_no,dept,applicant_label,title,bottleneck,problem) VALUES('owned-new','owned-new','Other','A','new','b','p')").run()
    expect((await DB.prepare("SELECT owner_email FROM application WHERE id='owned-new'").first()).owner_email).toBe(a)
    await expect(db(a).prepare("UPDATE application SET owner_email=? WHERE id='owned-new'").bind(b).run()).rejects.toThrow('/42501')
    await expect(db(a).prepare("INSERT INTO application(id,ticket_no,dept,applicant_label,title,bottleneck,problem,owner_email) VALUES('forged','forged','HR','B','new','b','p',?)").bind(b).run()).rejects.toThrow('/42501')
    await expect(db(a).prepare("UPDATE override_actor SET role='executive' WHERE email=?").bind(a).run()).resolves.toMatchObject({meta:{changes:0}})
  })
  it('uses scoped atomic writes, rolls back blocked writes, and never calls the unrestricted commit',async()=>{
    const requestId='scope-atomic-00000001', fingerprint=await mutationFingerprint({test:'actor-a'})
    const result=await atomicMutation(db(a),requestId,fingerprint,async tx=>{
      await tx.prepare("UPDATE application SET title='owned update' WHERE id='app-a'").run()
      return Response.json({ok:true})
    })
    expect(result.status).toBe(200)
    expect((await DB.prepare("SELECT title FROM application WHERE id='app-a'").first()).title).toBe('owned update')
    expect(await db(b).mutationReceipt(requestId,fingerprint)).toBeNull()
    await expect(atomicMutation(db(a),'scope-atomic-00000002',fingerprint,async tx=>{
      await tx.prepare("UPDATE application SET title='must rollback' WHERE id='app-a'").run()
      await tx.prepare("INSERT INTO meeting(id,application_id,seq,title) VALUES('bad-child','app-b',9,'not allowed')").run()
      return Response.json({ok:true})
    })).rejects.toThrow('/42501')
    expect((await DB.prepare("SELECT title FROM application WHERE id='app-a'").first()).title).toBe('owned update')
    await expect(db(a).prepare("SELECT public.ilson_execute('SELECT * FROM application')").all()).rejects.toThrow('/42501')
  })
  it('revalidates active identity on queries, batches and receipts and invalidates changed scope receipts',async()=>{
    const key='scope-revocation-00001',fingerprint=await mutationFingerprint({test:'staff'})
    await atomicMutation(db(staff),key,fingerprint,async()=>Response.json({private:'staff-result'}))
    expect(await db(staff).mutationReceipt(key,fingerprint)).toMatchObject({body:{private:'staff-result'}})
    await DB.prepare("UPDATE override_actor SET product_ids_json='[]' WHERE email=?").bind(staff).run()
    await expect(db(staff).mutationReceipt(key,fingerprint)).rejects.toThrow('/40001')
    let repeated=false
    await expect(atomicMutation(db(staff),key,fingerprint,async()=>{
      repeated=true
      return Response.json({private:'must not recreate a changed external intent'})
    })).rejects.toThrow('/40001')
    expect(repeated).toBe(false)
    await DB.prepare('UPDATE override_actor SET active=0 WHERE email=?').bind(staff).run()
    await expect(db(staff).prepare('SELECT 1').all()).rejects.toThrow('/28000')
    const revoked=db(staff)
    await expect(revoked.batch([revoked.prepare('SELECT 1')])).rejects.toThrow('/28000')
    await expect(db(staff).mutationReceipt(key,fingerprint)).rejects.toThrow('/28000')
    await DB.prepare('UPDATE override_actor SET active=1 WHERE email=?').bind(staff).run()
  })
  it('supports PostgreSQL ON CONFLICT without cross-user overwrite',async()=>{
    await db(a).prepare("INSERT INTO review(application_id,impact_score,difficulty_score,verdict,verdict_reason,reviewer_label) VALUES('app-a',1,1,'수용','reason','A') ON CONFLICT(application_id) DO UPDATE SET verdict_reason=excluded.verdict_reason").run()
    await expect(db(b).prepare("INSERT INTO review(application_id,impact_score,difficulty_score,verdict,verdict_reason,reviewer_label) VALUES('app-a',1,1,'수용','other','B') ON CONFLICT(application_id) DO UPDATE SET verdict_reason=excluded.verdict_reason").run()).rejects.toThrow('/42501')
  })
  it('preserves isolated demonstration schemas and does not infer owners for copied old data',async()=>{
    const token='d'.repeat(64)
    await DB.workspaceOpen(token,[{id:'demo-a',ticket_no:'AX-DEM-X',dept:'Demo',applicant_label:'Visitor',title:'Demo',bottleneck:'b',problem:'p',current_minutes:1,current_people:1}])
    const demo=createSupabaseDb('https://access-scope-test.supabase.co','local-test-only',token)
    expect((await demo.prepare('SELECT id,owner_email FROM application').all()).results).toEqual([{id:'demo-a',owner_email:null}])
    expect(()=>demo.forActor(a)).toThrow('cannot switch')
    expect(await db(a).prepare("SELECT id FROM application WHERE id='demo-a'").first()).toBeNull()
  })
  it('fails closed without a verified actor or an actor-capable database binding',()=>{
    expect(()=>scopedActorDb(DB,{email:a,mode:'demo'})).toThrow()
    expect(()=>scopedActorDb({}, {email:a,mode:'access'})).toThrow()
    expect(actorAssignments({role:'product',departments_json:'["Finance"]',product_ids_json:'not-json'})).toEqual({departments:['Finance'],productIds:[],administrator:false})
  })
})
