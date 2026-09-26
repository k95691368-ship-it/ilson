// @vitest-environment node
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { createSupabaseDb } from '../functions/_lib/dbBridge.js'
import { loadOutcomeEvidence, loadOutcomeEvidenceMany, assessOutcomeEvidence, evidenceMetadata } from '../functions/_lib/outcomeEvidence.js'
import { onRequestGet as getOutcome, onRequestPost as postOutcome } from '../functions/api/applications/[id]/outcome.js'
import { onRequestGet as getDirect, onRequestPost as postDirect } from '../functions/api/track/[ticket]/outcome.js'
import { onRequestGet as getAgreement, onRequestPost as postAgreement } from '../functions/api/applications/[id]/agreement.js'
import { OUTCOME_KIND, OUTCOME_PROXY_KIND } from '../shared/accept.js'

const pg = new PGlite()
const DB = createSupabaseDb('https://outcome-test.supabase.co','local-only')
const env = { DB, DEMO_WORKSPACE:true }
let queue=Promise.resolve(),seq=0
beforeAll(async()=>{
  await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;')
  const directory=new URL('../supabase/migrations/',import.meta.url)
  for(const file of readdirSync(directory).filter(name=>/^\d+.*\.sql$/.test(name)).sort()) await pg.exec(readFileSync(new URL(file,directory),'utf8'))
  vi.stubGlobal('fetch',(url,options)=>{
    if(!String(url).startsWith('https://outcome-test.supabase.co/rest/v1/rpc/')) throw Error('Unexpected network')
    const result=queue.then(async()=>{
      try {
        await pg.exec('SET ROLE service_role')
        const args=Object.values(JSON.parse(options.body)),name=new URL(url).pathname.split('/').at(-1)
        return Response.json((await pg.query(`SELECT public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) AS data`,args)).rows[0].data)
      } catch(error) { return Response.json({code:error.code},{status:400}) }
      finally { await pg.exec('RESET ROLE') }
    })
    queue=result.catch(()=>{})
    return result
  })
},60000)
afterAll(async()=>{vi.restoreAllMocks();vi.unstubAllGlobals();await pg.close()})
async function fixture({baseline=true,runs=4}={}) {
  const id=`evidence-${++seq}`,ticket=`AX-EVIDENCE-${seq}`
  await pg.query("INSERT INTO application(id,ticket_no,dept,applicant_label,title,bottleneck,problem,status,current_frequency) VALUES($1,$2,'검증부서','검증자','성과 검증','수작업','지연','완료','매일')",[id,ticket])
  if(baseline) await pg.query("INSERT INTO baseline(application_id,median_seconds,min_seconds,max_seconds,sample_n,people,frequency,hourly_wage_krw) VALUES($1,600,600,600,5,1,'매일',3600)",[id])
  for(let i=0;i<runs;i++) await pg.query('INSERT INTO tool_use(id,application_id,ok,duration_ms,human_review_seconds,rework_seconds) VALUES($1,$2,1,1000,30,0)',[`${id}-run-${i}`,id])
  return {id,ticket}
}
const request=(body,key=crypto.randomUUID())=>new Request('https://test.invalid/api/outcome',{method:'POST',headers:{'Content-Type':'application/json','X-Idempotency-Key':key,'CF-Connecting-IP':crypto.randomUUID()},body:JSON.stringify(body)})
const get=async app=>(await getOutcome({env,params:{id:app.id}})).json()
const state=async app=>(await getDirect({env,params:{ticket:app.ticket}})).json()
async function bodyFor(app,body) {return {expectedEvidence:(await get(app)).expectedEvidence,...body}}
const post=async(app,body,key,overEnv=env)=>postOutcome({env:overEnv,params:{id:app.id},request:request(body,key)})
const direct=async(app,body,key,overEnv=env)=>postDirect({env:overEnv,params:{ticket:app.ticket},request:request(body,key)})
const proxyBody={kind:'dept_confirm',by:'검증 담당',comment:'현재 수치 확인'}

describe.sequential('성과 확인 근거와 원자 저장 PostgreSQL 회귀',()=>{
  it('기준선 또는 실행이 없으면 직접/대리 확인을 저장하지 않는다',async()=>{
    for(const options of [{baseline:false},{runs:0}]) {
      const app=await fixture(options)
      expect((await state(app)).state.canConfirm).toBe(false)
      expect((await post(app,await bodyFor(app,proxyBody))).status).toBe(400)
      expect((await direct(app,await bodyFor(app,{by:'검증 담당',agree:true}))).status).toBe(400)
      expect((await pg.query('SELECT count(*) AS n FROM outcome WHERE application_id=$1',[app.id])).rows[0].n).toBe(0)
    }
  })
  it('현재 수치 확인은 자기 무효화 없이 저장되며 유실 응답 재시도는 1건이다',async()=>{
    const app=await fixture(),body=await bodyFor(app,{by:'현장 담당',agree:true}),key=crypto.randomUUID()
    expect((await direct(app,body,key)).status).toBe(200)
    expect((await direct(app,body,key)).headers.get('X-Idempotency-Replayed')).toBe('1')
    expect((await get(app)).confirmation).toMatchObject({current:true,kind:OUTCOME_KIND})
    expect((await state(app)).state).toMatchObject({status:'부서가 확인함',netKrw:2276,successCount:4})
    expect((await pg.query('SELECT count(*) AS n FROM decision_log WHERE application_id=$1',[app.id])).rows[0].n).toBe(1)
  })
  it('금액 수정 후 기존 확인/해소 기록을 보존하되 현재의 확인으로 쓰지 않는다',async()=>{
    const app=await fixture()
    expect((await post(app,await bodyFor(app,proxyBody))).status).toBe(200)
    for(const c of (await get(app)).challenges) expect((await post(app,await bodyFor(app,{kind:'resolve_challenge',rule_code:c.code,resolution:'기존 수치의 현장 근거'}))).status).toBe(200)
    const before=await get(app)
    expect(before.label.label).toBe('확인됨')
    const original=(await pg.query('SELECT * FROM outcome WHERE application_id=$1',[app.id])).rows[0]
    expect((await post(app,await bodyFor(app,{kind:'inputs',dev_hours:0,ops_cost_krw:2000}))).status).toBe(200)
    const after=await get(app)
    expect(after.outcome.netKrw).toBe(276)
    expect(after.confirmation).toMatchObject({current:false,previous:{by:'검증 담당'}})
    expect(after.saved.dept_confirmed_at).toBeNull()
    expect(after.challenges.find(c=>c.code==='seasonality')).toMatchObject({resolved_at:null,previousResolution:'기존 수치의 현장 근거'})
    expect(after.label.label).toBe('보수적 추정')
    expect((await pg.query('SELECT dept_confirmed_at FROM outcome WHERE application_id=$1',[app.id])).rows[0].dept_confirmed_at).toBe(original.dept_confirmed_at)
    expect((await post(app,await bodyFor(app,proxyBody))).status).toBe(200)
    expect((await get(app)).confirmation.current).toBe(true)
  })
  it('과거 증거 없는 확인/해소를 삭제하지 않으며 현재 확인으로 승격하지 않는다',async()=>{
    const app=await fixture()
    await pg.query("INSERT INTO outcome(application_id,dept_confirmed_at,dept_confirmed_by) VALUES($1,datetime('now'),'과거 담당')",[app.id])
    await pg.query("INSERT INTO outcome_challenge(id,application_id,rule_code,title,body,resolved_at,resolution) VALUES($1,$2,'seasonality','이전','이전',datetime('now'),'이전 해소')",[`${app.id}-legacy`,app.id])
    const result=await get(app)
    expect(result.confirmation).toMatchObject({current:false,legacy:true,previous:{by:'과거 담당'}})
    expect(result.challenges.find(c=>c.code==='seasonality')).toMatchObject({resolved_at:null,previousResolution:'이전 해소'})
    expect((await pg.query('SELECT count(*) AS n FROM outcome_challenge WHERE application_id=$1',[app.id])).rows[0].n).toBe(1)
  })
  it('다른 탭의 값 변경과 새 실행은 이전 확인 토큰을 거절한다',async()=>{
    const app=await fixture(),old=await bodyFor(app,proxyBody)
    expect((await post(app,await bodyFor(app,{kind:'inputs',ops_cost_krw:100}))).status).toBe(200)
    expect((await post(app,old)).status).toBe(409)
    const beforeRun=await bodyFor(app,proxyBody)
    await pg.query('INSERT INTO tool_use(id,application_id,ok,duration_ms) VALUES($1,$2,1,1000)',[`${app.id}-new`,app.id])
    expect((await post(app,beforeRun)).status).toBe(409)
  })
  it('성공 후 같은 요청 번호의 다른 내용은 거절하고 동시 변경 1개만 저장한다',async()=>{
    const app=await fixture(),body=await bodyFor(app,{kind:'inputs',ops_cost_krw:100}),key=crypto.randomUUID()
    expect((await post(app,body,key)).status).toBe(200)
    expect((await post(app,{...body,ops_cost_krw:200},key)).status).toBe(409)
    let waiting=0,release
    const barrier=new Promise(resolve=>{release=resolve})
    const concurrentEnv={...env,DB:{...DB,commitMutation:async(...args)=>{if(++waiting===2) release();await barrier;return DB.commitMutation(...args)}}}
    const viewed=await bodyFor(app,{kind:'inputs',ops_cost_krw:300})
    const responses=await Promise.all([post(app,viewed,undefined,concurrentEnv),post(app,{...viewed,ops_cost_krw:400},undefined,concurrentEnv)])
    expect(responses.map(r=>r.status).sort()).toEqual([200,409])
  })
  it('감사 저장 실패 시 계산값과 확인을 함께 롤백한다',async()=>{
    const app=await fixture(),body=await bodyFor(app,{kind:'inputs',ops_cost_krw:555}),key=crypto.randomUUID()
    await pg.exec(`CREATE FUNCTION public.outcome_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.link_kind='성과산정변경' THEN RAISE EXCEPTION 'test failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER outcome_test_failure BEFORE INSERT ON decision_log FOR EACH ROW EXECUTE FUNCTION public.outcome_test_failure();`)
    try {
      expect((await post(app,body,key)).status).toBe(503)
      expect((await pg.query('SELECT count(*) AS n FROM outcome WHERE application_id=$1',[app.id])).rows[0].n).toBe(0)
    } finally {await pg.exec('DROP TRIGGER outcome_test_failure ON decision_log; DROP FUNCTION public.outcome_test_failure()')}
    expect((await post(app,body,key)).status).toBe(200)
  })
  it('다른 부서는 직접 확인할 수 없다',async()=>{
    const app=await fixture()
    await pg.query("INSERT INTO override_actor(email,display_name,role,departments_json) VALUES('local@test.invalid','검증자','operations','[\"다른부서\"]')")
    const response=await direct(app,await bodyFor(app,{by:'검증자',agree:true}),undefined,{DB,AUTH_ACTOR:{mode:'access',email:'local@test.invalid',role:'employee',departments:['다른부서']}})
    expect(response.status).toBe(403)
  })
  it('부서 확인 의무를 일반 반박 해소로 우회하지 않는다',async()=>{
    const app=await fixture()
    expect((await post(app,await bodyFor(app,{kind:'resolve_challenge',rule_code:'no_dept_confirm',resolution:'직접 확인 없이 해소'}))).status).toBe(400)
    expect((await get(app)).confirmation.current).toBe(false)
  })
  it('음수·무한·비숫자 비용과 허용되지 않은 상각 기간은 쓰기 없이 거절한다',async()=>{
    const app=await fixture()
    for(const invalid of [{dev_hours:-100},{ops_cost_krw:-1000},{dev_hours:'Infinity'},{ops_cost_krw:[]},{dev_hours:true},{amortize_months:0},{amortize_months:1.5}]) {
      expect((await post(app,{kind:'inputs',...invalid})).status,JSON.stringify(invalid)).toBe(400)
    }
    expect((await pg.query('SELECT count(*) AS n FROM outcome WHERE application_id=$1',[app.id])).rows[0].n).toBe(0)
  })
  it('체감 시간 빈칸·null·불리언은 0으로 바꾸지 않고 명시적인 0만 허용한다',async()=>{
    const app=await fixture()
    for(const felt of ['',null,'   ',false,[], 'Infinity']) expect((await direct(app,await bodyFor(app,{by:'검증자',agree:false,felt}))).status).toBe(400)
    expect((await direct(app,await bodyFor(app,{by:'검증자',agree:false,felt:0}))).status).toBe(200)
    expect((await state(app)).state.deptFelt).toBe(0)
  })
  it('기준선 봉인을 같은 잠금으로 저장하고 재산정된 기준선은 이전 확인을 무효화한다',async()=>{
    const app=await fixture()
    await post(app,await bodyFor(app,proxyBody))
    for(let i=0;i<3;i++) await pg.query('INSERT INTO shadow_run(id,application_id,seq,total_seconds,error_count) VALUES($1,$2,$3,900,0)',[`${app.id}-shadow-${i}`,app.id,i+1])
    for(const invalid of [{people:-1},{hourly_wage_krw:-5}]) expect((await postAgreement({env,params:{id:app.id},request:request({kind:'baseline',...invalid})})).status).toBe(400)
    expect((await postAgreement({env,params:{id:app.id},request:request({kind:'baseline',people:2,hourly_wage_krw:7200,expectedVersion:(await(await getAgreement({env,params:{id:app.id}})).json()).baseline_source_version})})).status).toBe(200)
    const after=await get(app)
    expect(after.baseline).toMatchObject({people:2,hourly_wage_krw:7200,median_seconds:900})
    expect(after.confirmation.current).toBe(false)
  })
  it('실측 추가와 봉인이 동시에 진행되면 오래된 표본 봉인은 거절한다',async()=>{
    const app=await fixture()
    for(let i=0;i<3;i++) await pg.query('INSERT INTO shadow_run(id,application_id,seq,total_seconds,error_count) VALUES($1,$2,$3,600,0)',[`${app.id}-shadow-${i}`,app.id,i+1])
    let announce,release
    const arrived=new Promise(done=>{announce=done}),gate=new Promise(done=>{release=done})
    const delayed={...env,DB:{...DB,commitMutation:async(...args)=>{announce();await gate;return DB.commitMutation(...args)}}}
    const seal=postAgreement({env:delayed,params:{id:app.id},request:request({kind:'baseline',expectedVersion:(await(await getAgreement({env,params:{id:app.id}})).json()).baseline_source_version})})
    await arrived
    const measurement=await postAgreement({env,params:{id:app.id},request:request({kind:'shadow_run',total_seconds:1800})})
    expect(measurement.status).toBe(201)
    release()
    expect((await seal).status).toBe(409)
    expect((await get(app)).baseline.sample_n).toBe(5)
  })
  it('단순 날짜 경과는 같은 수치의 확인을 매일 무효화하지 않는다',async()=>{
    const app=await fixture()
    await post(app,await bodyFor(app,proxyBody))
    const before=await loadOutcomeEvidence(DB,app.id),now=Date.now()
    const clock=vi.spyOn(Date,'now').mockReturnValue(now+86400000)
    try {const after=await loadOutcomeEvidence(DB,app.id);expect(after.coreFingerprint).toBe(before.coreFingerprint);expect(after.confirmation.current).toBe(true)} finally {clock.mockRestore()}
  })
  it('같은 초 direct→proxy→direct 순서는 UUID의 정렬에 영향받지 않는다',async()=>{
    const app=await fixture(),e=await loadOutcomeEvidence(DB,app.id)
    const row=(id,kind,supersedes,felt)=>({id,link_kind:kind,created_at:'2026-09-26 00:00:00',title:id,alternatives:evidenceMetadata(e,{supersedes,felt})})
    const records=[row('zzz-old',OUTCOME_KIND,null,20),row('mmm-proxy',OUTCOME_PROXY_KIND,'zzz-old',null),row('aaa-new',OUTCOME_KIND,'mmm-proxy',null)].sort((a,b)=>a.id.localeCompare(b.id))
    const result=await assessOutcomeEvidence({...e,records})
    expect(result.confirmation.recordId).toBe('aaa-new')
    expect(result.deptFelt).toBeNull()
    expect(result.challenges.some(c=>c.code==='dept_disagrees')).toBe(false)
  })
  it('1만 회 실행의 요약은 1행만 가져오고 상세와 정확히 같은 근거를 쓴다',async()=>{
    const app=await fixture({runs:0})
    await pg.query("INSERT INTO tool_use(id,application_id,ok,duration_ms,human_review_seconds,rework_seconds) SELECT $1||'-'||g,$1,CASE WHEN g%7=0 THEN 0 ELSE 1 END,1100,0.3,0.1 FROM generate_series(1,10000) g",[app.id])
    let fetchedRuns=0
    const tracked={...DB,prepare(sql){const statement=(binds=[])=>({bind:(...values)=>statement(values),all:async()=>{const result=await DB.prepare(sql).bind(...binds).all();if(sql.includes('FROM tool_use')) fetchedRuns+=result.results.length;return result}});return statement()}}
    const summary=(await loadOutcomeEvidenceMany(tracked,[app.id])).get(app.id)
    expect(fetchedRuns).toBe(1)
    expect(summary.uses).toEqual([])
    expect(summary.runSummary.count).toBe(10000)
    const detail=await loadOutcomeEvidence(DB,app.id,{detail:true})
    expect(detail.uses).toHaveLength(10000)
    expect(summary.coreFingerprint).toBe(detail.coreFingerprint)
    expect(summary.outcome).toEqual(detail.outcome)
    const before=summary.coreFingerprint
    await pg.query('UPDATE tool_use SET human_review_seconds=human_review_seconds+1 WHERE id=$1',[`${app.id}-1`])
    expect((await loadOutcomeEvidence(DB,app.id)).coreFingerprint).not.toBe(before)
  })
})
