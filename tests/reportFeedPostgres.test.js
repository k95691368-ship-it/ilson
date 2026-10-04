// @vitest-environment node
// Signed Pages middleware + current migrations and RPCs, disposable memory PG.
// ONE connection, queued RPCs: not production load or multi-session concurrency.
import { afterAll,afterEach,beforeAll,describe,expect,it,vi } from 'vitest'
import { readFileSync,readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { createSupabaseDb } from '../functions/_lib/dbBridge.ts'
import { onRequest } from '../functions/api/_middleware.js'
import { onRequestGet as reportsGet } from '../functions/api/reports.js'
import { onRequestGet as toolsGet } from '../functions/api/tools/index.js'
import { loadReportFeed } from '../functions/_lib/reportFeed.ts'

const pg=new PGlite(),base='https://report-feed-memory.supabase.co',issuer='https://report-feed-memory.cloudflareaccess.com'
const email='report-owner@local.invalid',other='report-other@local.invalid',admin='report-admin@local.invalid'
const DB=createSupabaseDb(base,'synthetic-only')
const env={DB,DBBridgeApplied:true,SUPABASE_URL:base,SUPABASE_SERVICE_ROLE_KEY:'synthetic-only',ACCESS_TEAM_DOMAIN:issuer,ACCESS_AUD:'report-feed-memory',DEMO_WORKSPACES:'false',OVERRIDE_DEMO_MODE:'false'}
let pair,jwk,queue=Promise.resolve(),sequence=0,beforeRead=null,failRead=false,malformedRead=false,damagedWrapper=null
const calls=[],wire=[]
beforeAll(async()=>{
  await pg.exec('CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;')
  const directory=new URL('../supabase/migrations/',import.meta.url)
  for(const file of readdirSync(directory).filter(name=>/^\d+.*\.sql$/.test(name)).sort())await pg.exec(readFileSync(new URL(file,directory),'utf8'))
  await pg.query(`INSERT INTO override_actor(email,display_name,role,departments_json) VALUES
    ($1,'담당자','product','["Finance"]'),($2,'다른 담당','product','["Other"]'),($3,'감사','audit','[]')`,[email,other,admin])
  pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify'])
  jwk={...await crypto.subtle.exportKey('jwk',pair.publicKey),kid:env.ACCESS_AUD,alg:'RS256',use:'sig'}
  vi.stubGlobal('fetch',(url,options)=>{
    if(String(url)===issuer+'/cdn-cgi/access/certs')return Promise.resolve(Response.json({keys:[jwk]}))
    if(!String(url).startsWith(base+'/rest/v1/rpc/'))throw Error('External network prohibited')
    const name=new URL(url).pathname.split('/').at(-1),args=JSON.parse(options.body),sql=args.p_sql??''
    calls.push({name,sql})
    const run=queue.then(async()=>{
      try{
        if(sql.startsWith('WITH latest_fix')){
          if(beforeRead){const hook=beforeRead;beforeRead=null;await hook()}
          if(failRead)return Response.json({code:'XX000',message:'PRIVATE_SQL_SENTINEL'},{status:503})
          if(malformedRead)return Response.json({rows:[{payload:{counts:[],rows:null}}],rowCount:1,last_row_id:null})
          if(damagedWrapper)return Response.json(damagedWrapper)
        }
        await pg.exec('SET ROLE service_role')
        const values=Object.values(args),data=(await pg.query(`SELECT public.${name}(${values.map((_,i)=>'$'+(i+1)).join(',')}) AS data`,values)).rows[0].data
        if(sql.startsWith('WITH latest_fix'))wire.push(data)
        return Response.json(data)
      }catch(error){return Response.json({code:error.code,message:'PRIVATE_SQL_SENTINEL'},{status:400})}
      finally{await pg.exec('RESET ROLE')}
    })
    queue=run.catch(()=>{})
    return run
  })
},60000)
afterEach(async()=>{
  await queue;beforeRead=null;failRead=false;malformedRead=false;damagedWrapper=null;calls.length=0;wire.length=0
  await pg.exec('TRUNCATE decision_log,application CASCADE')
  await pg.query(`UPDATE override_actor SET active=1,role='product',departments_json='["Finance"]' WHERE email=$1`,[email])
})
afterAll(async()=>{await queue;vi.unstubAllGlobals();await pg.close()})
const at=n=>new Date(Date.UTC(2026,9,1,0,0,n)).toISOString().replace('T',' ').replace('.000Z','')
async function jwt(identity){
  const enc=v=>Buffer.from(JSON.stringify(v)).toString('base64url'),now=Math.floor(Date.now()/1000)
  const text=enc({alg:'RS256',kid:jwk.kid})+'.'+enc({iss:issuer,aud:[jwk.kid],email:identity,iat:now,exp:now+600})
  return text+'.'+Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,new TextEncoder().encode(text))).toString('base64url')
}
async function invoke(query='',options={}){
  const identity=options.identity??email,database=options.token?createSupabaseDb(base,'synthetic-only',options.token):DB.forActor(identity)
  const headers={'X-Ilson-Scope':await database.toolRunScope()}
  if(options.token)headers.Cookie='ilson_workspace='+options.token
  else headers['Cf-Access-Jwt-Assertion']=await jwt(identity)
  const request=new Request('https://local.invalid/api/'+(options.tools?'tools':'reports')+query,{headers}),data={}
  const bindings=options.token?{...env,DEMO_WORKSPACES:'true',OVERRIDE_DEMO_MODE:'true'}:env
  const context={env:bindings,data,request}
  context.next=forwarded=>(options.tools?toolsGet:reportsGet)({env:bindings,data,request:forwarded??request})
  const response=await onRequest(context)
  return{status:response.status,body:await response.json(),headers:response.headers}
}
async function app({owner=email,dept='Finance',handed=true,stopped=false,database=DB}={}){
  const id='report-app-'+(++sequence),slug='report-tool-'+sequence
  await database.prepare(`INSERT INTO application(id,ticket_no,dept,applicant_label,title,bottleneck,problem,status,owner_email)
    VALUES(?,?,?,'합성','신고 조사','취합','반복','수용',?)`).bind(id,id,dept,owner).run()
  if(handed)await database.prepare(`INSERT INTO handover(application_id,slug,title,handed_to_dept,handed_to_person,rolled_back_at)
    VALUES(?,?,?,?,'합성',?)`).bind(id,slug,slug,dept,stopped?at(1):null).run()
  return{id,slug,database}
}
async function log(a,id,kind='신고',link='wrong_number',time=at(0),what=id){
  await a.database.prepare(`INSERT INTO decision_log(id,application_id,stage,actor,title,what,why,link_kind,link_id,created_at)
    VALUES(?,?,'배포','human','합성 직원',?,'합성 근거',?,?,?)`).bind(id,a.id,what,kind,link,time).run()
}
async function ordinary(a,n,{prefix='ordinary-',time=null,body=null}={}){
  await pg.query(`INSERT INTO decision_log(id,application_id,stage,actor,title,what,why,link_kind,link_id,created_at)
    SELECT $1||lpad(i::text,4,'0'),$2,'배포','human','합성 직원',coalesce($4,$1||i::text),'합성 근거','신고','hard_to_use',
      coalesce($3,to_char(timestamp '2026-10-01 00:00:00'+i*interval '1 second','YYYY-MM-DD HH24:MI:SS')) FROM generate_series(1,$5::int) AS i`,[prefix,a.id,time,body,n])
}
const ids=result=>result.body.tools.flatMap(t=>t.reports).map(r=>r.id)

describe.sequential('bounded report GET through signed scope and actual PostgreSQL',()=>{
  it('puts an old urgent report before 200 ordinary reports and agrees with whole tool trust',async()=>{
    const old=await app(),recent=await app()
    await log(old,'old-urgent');await ordinary(recent,200)
    calls.length=0;const first=await invoke()
    expect(first.status).toBe(200);expect(first.body.summary).toEqual({total:201,open:201,urgent:1,fixed:0,toolsUntrusted:1})
    expect(ids(first)).toHaveLength(100);expect(ids(first)[0]).toBe('old-urgent')
    expect(first.body.page).toMatchObject({number:1,size:100,total:201,totalPages:3,hasPrevious:false,hasMore:true,basis:expect.stringMatching(/^[a-f0-9]{64}$/)})
    expect(first.body.tools.find(t=>t.applicationId===recent.id)).toMatchObject({total:200,open:200,urgent:0,fixed:0})
    expect(calls.filter(c=>c.sql.startsWith('WITH latest_fix'))).toHaveLength(1)
    expect(wire[0].rows).toHaveLength(1);expect(wire[0].rows[0].payload.rows).toHaveLength(100)
    const tools=await invoke('',{tools:true})
    expect(tools.body.items.find(t=>t.application_id===old.id).trust.urgent).toBe(1)
    expect(tools.body.summary.untrusted).toBe(first.body.summary.toolsUntrusted)
    expect(first.headers.get('Cache-Control')).toBe('private, no-store')
  })
  it('keeps the old original and its latest fix even after 200 newer ordinary origins',async()=>{
    const old=await app(),recent=await app();await log(old,'fixed-old');await ordinary(recent,200)
    await log(old,'fix-old','신고처리','fixed-old',at(400),'예전 처리')
    await log(old,'fix-new','신고처리','fixed-old',at(500),'최근 처리')
    const first=await invoke(),last=await invoke('?page=3&basis='+first.body.page.basis)
    expect(last.status).toBe(200);expect(first.body.summary).toMatchObject({total:201,open:200,fixed:1,urgent:0})
    expect(ids(last)).toEqual(['fixed-old'])
    expect(last.body.tools[0]).toMatchObject({total:1,open:0,fixed:1,reports:[{open:false,fix:{how:'최근 처리'}}]})
    const tools=await invoke('',{tools:true})
    expect(tools.body.items.find(t=>t.application_id===old.id).trust.open).toBe(0)
  })
  it('covers all 408 origins including 205 timestamp ties with complete per-tool badges',async()=>{
    const old=await app(),recent=await app(),down=await app({stopped:true}),hidden=await app({owner:other,dept:'Other'})
    await log(old,'old-urgent');await log(old,'fixed-old');await log(old,'fix','신고처리','fixed-old',at(500),'최근 처리')
    await ordinary(recent,200);await ordinary(recent,205,{prefix:'tie-',time:at(250)})
    await log(down,'down-urgent','신고','missing_rows',at(201));await log(hidden,'hidden-urgent')
    const first=await invoke(),seen=[]
    expect(first.body.summary).toEqual({total:408,open:407,urgent:2,fixed:1,toolsUntrusted:2})
    expect(first.body.tools.find(t=>t.applicationId===recent.id).reports).toHaveLength(98)
    expect(first.body.tools.find(t=>t.applicationId===recent.id).open).toBe(405)
    for(let page=1;page<=5;page++){
      const response=page===1?first:await invoke('?page='+page+'&basis='+first.body.page.basis)
      expect(response.status).toBe(200);expect(response.body.summary).toEqual(first.body.summary)
      expect(ids(response).length).toBeLessThanOrEqual(100);seen.push(...ids(response))
      expect(response.body.page).toMatchObject({number:page,hasMore:page<5,hasPrevious:page>1,basis:first.body.page.basis})
    }
    expect(seen).toHaveLength(408);expect(new Set(seen).size).toBe(408);expect(seen).not.toContain('hidden-urgent')
    const beyond=await invoke('?page=10000&basis='+first.body.page.basis)
    expect(beyond.status).toBe(200);expect(beyond.body.tools).toEqual([])
    expect(beyond.body.page).toMatchObject({number:10000,totalPages:5,hasPrevious:true,hasMore:false})
  })
  it('preserves owner/dept/null-owner RLS, same-app fixes and stopped/unhanded reports',async()=>{
    const visible=await app(),hidden=await app({owner:other,dept:'Other'}),nullOwner=await app({owner:null}),ownOther=await app({dept:'Other'}),assigned=await app({owner:other}),down=await app({stopped:true}),unhanded=await app({handed:false})
    for(const [i,a]of[visible,hidden,nullOwner,ownOther,assigned,down,unhanded].entries())await log(a,'scope-'+i)
    await log(assigned,'wrong-app-fix','신고처리','scope-0',at(100),'다른 업무 처리')
    await log(hidden,'hidden-fix','신고처리','scope-0',at(101),'숨긴 처리 원문')
    const real=await invoke(),audit=await invoke('',{identity:admin})
    expect(ids(real).sort()).toEqual(['scope-0','scope-3','scope-4','scope-5','scope-6'])
    expect(real.body.summary).toMatchObject({total:5,open:5,urgent:5,fixed:0})
    expect(real.body.tools.find(t=>t.applicationId===visible.id).reports[0].open).toBe(true)
    expect(JSON.stringify(real.body)).not.toContain('숨긴 처리 원문')
    expect(real.body.tools.find(t=>t.applicationId===unhanded.id)).toMatchObject({slug:null,toolTitle:'Finance',dept:'Finance'})
    expect(audit.body.summary.total).toBe(7)
    const tools=await invoke('',{tools:true})
    expect(tools.body.items.find(t=>t.application_id===down.id)).toMatchObject({health:'내림',trust:{urgent:1}})
  })
  it('chooses same-app fix timestamp/id deterministically, independent of input read direction',async()=>{
    const a=await app();await log(a,'origin')
    await log(a,'fix-a','신고처리','origin',at(10),'동률 A')
    await log(a,'fix-z','신고처리','origin',at(10),'동률 Z')
    const response=await invoke()
    expect(response.body.tools[0].reports[0].fix.how).toBe('동률 Z')
    expect(response.body.summary).toMatchObject({total:1,fixed:1,open:0})
  })
  it('matches shared Unicode tie order and treats prototype codes as ordinary unknown types',async()=>{
    const a=await app();await log(a,'😀');await log(a,'\ue000');await log(a,'unknown','신고','__proto__')
    await log(a,'fix-\ue000','신고처리','😀',at(10),'BMP');await log(a,'fix-😀','신고처리','😀',at(10),'astral')
    const result=await invoke()
    expect(result.body.tools[0].reports.find(r=>r.id==='😀').fix.how).toBe('astral')
    expect(result.body.tools[0].reports.find(r=>r.id==='unknown')).toMatchObject({code:'other',urgent:false})
    expect(result.body.tools[0].reports.map(r=>r.id)).toEqual(['\ue000','unknown','😀'])
  })
  it.each(['?page=0','?page=10001','?page=01','?size=100','?basis=bad','?page=1&page=2'])('rejects %s without a report query after middleware authentication',async query=>{
    calls.length=0;expect((await invoke(query)).status).toBe(400)
    expect(calls.filter(c=>c.sql.startsWith('WITH latest_fix'))).toEqual([])
  })
  it.each([
    ['new origin',a=>log(a,'new-urgent','신고','wrong_number',at(-1))],
    ['origin text',()=>pg.query("UPDATE decision_log SET what='변경된 실제 제보' WHERE id='origin'")],
    ['origin delete',()=>pg.query("DELETE FROM decision_log WHERE id='origin'")],
    ['origin kind',()=>pg.query("UPDATE decision_log SET link_id='missing_rows' WHERE id='origin'")],
    ['new fix',a=>log(a,'fix','신고처리','origin',at(10),'새로운 처리')],
    ['application metadata',a=>pg.query("UPDATE application SET ticket_no=ticket_no||'-changed' WHERE id=$1",[a.id])],
    ['handover metadata',a=>pg.query("UPDATE handover SET title='바뀐 도구명' WHERE application_id=$1",[a.id])],
    ['stop metadata',a=>pg.query("UPDATE handover SET rolled_back_at='2026-10-04 00:00:00' WHERE application_id=$1",[a.id])],
  ])('rejects old basis after %s without leaking new/old content',async(_name,change)=>{
    const a=await app();await log(a,'origin');const before=await invoke()
    await change(a)
    const stale=await invoke('?page=1&basis='+before.body.page.basis),fresh=await invoke()
    expect(stale.status).toBe(409);expect(stale.body).toEqual({error:'신고 기록이 바뀌었습니다. 첫 페이지에서 다시 확인해주세요.',code:'REPORTS_CHANGED'})
    expect(fresh.status).toBe(200);expect(fresh.body.page.basis).not.toBe(before.body.page.basis)
  })
  it.each([
    ['selected fix text',()=>pg.query("UPDATE decision_log SET what='수정된 처리 본문' WHERE id='selected-fix'")],
    ['selected fix rationale',()=>pg.query("UPDATE decision_log SET why='수정된 원인 근거' WHERE id='selected-fix'")],
    ['selected fix delete',()=>pg.query("DELETE FROM decision_log WHERE id='selected-fix'")],
  ])('detects %s even with unchanged old origin counts/max times',async(_name,change)=>{
    const a=await app();await log(a,'origin');await log(a,'old-fix','신고처리','origin',at(1),'예전 처리')
    await log(a,'selected-fix','신고처리','origin',at(2),'선택된 처리');const before=await invoke()
    await change()
    expect((await invoke('?basis='+before.body.page.basis)).status).toBe(409)
    const fresh=await invoke();expect(fresh.body.page.basis).not.toBe(before.body.page.basis)
    expect(fresh.body.summary).toMatchObject({total:1,fixed:1})
  })
  it('keeps a basis stable across unchanged pages/hidden-source changes and distinct across scopes',async()=>{
    const visible=await app(),hidden=await app({owner:other,dept:'Other'});await ordinary(visible,150);await log(hidden,'hidden')
    const first=await invoke();await pg.query("UPDATE decision_log SET what='숨긴 변경' WHERE id='hidden'")
    const next=await invoke('?page=2&basis='+first.body.page.basis)
    expect(next.status).toBe(200);expect(next.body.page.basis).toBe(first.body.page.basis)
    const otherScope=await invoke('',{identity:admin})
    expect((await invoke('?basis='+otherScope.body.page.basis)).status).toBe(409)
  })
  it('returns explicit failure on query error/malformed wrapper rather than fake zeros',async()=>{
    await log(await app(),'origin');failRead=true
    const failed=await invoke();expect(failed.status).toBe(503);expect(failed.body).toEqual({error:'신고를 불러오지 못했습니다.'})
    failRead=false;malformedRead=true
    const malformed=await invoke();expect(malformed.status).toBe(503);expect(malformed.body).not.toHaveProperty('summary')
    expect(JSON.stringify(malformed.body)).not.toContain('PRIVATE_SQL_SENTINEL')
  })
  it.each([
    {rows:[{payload:{counts:[],rows:[]}},{payload:{counts:[],rows:[]}}],rowCount:2,last_row_id:null},
    {rows:[{payload:{counts:[],rows:[]}}],rowCount:0,last_row_id:null},
    {rows:[],rowCount:1,last_row_id:null},
  ])('rejects inconsistent RPC wrapper rows/count through the actual bridge %#',async value=>{
    await log(await app(),'origin');damagedWrapper=value
    const response=await invoke()
    expect(response.status).toBe(503);expect(response.body).toEqual({error:'신고를 불러오지 못했습니다.'})
    expect(response.body).not.toHaveProperty('summary')
  })
  it('preserves branded current actor revocation at the actual feed query',async()=>{
    await log(await app(),'origin');beforeRead=()=>pg.query('UPDATE override_actor SET active=0 WHERE email=$1',[email])
    const response=await invoke();expect(response.status).toBe(401);expect(response.body.code).toBe('ACCESS_REVOKED')
    expect(response.body).not.toHaveProperty('summary')
  })
  it('bounds huge original text on the DB-to-worker wire to 100 origins',async()=>{
    const a=await app(),huge='BODY_SENTINEL_'+('가'.repeat(16000));await ordinary(a,205,{body:huge})
    wire.length=0;const response=await invoke()
    expect(response.status).toBe(200);expect(response.body.summary.total).toBe(205)
    expect(wire).toHaveLength(1);expect(wire[0].rows[0].payload.rows).toHaveLength(100)
    expect(JSON.stringify(wire[0]).split('BODY_SENTINEL_').length-1).toBe(100)
    expect(ids(response)).toHaveLength(100)
    expect(wire[0].rows[0].payload.counts[0].digest).toMatch(/^[a-f0-9]{32}$/)
    // Counts carry only compact known counts/digests, never all original bodies.
    expect(JSON.stringify(wire[0].rows[0].payload.counts)).not.toContain('BODY_SENTINEL_')
  })
  it('preserves isolation through actual demo middleware and CTE search_path',async()=>{
    const tokenA='a'.repeat(64),tokenB='b'.repeat(64)
    await DB.workspaceOpen(tokenA,[]);await DB.workspaceOpen(tokenB,[])
    const a=await app({database:createSupabaseDb(base,'synthetic-only',tokenA)}),b=await app({database:createSupabaseDb(base,'synthetic-only',tokenB)})
    await log(a,'demo-A');await log(b,'demo-B');await log(await app(),'production-origin')
    const ra=await invoke('',{token:tokenA}),rb=await invoke('',{token:tokenB}),real=await invoke()
    expect(ra.status).toBe(200);expect(rb.status).toBe(200)
    expect(ids(ra)).toEqual(['demo-A']);expect(ids(rb)).toEqual(['demo-B']);expect(ids(real)).toEqual(['production-origin'])
    expect(ra.body.page.basis).not.toBe(rb.body.page.basis)
    expect((await invoke('?basis='+ra.body.page.basis,{token:tokenB})).status).toBe(409)
    expect(await loadReportFeed(createSupabaseDb(base,'synthetic-only',tokenA),{number:1,basis:null})).toMatchObject({summary:{total:1}})
  },60000)
})
