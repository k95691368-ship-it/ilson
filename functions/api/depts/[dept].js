// 부서 한 곳과 나 사이에 있었던 일 전부.
//
// 지금까지 화면은 전부 "신청서 단위"였다. 그런데 실제로 일하다 보면 단위가
// 부서다. 재무 팀장을 만나기 전에 알아야 할 것은 "AX-EFD-E58이 어디까지
// 왔나"가 아니라 "재무와 그동안 뭘 했고, 지금 내가 재무에 못 준 게 뭔가"다.
//
// 그래서 이 화면의 중심은 **내가 이 부서에 빚진 것**이다. 보통 대시보드는
// 남이 나한테 안 해 준 것을 센다. 그건 만들기 쉽고 보기 편하지만, 부서와
// 마주 앉을 때 아무 쓸모가 없다.

import { jsonResponse, jsonError, failUnexpected } from '../../_lib/http.js'
import { annualHours } from '../../_lib/applications.js'

const STALE_HOURS = 24

export async function onRequestGet({ env, params }) {
  const dept = decodeURIComponent(params.dept ?? '').trim()
  if (!dept) return jsonError('부서를 알려주세요.', 400)

  try {
    const [apps, stakeholders, meetings, reqs, conflicts, tools, feedback, decisions] =
      await Promise.all([
        env.DB.prepare(
          `SELECT a.id, a.ticket_no, a.title, a.bottleneck, a.status, a.created_at,
                  a.applicant_label, a.current_minutes, a.current_people, a.current_frequency,
                  CAST((julianday('now') - julianday(a.created_at)) * 24 AS INTEGER) AS hours_since,
                  r.verdict, r.decided_at, r.verdict_reason, r.refuse_alternative,
                  r.hold_until_condition, r.impact_score, r.difficulty_score,
                  b.median_seconds, b.sample_n
           FROM application a
           LEFT JOIN review r ON r.application_id = a.id
           LEFT JOIN baseline b ON b.application_id = a.id
           WHERE a.dept = ?
           ORDER BY a.created_at DESC`
        )
          .bind(dept)
          .all(),

        env.DB.prepare(
          `SELECT s.*, a.ticket_no, a.title AS application_title
           FROM stakeholder s JOIN application a ON a.id = s.application_id
           WHERE s.dept = ? ORDER BY s.is_owner DESC, s.created_at`
        )
          .bind(dept)
          .all(),

        // 회의 참석 부서는 JSON 배열로 저장돼 있다. 부서 이름을 따옴표째
        // 찾아야 '재무'가 '재무회계'에 걸리지 않는다.
        env.DB.prepare(
          `SELECT m.id, m.seq, m.title, m.held_at, m.status, m.depts_json,
                  a.ticket_no, a.title AS application_title
           FROM meeting m JOIN application a ON a.id = m.application_id
           WHERE m.depts_json LIKE ? ORDER BY m.held_at`
        )
          .bind(`%"${dept}"%`)
          .all(),

        env.DB.prepare(
          `SELECT q.*, a.ticket_no FROM requirement q
           JOIN application a ON a.id = q.application_id
           WHERE q.dept = ? ORDER BY q.created_at`
        )
          .bind(dept)
          .all(),

        // 이 부서가 낸 요구가 낀 충돌. 어느 쪽이 이겼는지가 이 부서에게는
        // 가장 민감한 기록이다.
        env.DB.prepare(
          `SELECT c.*, a.ticket_no,
                  ra.dept AS a_dept, ra.body AS a_body,
                  rb.dept AS b_dept, rb.body AS b_body
           FROM requirement_conflict c
           JOIN application a ON a.id = c.application_id
           JOIN requirement ra ON ra.id = c.req_a_id
           JOIN requirement rb ON rb.id = c.req_b_id
           WHERE ra.dept = ? OR rb.dept = ?
           ORDER BY c.created_at`
        )
          .bind(dept, dept)
          .all(),

        env.DB.prepare(
          `SELECT h.*, a.ticket_no, a.title AS application_title,
                  (SELECT COUNT(*) FROM tool_use u WHERE u.application_id = h.application_id) AS uses,
                  (SELECT MAX(used_at) FROM tool_use u WHERE u.application_id = h.application_id) AS last_use
           FROM handover h JOIN application a ON a.id = h.application_id
           WHERE h.handed_to_dept = ? ORDER BY h.handed_at DESC`
        )
          .bind(dept)
          .all(),

        env.DB.prepare(
          `SELECT f.*, a.ticket_no FROM beta_feedback f
           JOIN application a ON a.id = f.application_id
           WHERE f.dept = ? ORDER BY f.created_at DESC`
        )
          .bind(dept)
          .all(),

        env.DB.prepare(
          `SELECT d.stage, d.title, d.what, d.why, d.alternatives, d.unrequested, d.created_at,
                  a.ticket_no
           FROM decision_log d JOIN application a ON a.id = d.application_id
           WHERE a.dept = ? AND d.actor = 'human'
           ORDER BY d.created_at DESC LIMIT 40`
        )
          .bind(dept)
          .all(),
      ])

    const items = apps.results.map((r) => ({ ...r, annual_hours: annualHours(r) }))

    // 내가 이 부서에 빚진 것.
    //
    // 이 화면의 중심이다. 부서와 마주 앉기 전에 알아야 할 것은 저쪽이
    // 나한테 안 해 준 것이 아니라 내가 저쪽에 못 준 것이다.
    const owed = []

    for (const a of items) {
      if (a.status === '접수' && a.hours_since >= STALE_HOURS) {
        owed.push({
          code: 'no_answer',
          ticket_no: a.ticket_no,
          title: a.title,
          days: Math.floor(a.hours_since / 24),
          text: `낸 지 ${Math.floor(a.hours_since / 24)}일이 지났는데 아직 아무 답도 못 드렸습니다.`,
        })
      }
      if (a.verdict === '반려' && !a.refuse_alternative) {
        owed.push({
          code: 'refused_no_alternative',
          ticket_no: a.ticket_no,
          title: a.title,
          text: '반려만 하고 대신 해볼 것을 못 드렸습니다. 병목은 그대로 남아 있습니다.',
        })
      }
      if (a.verdict === '보류' && a.hold_until_condition) {
        owed.push({
          code: 'held',
          ticket_no: a.ticket_no,
          title: a.title,
          text: `보류 중입니다 — ${a.hold_until_condition}`,
        })
      }
    }

    for (const r of reqs.results) {
      if (r.status === '기각' && !r.reject_reason) {
        owed.push({
          code: 'rejected_no_reason',
          ticket_no: r.ticket_no,
          title: r.body,
          text: '이 부서가 낸 요구를 기각하면서 사유를 안 적었습니다.',
        })
      }
    }

    for (const c of conflicts.results) {
      if (!c.verdict) {
        owed.push({
          code: 'conflict_unjudged',
          ticket_no: c.ticket_no,
          title: c.reason,
          text: '이 부서 요구가 다른 부서 요구와 부딪히는데 아직 판정을 못 냈습니다.',
        })
      }
    }

    for (const f of feedback.results) {
      if (!f.resolved_at) {
        owed.push({
          code: 'feedback_open',
          ticket_no: f.ticket_no,
          title: f.body,
          text: `${f.person_label}님이 남긴 말에 아직 답을 못 드렸습니다.`,
        })
      }
    }

    for (const t of tools.results) {
      if (!t.accepted_at && !t.rolled_back_at) {
        owed.push({
          code: 'handover_pending',
          ticket_no: t.ticket_no,
          title: t.title,
          text: '넘겨드렸지만 받으셨다는 확인이 아직 없습니다. 제대로 전달됐는지 확인이 필요합니다.',
        })
      }
    }

    // 이 부서 것 중 실제로 넘어가서 쓰이고 있는 것의 기준선 합.
    //
    // "얼마나 아꼈다"가 아니라 "자동화 전에 이만큼 걸리던 일을 넘겼다"까지만
    // 말한다. 실제 절감은 8단계에서 검수 시간·재작업까지 빼고 계산한다.
    let handedBaselineSeconds = 0
    for (const t of tools.results) {
      const a = items.find((x) => x.ticket_no === t.ticket_no)
      if (a?.median_seconds) handedBaselineSeconds += a.median_seconds
    }

    const by = (s) => items.filter((i) => i.status === s).length

    return jsonResponse({
      dept,
      summary: {
        total: items.length,
        waiting: by('접수'),
        accepted: by('수용'),
        refused: by('반려'),
        held: by('보류'),
        inProgress: by('진행중'),
        done: by('완료'),
        stale: items.filter((i) => i.status === '접수' && i.hours_since >= STALE_HOURS).length,
        // 이 부서가 "이만큼 걸린다"고 적어 낸 것의 합. 신청자 체감이지 실측이 아니다.
        claimedAnnualHours: items.reduce((s, i) => s + (i.annual_hours ?? 0), 0),
        claimedMissing: items.filter((i) => i.annual_hours == null).length,
        handedTools: tools.results.length,
        handedBaselineSeconds,
        meetings: meetings.results.length,
        requirementsTaken: reqs.results.filter((r) => r.status.includes('채택')).length,
        requirementsRejected: reqs.results.filter((r) => r.status === '기각').length,
      },
      applications: items,
      stakeholders: stakeholders.results,
      meetings: meetings.results,
      requirements: reqs.results,
      conflicts: conflicts.results,
      tools: tools.results,
      feedback: feedback.results,
      decisions: decisions.results,
      owed,
    })
  } catch (err) {
    return failUnexpected(err, '부서 기록을 모으지 못했습니다.')
  }
}
