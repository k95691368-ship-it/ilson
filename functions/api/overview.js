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
import { OUTCOME_KIND } from '../../shared/accept.js'
import { HOLD_LIFT_KIND, HOLD_LIFT_CANCEL_KIND } from '../../shared/holdlift.js'
import { PICK_KIND, UNPICK_KIND } from '../../shared/priority.js'
import { unrankedPressure } from '../../shared/waitline.js'
import { provenanceOf } from '../../shared/provenance.js'

export async function onRequestGet({ env }) {
  try {
    const [
      apps,
      refuseMix,
      stageRows,
      handovers,
      uses,
      decisions,
      refuseNoAlt,
      deptSaid,
      betaOpen,
      holdLifts,
      pickRows,
      answeredWaiting,
      deptAsked,
      unrequestedAll,
    ] = await Promise.all([
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
                a.created_at AS applied_at, a.title, a.dept, a.ticket_no
         FROM handover h JOIN application a ON a.id = h.application_id`
      ).all(),

      env.DB.prepare(
        'SELECT COUNT(*) AS n, SUM(rows_out) AS rows_total, MAX(used_at) AS last FROM tool_use'
      ).first(),

      env.DB.prepare(
        `SELECT d.id, d.application_id, d.stage, d.actor, d.title, d.what, d.why, d.created_at,
                -- 결정 기록 화면과 **같은 규칙**을 쓴다. 두 화면이 다른
                -- 숫자를 말하면 둘 다 못 믿는다.
                (d.unrequested = 1 OR (d.link_kind = 'review' AND r.verdict = '반려'
                  AND TRIM(COALESCE(r.refuse_alternative, '')) <> '')) AS unrequested
         FROM decision_log d
         LEFT JOIN review r ON r.application_id = d.application_id
         ORDER BY d.created_at DESC LIMIT 8`
      ).all(),

      // 기준선 표를 통째로 읽어 개수만 세고 버리던 쿼리가 여기 있었다.
      // 첫 화면을 열 때마다 돌았고, 그 숫자를 그리는 화면은 없었다. 지운다.

      // 대안 없이 반려한 것. /honesty가 세는 것과 같은 조건으로 센다 —
      // 두 화면이 서로 다른 말을 하면 둘 다 못 믿는다.
      env.DB.prepare(
        `SELECT COUNT(*) AS n FROM review
         WHERE verdict = '반려' AND (refuse_alternative IS NULL OR TRIM(refuse_alternative) = '')`
      ).first(),

      // 부서가 성과 숫자를 직접 확인하면서 남긴 것.
      //
      // 부서가 "그거 그렇게 안 걸립니다"라고 했는데 담당자가 그걸 모르면,
      // 그 금액은 부서가 아니라고 한 채로 보고에 올라간다. 여기서 세서
      // 첫 화면 할 일 목록에 올린다.
      env.DB.prepare(
        `SELECT id, application_id, alternatives FROM decision_log
         WHERE link_kind = ? ORDER BY created_at DESC`
      )
        .bind(OUTCOME_KIND)
        .all(),

      // 부서가 시험판을 써 보고 적었는데 아직 답을 못 준 것.
      env.DB.prepare(
        `SELECT DISTINCT application_id FROM beta_feedback WHERE resolved_at IS NULL`
      ).all(),

      // 보류해 둔 것의 조건이 풀렸다고 부서가 알려 온 것.
      //
      // 이건 다른 알림과 무게가 다르다. 보류는 **아무도 안 움직이면 영원히
      // 그대로**인 유일한 상태다. 부서가 큰맘 먹고 알렸는데 그것마저 안
      // 보이면, 그 부서는 다음부터 아무것도 안 알린다.
      env.DB.prepare(
        `SELECT d.application_id, d.link_kind, d.created_at, r.updated_at AS judged_at
         FROM decision_log d
         LEFT JOIN review r ON r.application_id = d.application_id
         WHERE d.link_kind IN (?, ?)
         ORDER BY d.created_at`
      )
        .bind(HOLD_LIFT_KIND, HOLD_LIFT_CANCEL_KIND)
        .all(),

      // 먼저 하기로 정해 둔 것. 취소는 자기 앞의 지정을 지운다.
      env.DB.prepare(
        `SELECT d.application_id, d.link_kind, a.status
         FROM decision_log d JOIN application a ON a.id = d.application_id
         WHERE d.link_kind IN (?, ?)
         ORDER BY d.created_at`
      )
        .bind(PICK_KIND, UNPICK_KIND)
        .all(),

      // 되물었고 답을 받았는데 아직 판정 안 한 것.
      //
      // 답이 오면 "답 기다리는 중" 배지가 조용히 사라지는 것이 전부였다.
      // 담당자는 막혀서 되물었던 건인데, 풀린 것을 배지가 없어진 것으로
      // 알아채야 했다.
      env.DB.prepare(
        `SELECT a.id AS application_id FROM application a
         WHERE a.status IN ('접수', '검토중')
           AND EXISTS (
             SELECT 1 FROM decision_log ans
              JOIN decision_log q ON q.id = ans.link_id
             WHERE ans.link_kind = '답변' AND q.application_id = a.id
           )
           AND NOT EXISTS (
             SELECT 1 FROM decision_log q2
              WHERE q2.application_id = a.id AND q2.link_kind = '질문'
                AND NOT EXISTS (
                  SELECT 1 FROM decision_log a2
                   WHERE a2.link_kind = '답변' AND a2.link_id = q2.id
                )
           )`
      ).all(),

      // 부서가 먼저 물어 온 것 중 아직 답 안 한 것.
      //
      // 부서는 로그인이 없어서 재촉할 길이 없다. 조회 화면을 다시 열어 보는
      // 것 말고는 아무것도 못 한다. 담당자가 첫 화면에서 못 보면 그냥 잊힌다.
      // 물을 자리만 만들고 답할 자리를 안 만들면 물을 데가 없던 것보다 나쁘다.
      env.DB.prepare(
        `SELECT DISTINCT q.application_id FROM decision_log q
         WHERE q.link_kind = '부서질문'
           AND NOT EXISTS (
             SELECT 1 FROM decision_log r
              WHERE r.link_kind = '담당자답' AND r.link_id = q.id
           )`
      ).all(),

      // 요청받지 않았는데 먼저 꺼낸 것 — **전체**를 센다.
      //
      // 여태 최근 8건 안에서만 셌다. 그래서 첫 화면은 0인데 결정 기록
      // 화면은 3이라고 말했다. 문구는 "요청받지 않았는데 먼저 제안한 것
      // N건"이라 전체처럼 읽히는데 실제로는 최근 것만 본 숫자였다.
      // 두 화면이 다른 숫자를 말하면 둘 다 못 믿는다.
      env.DB.prepare(
        `SELECT COUNT(*) AS n FROM decision_log d
         LEFT JOIN review r ON r.application_id = d.application_id
         WHERE d.unrequested = 1 OR (d.link_kind = 'review' AND r.verdict = '반려'
           AND TRIM(COALESCE(r.refuse_alternative, '')) <> '')`
      ).first(),
    ])

    // 취소는 자기 앞의 요청을 지우고, 요청 뒤에 다시 판정했으면 답을 준 것이다.
    const liftOpen = new Map()
    for (const r of holdLifts.results) {
      if (r.link_kind === HOLD_LIFT_CANCEL_KIND) liftOpen.delete(r.application_id)
      else liftOpen.set(r.application_id, r)
    }
    // 세는 것으로 끝내지 않고 **어느 건인지**까지 모은다.
    //
    // 할 일 목록이 "N건"만 알려 주면, 담당자는 검토 화면에 와서 칩을 하나씩
    // 눌러 그 건을 찾아야 한다. 못 찾으면 그 목록을 다음부터 안 읽는다.
    // 세는 자리에서 같이 모아야 "3건"이라 해 놓고 두 개만 짚는 일이 없다.
    let holdLiftWaiting = 0
    const holdLiftedIds = []
    for (const r of liftOpen.values()) {
      if (!r.judged_at || String(r.judged_at) <= String(r.created_at)) {
        holdLiftWaiting += 1
        holdLiftedIds.push(r.application_id)
      }
    }

    // 하기로 해 놓고 아직 시작 안 한 것이 여럿인데 순서를 안 정한 상태.
    //
    // 순서를 안 정하는 것 자체는 잘못이 아니다. 한 건만 있으면 정할 것도
    // 없다. 다만 **여럿이 기다리는데 안 정한 것**은 다르다 — 그때 부서가
    // "왜 우리 것은 아직입니까"라고 물으면 댈 말이 없다.
    const livePicks = new Map()
    for (const r of pickRows.results) {
      if (r.link_kind === UNPICK_KIND) livePicks.delete(r.application_id)
      else livePicks.set(r.application_id, r)
    }
    const pickedLive = [...livePicks.values()].filter(
      (r) => r.status !== '완료' && r.status !== '반려'
    )
    // apps.results 를 쓴다. items 는 이 아래에서 선언되고, 여기서 items 를
    // 쓰면 TDZ에 걸려 이 라우트가 통째로 503이 된다 — 실제로 그렇게
    // 배포했고 첫 화면이 안 열렸다.
    const waitingToStart = apps.results.filter((a) => a.status === '수용').length
    const rankPressure = unrankedPressure({ waiting: waitingToStart, picked: pickedLive })

    // 체감이 우리가 잰 값과 크게 다르다고 한 건. 숫자는 alternatives에
    // JSON으로 들어 있다 — why 칸에 넣었다가 첫 화면에 그대로 찍힌 적이 있다.
    const disagreed = new Set()
    for (const r of deptSaid.results) {
      try {
        const said = JSON.parse(r.alternatives)
        if (said?.agree === false) disagreed.add(r.application_id)
      } catch {
        // 옛 기록에는 숫자가 없다. 그건 세지 않는다.
      }
    }

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
        // 접수번호를 함께 준다. 화면이 "이건 왜 21일이나 걸렸지"를 눌러
        // 그 기록으로 갈 수 있어야 숫자가 이야기가 된다.
        return {
          ticket_no: h.ticket_no,
          title: h.title,
          dept: h.dept,
          days: Math.max(0, (to - from) / 86400000),
        }
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
      // 대안 없이 반려한 것.
      //
      // 첫 화면 타일이 "전부 이유와 대안을 함께 보냈습니다"라고 단언하는
      // 동안 /honesty는 "대안 없이 반려 N건"이라고 반대로 말하고 있었다.
      // 두 화면이 같은 자리를 보게 세는 곳을 여기 둔다.
      refusedWithoutAlternative: refuseNoAlt?.n ?? 0,
      // 부서가 "그 숫자는 체감과 다릅니다"라고 한 건. 이게 살아 있는 동안
      // 그 금액은 보수적 추정으로 내려가 있다.
      deptDisagrees: disagreed.size,
      deptDisagreesIds: [...disagreed],
      // 부서가 시험판을 써 보고 적었는데 아직 답을 못 준 것.
      betaUnanswered: betaOpen.results.length,
      betaUnansweredIds: betaOpen.results.map((r) => r.application_id),
      // 보류 조건이 풀렸다고 알려 왔는데 아직 다시 판정 안 한 것.
      holdLiftWaiting,
      holdLiftedIds,
      // 이 숫자가 무엇 위에 서 있는가. 시연용으로 심은 것이 몇 건인지를
      // 첫 화면이 스스로 말해야 한다 — 지금은 /review 한 군데에만 적혀 있다.
      provenance: provenanceOf(items),
      // 되물었고 답을 받았는데 아직 판정 안 한 것.
      //
      // 부서가 시간을 써서 답해 줬다. 그걸 놓치면 부서는 "답해 봐야
      // 소용없다"를 배운다.
      // 세는 것과 **어느 건인지**를 같은 자리에서 낸다. 따로 뽑으면
      // "3건"이라 해 놓고 두 개만 짚어 주게 된다.
      answered: answeredWaiting.results.length,
      answeredIds: answeredWaiting.results.map((r) => r.application_id),
      // 부서가 물어 놓고 답을 기다리는 것.
      deptAsked: deptAsked.results.length,
      deptAskedIds: deptAsked.results.map((r) => r.application_id),
      // 하기로 해 놓고 순서를 안 정한 채 기다리는 것.
      waitingToStart,
      unranked: rankPressure.over ? waitingToStart : 0,
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
      // 접수부터 인수인계까지.
      //
      // 여태 화면은 중앙값 하나만 그렸다. fastest·slowest 는 여기서 계산해
      // 내려보내는데 읽는 곳이 없었다. 중앙값만 보이면 **폭이 안 보인다** —
      // 셋 다 열흘쯤 걸린 것과, 사흘짜리 하나에 스무날짜리 하나가 섞여 중앙이
      // 열흘인 것은 완전히 다른 이야기인데 화면에서는 같은 숫자다.
      //
      // 이 사이트는 다른 자리에서 "못 한 것을 숨기지 않는다"고 말한다.
      // 오래 걸린 건을 가려 놓고 그 말을 할 수는 없다.
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
        // 넘기긴 했는데 부서가 아직 "받았습니다"를 안 누른 것.
        //
        // 투어의 배포 칸은 "부서가 받았다고 눌러야 넘긴 것으로 칩니다. 그
        // 전까지는 넘긴 것이 아닙니다"라고 적어 놓고, 정작 넘기자마자 다음
        // 칸으로 넘어갔다. 적어 둔 쪽이 옳으니 안내가 이 수를 보게 한다.
        totalRuns: uses?.n ?? 0,
        list: handovers.results
          .filter((h) => !h.rolled_back_at)
          .map((h) => ({ slug: h.slug, title: h.title, dept: h.dept })),
      },
      recentDecisions: decisions.results,
      // 결정 기록 화면과 같은 규칙, 같은 범위(전체)를 본다.
      unrequestedCount: unrequestedAll?.n ?? 0,
      recent: items.slice(0, 6).map((a) => ({ ...a, stage: stageOf(a) })),
    })
  } catch (err) {
    return jsonError(`현황을 불러오지 못했습니다. (${String(err.message).slice(0, 160)})`, 503)
  }
}
