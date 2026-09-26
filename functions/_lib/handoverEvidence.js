import { agreementGate } from '../../shared/acceptance.js'
import { signoffState } from '../../shared/signoff.js'
import { pendingJoinDepts } from '../../shared/join.js'
import { REPORT_KIND, REPORT_FIX, toReports } from '../../shared/report.js'
import { STOP_KIND, TOOL_SCOPE } from '../../shared/handover.js'
import { decodeBetaRound } from '../../shared/betaEvidence.js'
import { loadSignoff, requiredDeptsOf } from './signoff.js'
import { loadJoins } from '../api/applications/[id]/join.js'
import { mutationFingerprint } from './atomicMutation.js'

export async function loadHandoverEvidence(DB, identity) {
  const application = await DB.prepare('SELECT id,ticket_no,dept,title,status,beta_criteria_revision FROM application WHERE id=? OR ticket_no=?').bind(identity,identity).first()
  if (!application) return null
  const id=application.id, rows=async(sql,...args)=>(await DB.prepare(sql).bind(...args).all()).results
  const [requirements,conflicts,criteria,baseline,latestBuild,rawBeta,feedback,handover,manual,logs,signatures,requiredDepts,joins] = await Promise.all([
    rows('SELECT * FROM requirement WHERE application_id=? ORDER BY id',id),
    rows('SELECT * FROM requirement_conflict WHERE application_id=? ORDER BY id',id),
    rows('SELECT * FROM acceptance_criterion WHERE application_id=? ORDER BY ord,id',id),
    DB.prepare('SELECT * FROM baseline WHERE application_id=?').bind(id).first(),
    DB.prepare('SELECT id,seq FROM build_run WHERE application_id=? ORDER BY seq DESC LIMIT 1').bind(id).first(),
    DB.prepare('SELECT * FROM beta_round WHERE application_id=? ORDER BY seq DESC LIMIT 1').bind(id).first(),
    rows("SELECT id,kind,resolved_at,resolution FROM beta_feedback WHERE application_id=? ORDER BY id",id),
    DB.prepare('SELECT * FROM handover WHERE application_id=?').bind(id).first(),
    DB.prepare('SELECT * FROM manual WHERE application_id=?').bind(id).first(),
    rows('SELECT id,link_kind,link_id,title,what,why,alternatives,created_at FROM decision_log WHERE application_id=? AND link_kind IN (?,?,?) ORDER BY created_at,id',id,REPORT_KIND,REPORT_FIX,STOP_KIND),
    loadSignoff({DB},id,application.dept), requiredDeptsOf({DB},id,application.dept),loadJoins({DB},id),
  ])
  const latestBeta=decodeBetaRound(rawBeta)
  const results=latestBeta?await rows('SELECT criterion_id,ord,body,check_key,check_kind,is_required_safety,verdict,evidence FROM beta_result WHERE round_id=? ORDER BY ord,criterion_id',latestBeta.id):[]
  const signoff=signoffState({...signatures,requiredDepts})
  const blockers=agreementGate({requirements,conflicts,criteria,baseline,pendingJoins:pendingJoinDepts({joins,requirements})}).blockers
  if (!['수용','진행중','완료'].includes(application.status)) blockers.push('수용된 신청서만 현장에 인계할 수 있습니다.')
  if (!baseline || !(Number(baseline.sample_n)>=3) || !Number.isFinite(Number(baseline.median_seconds)) || Number(baseline.median_seconds)<=0) blockers.push('3회 이상 측정한 유효한 기준선이 필요합니다.')
  if (!signoff.binding) blockers.push('현재 합격 기준을 관련 부서가 모두 직접 확인해야 합니다.')
  if (!latestBuild) blockers.push('제작 단계에서 시험 계산 기록을 남겨주세요.')
  if (!latestBeta || latestBeta.overall!=='통과') blockers.push('최신 베타 회차가 통과해야 합니다.')
  if (latestBeta && latestBeta.criteriaRevision!==Number(application.beta_criteria_revision)) blockers.push('현재 합격 기준으로 다시 시험해주세요. 옛 회차는 인계 근거로 사용할 수 없습니다.')
  if (latestBeta && latestBeta.build_run_id!==latestBuild?.id) blockers.push('최신 제작 기록에 연결된 베타 시험이 필요합니다.')
  const byCriterion=new Map(results.map(r=>[r.criterion_id,r]))
  if (latestBeta && (results.length!==criteria.length || criteria.some(c=>{
    const r=byCriterion.get(c.id)
    return !r || r.ord!==c.ord || r.body!==c.body || r.check_key!==c.check_key || r.check_kind!==c.check_kind
      || Number(r.is_required_safety)!==Number(c.is_required_safety) || r.verdict!==(c.check_kind==='human'?'사람확인':'통과')
  }))) blockers.push('최신 시험이 현재 기준 전체와 일치하지 않습니다. 다시 시험해주세요.')
  if (feedback.some(f=>f.kind==='막힌곳'&&(!f.resolved_at||!f.resolution?.trim()))) blockers.push('아직 해결 근거가 없는 현장 막힘 피드백이 있습니다.')
  if (toReports(logs).some(r=>r.open&&r.urgent)) blockers.push('처리하지 않은 중요 현장 신고가 있습니다.')
  let stopBetaSeq=null
  for(const stop of logs.filter(l=>l.link_kind===STOP_KIND)) {
    try {const seq=JSON.parse(stop.alternatives)?.betaSeq;if(Number.isSafeInteger(seq))stopBetaSeq=Math.max(stopBetaSeq??0,seq)} catch { /* Preserve legacy stop text. */ }
  }
  if (handover?.rolled_back_at && (!latestBeta || (stopBetaSeq!==null ? Number(latestBeta.seq)<=Number(stopBetaSeq) : String(latestBeta.created_at)<=String(handover.rolled_back_at)))) blockers.push('중단 후 새 베타 시험을 통과해야 다시 인계할 수 있습니다.')
  const snapshot={application,requirements,conflicts,criteria,baseline,latestBuild,latestBeta,results,feedback,handover,manual,logs,signatures,requiredDepts,joins}
  return {application,baseline,latestBeta,handover,manual,signoff,criteria,blockers:[...new Set(blockers)],humanCriteria:criteria.filter(c=>c.check_kind==='human'),
    expectedEvidence:await mutationFingerprint(snapshot),proof:{criteriaRevision:Number(application.beta_criteria_revision),criteriaSourceVersion:signatures.criteriaSourceVersion,betaId:latestBeta?.id??null,betaSeq:latestBeta?.seq??null,baseline,signatures:signatures.signatures},scope:TOOL_SCOPE}
}

export function publicHandoverEvidence(evidence) {
  const {proof: _proof,criteria: _criteria,baseline: _baseline,...publicState}=evidence
  return publicState
}
