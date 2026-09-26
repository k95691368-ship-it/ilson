import { jsonResponse, jsonError, failFields, failUnexpected } from '../../../_lib/http.ts'
import { atomicMutation, mutationFingerprint } from '../../../_lib/atomicMutation.ts'
import { loadHandoverEvidence, publicHandoverEvidence } from '../../../_lib/handoverEvidence.ts'
import { logDecision } from '../../../_lib/decisions.js'
import { HANDOVER_KIND, STOP_KIND, TOOL_SCOPE, validateHandover } from '../../../../shared/handover.ts'
import { RESTORE_KIND } from '../../../../shared/rollback.js'
import type { Database, DatabaseEnvironment } from '../../../_lib/runtimeTypes.ts'
import type { HandoverErrors, HumanCriterionReference, HandoverHumanCheck } from '../../../../shared/handover.ts'
import type { HandoverMutationResponse, HandoverRequest } from '../../../../shared/contracts/handover.ts'

interface HandoverEnvironment extends DatabaseEnvironment {
  DEMO_WORKSPACE?: boolean
  OVERRIDE_DEMO_MODE?: string
  AUTH_ACTOR?: { mode?: string; email?: string; role?: string } | null
}
type HandoverReadContext = { env: HandoverEnvironment; data?: { requestEnv?: HandoverEnvironment }; params: { id: string } }
type HandoverWriteContext = HandoverReadContext & { request: Request }
type Authority = { label: string; email?: string }
type ActorRow = { email: string; display_name: string; role: string; active: number; departments_json: string; product_ids_json: string }
export type HandoverValidationResult = { ok: true; value: HandoverRequest } | { ok: false; fields: HandoverErrors }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

// Preserve the existing validator's messages/limits, then construct only the
// fields actually used by the write. The fingerprint still uses the full raw
// body, so unknown fields cannot change idempotency/replay semantics.
export function validatedHandoverBody(body: Record<string, unknown>, humanCriteria: readonly HumanCriterionReference[], expectedEvidence: string): HandoverValidationResult {
  const fields=validateHandover(body,humanCriteria)
  if(Object.keys(fields).length) return {ok:false,fields}
  if(typeof body.reason!=='string') throw new Error('Validated handover reason is not text')
  if(body.action==='stop') return {ok:true,value:{action:'stop',reason:body.reason,expectedEvidence}}
  if((body.action!=='create'&&body.action!=='restore')||typeof body.title!=='string'||typeof body.person!=='string'
    ||typeof body.whenToRun!=='string'||typeof body.afterRun!=='string'||typeof body.contact!=='string'
    ||typeof body.dailyLimit!=='number'||typeof body.maxFileMb!=='number'||body.scopeAccepted!==true) {
    throw new Error('Validated handover fields have an inconsistent shape')
  }
  const humanChecks: Record<string,HandoverHumanCheck>={}
  for(const criterion of humanCriteria) {
    const check=isRecord(body.humanChecks)?body.humanChecks[criterion.id]:undefined
    if(!isRecord(check)||check.confirmed!==true||typeof check.evidence!=='string') throw new Error('Validated human evidence has an inconsistent shape')
    humanChecks[criterion.id]={confirmed:true,evidence:check.evidence}
  }
  return {ok:true,value:{action:body.action,reason:body.reason,title:body.title,person:body.person,whenToRun:body.whenToRun,
    afterRun:body.afterRun,contact:body.contact,dailyLimit:body.dailyLimit,maxFileMb:body.maxFileMb,
    scopeAccepted:true,humanChecks,expectedEvidence}}
}

const conflict=()=>jsonResponse({error:'인계 근거 또는 권한이 변경되었습니다. 작성한 내용은 유지하고 최신 근거를 확인해주세요.',code:'HANDOVER_CONFLICT',notSaved:true},409)

async function authority(env: HandoverEnvironment,DB: Database): Promise<Authority | Response> {
  if(env.DEMO_WORKSPACE===true||env.OVERRIDE_DEMO_MODE==='true') return {label:'체험 담당자'}
  if(env.AUTH_ACTOR?.mode!=='access'||!env.AUTH_ACTOR.email) return jsonError('인증된 사내 계정이 필요합니다.',401)
  const row=await DB.prepare('SELECT email,display_name,role,active,departments_json,product_ids_json FROM override_actor WHERE email=?').bind(env.AUTH_ACTOR.email).first<ActorRow>()
  if(!row||Number(row.active)!==1) return jsonError('현재 계정의 접근 권한을 확인할 수 없습니다.',401)
  if(!['product','ml','engineer','audit','executive'].includes(row.role)) return jsonError('현재 계정에는 도구를 인계하거나 중단할 권한이 없습니다.',403)
  return {label:row.display_name,email:row.email}
}

export async function onRequestGet({env,data,params}: HandoverReadContext): Promise<Response> {
  env=data?.requestEnv??env
  try {
    const evidence=await loadHandoverEvidence(env.DB,params.id)
    return evidence?jsonResponse(publicHandoverEvidence(evidence)):jsonError('그런 신청서가 없습니다.',404)
  } catch(error) {return failUnexpected(error,'인계 근거를 불러오지 못했습니다.')}
}

export async function onRequestPost({env,data,params,request}: HandoverWriteContext): Promise<Response> {
  env=data?.requestEnv??env
  let rawBody: unknown
  try {rawBody=await request.json()} catch {return jsonError('요청 형식이 올바르지 않습니다.',400)}
  if(!isRecord(rawBody)) return jsonError('요청 형식이 올바르지 않습니다.',400)
  const expectedEvidence=rawBody.expectedEvidence
  if(typeof expectedEvidence!=='string'||!/^[a-f0-9]{64}$/.test(expectedEvidence)) return conflict()
  const key=request.headers.get('X-Idempotency-Key')
  if(!key||!/^[a-zA-Z0-9_-]{16,100}$/.test(key)) return jsonError('중복 방지 요청 번호가 필요합니다.',400)
  try {
    return await atomicMutation(env.DB,key,await mutationFingerprint({kind:'handover',identity:params.id,body:rawBody}),async DB=>{
      const actor=await authority(env,DB)
      if(actor instanceof Response) return actor
      const evidence=await loadHandoverEvidence(DB,params.id)
      if(!evidence) return jsonError('그런 신청서가 없습니다.',404)
      if(expectedEvidence!==evidence.expectedEvidence) return conflict()
      const validated=validatedHandoverBody(rawBody,evidence.humanCriteria,expectedEvidence)
      if(!validated.ok) return failFields(validated.fields)
      const body=validated.value
      const {application:app,handover:old,manual:oldManual}=evidence
      const reason=body.reason.trim()
      if(body.action==='stop') {
        if(!old||old.rolled_back_at) return jsonError('현재 실행 중인 인계 도구가 없습니다.',409)
        await DB.prepare("UPDATE handover SET rolled_back_at=datetime('now'),rollback_reason=?,updated_at=datetime('now') WHERE application_id=?").bind(reason,app.id).run()
        await logDecision({DB},{applicationId:app.id,stage:'배포',title:actor.label,what:reason,why:'현장 실행을 중단합니다.',
          alternatives:JSON.stringify({betaSeq:evidence.latestBeta?.seq??0,betaId:evidence.latestBeta?.id??null,previous:old}),linkKind:STOP_KIND,linkId:old.slug})
        return jsonResponse({ok:true,action:'stop',slug:old.slug} satisfies HandoverMutationResponse)
      }
      if(evidence.blockers.length) return jsonResponse({error:'인계에 필요한 근거를 먼저 확인해주세요.',blockers:evidence.blockers},400)
      if(body.action==='create'&&old) return jsonError('이미 인계한 도구가 있습니다. 새로 만들지 않고 기존 도구를 사용해주세요.',409)
      if(body.action==='restore'&&(!old||!old.rolled_back_at)) return jsonError('중단된 도구만 다시 인계할 수 있습니다.',409)
      const slug=old?.slug??`settlement-${crypto.randomUUID()}`
      const manual={title:body.title.trim(),intro:TOOL_SCOPE,whenToRun:body.whenToRun.trim(),afterRun:body.afterRun.trim(),contact:body.contact.trim()}
      await DB.prepare(`INSERT INTO manual (application_id,title,intro,when_to_run,what_to_do_after,contact,published_at)
        VALUES (?,?,?,?,?,?,datetime('now')) ON CONFLICT(application_id) DO UPDATE SET title=excluded.title,intro=excluded.intro,
        when_to_run=excluded.when_to_run,what_to_do_after=excluded.what_to_do_after,contact=excluded.contact,published_at=datetime('now'),updated_at=datetime('now')`)
        .bind(app.id,manual.title,manual.intro,manual.whenToRun,manual.afterRun,manual.contact).run()
      if(body.action==='create') {
        await DB.prepare(`INSERT INTO handover (application_id,slug,title,handed_to_dept,handed_to_person,daily_limit,max_file_mb,note)
          VALUES (?,?,?,?,?,?,?,?)`).bind(app.id,slug,manual.title,app.dept,body.person.trim(),body.dailyLimit,body.maxFileMb,reason).run()
      } else {
        await DB.prepare(`UPDATE handover SET title=?,handed_to_dept=?,handed_to_person=?,daily_limit=?,max_file_mb=?,note=?,
          rolled_back_at=NULL,rollback_reason=NULL,updated_at=datetime('now') WHERE application_id=?`)
          .bind(manual.title,app.dept,body.person.trim(),body.dailyLimit,body.maxFileMb,reason,app.id).run()
      }
      // Receiving remains a separate declaration by the actual department.
      if(body.action==='create') await DB.prepare("UPDATE application SET status='진행중',updated_at=datetime('now') WHERE id=?").bind(app.id).run()
      const humanChecks=Object.fromEntries(evidence.humanCriteria.map(c=>[c.id,{body:c.body,confirmed:true,evidence:body.humanChecks[c.id].evidence.trim()}]))
      await logDecision({DB},{applicationId:app.id,stage:'배포',title:actor.label,
        what:body.action==='restore'?reason:`${app.dept} ${body.person.trim()}에게 ${manual.title} 인계`,why:reason,
        alternatives:JSON.stringify({proof:evidence.proof,humanChecks,scopeAccepted:true,manual,previous:old,previousManual:oldManual}),
        linkKind:body.action==='restore'?RESTORE_KIND:HANDOVER_KIND,linkId:slug})
      return jsonResponse({ok:true,action:body.action,slug,href:`/t/${slug}`} satisfies HandoverMutationResponse,body.action==='create'?201:200)
    })
  } catch(error) {
    const message=error!==null&&typeof error==='object'&&'message' in error&&typeof error.message==='string'?error.message:''
    if(/\/(40001|40P01|28000)/.test(message)) return conflict()
    return failUnexpected(error,'인계 저장 여부를 확인하지 못했습니다. 같은 내용으로 다시 저장해주세요.')
  }
}
