// @vitest-environment node
import {beforeAll,afterAll,describe,it,expect,vi} from 'vitest'
import {readFileSync,readdirSync} from 'node:fs'
import {PGlite} from '@electric-sql/pglite'
import {createSupabaseDb} from '../functions/_lib/dbBridge.js'
import {onRequestGet as get,onRequestPost as post,onRequestPatch as patch,onRequestDelete as remove} from '../functions/api/applications/[id]/agreement.js'
import {onRequestGet as signInfo,onRequestPost as sign} from '../functions/api/track/[ticket]/signoff.js'
import {onRequestGet as betaInfo,onRequestPost as betaSave} from '../functions/api/applications/[id]/beta.js'
import {fullySignedIds} from '../functions/_lib/signoff.js'

const pg=new PGlite(),base='https://agreement-evidence.supabase.co',DB=createSupabaseDb(base,'local-only')
const email='author@local.invalid',env={DB:DB.forActor(email),AUTH_ACTOR:{email,mode:'access',role:'product',departments:['Finance']}}
let queue=Promise.resolve(),seq=0,beforeCommit=null
beforeAll(async()=>{
  await pg.exec('CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;')
  for(const file of readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(f=>/^\d+.*\.sql$/.test(f)).sort()) await pg.exec(readFileSync(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'))
  vi.stubGlobal('fetch',(url,opt)=>{
    if(!String(url).startsWith(base+'/rest/v1/rpc/')) throw Error('External network blocked')
    const pending=queue.then(async()=>{
      try {
        const name=new URL(url).pathname.split('/').at(-1)
        if(name==='ilson_actor_commit'&&beforeCommit){const hook=beforeCommit;beforeCommit=null;await hook()}
        await pg.exec('SET ROLE service_role')
        const args=Object.values(JSON.parse(opt.body))
        return Response.json((await pg.query(`SELECT public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) data`,args)).rows[0].data)
      } catch(error){return Response.json({code:error.code},{status:400})}
      finally{await pg.exec('RESET ROLE')}
    });queue=pending.catch(()=>{});return pending
  })
  await DB.prepare("INSERT INTO override_actor(email,display_name,role,departments_json) VALUES(?,'Author','product','[\"Finance\"]')").bind(email).run()
  await DB.prepare("INSERT INTO override_actor(email,display_name,role,departments_json) VALUES('other@local.invalid','Other','product','[\"Other\"]')").run()
},60000)
afterAll(async()=>{vi.unstubAllGlobals();await pg.close()})
async function fixture(){
  const id='AGREEMENT-'+(++seq)
  await DB.prepare("INSERT INTO application(id,ticket_no,dept,applicant_label,title,bottleneck,problem,current_people,current_frequency,status,owner_email) VALUES(?,?,'Finance','Author','Task','Task','Task',2,'매일','수용',?)").bind(id,id,email).run()
  return id
}
const request=(body,key=crypto.randomUUID())=>new Request('https://test.invalid/api/agreement',{method:'POST',headers:{'Content-Type':'application/json','X-Idempotency-Key':key},body:JSON.stringify(body)})
const invoke=(handler,id,body,key,environment=env)=>handler({env:environment,params:{id,ticket:id},request:request(body,key)})
const view=async id=>(await get({env,params:{id}})).json()
const signature=async id=>(await signInfo({env,params:{ticket:id}})).json()
async function create(id,text='Criterion'){
  const r=await invoke(post,id,{kind:'criterion',body:text,check_key:'currency_converted',expectedVersion:(await view(id)).criteria_source_version})
  expect(r.status).toBe(201);return(await r.json()).id
}
async function change(id,cid,values={}){
  const c=(await view(id)).criteria.find(r=>r.id===cid)
  return invoke(patch,id,{kind:'criterion',id:cid,confirmed:Boolean(c.confirmed_at),is_required_safety:Boolean(c.is_required_safety),expectedVersion:c.edit_version,...values})
}
async function signBody(id){const s=await signature(id);return{by:'Author',dept:'Finance',verdicts:Object.fromEntries(s.criteria.map(c=>[c.id,'ok'])),reasons:{},expectedVersion:s.expectedVersion}}
async function measurements(id){for(const seconds of [60,90,120]) expect((await invoke(post,id,{kind:'shadow_run',total_seconds:seconds,error_count:0})).status).toBe(201)}
const logs=async id=>(await DB.prepare('SELECT * FROM decision_log WHERE application_id=? ORDER BY id').bind(id).all()).results

describe.sequential('agreement evidence versions through scoped PostgreSQL',()=>{
  it('records one criterion and audit for duplicate retries, then exposes immutable edit versions',async()=>{
    const id=await fixture(),v=await view(id),key=crypto.randomUUID(),body={kind:'criterion',body:'Fresh criterion',expectedVersion:v.criteria_source_version}
    const first=await invoke(post,id,body,key),replay=await invoke(post,id,body,key)
    expect(first.status).toBe(201);expect(replay.headers.get('X-Idempotency-Replayed')).toBe('1')
    expect(await replay.json()).toEqual(await first.json())
    const after=await view(id);expect(after.criteria).toHaveLength(1);expect(after.criteria[0].edit_version).toMatch(/^[a-f0-9]{64}$/)
    expect(after.criteria_source_version).not.toBe(v.criteria_source_version);expect(await logs(id)).toHaveLength(1)
  })
  it('rejects an old checkbox form without reverting newer mandatory safety',async()=>{
    const id=await fixture(),cid=await create(id),old=(await view(id)).criteria[0]
    expect((await change(id,cid,{confirmed:true,is_required_safety:true})).status).toBe(200)
    const response=await invoke(patch,id,{kind:'criterion',id:cid,confirmed:false,is_required_safety:false,expectedVersion:old.edit_version})
    expect(response.status).toBe(409);expect((await view(id)).criteria[0]).toMatchObject({is_required_safety:1})
    expect((await view(id)).criteria[0].confirmed_at).toBeTruthy()
  })
  it('allows only one competing creation from the same viewed list',async()=>{
    const id=await fixture(),expectedVersion=(await view(id)).criteria_source_version
    const results=await Promise.all(['A','B'].map(body=>invoke(post,id,{kind:'criterion',body,expectedVersion})))
    expect(results.map(r=>r.status).sort()).toEqual([201,409]);expect((await view(id)).criteria).toHaveLength(1)
  })
  it('rejects role revocation before commit while ownership read access remains',async()=>{
    const id=await fixture(),body={kind:'criterion',body:'New',expectedVersion:(await view(id)).criteria_source_version}
    beforeCommit=()=>pg.exec("UPDATE override_actor SET role='reviewer' WHERE email='author@local.invalid'")
    expect((await invoke(post,id,body)).status).toBe(409)
    expect((await view(id)).criteria).toHaveLength(0)
    await DB.prepare("UPDATE override_actor SET role='product' WHERE email=?").bind(email).run()
  })
  it('keeps original signatures but requires current safety/confirmation revision; old beta is also rejected',async()=>{
    const id=await fixture(),cid=await create(id);await change(id,cid,{confirmed:true,is_required_safety:false})
    expect((await invoke(sign,id,await signBody(id))).status).toBe(200)
    const original=(await logs(id)).find(r=>r.link_kind==='기준서명')
    expect((await signature(id)).state.binding).toBe(true)
    expect(await fullySignedIds(env,[{id,dept:'Finance'}])).toEqual(new Set([id]))
    const beta=await(await betaInfo({env,params:{id}})).json()
    const payload={kind:'round',run_id:crypto.randomUUID(),run_scope:beta.runScope,criteria_revision:beta.criteriaRevision,graded:beta.criteria.map(c=>({id:c.id,ord:c.ord,body:c.body,check_key:c.check_key,is_required_safety:c.is_required_safety,kind:'rule',verdict:'통과',evidence:'Local',samples:[]})),summary:{durationMs:1}}
    await change(id,cid,{is_required_safety:true})
    expect((await signature(id)).state).toMatchObject({binding:false,status:'다시 받아야 함'})
    expect(await fullySignedIds(env,[{id,dept:'Finance'}])).toEqual(new Set())
    expect((await invoke(betaSave,id,payload)).status).toBe(409)
    await change(id,cid,{confirmed:false});expect((await signature(id)).state).toMatchObject({binding:false,canSign:false})
    await change(id,cid,{confirmed:true,is_required_safety:false});expect((await signature(id)).state.binding).toBe(false)
    expect((await logs(id)).find(r=>r.id===original.id)).toEqual(original)
    expect((await invoke(sign,id,await signBody(id))).status).toBe(200)
    expect((await signature(id)).state.binding).toBe(true)
  })
  it('does not let a stale direct signature attest to newly changed criteria',async()=>{
    const id=await fixture(),cid=await create(id);await change(id,cid,{confirmed:true})
    const old=await signBody(id);await change(id,cid,{is_required_safety:false})
    expect((await invoke(sign,id,old)).status).toBe(409)
    const beforeAddition=await signBody(id),added=await create(id,'Added criterion')
    await change(id,added,{confirmed:true})
    const stale=await invoke(sign,id,beforeAddition)
    expect(stale.status).toBe(409)
    expect((await stale.json()).code).toBe('AGREEMENT_EDIT_CONFLICT')
    expect((await logs(id)).filter(r=>r.link_kind==='기준서명')).toHaveLength(0)
  })
  it('preserves legacy signature text but never counts it as current proof',async()=>{
    const id=await fixture(),cid=await create(id);await change(id,cid,{confirmed:true})
    await DB.prepare("INSERT INTO decision_log(id,application_id,stage,actor,title,what,why,alternatives,link_kind,link_id) VALUES(?,?,'협의안','human','Old','Original text','Original reason',?,'기준서명','Finance')").bind(id+'-old',id,JSON.stringify([cid])).run()
    expect((await signature(id)).state.binding).toBe(false)
    expect(await fullySignedIds(env,[{id,dept:'Finance'}])).toEqual(new Set())
    expect((await logs(id)).at(-1).what).toBeTruthy()
  })
  it('keeps a released department historical signature without blocking current required departments',async()=>{
    const id=await fixture(),cid=await create(id);await change(id,cid,{confirmed:true})
    const original=await signature(id)
    await DB.prepare("INSERT INTO decision_log(id,application_id,stage,actor,title,what,why,alternatives,link_kind,link_id,created_at) VALUES(?,?,'협의안','human','Previous marketing','Original signature','Original agreement',?,'기준서명','Marketing','2020-01-01 00:00:00')")
      .bind(id+'-marketing',id,JSON.stringify({criterionIds:[cid],criteriaSourceVersion:original.expectedVersion})).run()
    await change(id,cid,{is_required_safety:false})
    expect((await invoke(sign,id,await signBody(id))).status).toBe(200)
    expect((await signature(id)).state).toMatchObject({requiredDepts:['Finance'],waitingDepts:[],binding:true})
    expect((await logs(id)).find(r=>r.id===id+'-marketing').what).toBe('Original signature')
  })
  it('requires the exact measured source before sealing and preserves sealed originals',async()=>{
    const id=await fixture();await measurements(id);const old=await view(id)
    await invoke(post,id,{kind:'shadow_run',total_seconds:150,error_count:0})
    expect((await invoke(post,id,{kind:'baseline',expectedVersion:old.baseline_source_version})).status).toBe(409)
    const fresh=await view(id),body={kind:'baseline',people:2,hourly_wage_krw:20000,expectedVersion:fresh.baseline_source_version},key=crypto.randomUUID()
    expect((await invoke(post,id,body,key)).status).toBe(200)
    expect((await invoke(post,id,body,key)).headers.get('X-Idempotency-Replayed')).toBe('1')
    const sealed=await view(id);expect(sealed.baseline).toMatchObject({sample_n:4,median_seconds:105,people:2,hourly_wage_krw:20000})
    expect((await invoke(remove,id,{kind:'shadow_run',id:sealed.shadowRuns[0].id})).status).toBe(409)
    expect((await view(id)).shadowRuns).toHaveLength(4)
  })
  it('rejects nonnumeric counts and invalid seal numbers and keeps append retry idempotent',async()=>{
    const id=await fixture()
    for(const error_count of [true,[5],{},-1,0.5]) expect((await invoke(post,id,{kind:'shadow_run',total_seconds:60,error_count})).status).toBe(400)
    for(const total_seconds of [true,[60],0,-1,'Infinity']) expect((await invoke(post,id,{kind:'shadow_run',total_seconds})).status).toBe(400)
    const key=crypto.randomUUID(),body={kind:'shadow_run',total_seconds:60,error_count:'0'}
    expect((await invoke(post,id,body,key)).status).toBe(201);expect((await invoke(post,id,body,key)).headers.get('X-Idempotency-Replayed')).toBe('1')
    expect((await view(id)).shadowRuns).toHaveLength(1)
    for(const extra of [{people:0},{people:true},{people:1.2},{hourly_wage_krw:-1},{hourly_wage_krw:[20]}]) expect((await invoke(post,id,{kind:'baseline',...extra})).status).toBe(400)
  })
  it('fails closed for JSON null/array, foreign applications and missing versions',async()=>{
    const id=await fixture()
    for(const handler of [post,patch,remove]) for(const body of [null,[]]) expect((await invoke(handler,id,body)).status).toBe(400)
    expect((await invoke(post,id,{kind:'criterion',body:'No version'})).status).toBe(409)
    const other={DB:DB.forActor('other@local.invalid'),AUTH_ACTOR:{email:'other@local.invalid',role:'product',mode:'access'}}
    expect((await invoke(post,id,{kind:'criterion',body:'Cross scope'},undefined,other)).status).toBe(404)
  })
  it('rolls back criterion and baseline writes if the required audit record fails',async()=>{
    const id=await fixture();await measurements(id)
    await pg.exec(`CREATE FUNCTION public.fail_agreement_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Test audit failure'; END $$;
      CREATE TRIGGER fail_agreement_audit BEFORE INSERT ON decision_log FOR EACH ROW WHEN (NEW.application_id='${id}') EXECUTE FUNCTION public.fail_agreement_audit();`)
    try {
      let v=await view(id)
      expect((await invoke(post,id,{kind:'criterion',body:'Audit failure',expectedVersion:v.criteria_source_version})).status).toBe(503)
      v=await view(id);expect(v.criteria).toHaveLength(0)
      expect((await invoke(post,id,{kind:'baseline',expectedVersion:v.baseline_source_version})).status).toBe(503)
      expect((await view(id)).baseline).toBeNull();expect(await logs(id)).toHaveLength(0)
    } finally {await pg.exec('DROP TRIGGER fail_agreement_audit ON decision_log;DROP FUNCTION public.fail_agreement_audit()')}
  })
})
