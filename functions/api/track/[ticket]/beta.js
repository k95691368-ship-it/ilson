// 시험판을 써 본 부서가 막힌 곳을 직접 말한다.
//
// 조회 화면은 "시험판을 써 보고 막힌 곳을 알려주세요"라고 적어 두고, 정작
// 그 말을 적을 칸을 아무 데도 안 뒀다. /beta는 담당자 화면이고, 도구
// 주소(/t/:slug)는 배포가 끝나야 생긴다 — 시험판은 배포 **앞** 단계다.
// 시키기만 하고 갈 곳이 없는 문장이 첫 화면에 떠 있었다.
//
// 로그인이 없다. 접수번호를 아는 사람이 그 신청서의 부서라고 본다 —
// 수령 확인·성과 확인과 같은 규칙이다.

import { jsonResponse, jsonError, failFields, failUnexpected } from '../../../_lib/http.ts'
import { newId } from '../../../_lib/ids.js'
import { checkRateLimit, releaseRateLimit } from '../../../_lib/rateLimit.js'
import { validateBetaSay, betaSayState, BETA_SAY_KIND } from '../../../../shared/betasay.js'
import { logDecision } from '../../../_lib/decisions.js'
import { currentDepartmentAuthority } from '../../../_lib/departmentAuthority.js'
import { departmentMutation } from '../../../_lib/departmentMutation.js'

async function load(env, ticket) {
  const app = await env.DB.prepare(
    'SELECT id, ticket_no, dept, title FROM application WHERE ticket_no = ?'
  )
    .bind(ticket)
    .first()
  if (!app) return null

  const [round, says] = await Promise.all([
    env.DB.prepare(
      'SELECT id, seq, overall, created_at FROM beta_round WHERE application_id = ? ORDER BY seq DESC LIMIT 1'
    )
      .bind(app.id)
      .first(),
    env.DB.prepare(
      `SELECT id, dept, person_label, body, kind, resolved_at, resolution, created_at
       FROM beta_feedback WHERE application_id = ? ORDER BY created_at DESC`
    )
      .bind(app.id)
      .all(),
  ])

  return { app, round, says: says.results }
}

export async function onRequestGet({ env, data: requestData, params }) {
  env = requestData?.requestEnv ?? env
  const loaded = await load(env, String(params.ticket ?? '').trim().toUpperCase())
  if (!loaded) return jsonError('그 접수번호를 찾지 못했습니다.', 404)
  return jsonResponse({ state: betaSayState(loaded) })
}

export async function onRequestPost({ env, data: requestData, request, params }) {
  env = requestData?.requestEnv ?? env
  const bucket = `betasay:${request.headers.get('CF-Connecting-IP') || 'unknown'}`
  const rateTicket = await checkRateLimit(env,bucket,20,3600)
  if (!rateTicket) return jsonError('의견은 시간당 20건까지 남기실 수 있습니다.',429)
  let body
  try { body = await request.json() } catch {
    await releaseRateLimit(env,bucket,rateTicket)
    return jsonError('보내주신 내용을 읽지 못했습니다.',400)
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    await releaseRateLimit(env,bucket,rateTicket)
    return jsonError('요청 형식이 올바르지 않습니다.',400)
  }
  const ticket = String(params.ticket ?? '').trim().toUpperCase()
  const response = await departmentMutation(env,request,`betasay:${ticket}`,body,async DB => {
    const loaded = await load({...env,DB},ticket)
    if (!loaded) return jsonError('그 접수번호를 찾지 못했습니다.',404)
    const forbidden = await currentDepartmentAuthority(env,DB,loaded.app.dept)
    if (forbidden) return forbidden
    if (!loaded.round) return jsonError('아직 시험판이 나오지 않았습니다. 나오면 이 화면에 뜹니다.',409)
    const errors = validateBetaSay(body)
    if (Object.keys(errors).length) return failFields(errors,'적어 주신 내용을 확인해주세요.')
    const by = String(body.by).trim().slice(0,60), said = String(body.body).trim().slice(0,1000)
    await DB.prepare(`INSERT INTO beta_feedback (id,application_id,round_id,dept,person_label,body,kind)
      VALUES(?,?,?,?,?,?,?)`).bind(newId('bfb'),loaded.app.id,loaded.round.id,loaded.app.dept,by,said,body.kind).run()
    await logDecision({DB},{applicationId:loaded.app.id,stage:'베타테스트',actor:'human',title:by,what:said,
      why:`${loaded.app.dept}에서 시험판을 써 보고 적어 주셨습니다. 기계 채점은 "쓰기 불편하다"를 채점하지 못합니다.`,
      linkKind:BETA_SAY_KIND,linkId:loaded.round.id})
    return jsonResponse({ok:true,blocked:body.kind === '막힌곳'})
  })
  if (!response.ok || response.headers.get('X-Idempotency-Replayed') === '1') await releaseRateLimit(env,bucket,rateTicket)
  if (!response.ok) return response
  try {
    const receipt = await response.json(), state = betaSayState(await load(env,ticket))
    return jsonResponse({ok:true,state,message:receipt.blocked
      ? '알려주셔서 고맙습니다. 막힌 곳은 고치고 나서 여기에 답을 적어 두겠습니다.'
      : '알려주셔서 고맙습니다. 여기에 답을 적어 두겠습니다.'},200,
      {'X-Idempotency-Replayed':response.headers.get('X-Idempotency-Replayed') || '0'})
  } catch(error) { return failUnexpected(error,'시험판 의견 상태를 불러오지 못했습니다.') }
}
