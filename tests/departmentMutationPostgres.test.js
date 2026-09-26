// @vitest-environment node
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { createSupabaseDb } from '../functions/_lib/dbBridge.js'
import { requireSessionScope } from '../functions/_lib/sessionScope.js'
import { onRequestPost as signoff } from '../functions/api/track/[ticket]/signoff.js'
import { onRequestPost as accept } from '../functions/api/tools/[slug]/accept.js'
import { onRequestPost as hold } from '../functions/api/track/[ticket]/hold.js'
import { onRequestPost as beta } from '../functions/api/track/[ticket]/beta.js'

const pg = new PGlite(), base = 'https://department-mutation.supabase.co'
const DB = createSupabaseDb(base, 'local-test-only'), email = 'owner@local.invalid'
let queue = Promise.resolve(), revokeAtWrite = false
const cases = [
  ['signoff', signoff, { by:'Owner', dept:'Finance', verdicts:{criterion:'no'}, reasons:{criterion:'실제 처리 기준과 맞지 않습니다.'} }],
  ['accept', accept, {by:'Owner'}],
  ['reject', accept, {by:'Owner',kind:'reject',reason:'실제 업무에서 사용할 수 없습니다.'}],
  ['hold', hold, {by:'Owner', kind:'met', body:'보류 조건이 실제로 해소되었습니다.'}],
  ['cancel', hold, {by:'Owner',kind:'cancel'}],
  ['beta', beta, {by:'Owner', kind:'의견', body:'실제 업무에 적용해 확인했습니다.'}],
]
beforeAll(async () => {
  await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;')
  for (const file of ['0000_schema.sql','0001_execute_sql.sql','0002_override_loop.sql','0003_journey_workspaces.sql','0004_audit_hardening.sql','0005_field_feedback.sql','0006_access_scope.sql','0007_issue_workflow.sql','0008_feedback_rechecks.sql','0009_participation_quota.sql','0010_application_ownership.sql','0011_tool_run_receipts.sql','0012_beta_round_receipts.sql','0013_review_revision.sql']) {
    await pg.exec(readFileSync(new URL('../supabase/migrations/'+file, import.meta.url),'utf8'))
  }
  vi.stubGlobal('fetch', (url, options) => {
    if (!String(url).startsWith(base+'/rest/v1/rpc/')) throw Error('External network forbidden')
    const task = queue.then(async () => {
      const name = new URL(url).pathname.split('/').at(-1), payload = JSON.parse(options.body)
      try {
        if (revokeAtWrite && (name === 'ilson_actor_commit' || (/^ilson_actor_(query|batch)$/.test(name) && /\b(INSERT|UPDATE|DELETE)\b/i.test(JSON.stringify(payload))))) {
          revokeAtWrite = false
          await pg.exec("UPDATE override_actor SET departments_json='[]' WHERE email='owner@local.invalid'")
        }
        await pg.exec('SET ROLE service_role')
        const args=Object.values(payload)
        return Response.json((await pg.query(`SELECT public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) data`,args)).rows[0].data)
      } catch(error) {return Response.json({code:error.code},{status:400})}
      finally {await pg.exec('RESET ROLE')}
    })
    queue=task.catch(()=>{})
    return task
  })
  await DB.prepare("INSERT INTO override_actor(email,display_name,role,departments_json) VALUES(?,'Owner','operations','[\"Finance\"]')").bind(email).run()
  await DB.prepare("INSERT INTO application(id,ticket_no,dept,applicant_label,title,bottleneck,problem,status,owner_email) VALUES('app-race','AX-RACE','Finance','Owner','Task','Task','Task','보류',?)").bind(email).run()
  await DB.prepare("INSERT INTO acceptance_criterion(id,application_id,ord,body,confirmed_at) VALUES('criterion','app-race',1,'서류 확인',datetime('now'))").run()
  await DB.prepare("INSERT INTO handover(application_id,slug,title,handed_to_dept,handed_to_person) VALUES('app-race','race-tool','Tool','Finance','Owner')").run()
  await DB.prepare("INSERT INTO beta_round(id,application_id,seq,overall) VALUES('round','app-race',1,'통과')").run()
  await pg.exec(`CREATE FUNCTION public.reject_department_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.title LIKE 'Reject audit%' THEN RAISE EXCEPTION 'Test audit rejection'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER reject_department_audit BEFORE INSERT ON public.decision_log FOR EACH ROW EXECUTE FUNCTION public.reject_department_audit();`)
},60000)
beforeEach(async()=>{
  revokeAtWrite=false
  await DB.prepare("UPDATE override_actor SET departments_json='[\"Finance\"]' WHERE email=?").bind(email).run()
  await DB.prepare("DELETE FROM decision_log WHERE application_id='app-race'").run()
  await DB.prepare("DELETE FROM beta_feedback WHERE application_id='app-race'").run()
  await DB.prepare("UPDATE handover SET accepted_at=NULL,accepted_by=NULL WHERE application_id='app-race'").run()
  await DB.prepare("UPDATE application SET status='보류' WHERE id='app-race'").run()
})
afterAll(async()=>{vi.unstubAllGlobals();await pg.close()})
async function invoke(handler,body,key=crypto.randomUUID(),race=false) {
  const scoped=DB.forActor(email)
  const request=new Request('https://local.invalid/api/department-test',{method:'POST',headers:{'Content-Type':'application/json','X-Idempotency-Key':key,'X-Ilson-Scope':await scoped.toolRunScope()},body:JSON.stringify(body)})
  expect(await requireSessionScope(request,scoped)).toBeNull()
  revokeAtWrite=race
  return handler({env:{DB:scoped,AUTH_ACTOR:{mode:'access',email,role:'operations',departments:['Finance']},OVERRIDE_DEMO_MODE:'false'},request,params:{ticket:'AX-RACE',slug:'race-tool'}})
}
async function stored() {
  return {
    logs:Number((await DB.prepare("SELECT count(*) n FROM decision_log WHERE application_id='app-race'").first()).n),
    feedback:Number((await DB.prepare("SELECT count(*) n FROM beta_feedback WHERE application_id='app-race'").first()).n),
    accepted:(await DB.prepare("SELECT accepted_at FROM handover WHERE application_id='app-race'").first()).accepted_at,
    status:(await DB.prepare("SELECT status FROM application WHERE id='app-race'").first()).status,
  }
}
describe.sequential('department declarations commit under current authority',()=>{
  it.each(cases)('%s rejects department revocation immediately before writing even when ownership still permits reads',async(_name,handler,body)=>{
    const before=await stored(),response=await invoke(handler,body,crypto.randomUUID(),true)
    expect(response.status,JSON.stringify(await response.json())).toBe(409)
    expect(await stored()).toEqual(before)
    expect((await DB.prepare('SELECT departments_json FROM override_actor WHERE email=?').bind(email).first()).departments_json).toBe('[]')
    expect(await DB.forActor(email).prepare("SELECT id FROM application WHERE id='app-race'").first()).toEqual({id:'app-race'})
  })
  it.each(cases)('%s preserves normal results and reuses the successful receipt without duplicate writes',async(name,handler,body)=>{
    const key=crypto.randomUUID(),first=await invoke(handler,body,key)
    const result=await first.json()
    expect(first.status,JSON.stringify(result)).toBe(200)
    if(name==='signoff') expect(result.state).toMatchObject({status:'이의 있음',signedDepts:['Finance']})
    if(name==='accept') expect(result.state).toMatchObject({status:'부서가 확인함',by:'Owner'})
    if(name==='reject') expect(result.state).toMatchObject({status:'못 쓰겠다고 하심'})
    if(name==='beta') expect(result.state).toMatchObject({total:1,open:1})
    const after=await stored(),replay=await invoke(handler,body,key)
    expect(replay.status,JSON.stringify(await replay.json())).toBe(200)
    expect(replay.headers.get('X-Idempotency-Replayed')).toBe('1')
    expect(await stored()).toEqual(after)
    expect(after.logs).toBeGreaterThan(0)
  })
  it.each(cases)('%s rolls back domain writes when the required audit write fails',async(_name,handler,body)=>{
    const before=await stored(),response=await invoke(handler,{...body,by:'Reject audit'})
    expect(response.status).toBe(503)
    expect(await stored()).toEqual(before)
  })
})
