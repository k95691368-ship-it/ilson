// 전체 현황.
//
// 첫 화면이 목차만 있으면 이 조직에 무슨 일이 일어나고 있는지 알 수 없다.
// 몇 건이 들어왔고, 어디서 막혀 있고, 얼마나 걸려서 넘어가는지가 보여야
// "기록을 담당하는 사이트"라는 말이 실감난다.
//
// 특히 두 가지를 보여 준다.
//   어느 단계에 몇 건이 머물러 있는가 — 병목은 신청서에만 있는 게 아니다.
//   접수부터 인수인계까지 실제로 며칠 걸렸는가 — 이 조직의 처리 속도.

import { jsonResponse, jsonError } from '../_lib/http.js'
import { REFUSE_LABELS } from '../../shared/review.js'

export async function onRequestGet({ env }) {
  try {
    const [apps, refuseMix, stageRows, handovers, uses, decisions, baselines] = await Promise.all([
      env.DB.prepare(
        `SELECT id, ticket_no, dept, title, status, created_at, updated_at,
                current_minutes, current_people, current_frequency,
                CAST((julianday('now') - julianday(created_at)) AS INTEGER) AS days_since
         FROM application ORDER BY created_at DESC`
      ).all(),

      env.DB.prepare(
        `SELECT refuse_code, COUNT(*) AS n FROM review
         WHERE verdict = '반려' AND refuse_code IS NOT NULL
         GROUP BY refuse_code ORDER BY n DESC`
      ).all(),

      // 신청서마다 어느 단계까지 갔는지. 산출물이 있으면 지나온 것으로 본다.
      env.DB.prepare(
        `SELECT a.id,
                (SELECT COUNT(*) FROM review r WHERE r.application_id = a.id) AS reviewed,
                (SELECT COUNT(*) FROM baseline b WHERE b.application_id = a.id) AS agreed,
                (SELECT COUNT(*) FROM build_run br WHERE br.application_id = a.id) AS built,
                (SELECT COUNT(*) FROM beta_round bt WHERE bt.application_id = a.id AND bt.overall = '통과') AS tested,
                (SELECT COUNT(*) FROM manual m WHERE m.application_id = a.id AND m.published_at IS NOT NULL) AS documented,
                (SELECT COUNT(*) FROM handover h WHERE h.application_id = a.id AND h.rolled_back_at IS NULL) AS handed,
                (SELECT COUNT(*) FROM outcome o WHERE o.application_id = a.id AND o.dept_confirmed_at IS NOT NULL) AS confirmed
         FROM application a`
      ).all(),

      env.DB.prepare(
        `SELECT h.application_id, h.handed_at, h.accepted_at, h.rolled_back_at, h.slug,
                a.created_at AS applied_at, a.title, a.dept
         FROM handover h JOIN application a ON a.id = h.application_id`
      ).all(),

      env.DB.prepare(
        'SELECT COUNT(*) AS n, SUM(rows_out) AS rows_total, MAX(used_at) AS last FROM tool_use'
      ).first(),

      env.DB.prepare(
        `SELECT id, application_id, stage, actor, title, what, why, unrequested, created_at
         FROM decision_log ORDER BY created_at DESC LIMIT 8`
      ).all(),

      env.DB.prepare(
        'SELECT application_id, median_seconds, sample_n FROM baseline'
      ).all(),
    ])

    const items = apps.results
    const stageBy = new Map(stageRows.results.map((s) => [s.id, s]))

    // 각 신청서가 지금 어느 단계인지
    const stageOf = (a) => {
      if (a.status === '반려') return '반려'
      if (a.status === '보류') return '보류'
      const s = stageBy.get(a.id) ?? {}
      if (s.confirmed) return '성과'
      if (s.handed) return '배포'
      if (s.documented) return '사용법서'
      if (s.tested) return '베타테스트'
      if (s.built) return '제작'
      if (s.agreed) return '협의안'
      if (s.reviewed) return '검토'
      return '신청서'
    }

    const byStage = {}
    const byDept = {}
    for (const a of items) {
      const st = stageOf(a)
      byStage[st] = (byStage[st] ?? 0) + 1
      if (!byDept[a.dept]) byDept[a.dept] = { total: 0, refused: 0, done: 0 }
      byDept[a.dept].total += 1
      if (a.status === '반려') byDept[a.dept].refused += 1
      if (a.status === '완료') byDept[a.dept].done += 1
    }

    // 접수부터 인수인계까지 실제로 며칠 걸렸나
    const leadDays = handovers.results
      .filter((h) => !h.rolled_back_at)
      .map((h) => {
        const from = new Date(`${h.applied_at.replace(' ', 'T')}Z`).getTime()
        const to = new Date(`${h.handed_at.replace(' ', 'T')}Z`).getTime()
        return { title: h.title, dept: h.dept, days: Math.max(0, (to - from) / 86400000) }
      })
      .sort((a, b) => a.days - b.days)

    const medianLead =
      leadDays.length === 0
        ? null
        : leadDays.length % 2 === 1
          ? leadDays[(leadDays.length - 1) / 2].days
          : (leadDays[leadDays.length / 2 - 1].days + leadDays[leadDays.length / 2].days) / 2

    // 하루가 지나도록 아무도 열람하지 않은 신청서
    const waiting = items.filter((a) => a.status === '접수')
    const stale = waiting.filter((a) => a.days_since >= 1)

    const refused = items.filter((a) => a.status === '반려').length
    const reviewed = items.filter((a) => a.status !== '접수').length

    return jsonResponse({
      counts: {
        total: items.length,
        waiting: waiting.length,
        stale: stale.length,
        accepted: items.filter((a) => a.status === '수용' || a.status === '진행중').length,
        refused,
        held: items.filter((a) => a.status === '보류').length,
        done: items.filter((a) => a.status === '완료').length,
      },
      // 반려율을 숨기지 않는다. 다 받아 주는 조직은 없고, 반려가 0이면
      // 오히려 아무 판단도 하지 않았다는 뜻이다.
      refuseRate: reviewed > 0 ? Math.round((refused / reviewed) * 100) : null,
      refuseMix: refuseMix.results.map((r) => ({
        code: r.refuse_code,
        label: REFUSE_LABELS[r.refuse_code] ?? r.refuse_code,
        n: r.n,
      })),
      byStage,
      byDept: Object.entries(byDept)
        .map(([dept, v]) => ({ dept, ...v }))
        .sort((a, b) => b.total - a.total),
      lead: {
        medianDays: medianLead == null ? null : Math.round(medianLead * 10) / 10,
        fastest: leadDays[0] ?? null,
        slowest: leadDays[leadDays.length - 1] ?? null,
        count: leadDays.length,
      },
      tools: {
        handedOver: handovers.results.filter((h) => !h.rolled_back_at).length,
        accepted: handovers.results.filter((h) => h.accepted_at).length,
        rolledBack: handovers.results.filter((h) => h.rolled_back_at).length,
        totalRuns: uses?.n ?? 0,
        rowsProcessed: uses?.rows_total ?? 0,
        lastUsed: uses?.last ?? null,
        list: handovers.results
          .filter((h) => !h.rolled_back_at)
          .map((h) => ({ slug: h.slug, title: h.title, dept: h.dept })),
      },
      baselines: baselines.results.length,
      recentDecisions: decisions.results,
      unrequestedCount: decisions.results.filter((d) => d.unrequested === 1).length,
      recent: items.slice(0, 6).map((a) => ({ ...a, stage: stageOf(a) })),
    })
  } catch (err) {
    return jsonError(`현황을 불러오지 못했습니다. (${String(err.message).slice(0, 160)})`, 503)
  }
}
