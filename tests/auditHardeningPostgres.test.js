// @vitest-environment node
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { createSupabaseDb } from '../functions/_lib/dbBridge.js'
import { seedOverrideWorkspace } from '../functions/_lib/override.js'
import { onRequestPost as mutate, onRequestGet as workspace } from '../functions/api/override.js'
import { onRequestGet as health } from '../functions/api/health.js'
import { checkRateLimit } from '../functions/_lib/rateLimit.js'
import { onRequestPost as assist } from '../functions/api/override/assist.js'

// JWT verification is exercised with real signatures in accessHardening.test.js.
vi.mock('../functions/_lib/access.js',()=>({verifiedAccessEmail:async env=>env.TEST_VERIFIED_EMAIL||null}))

const pg = new PGlite()
const DB = createSupabaseDb('https://audit-test.supabase.co','local-only')
const env = { DB, SUPABASE_URL:'https://audit-test.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'local-only',OVERRIDE_DEMO_MODE:'true' }
let queue = Promise.resolve()
let external = ()=>{throw Error('Unexpected external call')}
beforeAll(async()=>{
  await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;')
for (const file of ['0000_schema.sql','0001_execute_sql.sql','0002_override_loop.sql','0003_journey_workspaces.sql','0004_audit_hardening.sql','0005_field_feedback.sql'])
    await pg.exec(readFileSync(new URL(`../supabase/migrations/${file}`,import.meta.url),'utf8'))
  vi.stubGlobal('fetch',(url,options)=>{
    if (!String(url).startsWith(env.SUPABASE_URL+'/rest/v1/rpc/')) return external(url,options)
    const result = queue.then(async()=>{
      try {
        await pg.exec('SET ROLE service_role')
        const args = Object.values(JSON.parse(options.body))
        const name = new URL(url).pathname.split('/').at(-1)
        return Response.json((await pg.query(`SELECT public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) AS data`,args)).rows[0].data)
      } catch(error) { return Response.json({code:error.code},{status:400}) }
      finally { await pg.exec('RESET ROLE') }
    })
    queue = result.catch(()=>{})
    return result
  })
  await seedOverrideWorkspace(env)
},60000)
afterAll(async()=>{ vi.unstubAllGlobals(); await pg.close() })
const post = (body,key=crypto.randomUUID())=>mutate({env,request:new Request('https://ilson.test/api/override',{
  method:'POST',headers:{'X-Idempotency-Key':key},body:JSON.stringify({role:'product',...body}) })})
const plan = {metricType:'rate',minimumWindowSeconds:60,minimumSamples:{historical:10,shadow:10,limited:10},
  rationale:'관측 변동성과 주간 업무량에 맞춘 사전 계획',datasetVersion:'data-v1',modelVersion:'model-v1',policyVersion:'policy-v1'}
async function experiment() {
  const response = await post({action:'create_experiment',clusterId:'olc_policy',title:'회귀 실험',changeTarget:'검색',hypothesis:'오류 감소',
    scope:'테스트',comparator:'v1',successMetric:'수정률',approver:'검토자',rollbackPlan:'v1 복원',guardrails:['정책 위반 0건'],
    stopConditions:['위반 1건'],metricDirection:'lower',targetImprovement:20,evaluationPlan:plan})
  expect(response.status,JSON.stringify(await response.clone().json())).toBe(201)
  const id = (await response.json()).id
  expect((await post({action:'approve_experiment',experimentId:id,basis:'측정 계획 검토'})).status).toBe(200)
  return id
}
const run = (id,phase='historical',overrides={})=>({action:'record_run',experimentId:id,phase,controlValue:10,variantValue:7,
  sampleSize:20,guardrailBreaches:0,evidenceRefs:['local-test-run/001'],measurementStart:new Date(Date.now()-3600000).toISOString(),
  measurementEnd:new Date(Date.now()-1800000).toISOString(),...overrides})

describe.sequential('audit regressions against actual PostgreSQL handlers',()=>{
  it('checks the migration RPC and scoped readiness, not just old tables',async()=>{
    const response = await health({env})
    expect(await response.json()).toMatchObject({ready:true,checks:{runtime:true,capacity:true}})
    expect((await health({env:{...env,DB:{prepare:DB.prepare,readiness:async()=>{throw Error('missing RPC')}}}})).status).toBe(503)
  })
  it('runs the complete approved cycle and seals terminal experiments',async()=>{
    const id=await experiment()
    for (const phase of ['historical','shadow','limited']) {
      const response=await post(run(id,phase))
      expect(await response.json()).toMatchObject({status:'passed'})
    }
    expect((await post({action:'decide_experiment',experimentId:id,decision:'expand',basis:'현재 승인 주기 근거 확인'})).status).toBe(200)
    const decision=await DB.prepare('SELECT metrics_snapshot_json FROM override_decision_record WHERE experiment_id=?').bind(id).first()
    const snapshot=JSON.parse(decision.metrics_snapshot_json)
    expect(snapshot.evaluation_plan).toEqual(plan)
    expect(snapshot.runs).toHaveLength(3)
    expect(snapshot.runs[0]).toMatchObject({sample_size:20,evidence_refs:['local-test-run/001'],source_kind:'manual'})
    expect((await post(run(id))).status).toBe(409)
    expect((await post({action:'approve_experiment',experimentId:id,basis:'재승인 시도'})).status).toBe(409)
    expect((await post({action:'decide_experiment',experimentId:id,decision:'hold',basis:'종료 덮어쓰기'})).status).toBe(409)
  })
  it('blocks stopped reactivation and discards the previous approval cycle',async()=>{
    const id=await experiment()
    expect((await post(run(id))).status).toBe(201)
    expect((await post(run(id,'shadow',{guardrailBreaches:1}))).status).toBe(201)
    expect((await post(run(id,'shadow'))).status).toBe(409)
    expect((await post({action:'approve_experiment',experimentId:id,basis:'재시험은 과거 재생부터'})).status).toBe(200)
    expect((await post(run(id,'shadow'))).status).toBe(409)
    expect((await post(run(id))).status).toBe(201)
  })
  it('does not reuse an older pass after the latest result failed',async()=>{
    const id=await experiment()
    await post(run(id))
    const failure=await post(run(id,'historical',{variantValue:11}))
    expect(await failure.json()).toMatchObject({status:'failed'})
    expect((await post(run(id,'shadow'))).status).toBe(409)
    await post({action:'approve_experiment',experimentId:id,basis:'재검토'})
    expect((await post(run(id,'shadow'))).status).toBe(409)
  })
  it('rejects malformed measurements and requires original evidence',async()=>{
    const id=await experiment()
    for (const overrides of [{sampleSize:'not-a-number'},{sampleSize:2.5},{controlValue:' '},{variantValue:-1},
      {guardrailBreaches:-1},{variantValue:101},{evidenceRefs:[]},{measurementEnd:'invalid'}]) {
      const response=await post(run(id,'historical',overrides))
      expect(response.status,JSON.stringify(overrides)).toBe(400)
    }
    expect(await (await post(run(id,'historical',{sampleSize:1}))).json()).toMatchObject({status:'insufficient'})
    expect((await post(run(id,'shadow'))).status).toBe(409)
  })
  it('rolls business writes back when the audit insertion fails',async()=>{
    await pg.exec(`CREATE FUNCTION public.fail_audit_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.action='create_product' THEN RAISE EXCEPTION 'test audit failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER fail_audit_test BEFORE INSERT ON override_audit FOR EACH ROW EXECUTE FUNCTION fail_audit_test();`)
    const response=await post({action:'create_product',name:'must-not-persist',domain:'test',ownerTeam:'test',modelName:'test',
      modelVersion:'v1',promptVersion:'v1',policyVersion:'v1'})
    expect(response.status).toBe(503)
    expect((await DB.prepare("SELECT count(*) AS n FROM override_product WHERE name='must-not-persist'").first()).n).toBe(0)
    await pg.exec('DROP TRIGGER fail_audit_test ON override_audit; DROP FUNCTION public.fail_audit_test()')
  })
  it('replays the same request once and rejects conflicting simultaneous writes',async()=>{
    const id=await experiment(), key=crypto.randomUUID(), body=run(id)
    const results=await Promise.all([post(body,key),post(body,key)])
    expect(results.map(r=>r.status)).toEqual([201,201])
    expect((await results[0].json()).id).toBe((await results[1].json()).id)
    expect((await post({...body,variantValue:6},key)).status).toBe(409)
    let waiting=0, release
    const barrier=new Promise(resolve=>{release=resolve})
    env.DB={...DB,commitMutation:async(...args)=>{ if (++waiting===2) release(); await barrier; return DB.commitMutation(...args) }}
    const concurrent=await Promise.all([post(run(id,'shadow')),post(run(id,'shadow',{variantValue:11}))])
    env.DB=DB
    expect(concurrent.map(r=>r.status).sort()).toEqual([201,409])
  })
  it('admits only one of six competing rate-limit claims',async()=>{
    const tickets=await Promise.all(Array.from({length:6},()=>checkRateLimit(env,'concurrent-limit',1,60)))
    expect(tickets.filter(Boolean)).toHaveLength(1)
  })
  it('aggregates beyond 500 list items and never pairs unrelated denominators',async()=>{
    await pg.exec(`INSERT INTO override_event SELECT (jsonb_populate_record(NULL::override_event,
      to_jsonb(e)||jsonb_build_object('id','bulk_'||n,'external_ref','bulk_'||n,'occurred_at',public.datetime('now'),
      'validity','valid','is_override',1))).* FROM override_event e CROSS JOIN generate_series(1,1007) n WHERE e.id='ole_01'`)
    const response=await workspace({env})
    expect(response.status,JSON.stringify(await response.clone().json())).toBe(200)
    const data=await response.json()
    expect(data.events).toHaveLength(500)
    expect(data.metrics.total_decisions).toBe(1015)
    expect(data.metrics.overrides).toBeGreaterThanOrEqual(1007)
    expect(data.event_list.truncated).toBe(true)
    expect(data.metrics.confirmed_override_rate).toBeNull()
    expect(data.metrics.rate_window.unmatched).toBeGreaterThanOrEqual(1007)
    expect(data.policy_impact.some(row=>row.events>=1007)).toBe(true)
  })
  it('denies unauthenticated access to the new privileged RPCs',async()=>{
    await pg.exec('SET ROLE anon')
    await expect(pg.query("SELECT public.ilson_claim_rate_limit(NULL,'forbidden',1,60)")).rejects.toThrow()
    await pg.exec('RESET ROLE')
  })
  it('refuses zero targets, invalid denominators and reapproval after rollback',async()=>{
    const id=await experiment()
    await post({action:'decide_experiment',experimentId:id,decision:'rollback',basis:'복귀 결정만 기록'})
    expect((await post({action:'approve_experiment',experimentId:id,basis:'종료 재승인'})).status).toBe(409)
    for (const body of [{totalCases:'NaN',applicableCases:10},{totalCases:5,applicableCases:10}, {totalCases:10,applicableCases:2.5}])
      expect((await post({action:'record_volume',productId:'olp_loan',measuredOn:new Date().toISOString().slice(0,10),segment:'검증',...body})).status).toBe(400)
    const record=await DB.prepare('SELECT * FROM change_experiment WHERE id=?').bind(id).first()
    expect(record.mutation_version).toBeGreaterThan(1)
  })
  it('records integration intent before sending and retries an uncertain commit with one remote effect',async()=>{
    await DB.prepare("INSERT INTO override_actor(email,display_name,role) VALUES('test@example.test','검증 사용자','product')").run()
    const endpoint='https://tickets.example.test/hook'
    const realEnv={...env,OVERRIDE_DEMO_MODE:'false',TEST_VERIFIED_EMAIL:'test@example.test',
      OVERRIDE_INTEGRATIONS:JSON.stringify({ticket:{endpointUrl:endpoint,secretBinding:'OVERRIDE_INTEGRATION_TEST_TOKEN',supportsIdempotency:true}}),
      OVERRIDE_INTEGRATION_TEST_TOKEN:'local-fake-token'}
    const realPost=(body,key=crypto.randomUUID())=>mutate({env:realEnv,request:new Request('https://ilson.test/api/override',{method:'POST',headers:{'X-Idempotency-Key':key},body:JSON.stringify(body)})})
    const saved=await realPost({action:'save_integration',kind:'ticket',name:'test',endpointUrl:endpoint,secretBinding:'OVERRIDE_INTEGRATION_TEST_TOKEN'})
    expect(saved.status).toBe(200)
    const integrationId=(await saved.json()).id, key=crypto.randomUUID(), effects=new Set(), attempts=[]
    external=async(url,options)=>{
      expect(url).toBe(endpoint)
      expect((await DB.prepare("SELECT count(*) AS n FROM override_audit WHERE action='sync_integration_requested'").first()).n).toBeGreaterThan(0)
      attempts.push(options.headers['Idempotency-Key']);effects.add(options.headers['Idempotency-Key'])
      return Response.json({ok:true})
    }
    await pg.exec(`CREATE FUNCTION public.fail_sync_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.action='sync_integration' THEN RAISE EXCEPTION 'test completion failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER fail_sync_test BEFORE INSERT ON override_audit FOR EACH ROW EXECUTE FUNCTION fail_sync_test();`)
    expect((await realPost({action:'sync_integration',integrationId},key)).status).toBe(503)
    expect((await DB.prepare("SELECT count(*) AS n FROM override_audit WHERE action='sync_integration'").first()).n).toBe(0)
    await pg.exec('DROP TRIGGER fail_sync_test ON override_audit; DROP FUNCTION public.fail_sync_test()')
    expect((await realPost({action:'sync_integration',integrationId},key)).status).toBe(200)
    expect((await realPost({action:'sync_integration',integrationId},key)).status).toBe(200)
    expect(attempts).toEqual([key,key]);expect(effects.size).toBe(1)
    expect((await realPost({action:'save_integration',kind:'ticket',name:'bad',endpointUrl:endpoint,secretBinding:'SUPABASE_SERVICE_ROLE_KEY'})).status).toBe(400)
  })
  it('keeps AI call results and audit atomic, and never reissues an unknown generation',async()=>{
    const realEnv={...env,OVERRIDE_DEMO_MODE:'false',TEST_VERIFIED_EMAIL:'test@example.test',CLAUDE_API_KEY:'fake-test-only'}
    const body={kind:'event',context:{summary:'가상 오류 검증'}}
    const ai=(key)=>assist({env:realEnv,request:new Request('https://ilson.test/api/override/assist',{method:'POST',headers:{'X-Idempotency-Key':key},body:JSON.stringify(body)})})
    let calls=0
    external=async(url)=>{expect(url).toBe('https://api.anthropic.com/v1/messages');calls++;return Response.json({content:[{type:'text',text:'{"summary":"가상 초안"}'}],usage:{input_tokens:10,output_tokens:5}})}
    const first=crypto.randomUUID()
    expect((await ai(first)).status).toBe(200);expect((await ai(first)).status).toBe(200);expect(calls).toBe(1)
    await pg.exec(`CREATE FUNCTION public.fail_ai_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.action='ai_assist' THEN RAISE EXCEPTION 'test audit failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER fail_ai_test BEFORE INSERT ON override_audit FOR EACH ROW EXECUTE FUNCTION fail_ai_test();`)
    const uncertain=crypto.randomUUID()
    expect((await ai(uncertain)).status).toBe(503)
    expect((await DB.prepare("SELECT count(*) AS n FROM override_ai_call WHERE ok=1").first()).n).toBe(1)
    await pg.exec('DROP TRIGGER fail_ai_test ON override_audit; DROP FUNCTION public.fail_ai_test()')
    expect((await ai(uncertain)).status).toBe(409);expect(calls).toBe(2)
    external=async()=>Response.json({content:[{type:'text',text:'not-json'}]})
    expect((await ai(crypto.randomUUID())).status).toBe(502)
    expect((await DB.prepare("SELECT count(*) AS n FROM override_audit WHERE action='ai_assist_failed'").first()).n).toBe(1)
  })
  it('commits a captured event, validity and derived cluster counts together without inflating the denominator',async()=>{
    const product=await DB.prepare("SELECT applicable_cases FROM override_product WHERE id='olp_loan'").first()
    const response=await post({action:'capture_event',productId:'olp_loan',decisionAction:'modify',aiDecision:'기존 정책',humanDecision:'최신 정책',
      reasonDetail:'최신 내규 검색 버전을 수정합니다.',policyRefs:['대출내규-2026.08-14'],externalRef:'regression-capture-001'})
    expect(response.status,JSON.stringify(await response.clone().json())).toBe(201)
    const saved=await response.json()
    expect((await DB.prepare('SELECT validity FROM override_event WHERE id=?').bind(saved.id).first()).validity).toBe('pending')
    expect((await post({action:'validate_event',eventId:saved.id,validity:'valid',reason:'원본 문서와 확인'})).status).toBe(200)
    const count=await DB.prepare("SELECT count(*) AS n FROM override_event WHERE cluster_id=? AND is_override=1 AND validity='valid'").bind(saved.cluster_id).first()
    expect((await DB.prepare('SELECT recurrence_count FROM issue_cluster WHERE id=?').bind(saved.cluster_id).first()).recurrence_count).toBe(count.n)
    expect((await DB.prepare("SELECT applicable_cases FROM override_product WHERE id='olp_loan'").first()).applicable_cases).toBe(product.applicable_cases)
  })
})
