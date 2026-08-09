// 부서가 성과 숫자를 직접 확인한다.
//
// 성과 화면은 "만든 사람만 아는 성과는 성과가 아닙니다"라고 적어 두고,
// 정작 그 확인 버튼을 담당자 화면에만 뒀다. 담당자가 창을 띄워 부서 사람
// 이름을 대신 타이핑했다. 수령 확인과 똑같은 자리에서 똑같이 어긋나 있었다.
//
// **"맞습니다" 한 버튼으로 받지 않는다.** 그러면 아무도 안 읽고 누른다.
// 실제로 한 번에 몇 분쯤 걸린다고 느끼는지를 숫자로 받아, 우리가 잰 값과
// 다르면 그 차이가 성과 화면에 그대로 남게 한다.

import { jsonResponse, jsonError, failFields, failUnexpected } from '../../../_lib/http.js'
import { newId } from '../../../_lib/ids.js'
import { checkRateLimit, releaseRateLimit } from '../../../_lib/rateLimit.js'
import { validateOutcomeConfirm, OUTCOME_KIND, OUTCOME_PROXY_KIND } from '../../../../shared/accept.js'

async function load(env, ticket) {
  const app = await env.DB.prepare(
    'SELECT id, ticket_no, dept, title FROM application WHERE ticket_no = ?'
  )
    .bind(ticket)
    .first()
  if (!app) return null

  const [baseline, saved, uses, records, answered] = await Promise.all([
    env.DB.prepare('SELECT median_seconds, people, sample_n FROM baseline WHERE application_id = ?')
      .bind(app.id)
      .first(),
    env.DB.prepare(
      'SELECT dept_confirmed_at, dept_confirmed_by, dept_comment FROM outcome WHERE application_id = ?'
    )
      .bind(app.id)
      .first(),
    env.DB.prepare('SELECT COUNT(*) AS n FROM tool_use WHERE application_id = ?')
      .bind(app.id)
      .first(),
    env.DB.prepare(
      `SELECT id, title, what, alternatives, link_kind, created_at FROM decision_log
       WHERE application_id = ? AND link_kind IN (?, ?)
       ORDER BY created_at`
    )
      .bind(app.id, OUTCOME_KIND, OUTCOME_PROXY_KIND)
      .all(),

    // 부서가 "체감은 다릅니다"라고 한 것에 담당자가 답했는가.
    //
    // 부서가 다른 숫자를 말하면 그건 성과 화면에 반박으로 올라가고,
    // 담당자가 그걸 풀면서 무엇을 확인했는지 적는다. 그 글이 부서에게
    // 가는 길이 없었다.
    //
    // 부서 입장에서는 이렇게 된다. "우리는 55분쯤 걸립니다"라고 애써
    // 알려 줬는데 아무 답이 없다. 그러면 다음부터는 그냥 넘긴다 — 남의
    // 숫자에 토를 다는 일은 원래 부담스러운 일이라, 한 번 무시당하면
    // 두 번 하지 않는다.
    env.DB.prepare(
      `SELECT resolution, resolved_at FROM outcome_challenge
       WHERE application_id = ? AND rule_code = 'dept_disagrees' AND resolved_at IS NOT NULL`
    )
      .bind(app.id)
      .first(),
  ])

  const rows = records.results.map((r) => {
    let felt = null
    try {
      felt = JSON.parse(r.alternatives)?.felt ?? null
    } catch {
      // 옛 기록에는 숫자가 없다.
    }
    return { id: r.id, kind: r.link_kind, by: r.title, what: r.what, felt, at: r.created_at }
  })

  return { app, baseline, saved, runs: uses?.n ?? 0, records: rows, answered }
}

function stateOf({ baseline, saved, runs, records, answered }) {
  // **마지막 것**을 본다. 처음 것이 아니다.
  //
  // 기록은 시간순으로 오고 find 는 첫 번째를 집는다. 그래서 부서가 체감을
  // 40분이라고 했다가 다시 재 보고 55분으로 고쳐 보내면, 서버는 200을
  // 돌려주고 "고맙습니다"까지 적어 놓고 값은 40 그대로 뒀다. 부서가 애써
  // 고쳐 준 숫자가 조용히 버려진다 — 이 사이트가 없애려는 것 그 자체다.
  //
  // 그리고 이건 돈이 걸린다. 성과 화면의 반박 규칙이 이 값으로 금액을
  // '보수적 추정'으로 내릴지 정한다.
  const latest = (kind) => records.filter((r) => r.kind === kind).at(-1) ?? null
  const direct = latest(OUTCOME_KIND)
  const proxy = latest(OUTCOME_PROXY_KIND)

  return {
    // 아직 한 번도 안 돌았으면 물어볼 것이 없다. 쓰지도 않은 것에
    // "얼마나 줄었습니까"를 물으면 그 화면은 그때부터 안 읽힌다.
    canConfirm: runs > 0 && Boolean(baseline),
    status: direct ? '부서가 확인함' : proxy || saved?.dept_confirmed_at ? '담당자가 대신 확인함' : '아직',
    proxy: !direct && Boolean(proxy || saved?.dept_confirmed_at),
    by: direct?.by ?? proxy?.by ?? saved?.dept_confirmed_by ?? null,
    at: direct?.at ?? proxy?.at ?? saved?.dept_confirmed_at ?? null,
    // 우리가 잰 값. 부서에게 이걸 보여 주고 맞는지 묻는다.
    measuredMinutes: baseline ? Math.round(baseline.median_seconds / 60) : null,
    people: baseline?.people ?? 1,
    sampleN: baseline?.sample_n ?? 0,
    runs,
    deptFelt: direct?.felt ?? null,
    comment: direct?.what ?? saved?.dept_comment ?? null,
    // 알려 주신 것에 담당자가 답했는가. 답이 없으면 그 사실도 말한다 —
    // 조용히 비워 두면 안 읽힌 것으로 보인다.
    answer: answered?.resolution ?? null,
    answeredAt: answered?.resolved_at ?? null,
  }
}

export async function onRequestGet({ env, params }) {
  const loaded = await load(env, String(params.ticket ?? '').trim().toUpperCase())
  if (!loaded) return jsonError('그 접수번호를 찾지 못했습니다.', 404)
  return jsonResponse({ state: stateOf(loaded) })
}

export async function onRequestPost({ env, request, params }) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown'
  const ticket = await checkRateLimit(env, `outconf:${ip}`, 10, 3600)
  if (!ticket) return jsonError('확인은 시간당 10회까지 가능합니다.', 429)

  const loaded = await load(env, String(params.ticket ?? '').trim().toUpperCase())
  if (!loaded) {
    await releaseRateLimit(env, `outconf:${ip}`, ticket)
    return jsonError('그 접수번호를 찾지 못했습니다.', 404)
  }

  let body
  try {
    body = await request.json()
  } catch {
    await releaseRateLimit(env, `outconf:${ip}`, ticket)
    return jsonError('보내주신 내용을 읽지 못했습니다.', 400)
  }

  const errors = validateOutcomeConfirm(body)
  if (Object.keys(errors).length > 0) {
    await releaseRateLimit(env, `outconf:${ip}`, ticket)
    return failFields(errors, '적어 주신 내용을 확인해주세요.')
  }

  const by = String(body.by).trim().slice(0, 60)
  const agree = body.agree === true
  const felt = agree ? null : Number(body.felt)
  const measured = loaded.baseline ? Math.round(loaded.baseline.median_seconds / 60) : null

  const what = agree
    ? `적어 주신 숫자가 체감과 맞다고 하셨습니다.${
        String(body.comment ?? '').trim() ? ` ${String(body.comment).trim()}` : ''
      }`
    : `체감과 다르다고 하셨습니다. 실제로는 한 번에 ${felt}분쯤 걸린다고 하십니다${
        measured != null ? ` (저희가 잰 값은 ${measured}분입니다)` : ''
      }.${String(body.comment ?? '').trim() ? ` ${String(body.comment).trim()}` : ''}`

  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO outcome (application_id, dept_confirmed_at, dept_confirmed_by, dept_comment)
         VALUES (?, datetime('now'), ?, ?)
         ON CONFLICT(application_id) DO UPDATE SET
           dept_confirmed_at = datetime('now'),
           dept_confirmed_by = excluded.dept_confirmed_by,
           dept_comment = excluded.dept_comment`
      ).bind(loaded.app.id, by, what.slice(0, 1000)),
      env.DB.prepare(
        `INSERT INTO decision_log
           (id, application_id, stage, actor, title, what, why, alternatives, link_kind, link_id)
         VALUES (?, ?, '성과', 'human', ?, ?, ?, ?, ?, ?)`
      ).bind(
        newId('dec'),
        loaded.app.id,
        by,
        what.slice(0, 1000),
        '만든 사람만 아는 성과는 성과가 아니다. 부서가 아니라고 하면 아닌 것이고, 그 차이가 숫자에 남아야 한다.',
        // 체감 분은 화면에 안 그려지는 칸에 넣는다. why 칸에 JSON을 넣어
        // 첫 화면에 그대로 찍힌 적이 있다.
        JSON.stringify({ felt, measured, agree }),
        OUTCOME_KIND,
        loaded.app.id
      ),
    ])

    const after = await load(env, loaded.app.ticket_no)
    return jsonResponse({
      ok: true,
      state: stateOf(after),
      message: agree
        ? '확인해주셔서 고맙습니다. 이 숫자를 보고에 씁니다.'
        : `알려주셔서 고맙습니다. 체감이 ${felt}분이라는 것을 성과 화면에 같이 적어 둡니다 — 저희가 잰 값만 쓰지 않습니다.`,
    })
  } catch (err) {
    await releaseRateLimit(env, `outconf:${ip}`, ticket)
    return failUnexpected(err, '확인을 남기지 못했습니다.')
  }
}
