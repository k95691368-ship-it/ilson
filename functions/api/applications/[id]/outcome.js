// 8단계 — 성과 정리.
//
// 3단계에서 재 둔 기준선과 대조한 기록이다. 계산은 shared/outcome.js가 하고,
// 여기서는 그 계산에 필요한 것을 모아 넘기고 결과를 돌려준다.
//
// 계산을 서버에서 하는 이유: 이 숫자는 사람이 고칠 수 있으면 안 된다. 화면에서
// 계산하면 브라우저를 열어 값을 바꿀 수 있고, 그러면 근거가 아니라 주장이 된다.

import { jsonResponse, jsonError } from '../../../_lib/http.js'
import { newId } from '../../../_lib/ids.js'
import { logDecision } from '../../../_lib/decisions.js'
import {
  computeOutcome,
  buildChallenges,
  labelForOutcome,
  annualize,
} from '../../../../shared/outcome.js'
import { OUTCOME_KIND, OUTCOME_PROXY_KIND } from '../../../../shared/accept.js'

async function findApplication(env, id) {
  return env.DB.prepare(
    'SELECT id, ticket_no, dept, title, status, current_minutes, current_people, current_frequency FROM application WHERE id = ? OR ticket_no = ?'
  )
    .bind(id, id)
    .first()
}

async function load(env, app) {
  const [baseline, uses, saved, challenges, quarantineLeft] = await Promise.all([
    env.DB.prepare('SELECT * FROM baseline WHERE application_id = ?').bind(app.id).first(),
    env.DB.prepare(
      'SELECT id, used_at, duration_ms, human_review_seconds, rework_seconds, rows_out, quarantined, ok FROM tool_use WHERE application_id = ? ORDER BY used_at'
    )
      .bind(app.id)
      .all(),
    env.DB.prepare('SELECT * FROM outcome WHERE application_id = ?').bind(app.id).first(),
    env.DB.prepare('SELECT * FROM outcome_challenge WHERE application_id = ? ORDER BY created_at')
      .bind(app.id)
      .all(),
    env.DB.prepare(
      `SELECT SUM(quarantined) AS n FROM (
         SELECT quarantined FROM tool_use WHERE application_id = ? ORDER BY used_at DESC LIMIT 1
       )`
    )
      .bind(app.id)
      .first(),
  ])
  return {
    baseline,
    uses: uses.results,
    saved,
    challenges: challenges.results,
    quarantineLeft: quarantineLeft?.n ?? 0,
  }
}

function daysSince(sqlTime) {
  if (!sqlTime) return 0
  const t = new Date(`${String(sqlTime).replace(' ', 'T')}Z`).getTime()
  return Math.max(0, Math.floor((Date.now() - t) / 86400000))
}

export async function onRequestGet({ env, params }) {
  const app = await findApplication(env, params.id)
  if (!app) return jsonError('그런 신청서가 없습니다.', 404)

  try {
    const { baseline, uses, saved, challenges, quarantineLeft } = await load(env, app)

    // 부서가 직접 말한 체감 분.
    const deptSaid = await env.DB.prepare(
      `SELECT alternatives FROM decision_log
       WHERE application_id = ? AND link_kind = ?
       ORDER BY created_at DESC LIMIT 1`
    )
      .bind(app.id, OUTCOME_KIND)
      .first()
    let deptFelt = null
    try {
      deptFelt = JSON.parse(deptSaid?.alternatives)?.felt ?? null
    } catch {
      // 옛 기록에는 숫자가 없다.
    }

    const outcome = computeOutcome({
      baseline,
      runs: uses,
      devHours: saved?.dev_hours ?? 0,
      opsCostKrw: saved?.ops_cost_krw ?? 0,
      amortizeMonths: saved?.amortize_months ?? 24,
    })

    const context = {
      outcome,
      quarantineLeft,
      deptConfirmed: Boolean(saved?.dept_confirmed_at),
      baselineAgeDays: daysSince(baseline?.sealed_at),
      // 부서가 체감으로 말한 분. 우리가 잰 값과 크게 다르면 반박이 붙는다 —
      // 물어봐 놓고 답이 계산에 아무 영향이 없으면 묻는 것 자체가 연기다.
      deptFelt,
    }
    const shouldHave = outcome.status === '산정불가' ? [] : buildChallenges(context)

    // 저장된 반박과 지금 규칙이 만들어 낸 반박을 합친다.
    // 이미 해소한 것은 해소 상태를 지킨다.
    const byCode = new Map(challenges.map((c) => [c.rule_code, c]))
    const merged = shouldHave.map((c) => ({
      ...c,
      id: byCode.get(c.code)?.id ?? null,
      resolved_at: byCode.get(c.code)?.resolved_at ?? null,
      resolution: byCode.get(c.code)?.resolution ?? null,
    }))
    const unresolved = merged.filter((c) => !c.resolved_at).length

    return jsonResponse({
      application: app,
      baseline: baseline ?? null,
      // 신청서에 적힌 체감값과 실제로 잰 값을 나란히 보여 준다.
      // 얼마나 다른지가 그 자체로 볼거리다.
      claimed: app.current_minutes
        ? {
            minutes: app.current_minutes,
            people: app.current_people,
            frequency: app.current_frequency,
          }
        : null,
      uses,
      outcome,
      // 만든 공수와 운영비를 같이 넘긴다. 안 넘기면 연 환산값만 아무것도
      // 안 뺀 큰 숫자가 되어, 바로 위의 순절감과 기준이 달라진다.
      annual: annualize(outcome, baseline?.frequency ?? app.current_frequency, {
        devKrw: outcome.devKrw ?? 0,
        opsCostKrw: saved?.ops_cost_krw ?? 0,
      }),
      challenges: merged,
      unresolvedCount: unresolved,
      label: labelForOutcome(outcome, unresolved),
      saved: saved ?? null,
    })
  } catch (err) {
    return jsonError(`성과를 불러오지 못했습니다. (${String(err.message).slice(0, 160)})`, 503)
  }
}

export async function onRequestPost({ env, params, request }) {
  const app = await findApplication(env, params.id)
  if (!app) return jsonError('그런 신청서가 없습니다.', 404)

  let body
  try {
    body = await request.json()
  } catch {
    return jsonError('요청 형식이 올바르지 않습니다.', 400)
  }

  const t = (v) => String(v ?? '').trim()

  try {
    if (body.kind === 'inputs') {
      await env.DB.prepare(
        `INSERT INTO outcome (application_id, dev_hours, ops_cost_krw, amortize_months, next_bottleneck, computed_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(application_id) DO UPDATE SET
           dev_hours = excluded.dev_hours,
           ops_cost_krw = excluded.ops_cost_krw,
           amortize_months = excluded.amortize_months,
           next_bottleneck = excluded.next_bottleneck,
           computed_at = datetime('now')`
      )
        .bind(
          app.id,
          Number(body.dev_hours) || 0,
          Number(body.ops_cost_krw) || 0,
          Number(body.amortize_months) || 24,
          t(body.next_bottleneck) || null
        )
        .run()
      return jsonResponse({ ok: true })
    }

    // 부서가 이 숫자를 보고 맞다고 확인.
    // 담당자가 **대신** 확인.
    //
    // 이 버튼을 없애지 않는다. 전화로 듣고 대신 눌러야 할 때가 있다.
    // 다만 대신 눌렀다고 적는다 — 부서가 직접 누르는 자리는
    // functions/api/track/[ticket]/outcome.js 다.
    if (body.kind === 'dept_confirm') {
      // 확인할 숫자가 있어야 확인이다.
      //
      // 부서가 직접 누르는 쪽(track/[ticket]/outcome.js)은 이미 실행 기록과
      // 기준선이 둘 다 있어야 버튼을 내준다. 이쪽에는 그 조건이 없었다.
      // 성과 화면도 산정불가면 확인 자리를 안 그리지만, 서버가 안 막으니
      // **한 번도 안 돌린 도구가 "부서가 성과를 확인함"으로 기록되고 신청서가
      // 성과 단계로 넘어갔다.** 라이브에서 그렇게 됐다. 이 사이트가 하지
      // 않겠다고 적어 둔 것이 바로 이것이다.
      const [runs, baseline] = await Promise.all([
        // 부서 쪽 화면이 세는 것과 같은 문장이다. 다르게 세면 한쪽에서는
        // 누를 수 있고 다른 쪽에서는 못 누르는 일이 생긴다.
        env.DB.prepare('SELECT COUNT(*) AS n FROM tool_use WHERE application_id = ?')
          .bind(app.id)
          .first(),
        // baseline 은 application_id 가 기본키다. id 컬럼은 없다.
        env.DB.prepare('SELECT application_id FROM baseline WHERE application_id = ?')
          .bind(app.id)
          .first(),
      ])
      const blockers = []
      if (!baseline) blockers.push('기준선이 봉인돼 있지 않습니다. 견줄 값이 없습니다.')
      if ((runs?.n ?? 0) === 0) {
        blockers.push('도구가 아직 한 번도 안 돌았습니다. 쓰이기 전에는 줄어든 것이 없습니다.')
      }
      if (blockers.length > 0) {
        return jsonResponse({ error: '아직 확인할 숫자가 없습니다.', blockers }, 400)
      }

      await env.DB.prepare(
        `INSERT INTO outcome (application_id, dept_confirmed_at, dept_confirmed_by, dept_comment)
         VALUES (?, datetime('now'), ?, ?)
         ON CONFLICT(application_id) DO UPDATE SET
           dept_confirmed_at = datetime('now'),
           dept_confirmed_by = excluded.dept_confirmed_by,
           dept_comment = excluded.dept_comment`
      )
        .bind(app.id, t(body.by) || '부서 담당자', t(body.comment) || null)
        .run()

      await logDecision(env, {
        applicationId: app.id,
        stage: '성과',
        title: '담당자가 대신 성과를 확인했다',
        what: `${t(body.by) || '부서 담당자'}가 이 숫자를 보고 맞다고 했다. ${t(body.comment) || ''}`.trim(),
        why: '만든 사람만 아는 성과는 성과가 아니다. 실제로 쓰는 사람이 확인해야 근거가 된다.',
        linkKind: OUTCOME_PROXY_KIND,
        linkId: app.id,
      }).catch(() => {})

      return jsonResponse({ ok: true })
    }

    // 반박 하나를 해소.
    if (body.kind === 'resolve_challenge') {
      const code = t(body.rule_code)
      if (!code) return jsonError('어느 의심인지 알 수 없습니다.', 400)
      if (!t(body.resolution)) {
        return jsonResponse(
          { error: '적어 주신 내용을 확인해주세요.', fields: { resolution: '어떻게 확인했는지 적어주세요.' } },
          400
        )
      }
      await env.DB.prepare(
        `INSERT INTO outcome_challenge (id, application_id, rule_code, title, body, resolved_at, resolution)
         VALUES (?, ?, ?, ?, ?, datetime('now'), ?)
         ON CONFLICT(application_id, rule_code) DO UPDATE SET
           resolved_at = datetime('now'),
           resolution = excluded.resolution`
      )
        .bind(
          newId('chl'),
          app.id,
          code,
          t(body.title) || code,
          t(body.body) || '',
          t(body.resolution)
        )
        .run()
      return jsonResponse({ ok: true })
    }

    return jsonError('무엇을 저장할지 알 수 없습니다.', 400)
  } catch (err) {
    return jsonError(`저장하지 못했습니다. (${String(err.message).slice(0, 200)})`, 500)
  }
}
