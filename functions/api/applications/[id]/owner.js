import { jsonResponse, jsonError, failFields, failUnexpected } from '../../../_lib/http.js'
import { resolveOverrideActor } from '../../../_lib/override.js'
import { isAccessAdmin } from '../../../_lib/authorization.js'
import { actorAssignments } from '../../../_lib/dataScope.js'
import { DEPTS } from '../../../../shared/depts.js'

const application = (env,id) => env.DB.prepare('SELECT id,ticket_no,dept,owner_email FROM application WHERE id=? OR ticket_no=?').bind(id,id).first()
const canManage = (env,actor) => !env.DEMO_WORKSPACE && actor?.mode === 'access' && isAccessAdmin(actor) && env.DB.actorEmail === actor.email

export async function onRequestGet({ env, data: requestData, request, params }) {
  env = requestData?.requestEnv ?? env
  try {
    const actor = await resolveOverrideActor(env,request)
    if (!actor) return jsonError('인증된 사내 계정이 필요합니다.',401)
    if (!canManage(env,actor)) return jsonResponse({ canManage:false })
    const app = await application(env,params.id)
    if (!app) return jsonError('그런 신청서가 없습니다.',404)
    const [current,candidates,history] = await Promise.all([
      app.owner_email ? env.DB.prepare('SELECT email,display_name,active FROM override_actor WHERE email=?').bind(app.owner_email).first() : Promise.resolve(null),
      env.DB.prepare('SELECT email,display_name,role,departments_json FROM override_actor WHERE active=1 ORDER BY display_name,email').all(),
      env.DB.prepare("SELECT id,actor_label,created_at,detail_json FROM override_audit WHERE action='assign_application_owner' AND entity_kind='application' AND entity_id=? ORDER BY created_at DESC,id DESC LIMIT 20").bind(app.id).all(),
    ])
    const departmentValid = DEPTS.includes(app.dept)
    return jsonResponse({ canManage:true,application:app,departmentValid,
      owner:app.owner_email ? {email:app.owner_email,label:current?.display_name ?? app.owner_email,active:current ? Number(current.active)===1 : false,registered:Boolean(current)} : null,
      candidates:departmentValid ? candidates.results.filter(row=>actorAssignments(row).departments.includes(app.dept) && row.email!==app.owner_email)
        .map(row=>({email:row.email,label:row.display_name,role:row.role})) : [],
      history:history.results.map(row=>{ let detail={};try{detail=JSON.parse(row.detail_json ?? '{}')}catch{/* only trusted historical fields are shown */}
        return {id:row.id,by:row.actor_label,at:row.created_at,previousOwnerEmail:detail.previous_owner_email ?? null,newOwnerEmail:detail.new_owner_email ?? null,reason:detail.reason ?? ''}
      }),
    })
  } catch (error) { return failUnexpected(error,'소유계정 확인 정보를 불러오지 못했습니다.') }
}

export async function onRequestPost({ env, data: requestData, request, params }) {
  env = requestData?.requestEnv ?? env
  try {
    const actor = await resolveOverrideActor(env,request)
    if (!actor) return jsonError('인증된 사내 계정이 필요합니다.',401)
    if (!canManage(env,actor)) return jsonError('신청 소유계정은 실제 계정의 관리자만 확인·이관할 수 있습니다.',403)
    let body
    try { body=await request.json() } catch { return jsonError('요청 형식이 올바르지 않습니다.',400) }
    if (!body || typeof body!=='object' || Array.isArray(body)) return jsonError('요청 형식이 올바르지 않습니다.',400)
    const newOwnerEmail=typeof body.newOwnerEmail==='string' ? body.newOwnerEmail.trim().toLowerCase() : ''
    const reason=typeof body.reason==='string' ? body.reason.trim() : ''
    const expected=body.expectedOwnerEmail
    const fields={}
    if (!/^\S+@\S+\.\S+$/.test(newOwnerEmail) || newOwnerEmail.length>240) fields.newOwnerEmail='확인한 활성 계정을 선택해주세요.'
    if (!Object.hasOwn(body,'expectedOwnerEmail') || !(expected===null || typeof expected==='string' && expected.length<=240)) fields.expectedOwnerEmail='현재 소유계정을 다시 불러와 확인해주세요.'
    if (reason.length<5 || reason.length>1000) fields.reason='확인 근거와 이관 사유를 5~1000자로 적어주세요.'
    if (body.confirmed!==true) fields.confirmed='대상 계정과 이 신청서의 관계를 직접 확인해주세요.'
    if (Object.keys(fields).length) return failFields(fields)
    const requestId=request.headers.get('X-Idempotency-Key') || crypto.randomUUID()
    if (!/^[a-zA-Z0-9_-]{16,100}$/.test(requestId)) return jsonError('중복 방지 요청 번호가 올바르지 않습니다.',400)
    const app=await application(env,params.id)
    if (!app) return jsonError('그런 신청서가 없습니다.',404)
    if (typeof env.DB.assignApplicationOwner!=='function') return jsonError('소유계정 확인 기능의 데이터베이스 설정이 필요합니다.',503)
    return jsonResponse(await env.DB.assignApplicationOwner({applicationId:app.id,expectedOwnerEmail:expected,newOwnerEmail,reason,requestId}))
  } catch (error) {
    if (error.message.includes('/40001')) return jsonError('소유계정 또는 권한이 변경되었습니다. 최신 정보를 다시 불러온 뒤 확인해주세요.',409)
    if (error.message.includes('/P0002')) return jsonError('그런 신청서가 없습니다.',404)
    if (error.message.includes('/23514')) return jsonError('신청 부서에 배정된 활성 계정을 선택해야 합니다. 계정과 부서를 다시 확인해주세요.',400)
    if (error.message.includes('/22023')) return jsonError('대상 계정과 확인 사유를 다시 확인해주세요.',400)
    return failUnexpected(error,'소유계정 확인을 저장하지 못했습니다.')
  }
}
