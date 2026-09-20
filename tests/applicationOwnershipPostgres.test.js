// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { createSupabaseDb } from '../functions/_lib/dbBridge.js'
import { onRequestGet as info, onRequestPost as assign } from '../functions/api/applications/[id]/owner.js'
import { onRequestPost as join } from '../functions/api/applications/[id]/join.js'
import { onRequestGet as application } from '../functions/api/applications/[id]/index.js'

const pg=new PGlite(),base='https://ownership-test.supabase.co',DB=createSupabaseDb(base,'memory-only')
const admin='admin@local.invalid',staff='staff@local.invalid',old='old@local.invalid',next='next@local.invalid',other='other@local.invalid',inactive='inactive@local.invalid'
const actors=[[admin,'audit',[],1],[staff,'product',['재무'],1],[old,'reviewer',['재무'],1],[next,'reviewer',['재무'],1],[other,'reviewer',['영업'],1],[inactive,'reviewer',['재무'],0]]
let queue=Promise.resolve()
const environment=email=>{const[,role,departments]=actors.find(row=>row[0]===email);return{DB:DB.forActor(email),UNSCOPED_DB:DB,OVERRIDE_DEMO_MODE:'false',AUTH_ACTOR:{email,label:email,role,departments,mode:'access'}}}
const request=(body,key=crypto.randomUUID())=>new Request('https://local.invalid/api/applications/legacy/owner',{method:'POST',headers:{'Content-Type':'application/json','X-Idempotency-Key':key},body:JSON.stringify(body)})
const payload=(expectedOwnerEmail=null,newOwnerEmail=next)=>({expectedOwnerEmail,newOwnerEmail,reason:'본인 및 담당 부서와 신청 관계를 직접 확인했습니다.',confirmed:true})
const post=(id,body=payload(),actor=admin,key)=>assign({env:environment(actor),params:{id},request:request(body,key)})
const get=(id,actor=admin)=>info({env:environment(actor),params:{id},request:new Request('https://local.invalid/api/applications/'+id+'/owner')})

beforeAll(async()=>{
  await pg.exec('CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;')
  const dir=new URL('../supabase/migrations/',import.meta.url)
  for(const file of readdirSync(dir).filter(file=>/^\d+.*\.sql$/.test(file)).sort())await pg.exec(readFileSync(new URL(file,dir),'utf8'))
  vi.stubGlobal('fetch',(url,options)=>{
    if(!String(url).startsWith(base+'/rest/v1/rpc/'))throw Error('External network blocked')
    const result=queue.then(async()=>{
      try{
        await pg.exec('SET ROLE service_role')
        const name=new URL(url).pathname.split('/').at(-1),values=Object.values(JSON.parse(options.body))
        return Response.json((await pg.query(`SELECT public.${name}(${values.map((_,i)=>'$'+(i+1)).join(',')}) data`,values)).rows[0].data)
      }catch(error){return Response.json({code:error.code},{status:400})}
      finally{await pg.exec('RESET ROLE')}
    });queue=result.catch(()=>{});return result
  })
  for(const[email,role,departments,active]of actors)await DB.prepare('INSERT INTO override_actor(email,display_name,role,departments_json,active) VALUES(?,?,?,?,?)').bind(email,email,role,JSON.stringify(departments),active).run()
  for(const[id,owner,dept]of [['legacy',null,'재무'],['transfer',old,'재무'],['rollback',null,'재무'],['invalid-dept',null,'임의부서'],['untouched',old,'재무']])await DB.prepare("INSERT INTO application(id,ticket_no,dept,applicant_label,title,bottleneck,problem,owner_email) VALUES(?,?,?,'원래 작성자','원래 신청','취합','원문 유지',?)").bind(id,id,dept,owner).run()
},60000)
afterAll(async()=>{vi.unstubAllGlobals();await pg.close()})

describe.sequential('administrator-confirmed application ownership',()=>{
  it('exposes only matching active candidates to a real administrator, not a normal user or demo',async()=>{
    const response=await get('legacy'),data=await response.json()
    expect(response.status).toBe(200)
    expect(data.owner).toBeNull()
    expect(data.candidates.map(row=>row.email).sort()).toEqual([next,old,staff].sort())
    expect(await (await get('legacy',staff)).json()).toEqual({canManage:false})
    const demo=await info({env:{DB,DEMO_WORKSPACE:true,OVERRIDE_DEMO_MODE:'true'},params:{id:'legacy'},request:new Request('https://local.invalid/api/applications/legacy/owner')})
    expect(await demo.json()).toEqual({canManage:false})
    expect((await post('legacy',payload(),staff)).status).toBe(403)
    expect((await assign({env:{DB,DEMO_WORKSPACE:true,OVERRIDE_DEMO_MODE:'true'},params:{id:'legacy'},request:request(payload())})).status).toBe(403)
  })
  it('requires explicit old owner, confirmation and reason without inferring an identity',async()=>{
    for(const body of [{...payload(),expectedOwnerEmail:undefined},{...payload(),confirmed:false},{...payload(),reason:'짧음'},{...payload(),newOwnerEmail:'not-email'}])expect((await post('legacy',body)).status).toBe(400)
    expect((await DB.prepare("SELECT owner_email FROM application WHERE id='legacy'").first()).owner_email).toBeNull()
  })
  it('assigns one legacy record atomically, unblocks its owner and participation, and replays safely',async()=>{
    const key=crypto.randomUUID(),body=payload()
    expect((await application({env:environment(next),params:{id:'legacy'}})).status).toBe(404)
    const response=await post('legacy',body,admin,key)
    expect(response.status,await response.clone().text()).toBe(200)
    const saved=await response.json()
    expect(saved).toMatchObject({ok:true,owner_email:next,replayed:false})
    expect(await DB.prepare("SELECT owner_email,applicant_label,ticket_no,problem FROM application WHERE id='legacy'").first()).toEqual({owner_email:next,applicant_label:'원래 작성자',ticket_no:'legacy',problem:'원문 유지'})
    expect((await application({env:environment(next),params:{id:'legacy'}})).status).toBe(200)
    expect((await application({env:environment(next),params:{id:'untouched'}})).status).toBe(404)
    const replay=await post('legacy',body,admin,key)
    expect(replay.status).toBe(200)
    expect((await replay.json()).replayed).toBe(true)
    expect((await DB.prepare("SELECT id FROM override_audit WHERE action='assign_application_owner' AND entity_id='legacy'").all()).results).toHaveLength(1)
    const history=(await (await get('legacy')).json()).history
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({by:admin,previousOwnerEmail:null,newOwnerEmail:next,reason:body.reason})
    const participation=await join({env:environment(admin),params:{id:'legacy'},request:request({dept:'영업',by:'확인자',minutes:30,people:1,frequency:'주 1회',story:'이 신청과 관련된 실제 업무를 함께 처리합니다.'})})
    expect(participation.status,await participation.clone().text()).toBe(201)
    expect((await application({env:environment(other),params:{id:'legacy'}})).status).toBe(200)
  })
  it('transfers from an inactive former owner without changing the original author or wider access',async()=>{
    await DB.prepare('UPDATE override_actor SET active=0 WHERE email=?').bind(old).run()
    const current=await (await get('transfer')).json()
    expect(current.owner).toMatchObject({email:old,active:false})
    const response=await post('transfer',payload(old))
    expect(response.status,await response.clone().text()).toBe(200)
    expect((await application({env:environment(next),params:{id:'transfer'}})).status).toBe(200)
    await DB.prepare('UPDATE override_actor SET active=1 WHERE email=?').bind(old).run()
    expect((await application({env:environment(old),params:{id:'transfer'}})).status).toBe(404)
    expect((await application({env:environment(old),params:{id:'untouched'}})).status).toBe(200)
  })
  it('rejects stale CAS, nonmatching departments and inactive or unknown targets',async()=>{
    expect((await post('transfer',payload(old))).status).toBe(409)
    expect((await post('rollback',payload(null,other))).status).toBe(400)
    expect((await post('rollback',payload(null,inactive))).status).toBe(400)
    expect((await post('rollback',payload(null,'missing@local.invalid'))).status).toBe(400)
    expect((await post('invalid-dept')).status).toBe(400)
    expect((await post('missing')).status).toBe(404)
    expect((await DB.prepare("SELECT owner_email FROM application WHERE id='rollback'").first()).owner_email).toBeNull()
  })
  it('keeps general owner changes forbidden even for admins and rechecks actor authority inside the RPC',async()=>{
    await expect(environment(admin).DB.prepare('UPDATE application SET owner_email=? WHERE id=?').bind(old,'legacy').run()).rejects.toThrow('/42501')
    const args={applicationId:'rollback',expectedOwnerEmail:null,newOwnerEmail:next,reason:payload().reason,requestId:crypto.randomUUID()}
    await expect(environment(staff).DB.assignApplicationOwner(args)).rejects.toThrow('/42501')
    await DB.prepare('UPDATE override_actor SET active=0 WHERE email=?').bind(admin).run()
    await expect(environment(admin).DB.assignApplicationOwner(args)).rejects.toThrow('/28000')
    await DB.prepare('UPDATE override_actor SET active=1,role=? WHERE email=?').bind('product',admin).run()
    await expect(environment(admin).DB.assignApplicationOwner(args)).rejects.toThrow('/42501')
    await DB.prepare('UPDATE override_actor SET role=? WHERE email=?').bind('audit',admin).run()
    const privileges=(await pg.query("SELECT has_function_privilege('anon','public.ilson_assign_application_owner(text,text,text,text,text,text)','EXECUTE') anon,has_function_privilege('ilson_scoped_executor','public.ilson_assign_application_owner(text,text,text,text,text,text)','EXECUTE') scoped")).rows[0]
    expect(privileges).toEqual({anon:false,scoped:false})
  })
  it('rolls back the ownership update if its audit record cannot be written',async()=>{
    await pg.exec("CREATE FUNCTION public.test_owner_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='assign_application_owner' AND NEW.entity_id='rollback' THEN RAISE EXCEPTION 'test audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER test_owner_audit_failure BEFORE INSERT ON public.override_audit FOR EACH ROW EXECUTE FUNCTION public.test_owner_audit_failure();")
    const key=crypto.randomUUID()
    try{
      expect((await post('rollback',payload(),admin,key)).status).toBe(503)
      expect((await DB.prepare("SELECT owner_email FROM application WHERE id='rollback'").first()).owner_email).toBeNull()
      expect((await DB.prepare("SELECT id FROM override_audit WHERE entity_id='rollback'").all()).results).toHaveLength(0)
    }finally{await pg.exec('DROP TRIGGER test_owner_audit_failure ON public.override_audit; DROP FUNCTION public.test_owner_audit_failure();')}
    expect((await post('rollback',payload(),admin,key)).status).toBe(200)
    expect((await DB.prepare("SELECT id FROM override_audit WHERE entity_id='rollback'").all()).results).toHaveLength(1)
  })
})
