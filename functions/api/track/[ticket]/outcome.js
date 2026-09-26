import { jsonResponse, jsonError, failFields, failUnexpected } from '../../../_lib/http.js'
import { checkRateLimit, releaseRateLimit } from '../../../_lib/rateLimit.js'
import { currentDepartmentAuthority } from '../../../_lib/departmentAuthority.js'
import { validateOutcomeConfirm, OUTCOME_KIND, OUTCOME_PROXY_KIND } from '../../../../shared/accept.js'
import { logDecision } from '../../../_lib/decisions.js'
import { loadOutcomeEvidence, outcomeMutation, outcomeConflict, evidenceMetadata } from '../../../_lib/outcomeEvidence.js'

const find = (DB,ticket) => DB.prepare('SELECT id,ticket_no,dept,title FROM application WHERE ticket_no = ?').bind(String(ticket??'').trim().toUpperCase()).first()
function stateOf(e) {
  const c = e.confirmation
  const answer = e.challenges.find(row=>row.code === 'dept_disagrees' && row.resolved_at)
  return { canConfirm:e.canConfirm, expectedEvidence:e.mutationToken,
    status:c.current ? c.kind === OUTCOME_KIND ? '부서가 확인함' : '담당자가 대신 확인함' : c.previous ? '다시 확인 필요' : '아직',
    proxy:c.current && c.kind === OUTCOME_PROXY_KIND,by:c.by,at:c.at,comment:c.comment,previous:c.previous,
    measuredMinutes:e.baseline ? Math.round(e.baseline.median_seconds/60):null,people:e.baseline?.people??1,sampleN:e.baseline?.sample_n??0,
    runs:e.runSummary?.count??e.uses.length,deptFelt:e.deptFelt,answer:answer?.resolution??null,answeredAt:answer?.resolved_at??null,
    netKrw:e.outcome.netKrw??null,savedSeconds:e.outcome.savedSeconds??null,successCount:e.outcome.successCount??0,
    failedCount:e.outcome.failedCount??0,unknownCount:e.outcome.unknownCount??0,
  }
}
export async function onRequestGet({env,data:requestData,params}) {
  env=requestData?.requestEnv??env
  try {
    const app=await find(env.DB,params.ticket)
    if(!app) return jsonError('그 접수번호를 찾지 못했습니다.',404)
    return jsonResponse({state:stateOf(await loadOutcomeEvidence(env.DB,app.id))})
  } catch(error) { return failUnexpected(error,'성과 확인을 불러오지 못했습니다.') }
}
export async function onRequestPost({env,data:requestData,request,params}) {
  env=requestData?.requestEnv??env
  let body
  try {body=await request.json()} catch {return jsonError('보내주신 내용을 읽지 못했습니다.',400)}
  if(!body||typeof body!=='object'||Array.isArray(body)) return jsonError('요청 형식이 올바르지 않습니다.',400)
  const errors=validateOutcomeConfirm(body)
  if(String(body.by??'').trim().length>60) errors.by='성함은 60자 이내로 적어주세요.'
  if(String(body.comment??'').length>1000) errors.comment='의견은 1,000자 이내로 적어주세요.'
  if(Object.keys(errors).length) return failFields(errors)
  const bucket=`outconf:${request.headers.get('CF-Connecting-IP')||'unknown'}`
  const rateTicket=await checkRateLimit(env,bucket,10,3600)
  if(!rateTicket) return jsonError('확인은 시간당 10회까지 가능합니다.',429)
  const response=await outcomeMutation(env.DB,request,`outcome-direct:${params.ticket}`,body,async DB=>{
    const app=await find(DB,params.ticket)
    if(!app) return jsonError('그 접수번호를 찾지 못했습니다.',404)
    const forbidden=await currentDepartmentAuthority(env,DB,app.dept)
    if(forbidden) return forbidden
    const e=await loadOutcomeEvidence(DB,app.id)
    if(!e.canConfirm) return jsonError('기준선과 실행 기록이 있어야 성과를 확인할 수 있습니다.',400)
    if(body.expectedEvidence!==e.mutationToken) return outcomeConflict()
    const by=String(body.by).trim(),agree=body.agree===true,felt=agree?null:Number(body.felt)
    const comment=String(body.comment??'').trim()
    const what=agree ? `현재 기준선과 성과 수치를 확인했습니다.${comment ? ` ${comment}`:''}`
      : `기준선과 체감이 다릅니다. 실제 소요 ${felt}분.${comment ? ` ${comment}`:''}`
    await DB.prepare(`INSERT INTO outcome(application_id,dept_confirmed_at,dept_confirmed_by,dept_comment)
      VALUES(?,datetime('now'),?,?) ON CONFLICT(application_id) DO UPDATE SET dept_confirmed_at=datetime('now'),
      dept_confirmed_by=excluded.dept_confirmed_by,dept_comment=excluded.dept_comment`).bind(app.id,by,what).run()
    await logDecision({DB},{applicationId:app.id,stage:'성과',title:by,what,why:'화면에서 확인한 계산 근거와 부서의 체감 의견을 함께 보존한다.',
      linkKind:OUTCOME_KIND,linkId:app.id,alternatives:evidenceMetadata(e,{felt,agree,measured:Math.round(e.baseline.median_seconds/60)})})
    return jsonResponse({ok:true,message:agree?'현재 수치에 대한 확인을 기록했습니다.':'체감과 다른 점을 기록했습니다.'})
  })
  if(!response.ok || response.headers.get('X-Idempotency-Replayed')==='1') await releaseRateLimit(env,bucket,rateTicket)
  return response
}
