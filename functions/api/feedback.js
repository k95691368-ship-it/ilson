import { jsonResponse, jsonError, failUnexpected } from '../_lib/http.js'
import { atomicMutation, mutationFingerprint } from '../_lib/atomicMutation.js'
import { resolveOverrideActor, auditOverride } from '../_lib/override.js'
import { feedbackActorKey } from '../_lib/fieldFeedback.js'
import { createIssueFollowup } from '../_lib/issueWorkflow.js'
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
const CASE_PAGE_SIZE = 100
const BATCH_PAGE_SIZE = 50
const FOLLOWUP_OVERVIEW_SIZE = 200
function readCursor(value) {
  if (!value) return null
  try {
    demand(value.length <= 1000 && /^[A-Za-z0-9+/]+={0,2}$/.test(value),'페이지 주소를 확인해주세요.')
    const cursor=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(atob(value),c=>c.charCodeAt(0))))
    demand(Array.isArray(cursor) && cursor.length===2 && typeof cursor[0]==='string' && cursor[0].length<=40 && Number.isFinite(Date.parse(cursor[0])) && typeof cursor[1]==='string' && cursor[1].length>0 && cursor[1].length<=100,'페이지 주소를 확인해주세요.')
    return cursor
  } catch { demand(false,'페이지 주소를 확인해주세요.') }
}
const encodeCursor = item => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify([item.created_at,item.id]))))
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

async function readRows(DB, queries) {
  const entries = Object.entries(queries)
  if (!entries.length) return {}
  const results = await DB.batch(entries.map(([, statement]) => statement))
  return Object.fromEntries(entries.map(([name], index) => [name, results[index].results]))
}

export async function onRequestGet({env,data:requestData,request}) {
  env=requestData?.requestEnv ?? env
  try {
    const actor=await actorFor(env,request), key=await feedbackActorKey(actor)
    const manager=canManageFeedback(actor.role), reviewer=canReviewQuality(actor.role)
    const params=new URL(request.url).searchParams
    const cursor=readCursor(params.get('caseCursor')), batchCursor=readCursor(params.get('batchCursor'))
    const caseConditions=[...(manager?[]:['c.reporter_key=?']),...(cursor?['(c.created_at<? OR (c.created_at=? AND c.id<?))']:[])]
    const caseBinds=[...(manager?[]:[key]),...(cursor?[cursor[0],cursor[0],cursor[1]]:[])]
    const followupConditions=manager ? [] : [`(${reviewer ? "f.source_kind='quality_sample' OR " : ''}EXISTS(SELECT 1 FROM field_feedback_case own WHERE own.event_id=f.event_id AND own.reporter_key=?))`]
    const followupQuery=(conditions=[],binds=[],limit='')=>env.DB.prepare(`SELECT f.*,c.title AS cluster_title,c.assignee_email,c.assignee_label,c.acknowledged_at,c.next_response_on,p.name AS product_name
      FROM issue_followup f JOIN issue_cluster c ON c.id=f.cluster_id JOIN override_product p ON p.id=f.product_id
      ${followupConditions.length || conditions.length ? 'WHERE '+[...followupConditions,...conditions].join(' AND ') : ''}
      ORDER BY CASE WHEN f.status='open' THEN 0 ELSE 1 END,f.created_at DESC,f.id ${limit}`).bind(...(manager ? [] : [key]),...binds)
    // Independent reads share one RPC. Related rows need just one more RPC,
    // instead of seven serial network round trips to Supabase.
    const { cases: caseRows, batches: batchRows = [], nonuse, nonuseSummary = [], unread: unreadRows, followups } = await readRows(env.DB, {
      cases: env.DB.prepare(`SELECT c.*,e.reason_detail,e.product_id,p.name AS product_name
      FROM field_feedback_case c JOIN override_event e ON e.id=c.event_id JOIN override_product p ON p.id=e.product_id
      ${caseConditions.length?'WHERE '+caseConditions.join(' AND '):''} ORDER BY c.created_at DESC,c.id DESC LIMIT ${CASE_PAGE_SIZE+1}`).bind(...caseBinds),
      ...(reviewer ? { batches: env.DB.prepare(`SELECT b.*,p.name AS product_name FROM quality_sample_batch b JOIN override_product p ON p.id=b.product_id
      ${batchCursor?'WHERE b.created_at<? OR (b.created_at=? AND b.id<?)':''} ORDER BY b.created_at DESC,b.id DESC LIMIT ${BATCH_PAGE_SIZE+1}`).bind(...(batchCursor?[batchCursor[0],batchCursor[0],batchCursor[1]]:[])) } : {}),
      nonuse: env.DB.prepare(`SELECT r.id,r.product_id,p.name AS product_name,r.usage_state,r.reason,r.note,r.occurred_on
      FROM tool_nonuse_report r JOIN override_product p ON p.id=r.product_id WHERE r.reporter_key=? ORDER BY r.created_at DESC,r.id LIMIT 50`).bind(key),
      ...((manager || reviewer) ? { nonuseSummary: env.DB.prepare(`SELECT p.id AS product_id,p.name AS product_name,r.usage_state,r.reason,count(*) AS reports
      FROM tool_nonuse_report r JOIN override_product p ON p.id=r.product_id GROUP BY p.id,p.name,r.usage_state,r.reason ORDER BY reports DESC,p.id,r.usage_state,r.reason`) } : {}),
      unread: env.DB.prepare(`SELECT count(*) AS n FROM field_feedback_update u JOIN field_feedback_case c ON c.id=u.case_id
      LEFT JOIN field_feedback_receipt r ON r.update_id=u.id WHERE c.reporter_key=? AND r.update_id IS NULL`).bind(key),
      followups: followupQuery([],[],`LIMIT ${FOLLOWUP_OVERVIEW_SIZE}`),
    })
    const cases=caseRows.slice(0,CASE_PAGE_SIZE), hasMore=caseRows.length>CASE_PAGE_SIZE
    const batches=batchRows.slice(0,BATCH_PAGE_SIZE), moreBatches=batchRows.length>BATCH_PAGE_SIZE
    // The capped overview is not the source of truth for a page's linked work.
    // Fetch only missing links for these cases/batches, in the same scoped RPC.
    const pageFollowupConditions=[
      ...(cases.length ? [`(f.source_kind='feedback' AND f.event_id IN (${cases.map(()=>'?').join(',')}))`] : []),
      ...(batches.length ? [`(f.source_kind='quality_sample' AND EXISTS(SELECT 1 FROM quality_sample_item page_item WHERE page_item.id=f.source_id AND page_item.batch_id IN (${batches.map(()=>'?').join(',')})))`] : []),
    ]
    const { updates = [], samples = [], reviews = [], pageFollowups = [] } = await readRows(env.DB, {
      ...(cases.length ? { updates: env.DB.prepare(`SELECT u.*,r.seen_at,r.verdict,r.note,r.responded_at
      FROM field_feedback_update u LEFT JOIN field_feedback_receipt r ON r.update_id=u.id
      WHERE u.case_id IN (${cases.map(()=>'?').join(',')}) ORDER BY u.created_at,u.id`).bind(...cases.map(c=>c.id)) } : {}),
      ...(batches.length ? { samples: env.DB.prepare(`SELECT * FROM quality_sample_item WHERE batch_id IN (${batches.map(()=>'?').join(',')}) ORDER BY id`).bind(...batches.map(b=>b.id)) } : {}),
      ...(batches.length ? { reviews: env.DB.prepare(`SELECT h.* FROM quality_sample_review_history h JOIN quality_sample_item i ON i.id=h.item_id
      WHERE i.batch_id IN (${batches.map(()=>'?').join(',')}) ORDER BY h.item_id,h.revision`).bind(...batches.map(b=>b.id)) } : {}),
      ...(followups.length===FOLLOWUP_OVERVIEW_SIZE && pageFollowupConditions.length ? { pageFollowups: followupQuery([
        '('+pageFollowupConditions.join(' OR ')+')',
        ...(followups.length ? [`f.id NOT IN (${followups.map(()=>'?').join(',')})`] : []),
      ],[...cases.map(c=>c.event_id),...batches.map(b=>b.id),...followups.map(f=>f.id)]) } : {}),
    })
    const updatesByCase = new Map()
    for (const update of updates) {
      if (!updatesByCase.has(update.case_id)) updatesByCase.set(update.case_id, [])
      updatesByCase.get(update.case_id).push(update)
    }
    const reviewsBySample=new Map()
    for(const review of reviews) {
      if(!reviewsBySample.has(review.item_id)) reviewsBySample.set(review.item_id,[])
      reviewsBySample.get(review.item_id).push(review)
    }
    const followupsByEvent=new Map(), followupsBySample=new Map()
    for(const followup of [...followups,...pageFollowups]) {
      if(followup.source_kind==='quality_sample') followupsBySample.set(followup.source_id,followup)
      else {
        if(!followupsByEvent.has(followup.event_id)) followupsByEvent.set(followup.event_id,[])
        followupsByEvent.get(followup.event_id).push(followup)
      }
    }
    const items=cases.map(({reporter_key,...c})=>({...c,is_mine:reporter_key===key,updates:updatesByCase.get(c.id) ?? [],followups:followupsByEvent.get(c.event_id) ?? []}))
    const unread=unreadRows[0]?.n ?? 0
    return jsonResponse({cases:items,casePage:{hasMore,nextCursor:hasMore?encodeCursor(cases.at(-1)):null},unread:Number(unread),manager,reviewer,batches,
      batchPage:{hasMore:moreBatches,nextCursor:moreBatches?encodeCursor(batches.at(-1)):null},followups,
      samples:samples.map(({snapshot_json,...item})=>({...item,snapshot:JSON.parse(snapshot_json),review_history:reviewsBySample.get(item.id) ?? [],followup:followupsBySample.get(item.id) ?? null})),nonuse,nonuseSummary})
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
    const feedbackCase=await visibleCase(DB,update.case_id,key,false)
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
      if(body.verdict==='not_resolved') {
        const event=await DB.prepare('SELECT * FROM override_event WHERE id=?').bind(feedbackCase.event_id).first()
        demand(event,'원본 사건을 찾을 수 없습니다.',404)
        await createIssueFollowup(DB,actor,{sourceKind:'feedback',sourceId:update.id,event,reason:note,evidenceRefs:`개선 안내 ${update.id}; 원본 사건 ${event.id}`})
      }
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
    demand((!item.reviewed_at && !item.verdict) || item.verdict==='insufficient','이미 최종 판정한 표본입니다.',409)
    demand(has(QUALITY_VERDICTS,body.verdict),'점검 결과를 선택해주세요.')
    const reason=text(body.reason),evidenceRefs=text(body.evidenceRefs,1000,body.verdict!=='insufficient')
    await DB.prepare(`UPDATE quality_sample_item SET verdict=?,reason=?,evidence_refs=?,reviewed_by=?,reviewed_at=datetime('now') WHERE id=?`)
      .bind(body.verdict,reason,evidenceRefs,actor.label,item.id).run()
    if(body.verdict==='issue') {
      const event=await DB.prepare('SELECT * FROM override_event WHERE id=?').bind(item.event_id).first()
      demand(event,'원본 사건을 찾을 수 없습니다.',404)
      const snapshot=JSON.parse(item.snapshot_json)
      await createIssueFollowup(DB,actor,{sourceKind:'quality_sample',sourceId:item.id,
        event:{...event,ai_decision:snapshot.ai_decision,human_decision:snapshot.human_decision,policy_refs_json:snapshot.policy_refs_json},reason,evidenceRefs})
    }
    entityId=item.id
  } else if(action==='resolve_followup') {
    demand(canManageFeedback(actor.role),'현재 역할에는 후속 과제 처리 권한이 없습니다.',403)
    const followup=await DB.prepare('SELECT * FROM issue_followup WHERE id=?').bind(text(body.followupId,100)).first()
    demand(followup,'후속 과제를 찾을 수 없습니다.',404)
    demand(followup.status==='open','이미 처리한 후속 과제입니다.',409)
    await DB.prepare("UPDATE issue_followup SET status='resolved',resolution=?,resolved_by=?,resolved_at=datetime('now') WHERE id=?")
      .bind(text(body.resolution),actor.label,followup.id).run()
    entityId=followup.id
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
