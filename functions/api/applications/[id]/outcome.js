import { jsonResponse, jsonError, failFields, failUnexpected } from '../../../_lib/http.ts'
import { logDecision } from '../../../_lib/decisions.js'
import { validateOutcomeInputs } from '../../../../shared/outcomeInputs.ts'
import { OUTCOME_PROXY_KIND } from '../../../../shared/accept.js'
import { loadOutcomeEvidence, outcomeMutation, outcomeConflict, evidenceMetadata, OUTCOME_RESOLUTION_KIND, OUTCOME_INPUT_KIND } from '../../../_lib/outcomeEvidence.js'

async function findApplication(DB, id) {
  return DB.prepare('SELECT id,ticket_no,dept,title,status,current_minutes,current_people,current_frequency FROM application WHERE id = ? OR ticket_no = ?').bind(id,id).first()
}

export async function onRequestGet({ env, data: requestData, params }) {
  env = requestData?.requestEnv ?? env
  try {
    const app = await findApplication(env.DB, params.id)
    if (!app) return jsonError('그런 신청서가 없습니다.',404)
    const e = await loadOutcomeEvidence(env.DB,app.id,{detail:true})
    return jsonResponse({ application: app, baseline:e.baseline, uses:e.uses, outcome:e.outcome, annual:e.annual,
      claimed: app.current_minutes ? {minutes:app.current_minutes,people:app.current_people,frequency:app.current_frequency} : null,
      challenges:e.challenges, unresolvedCount:e.unresolvedCount,label:e.label,saved:e.currentSaved,
      confirmation:e.confirmation, expectedEvidence:e.mutationToken,
    })
  } catch(error) { return failUnexpected(error,'성과를 불러오지 못했습니다.') }
}

export async function onRequestPost({ env, data: requestData, params, request }) {
  env = requestData?.requestEnv ?? env
  let body
  try { body = await request.json() } catch { return jsonError('요청 형식이 올바르지 않습니다.',400) }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return jsonError('요청 형식이 올바르지 않습니다.',400)
  const t = value => String(value ?? '').trim()
  const inputs = body.kind === 'inputs' ? validateOutcomeInputs(body) : null
  if (inputs && !inputs.ok) return failFields(inputs.errors)
  if (!['inputs','dept_confirm','resolve_challenge'].includes(body.kind)) return jsonError('무엇을 저장할지 알 수 없습니다.',400)
  if (body.kind === 'dept_confirm' && (t(body.by).length < 2 || t(body.by).length > 60 || t(body.comment).length > 1000)) return failFields({by:'확인한 담당자 성함(2~60자)과 의견(1,000자 이내)을 적어주세요.'})
  if (body.kind === 'resolve_challenge' && (!t(body.resolution) || t(body.resolution).length > 2000)) return failFields({resolution:'확인 근거를 1~2,000자로 적어주세요.'})
  return outcomeMutation(env.DB,request,`outcome:${params.id}`,body,async DB => {
    const app = await findApplication(DB,params.id)
    if (!app) return jsonError('그런 신청서가 없습니다.',404)
    const e = await loadOutcomeEvidence(DB,app.id)
    if (body.kind !== 'inputs' && !e.canConfirm) {
      const blockers = []
      if (!e.baseline) blockers.push('기준선이 봉인돼 있지 않습니다. 견줄 값이 없습니다.')
      if (!(e.runSummary?.count > 0)) blockers.push('도구가 아직 한 번도 안 돌았습니다. 쓰이기 전에는 줄어든 것이 없습니다.')
      return jsonResponse({error:'아직 확인할 숫자가 없습니다.',blockers},400)
    }
    if (body.expectedEvidence !== e.mutationToken) return outcomeConflict()
    if (body.kind === 'inputs') {
      const v = inputs.value
      await DB.prepare(`INSERT INTO outcome(application_id,dev_hours,ops_cost_krw,amortize_months,next_bottleneck,computed_at)
        VALUES(?,?,?,?,?,datetime('now')) ON CONFLICT(application_id) DO UPDATE SET dev_hours=excluded.dev_hours,
        ops_cost_krw=excluded.ops_cost_krw,amortize_months=excluded.amortize_months,next_bottleneck=excluded.next_bottleneck,computed_at=datetime('now')`)
        .bind(app.id,v.dev_hours,v.ops_cost_krw,v.amortize_months,v.next_bottleneck || null).run()
      await logDecision({DB},{applicationId:app.id,stage:'성과',title:'성과 산정값을 저장했다',
        what:`제작 ${v.dev_hours}시간 · 운영비 ${v.ops_cost_krw}원`,why:'현재 계산 근거를 확인한 뒤 산정값을 변경했다.',
        linkKind:OUTCOME_INPUT_KIND,linkId:app.id,alternatives:evidenceMetadata(e,{nextInputs:v})})
    } else if (body.kind === 'dept_confirm') {
      await DB.prepare(`INSERT INTO outcome(application_id,dept_confirmed_at,dept_confirmed_by,dept_comment)
        VALUES(?,datetime('now'),?,?) ON CONFLICT(application_id) DO UPDATE SET dept_confirmed_at=datetime('now'),
        dept_confirmed_by=excluded.dept_confirmed_by,dept_comment=excluded.dept_comment`).bind(app.id,t(body.by),t(body.comment)||null).run()
      await logDecision({DB},{applicationId:app.id,stage:'성과',title:t(body.by),
        what:`담당자가 대신 확인했습니다. ${t(body.comment)}`.trim(),why:'부서와 확인한 현재 계산 근거에만 유효한 대리 확인이다.',
        linkKind:OUTCOME_PROXY_KIND,linkId:app.id,alternatives:evidenceMetadata(e)})
    } else {
      const challenge = e.challenges.find(row=>row.code === t(body.rule_code))
      if (!challenge) return jsonError('현재 성과에 해당하지 않는 검증 항목입니다.',400)
      if (challenge.code === 'no_dept_confirm') return jsonError('부서 직접 확인 또는 담당자의 대리 확인을 기록해야 합니다.',400)
      if (challenge.resolved_at) return outcomeConflict()
      await logDecision({DB},{applicationId:app.id,stage:'성과',title:challenge.title,what:t(body.resolution),
        why:challenge.body,linkKind:OUTCOME_RESOLUTION_KIND,linkId:challenge.code,
        alternatives:evidenceMetadata(e,{fingerprint:challenge.fingerprint,supersedes:null,rule:challenge.code})})
    }
    return jsonResponse({ok:true})
  })
}
