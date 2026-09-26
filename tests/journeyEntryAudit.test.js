// @vitest-environment node
// The real request handlers run against an isolated Postgres-compatible database.
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { createSupabaseDb } from '../functions/_lib/dbBridge.js'
import { onRequestPost as apply } from '../functions/api/applications/index.js'
import { onRequestGet as agreement, onRequestPost as addAgreement, onRequestPatch as patchAgreement } from '../functions/api/applications/[id]/agreement.js'
import { onRequestPost as build } from '../functions/api/applications/[id]/build.js'
import { onRequestGet as beta, onRequestPost as postBeta } from '../functions/api/applications/[id]/beta.js'
import { onRequestGet as outcome, onRequestPost as confirm } from '../functions/api/applications/[id]/outcome.js'
import { onRequestPost as tool } from '../functions/api/tools/[slug].js'
import { agreementGate } from '../shared/acceptance.js'
import { loadOutcomeEvidence } from '../functions/_lib/outcomeEvidence.js'
import { onRequestGet as handover, onRequestPost as postHandover } from '../functions/api/applications/[id]/handover.js'
import { onRequestGet as signoff, onRequestPost as postSignoff } from '../functions/api/track/[ticket]/signoff.js'
import { onRequestPost as accept } from '../functions/api/tools/[slug]/accept.js'
import { onRequestPost as directOutcome } from '../functions/api/track/[ticket]/outcome.js'
import { onRequestGet as record } from '../functions/api/applications/[id]/record.js'

const pg = new PGlite(), base = 'https://journey-audit.supabase.co'
const DB = createSupabaseDb(base, 'memory-only'), env = { DB, DEMO_WORKSPACE:true }
let queue = Promise.resolve(), app, slug, beforeCommit=null
const request = (body, method = 'POST') => new Request('https://local.invalid/api/audit', {
  method, headers:{'Content-Type':'application/json','X-Idempotency-Key':crypto.randomUUID()}, body:JSON.stringify(body),
})
const call = (handler, body, method) => handler({env, params:{id:app.id}, request:request(body,method)})
const get = handler => handler({env, params:{id:app.id}, request:new Request('https://local.invalid/api/audit')}).then(response=>response.json())
beforeAll(async()=>{
  await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;')
  const directory = new URL('../supabase/migrations/',import.meta.url)
  for(const file of readdirSync(directory).filter(name=>/^\d+.*\.sql$/.test(name)).sort()) await pg.exec(readFileSync(new URL(file,directory),'utf8'))
  vi.stubGlobal('fetch',(url,options)=>{
    if(!String(url).startsWith(base+'/rest/v1/rpc/')) throw Error('External network forbidden')
    const task=queue.then(async()=>{
      try {
        const args=Object.values(JSON.parse(options.body)),name=new URL(url).pathname.split('/').at(-1)
        if(beforeCommit&&/ilson_.*commit/.test(name)) {const action=beforeCommit;beforeCommit=null;await action()}
        await pg.exec('SET ROLE service_role')
        return Response.json((await pg.query(`SELECT public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) data`,args)).rows[0].data)
      } catch(error) {return Response.json({code:error.code},{status:400})}
      finally {await pg.exec('RESET ROLE')}
    })
    queue=task.catch(()=>{})
    return task
  })
  const form=new FormData()
  for(const [key,value] of Object.entries({dept:'재무',applicant_label:'감사 담당',title:'신규 신청 진행 감사',bottleneck:'수작업',problem:'지연',current_minutes:'10',current_people:'1',current_frequency:'매일'})) form.set(key,value)
  const response=await apply({env,request:new Request('https://local.invalid/api/applications',{method:'POST',body:form})})
  expect(response.status).toBe(201)
  app=await response.json()
  // Review is not under audit; begin from the supported accepted state.
  await DB.prepare("UPDATE application SET status='수용' WHERE id=?").bind(app.id).run()
},60000)
afterAll(async()=>{vi.unstubAllGlobals();await pg.close()})

const details={action:'create',title:'재무 정산',person:'재무 담당',whenToRun:'시연 기간 자료 확인',afterRun:'격리 내역과 원본을 대조',contact:'AX 담당',dailyLimit:20,maxFileMb:10,reason:'현재 기준을 통과해 제한 범위로 인계합니다.',scopeAccepted:true,humanChecks:{}}
async function signCurrent() {
  const data=await signoff({env,params:{ticket:app.ticket_no}}).then(r=>r.json())
  const response=await postSignoff({env,params:{ticket:app.ticket_no},request:request({by:'재무 담당',dept:'재무',expectedVersion:data.expectedVersion,verdicts:Object.fromEntries(data.criteria.map(c=>[c.id,'ok']))})})
  expect(response.status,await response.clone().text()).toBe(200)
}
async function gradeCurrent(note=null) {
  const data=await get(beta)
  const response=await call(postBeta,{kind:'round',run_id:crypto.randomUUID(),run_scope:data.runScope,criteria_revision:data.criteriaRevision,
    build_run_id:data.latestBuild.id,note,graded:data.criteria.map(c=>({id:c.id,ord:c.ord,body:c.body,kind:c.check_kind,check_key:c.check_key,is_required_safety:c.is_required_safety,verdict:c.check_kind==='human'?'사람확인':'통과',evidence:'시험에서 기준을 확인했습니다.'})),summary:{overall:'통과',durationMs:1}})
  expect(response.status,await response.clone().text()).toBe(201)
}

describe.sequential('fresh application to field-use and verified outcome',()=>{
  it('a fresh accepted application has no criteria or baseline; neither is created by application submission',async()=>{
    const data=await get(agreement)
    expect(data.criteria).toEqual([])
    expect(data.shadowRuns).toEqual([])
    expect(data.baseline).toBeNull()
    expect(agreementGate(data)).toMatchObject({ready:false})
    expect((await get(beta)).canTest).toBe(false)
    expect((await get(outcome)).outcome.status).toBe('산정불가')
  })
  it('build is allowed without agreement evidence, but it creates neither a baseline nor a field-use record',async()=>{
    const response=await call(build,{kind:'run',files:[],rows:[{date:'2026-06-01',iso_week:'2026-W23',sku:'AUDIT',channel:'audit'}],quarantine:[]})
    expect(response.status,await response.clone().text()).toBe(201)
    expect((await get(agreement)).baseline).toBeNull()
    expect((await DB.prepare('SELECT count(*) AS n FROM tool_use WHERE application_id=?').bind(app.id).first()).n).toBe(0)
    expect((await get(beta)).canTest).toBe(false)
  })
  it('existing agreement APIs can create explicit criteria and measured baseline; beta then opens',async()=>{
    const added=await call(addAgreement,{kind:'criterion',check_key:'traceable',is_required_safety:true,expectedVersion:(await get(agreement)).criteria_source_version})
    expect(added.status).toBe(201)
    const criterion=await added.json()
    expect((await call(patchAgreement,{kind:'criterion',id:criterion.id,confirmed:true,is_required_safety:true,expectedVersion:(await get(agreement)).criteria[0].edit_version},'PATCH')).status).toBe(200)
    expect((await call(addAgreement,{kind:'baseline',expectedVersion:(await get(agreement)).baseline_source_version})).status).toBe(400)
    for(const total_seconds of [600,620,580]) expect((await call(addAgreement,{kind:'shadow_run',total_seconds})).status).toBe(201)
    expect((await call(addAgreement,{kind:'baseline',expectedVersion:(await get(agreement)).baseline_source_version})).status).toBe(200)
    const data=await get(agreement)
    expect(data.baseline).toMatchObject({median_seconds:600,sample_n:3,people:1})
    expect(agreementGate(data).ready).toBe(true)
    const readiness=await get(beta)
    expect(readiness.canTest).toBe(true)
    await gradeCurrent('원본 메모 "보존"')
    expect((await get(beta)).rounds[0].note).toBe('원본 메모 "보존"')
    expect((await get(record)).betaRounds[0].note).toBe('원본 메모 "보존"')
  })
  it('even after a passing beta, no tool handover exists and outcome confirmation remains unavailable',async()=>{
    expect((await DB.prepare('SELECT count(*) AS n FROM handover WHERE application_id=?').bind(app.id).first()).n).toBe(0)
    const field=await tool({env,params:{slug:'new-application-tool'},request:request({})})
    expect(field.status).toBe(404)
    const data=await get(outcome)
    expect(data.outcome).toMatchObject({status:'산정불가',reason:'아직 한 번도 돌지 않았습니다. 실제로 쓰이기 전에는 절감이 없습니다.'})
    const evidence=await loadOutcomeEvidence(DB,app.id)
    const response=await call(confirm,{kind:'dept_confirm',by:'감사 담당',expectedEvidence:evidence.mutationToken})
    expect(response.status).toBe(400)
  })
  it('requires current department signatures, validates instructions and preserves stale drafts at the API boundary',async()=>{
    const unsigned=await get(handover)
    expect(unsigned.blockers.join(' ')).toContain('관련 부서')
    expect((await call(postHandover,{...details,expectedEvidence:unsigned.expectedEvidence})).status).toBe(400)
    await signCurrent()
    const ready=await get(handover)
    expect(ready.blockers).toEqual([])
    expect((await call(postHandover,{...details,expectedEvidence:unsigned.expectedEvidence})).status).toBe(409)
    expect((await call(postHandover,{...details,contact:'',maxFileMb:11,expectedEvidence:ready.expectedEvidence})).status).toBe(400)
  })
  it('does not reuse an old beta after unconfirm/reconfirm even when the criterion text is identical',async()=>{
    for(const confirmed of [false,true]) {
      const c=(await get(agreement)).criteria[0]
      expect((await call(patchAgreement,{kind:'criterion',id:c.id,confirmed,is_required_safety:true,expectedVersion:c.edit_version},'PATCH')).status).toBe(200)
    }
    await signCurrent()
    const data=await get(handover)
    expect(data.blockers.join(' ')).toContain('현재 합격 기준으로 다시 시험')
    expect((await call(postHandover,{...details,expectedEvidence:data.expectedEvidence})).status).toBe(400)
    await gradeCurrent()
    expect((await get(handover)).blockers).toEqual([])
  })
  it('rolls back manual and handover if the required audit insert fails',async()=>{
    await pg.exec(`CREATE FUNCTION reject_handover_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.link_kind='현장인계' THEN RAISE EXCEPTION 'Audit test'; END IF;RETURN NEW;END $$;CREATE TRIGGER reject_handover_audit BEFORE INSERT ON decision_log FOR EACH ROW EXECUTE FUNCTION reject_handover_audit();`)
    const response=await call(postHandover,{...details,expectedEvidence:(await get(handover)).expectedEvidence})
    expect(response.status).toBe(503)
    expect((await DB.prepare('SELECT * FROM handover WHERE application_id=?').bind(app.id).first())).toBeNull()
    expect((await DB.prepare('SELECT * FROM manual WHERE application_id=?').bind(app.id).first())).toBeNull()
    await pg.exec('DROP TRIGGER reject_handover_audit ON decision_log; DROP FUNCTION reject_handover_audit();')
  })
  it('does not turn human-needed grading or unresolved blocked feedback into an automatic release',async()=>{
    const added=await call(addAgreement,{kind:'criterion',check_key:'usable_by_dept',is_required_safety:false,expectedVersion:(await get(agreement)).criteria_source_version})
    expect(added.status).toBe(201)
    const {id}=await added.json(), c=(await get(agreement)).criteria.find(c=>c.id===id)
    expect((await call(patchAgreement,{kind:'criterion',id,confirmed:true,is_required_safety:false,expectedVersion:c.edit_version},'PATCH')).status).toBe(200)
    await signCurrent();await gradeCurrent()
    const ready=await get(handover)
    expect(ready.humanCriteria).toHaveLength(1)
    const missing=await call(postHandover,{...details,expectedEvidence:ready.expectedEvidence})
    expect(missing.status).toBe(400)
    expect((await missing.json()).fields.humanChecks).toBeTruthy()
    details.humanChecks={[id]:{confirmed:true,evidence:'부서 담당자가 제한 범위의 사용법을 직접 확인했습니다.'}}
    const feedback=await call(postBeta,{kind:'feedback',body:'현장에서 막힌 부분을 확인합니다.',feedback_kind:'막힌곳'})
    const feedbackId=(await feedback.json()).id
    const blocked=await get(handover)
    expect(blocked.blockers.join(' ')).toContain('해결 근거가 없는')
    expect((await call(postHandover,{...details,expectedEvidence:blocked.expectedEvidence})).status).toBe(400)
    expect((await call(postBeta,{kind:'resolve_feedback',id:feedbackId,resolution:'현장 담당자와 수정 결과를 확인했습니다.'})).status).toBe(200)
  })
  it('creates a fixed settlement tool, a manual and audit once, including response-loss replay',async()=>{
    const body={...details,expectedEvidence:(await get(handover)).expectedEvidence}, key=crypto.randomUUID()
    const send=()=>postHandover({env,params:{id:app.id},request:new Request('https://local.invalid/api/handover',{method:'POST',headers:{'Content-Type':'application/json','X-Idempotency-Key':key},body:JSON.stringify(body)})})
    const response=await send()
    expect(response.status,await response.clone().text()).toBe(201)
    slug=(await response.json()).slug
    const replay=await send()
    expect(replay.status).toBe(201)
    expect(replay.headers.get('X-Idempotency-Replayed')).toBe('1')
    expect((await DB.prepare("SELECT count(*) n FROM decision_log WHERE application_id=? AND link_kind='현장인계'").bind(app.id).first()).n).toBe(1)
    expect((await get(handover)).manual.intro).toContain('새 AI 도구나 코드를 자동으로 만들지 않습니다')
    expect((await get(handover)).handover.accepted_at).toBeNull()
  })
  it('runs the handed-over tool, receives it explicitly, and confirms the current measured outcome',async()=>{
    const response=await tool({env,params:{slug},request:request({run_scope:await DB.toolRunScope(),run_id:crypto.randomUUID(),rows_out:1,quarantined:0,duration_ms:1000,ok:true})})
    expect(response.status,await response.clone().text()).toBe(201)
    const received=await accept({env,params:{slug},request:request({by:'재무 담당'})})
    expect(received.status,await received.clone().text()).toBe(200)
    expect((await received.json()).state.status).toBe('부서가 확인함')
    const evidence=await loadOutcomeEvidence(DB,app.id)
    const confirmed=await directOutcome({env,params:{ticket:app.ticket_no},request:request({by:'재무 담당',agree:true,expectedEvidence:evidence.mutationToken})})
    expect(confirmed.status,await confirmed.clone().text()).toBe(200)
    expect((await loadOutcomeEvidence(DB,app.id)).directConfirmed).toBe(true)
  })
  it('stops field execution and requires another passing beta before resuming without erasing previous receipt',async()=>{
    const before=await get(handover)
    expect((await call(postHandover,{action:'stop',reason:'현장 결과를 추가 점검합니다.',expectedEvidence:before.expectedEvidence})).status).toBe(200)
    const run=await tool({env,params:{slug},request:request({run_scope:await DB.toolRunScope(),run_id:crypto.randomUUID(),rows_out:1,quarantined:0,duration_ms:1000,ok:true})})
    expect(run.status).toBe(409)
    const stopped=await get(handover)
    expect(stopped.blockers.join(' ')).toContain('중단 후 새 베타')
    expect((await call(postHandover,{...details,action:'restore',expectedEvidence:stopped.expectedEvidence})).status).toBe(400)
    await gradeCurrent()
    const fresh=await get(handover)
    expect((await call(postHandover,{...details,action:'restore',expectedEvidence:fresh.expectedEvidence})).status).toBe(200)
    const after=await get(handover)
    expect(after.handover.rolled_back_at).toBeNull()
    expect(after.handover.accepted_at).toBe(before.handover.accepted_at)
    expect(after.application.status).toBe(before.application.status)
    expect((await DB.prepare("SELECT count(*) n FROM decision_log WHERE application_id=? AND link_kind IN ('인계중단','다시올림')").bind(app.id).first()).n).toBe(2)
  })
  it('rechecks builder role under the atomic commit even when app ownership still permits reads',async()=>{
    const email='handover-owner@local.invalid'
    await DB.prepare("INSERT INTO override_actor(email,display_name,role,departments_json) VALUES(?,'Owner','engineer','[\"재무\"]')").bind(email).run()
    await DB.prepare('UPDATE application SET owner_email=? WHERE id=?').bind(email,app.id).run()
    const scoped=DB.forActor(email), authEnv={DB:scoped,AUTH_ACTOR:{mode:'access',email,role:'engineer'},OVERRIDE_DEMO_MODE:'false'}
    const state=await handover({env:authEnv,params:{id:app.id}}).then(r=>r.json())
    expect(state.handover).toBeTruthy()
    beforeCommit=()=>pg.query("UPDATE override_actor SET role='operations' WHERE email=$1",[email])
    const response=await postHandover({env:authEnv,params:{id:app.id},request:request({action:'stop',reason:'권한 변경 경쟁 검증입니다.',expectedEvidence:state.expectedEvidence})})
    expect(response.status,await response.clone().text()).toBe(409)
    expect((await get(handover)).handover.rolled_back_at).toBeNull()
  })
  it('allows normal owner-builder atomic stop/restore, while wrong-role writes remain forbidden',async()=>{
    const email='handover-owner@local.invalid',scoped=DB.forActor(email)
    const authEnv={DB:scoped,AUTH_ACTOR:{mode:'access',email,role:'engineer'},OVERRIDE_DEMO_MODE:'false'}
    let state=await handover({env:authEnv,params:{id:app.id}}).then(r=>r.json())
    const denied=await postHandover({env:authEnv,params:{id:app.id},request:request({action:'stop',reason:'권한 없는 중단 요청입니다.',expectedEvidence:state.expectedEvidence})})
    expect(denied.status).toBe(403)
    await DB.prepare("UPDATE override_actor SET role='engineer' WHERE email=?").bind(email).run()
    state=await handover({env:authEnv,params:{id:app.id}}).then(r=>r.json())
    const stopped=await postHandover({env:authEnv,params:{id:app.id},request:request({action:'stop',reason:'정상 권한으로 중단합니다.',expectedEvidence:state.expectedEvidence})})
    expect(stopped.status,await stopped.clone().text()).toBe(200)
    await gradeCurrent()
    state=await handover({env:authEnv,params:{id:app.id}}).then(r=>r.json())
    const restored=await postHandover({env:authEnv,params:{id:app.id},request:request({...details,action:'restore',expectedEvidence:state.expectedEvidence})})
    expect(restored.status,await restored.clone().text()).toBe(200)
    const audit=await DB.prepare("SELECT title FROM decision_log WHERE application_id=? AND link_kind='다시올림' ORDER BY created_at DESC,id DESC").bind(app.id).all()
    expect(audit.results.some(row=>row.title==='Owner')).toBe(true)
  })
})
