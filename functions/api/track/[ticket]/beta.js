// 시험판을 써 본 부서가 막힌 곳을 직접 말한다.
//
// 조회 화면은 "시험판을 써 보고 막힌 곳을 알려주세요"라고 적어 두고, 정작
// 그 말을 적을 칸을 아무 데도 안 뒀다. /beta는 담당자 화면이고, 도구
// 주소(/t/:slug)는 배포가 끝나야 생긴다 — 시험판은 배포 **앞** 단계다.
// 시키기만 하고 갈 곳이 없는 문장이 첫 화면에 떠 있었다.
//
// 로그인이 없다. 접수번호를 아는 사람이 그 신청서의 부서라고 본다 —
// 수령 확인·성과 확인과 같은 규칙이다.

import { jsonResponse, jsonError, failFields, failUnexpected } from '../../../_lib/http.js'
import { newId } from '../../../_lib/ids.js'
import { checkRateLimit, releaseRateLimit } from '../../../_lib/rateLimit.js'
import { validateBetaSay, betaSayState, BETA_SAY_KIND } from '../../../../shared/betasay.js'
import { logDecision } from '../../../_lib/decisions.js'

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

export async function onRequestGet({ env, params }) {
  const loaded = await load(env, String(params.ticket ?? '').trim().toUpperCase())
  if (!loaded) return jsonError('그 접수번호를 찾지 못했습니다.', 404)
  return jsonResponse({ state: betaSayState(loaded) })
}

export async function onRequestPost({ env, request, params }) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown'
  const ticket = await checkRateLimit(env, `betasay:${ip}`, 20, 3600)
  if (!ticket) return jsonError('의견은 시간당 20건까지 남기실 수 있습니다.', 429)

  const loaded = await load(env, String(params.ticket ?? '').trim().toUpperCase())
  if (!loaded) {
    await releaseRateLimit(env, `betasay:${ip}`, ticket)
    return jsonError('그 접수번호를 찾지 못했습니다.', 404)
  }

  // 시험판을 아직 안 돌렸으면 써 볼 것이 없다. 없는 것에 대고 의견을
  // 받으면 담당자는 무엇을 두고 하신 말인지 모른다.
  if (!loaded.round) {
    await releaseRateLimit(env, `betasay:${ip}`, ticket)
    return jsonError('아직 시험판이 나오지 않았습니다. 나오면 이 화면에 뜹니다.', 409)
  }

  let body
  try {
    body = await request.json()
  } catch {
    await releaseRateLimit(env, `betasay:${ip}`, ticket)
    return jsonError('보내주신 내용을 읽지 못했습니다.', 400)
  }

  const errors = validateBetaSay(body)
  if (Object.keys(errors).length > 0) {
    await releaseRateLimit(env, `betasay:${ip}`, ticket)
    return failFields(errors, '적어 주신 내용을 확인해주세요.')
  }

  const by = String(body.by).trim().slice(0, 60)
  const said = String(body.body).trim().slice(0, 1000)

  try {
    await env.DB.prepare(
      `INSERT INTO beta_feedback (id, application_id, round_id, dept, person_label, body, kind)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(newId('bfb'), loaded.app.id, loaded.round.id, loaded.app.dept, by, said, body.kind)
      .run()

    // 결정 기록에도 남긴다.
    //
    // 여기만 안 남기고 있었다. 부서가 하는 일 열대여섯 가지 중 이것만
    // beta_feedback 표에서 끝났다. 그래서 결정 기록 화면이 "부서가 직접
    // 누른 것 N건"을 셀 때 시험판 의견은 한 건도 안 세어졌다.
    //
    // 시험판을 써 보고 걸리는 것을 적는 일은 부서가 하는 일 중 손이 제일
    // 많이 가는 축이다. 그게 안 잡히면 이 화면이 하려는 말 — 이 기록은
    // 혼자 만든 것이 아니다 — 이 실제보다 약하게 보인다.
    await logDecision(env, {
      applicationId: loaded.app.id,
      stage: '베타테스트',
      actor: 'human',
      title: by,
      what: said,
      why: `${loaded.app.dept}에서 시험판을 써 보고 적어 주셨습니다. 기계 채점은 "쓰기 불편하다"를 채점하지 못합니다.`,
      linkKind: BETA_SAY_KIND,
      linkId: loaded.round.id,
    }).catch(() => {})

    const after = await load(env, loaded.app.ticket_no)
    return jsonResponse({
      ok: true,
      state: betaSayState(after),
      message:
        body.kind === '막힌곳'
          ? '알려주셔서 고맙습니다. 막힌 곳은 고치고 나서 여기에 답을 적어 두겠습니다.'
          : '알려주셔서 고맙습니다. 여기에 답을 적어 두겠습니다.',
    })
  } catch (err) {
    await releaseRateLimit(env, `betasay:${ip}`, ticket)
    return failUnexpected(err, '남기지 못했습니다.')
  }
}
