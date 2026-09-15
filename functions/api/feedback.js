import { jsonResponse, jsonError, failUnexpected } from '../_lib/http.js'
import { atomicMutation, mutationFingerprint } from '../_lib/atomicMutation.js'
import { resolveOverrideActor, auditOverride } from '../_lib/override.js'
import { feedbackActorKey } from '../_lib/fieldFeedback.js'
import { newId } from '../_lib/ids.js'
import { canManageFeedback, canReviewQuality, validDate, FEEDBACK_KINDS, FEEDBACK_VERDICTS, QUALITY_VERDICTS, NONUSE_STATES, NONUSE_REASONS } from '../../shared/fieldFeedback.js'

function demand(condition, message, status=400) {
  if (!condition) { const error=new Error(message); error.publicStatus=status; throw error }
}
function text(value,max=2000,required=true) {
  demand(typeof value==='string' && value.trim().length<=max && (!required || value.trim().length>0),'입력 내용을 확인해주세요.')
  return value.trim()
}
const has = (object,key) => typeof key==='string' && Object.hasOwn(object,key)
async function actorFor(env,request,body) {
  const role=new URL(request.url).searchParams.get('role')
  const actor=await resolveOverrideActor(env,request,body ?? {role:role || 'reviewer'})
  demand(actor,'인증된 계정이 필요합니다.',401)
  return actor
}
async function visibleCase(DB,id,key,manager) {
  const row=await DB.prepare('SELECT * FROM field_feedback_case WHERE id=?').bind(id).first()
  demand(row && (manager || row.reporter_key===key),'이 피드백을 찾을 수 없습니다.',404)
  return row
}

export async function onRequestGet({env,data:requestData,request}) {
  env=requestData?.requestEnv ?? env
  try {
    const actor=await actorFor(env,request), key=await feedbackActorKey(actor)
    const manager=canManageFeedback(actor.role), reviewer=canReviewQuality(actor.role)
    const cases=(await env.DB.prepare(`SELECT c.*,e.reason_detail,e.product_id,p.name AS product_name
      FROM field_feedback_case c JOIN override_event e ON e.id=c.event_id JOIN override_product p ON p.id=e.product_id
      ${manager?'':'WHERE c.reporter_key=?'} ORDER BY c.created_at DESC,c.id DESC LIMIT 100`).bind(...(manager?[]:[key])).all()).results
    const updates=cases.length ? (await env.DB.prepare(`SELECT u.*,r.seen_at,r.verdict,r.note,r.responded_at
      FROM field_feedback_update u LEFT JOIN field_feedback_receipt r ON r.update_id=u.id
      WHERE u.case_id IN (${cases.map(()=>'?').join(',')}) ORDER BY u.created_at,u.id`).bind(...cases.map(c=>c.id)).all()).results : []
    const batches=reviewer ? (await env.DB.prepare(`SELECT b.*,p.name AS product_name FROM quality_sample_batch b JOIN override_product p ON p.id=b.product_id ORDER BY b.created_at DESC,b.id DESC LIMIT 50`).all()).results : []
    const samples=batches.length ? (await env.DB.prepare(`SELECT * FROM quality_sample_item WHERE batch_id IN (${batches.map(()=>'?').join(',')}) ORDER BY id`).bind(...batches.map(b=>b.id)).all()).results : []
    const nonuse=(await env.DB.prepare(`SELECT r.id,r.product_id,p.name AS product_name,r.usage_state,r.reason,r.note,r.occurred_on
      FROM tool_nonuse_report r JOIN override_product p ON p.id=r.product_id WHERE r.reporter_key=? ORDER BY r.created_at DESC,r.id LIMIT 50`).bind(key).all()).results
    const nonuseSummary=(manager || reviewer) ? (await env.DB.prepare(`SELECT p.id AS product_id,p.name AS product_name,r.usage_state,r.reason,count(*) AS reports
      FROM tool_nonuse_report r JOIN override_product p ON p.id=r.product_id GROUP BY p.id,p.name,r.usage_state,r.reason ORDER BY reports DESC,p.id,r.usage_state,r.reason`).all()).results : []
    const items=cases.map(({reporter_key,...c})=>({...c,is_mine:reporter_key===key,updates:updates.filter(u=>u.case_id===c.id)}))
    const unread=(await env.DB.prepare(`SELECT count(*) AS n FROM field_feedback_update u JOIN field_feedback_case c ON c.id=u.case_id
      LEFT JOIN field_feedback_receipt r ON r.update_id=u.id WHERE c.reporter_key=? AND r.update_id IS NULL`).bind(key).first())?.n ?? 0
    return jsonResponse({cases:items,unread:Number(unread),manager,reviewer,batches,
      samples:samples.map(({snapshot_json,...item})=>({...item,snapshot:JSON.parse(snapshot_json)})),nonuse,nonuseSummary})
  } catch(error) {
    if(error.publicStatus)return jsonError(error.message,error.publicStatus)
    return failUnexpected(error,'현장 피드백을 불러오지 못했습니다. 새 기능의 DB 마이그레이션 적용 여부를 확인해주세요.')
  }
}

async function act(env,actor,key,body) {
  const DB=env.DB, action=body.action
  let entityId
  if(action==='publish_update') {
    demand(canManageFeedback(actor.role),'현재 역할에는 답변 권한이 없습니다.',403)
    const item=await visibleCase(DB,text(body.caseId,100),key,true)
    demand(has(FEEDBACK_KINDS,body.kind),'안내 종류를 선택해주세요.')
    const content=text(body.message)
    if(body.kind==='applied') demand(validDate(body.effectiveOn) && body.effectiveOn<=new Date().toISOString().slice(0,10) && body.confirmedApplied===true,'실제 적용 여부와 적용일을 확인해주세요.')
    entityId=newId('ffu')
    await DB.prepare('INSERT INTO field_feedback_update(id,case_id,kind,body,effective_on,actor_label) VALUES(?,?,?,?,?,?)')
      .bind(entityId,item.id,body.kind,content,body.kind==='applied'?body.effectiveOn:null,actor.label).run()
  } else if(action==='read_update' || action==='confirm_update') {
    const update=await DB.prepare('SELECT * FROM field_feedback_update WHERE id=?').bind(text(body.updateId,100)).first()
    demand(update,'안내를 찾을 수 없습니다.',404)
    await visibleCase(DB,update.case_id,key,false)
    const receipt=await DB.prepare('SELECT * FROM field_feedback_receipt WHERE update_id=?').bind(update.id).first()
    if(action==='read_update') {
      if(!receipt) await DB.prepare('INSERT INTO field_feedback_receipt(update_id) VALUES(?)').bind(update.id).run()
    } else {
      demand(update.kind==='applied','개선 적용 안내에만 재확인을 남길 수 있습니다.')
      demand(!receipt?.responded_at || receipt.verdict==='untested','이미 재확인을 남겼습니다.',409)
      demand(has(FEEDBACK_VERDICTS,body.verdict),'확인 결과를 선택해주세요.')
      const note=text(body.note ?? '',1000,body.verdict==='not_resolved')
      await DB.prepare(`INSERT INTO field_feedback_receipt(update_id,verdict,note,responded_at) VALUES(?,?,?,datetime('now'))
        ON CONFLICT(update_id) DO UPDATE SET verdict=excluded.verdict,note=excluded.note,responded_at=excluded.responded_at`)
        .bind(update.id,body.verdict,note).run()
    }
    entityId=update.id
  } else if(action==='create_sample') {
    demand(canReviewQuality(actor.role),'현재 역할에는 표본 점검 권한이 없습니다.',403)
    demand(validDate(body.startDate) && validDate(body.endDate) && body.startDate<=body.endDate && body.endDate<=new Date().toISOString().slice(0,10),'점검 기간을 확인해주세요.')
    const size=Number(body.size)
    demand(Number.isInteger(size)&&size>=1&&size<=30,'표본은 1~30건으로 선택해주세요.')
    const productId=text(body.productId,100)
    const product=await DB.prepare('SELECT id FROM override_product WHERE id=?').bind(productId).first()
    demand(product,'현재 공간의 제품을 선택해주세요.',404)
    const predicate=`e.product_id=? AND e.decision_action='approve' AND e.is_override=0 AND substr(e.occurred_at,1,10)>=? AND substr(e.occurred_at,1,10)<=?
      AND NOT EXISTS(SELECT 1 FROM quality_sample_item i WHERE i.event_id=e.id)`
    const binds=[productId,body.startDate,body.endDate]
    const eligible=Number((await DB.prepare(`SELECT count(*) AS n FROM override_event e WHERE ${predicate}`).bind(...binds).first())?.n || 0)
    demand(eligible>0,'선택한 기간에 아직 추출하지 않은 승인 사건이 없습니다.')
    // A server-generated seed prevents hand-picked samples; retries retain the receipt.
    const seed=crypto.randomUUID()
    const rows=(await DB.prepare(`SELECT e.id,e.ai_decision,e.human_decision,e.model_version,e.prompt_version,e.policy_refs_json,e.occurred_at
      FROM override_event e WHERE ${predicate} ORDER BY md5(e.id || ?),e.id LIMIT ?`).bind(...binds,seed,size).all()).results
    entityId=newId('qsb')
    await DB.prepare('INSERT INTO quality_sample_batch(id,product_id,start_at,end_at,requested_size,sample_size,eligible_count,seed,created_by) VALUES(?,?,?,?,?,?,?,?,?)')
      .bind(entityId,productId,body.startDate,body.endDate,size,rows.length,eligible,seed,actor.label).run()
    for(const row of rows)await DB.prepare('INSERT INTO quality_sample_item(id,batch_id,event_id,snapshot_json) VALUES(?,?,?,?)')
      .bind(newId('qsi'),entityId,row.id,JSON.stringify(row)).run()
  } else if(action==='review_sample') {
    demand(canReviewQuality(actor.role),'현재 역할에는 표본 점검 권한이 없습니다.',403)
    const item=await DB.prepare('SELECT * FROM quality_sample_item WHERE id=?').bind(text(body.itemId,100)).first()
    demand(item,'표본을 찾을 수 없습니다.',404)
    demand(!item.reviewed_at,'이미 점검한 표본입니다.',409)
    demand(has(QUALITY_VERDICTS,body.verdict),'점검 결과를 선택해주세요.')
    await DB.prepare(`UPDATE quality_sample_item SET verdict=?,reason=?,evidence_refs=?,reviewed_by=?,reviewed_at=datetime('now') WHERE id=?`)
      .bind(body.verdict,text(body.reason),text(body.evidenceRefs,1000,body.verdict!=='insufficient'),actor.label,item.id).run()
    entityId=item.id
  } else if(action==='record_nonuse') {
    demand(has(NONUSE_STATES,body.usageState)&&has(NONUSE_REASONS,body.reason),'사용 상태와 이유를 선택해주세요.')
    demand(validDate(body.occurredOn)&&body.occurredOn<=new Date().toISOString().slice(0,10),'사용 중단일을 확인해주세요.')
    const productId=text(body.productId,100)
    demand(await DB.prepare('SELECT id FROM override_product WHERE id=?').bind(productId).first(),'현재 공간의 제품을 선택해주세요.',404)
    entityId=newId('nur')
    await DB.prepare('INSERT INTO tool_nonuse_report(id,product_id,reporter_key,usage_state,reason,note,occurred_on) VALUES(?,?,?,?,?,?,?)')
      .bind(entityId,productId,key,body.usageState,body.reason,text(body.note ?? '',1000,body.reason==='other'),body.occurredOn).run()
  } else demand(false,'지원하지 않는 작업입니다.')
  // Never copy report text or reporter identity into the broadly visible audit feed.
  await auditOverride(env,actor,action,'field_feedback',entityId,{})
  return jsonResponse({ok:true,id:entityId},action==='create_sample'||action==='publish_update'||action==='record_nonuse'?201:200)
}

export async function onRequestPost({env,data:requestData,request}) {
  env=requestData?.requestEnv ?? env
  let body
  try {body=await request.json()}catch{return jsonError('요청 형식이 올바르지 않습니다.',400)}
  try {
    demand(body && typeof body==='object' && !Array.isArray(body),'요청 형식이 올바르지 않습니다.')
    const actor=await actorFor(env,request,body),key=await feedbackActorKey(actor)
    const requestId=request.headers.get('X-Idempotency-Key')
    demand(typeof requestId==='string'&&/^[a-zA-Z0-9_-]{16,100}$/.test(requestId),'중복 방지 요청 번호가 필요합니다.')
    return await atomicMutation(env.DB,requestId,await mutationFingerprint({body,identity:key,role:actor.role}),
      DB=>act({...env,DB},actor,key,body))
  } catch(error) {
    if(error.publicStatus)return jsonError(error.message,error.publicStatus)
    if(/\/(40001|23505)/.test(error.message))return jsonError('다른 요청으로 기록이 변경되었습니다. 새로고침 후 확인해주세요.',409)
    return failUnexpected(error,'현장 피드백을 저장하지 못했습니다.')
  }
}
