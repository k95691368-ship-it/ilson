import { atomicMutation, mutationFingerprint } from './atomicMutation.js'
import { jsonResponse, jsonError, failUnexpected } from './http.js'

export function agreementConflict() {
  return jsonResponse({error:'협의 근거가 변경되었습니다. 작성한 내용은 유지하고 최신 근거를 확인한 뒤 다시 저장해주세요.',code:'AGREEMENT_EDIT_CONFLICT'},409)
}

export async function criteriaSourceVersion(applicationId, revision, criteria) {
  return mutationFingerprint({applicationId,revision:Number(revision),criteria})
}

export async function loadCriteriaEvidence(DB, applicationId) {
  const app=await DB.prepare('SELECT id,beta_criteria_revision FROM application WHERE id=?').bind(applicationId).first()
  if(!app) return null
  const criteria=(await DB.prepare('SELECT * FROM acceptance_criterion WHERE application_id=? ORDER BY ord,id').bind(applicationId).all()).results
  const sourceVersion=await criteriaSourceVersion(app.id,app.beta_criteria_revision,criteria)
  return {criteria,sourceVersion,versioned:await Promise.all(criteria.map(async row=>({...row,
    edit_version:await mutationFingerprint({applicationId,revision:Number(app.beta_criteria_revision),row})}))) }
}

export async function baselineSourceVersion(app, shadowRuns, baseline) {
  return mutationFingerprint({applicationId:app.id,people:app.current_people??null,frequency:app.current_frequency??null,
    shadowRuns,baseline:baseline??null})
}

export async function currentAgreementAuthority(env, DB) {
  if(env.DEMO_WORKSPACE===true || env.OVERRIDE_DEMO_MODE==='true') return null
  const identity=env.AUTH_ACTOR
  if(identity?.mode!=='access'||!identity.email) return jsonError('인증된 사내 계정이 필요합니다.',401)
  const actor=await DB.prepare('SELECT email,display_name,role,active,departments_json,product_ids_json FROM override_actor WHERE email=?').bind(identity.email).first()
  if(!actor || Number(actor.active)!==1) return jsonError('현재 계정의 접근 권한을 확인할 수 없습니다.',401)
  if(!['operations','product','policy','audit','executive'].includes(actor.role)) return jsonError('현재 계정에는 협의 근거를 변경할 권한이 없습니다.',403)
  return null
}

export async function agreementMutation(env, request, identity, body, action) {
  const key=request.headers.get('X-Idempotency-Key')||crypto.randomUUID()
  if(!/^[a-zA-Z0-9_-]{16,100}$/.test(key)) return jsonError('중복 방지 요청 번호가 올바르지 않습니다.',400)
  try {
    return await atomicMutation(env.DB,key,await mutationFingerprint({identity,body}),async DB=>{
      const forbidden=await currentAgreementAuthority(env,DB)
      return forbidden||action(DB)
    })
  } catch(error) {
    if(/\/(40001|40P01|28000)/.test(error.message)) return agreementConflict()
    return failUnexpected(error,'협의 근거를 저장하지 못했습니다.')
  }
}
