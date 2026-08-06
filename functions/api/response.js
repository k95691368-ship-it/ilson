// 부서에 부탁한 것 중 실제로 답이 온 비율.
//
// 이 사이트는 부서에게 다섯 가지를 부탁한다. 부탁하는 자리는 회차마다
// 하나씩 만들었는데, **그 부탁이 실제로 먹혔는지는 한 번도 안 셌다.**
// 화면마다 "이건 부서가 해줘야 합니다"라고 적어 두고, 정작 부서가 몇 번
// 해줬는지는 아무도 모른다.
//
// 여기가 낮으면 나머지 기록이 아무리 촘촘해도 혼자 만든 것이다. 낮을 때
// 숨기지 않는 것이 이 사이트가 부서에게 요구하는 태도와 같다.

import { jsonResponse, jsonError } from '../_lib/http.js'
import { responseRate, responseLine, responseNote } from '../../shared/response.js'
import {
  ACCEPT_KIND,
  ACCEPT_PROXY_KIND,
  OUTCOME_KIND,
  OUTCOME_PROXY_KIND,
} from '../../shared/accept.js'
import { SIGNOFF_KIND } from '../../shared/signoff.js'
import { HOLD_LIFT_KIND } from '../../shared/holdlift.js'

// 한 부탁이 몇 건에 걸렸고 몇 건이 답했는지 세는 SQL 한 쌍.
//
// "물어봤다"의 기준은 **그 자리가 화면에 실제로 떴을 때**다. 기준이 아직
// 확정 전이면 서명을 부탁한 적이 없는 것이고, 그걸 미응답으로 세면 부서가
// 안 해준 것처럼 보인다.
export async function onRequestGet({ env }) {
  try {
    const [signoff, accept, outcome, beta, hold] = await Promise.all([
      // ① 합격 기준을 봐 달라 — 기준이 전부 확정된 건에만 부탁한다.
      env.DB.prepare(
        `SELECT
           COUNT(*) AS asked,
           SUM(CASE WHEN signed > 0 THEN 1 ELSE 0 END) AS answered,
           0 AS proxied
         FROM (
           SELECT a.id,
             (SELECT COUNT(*) FROM acceptance_criterion c WHERE c.application_id = a.id) AS total,
             (SELECT COUNT(*) FROM acceptance_criterion c
               WHERE c.application_id = a.id AND c.confirmed_at IS NOT NULL) AS confirmed,
             (SELECT COUNT(*) FROM decision_log d
               WHERE d.application_id = a.id AND d.link_kind = ?) AS signed
           FROM application a
         )
         WHERE total > 0 AND confirmed = total`
      )
        .bind(SIGNOFF_KIND)
        .first(),

      // ② 넘긴 것을 받았다고 눌러 달라 — 넘겼고 내리지 않은 건.
      env.DB.prepare(
        `SELECT
           COUNT(*) AS asked,
           SUM(CASE WHEN direct > 0 THEN 1 ELSE 0 END) AS answered,
           SUM(CASE WHEN direct = 0 AND proxy > 0 THEN 1 ELSE 0 END) AS proxied
         FROM (
           SELECT h.application_id,
             (SELECT COUNT(*) FROM decision_log d
               WHERE d.application_id = h.application_id AND d.link_kind = ?) AS direct,
             (SELECT COUNT(*) FROM decision_log d
               WHERE d.application_id = h.application_id AND d.link_kind = ?) AS proxy
           FROM handover h WHERE h.rolled_back_at IS NULL
         )`
      )
        .bind(ACCEPT_KIND, ACCEPT_PROXY_KIND)
        .first(),

      // ③ 성과가 체감과 맞는지 봐 달라 — 한 번이라도 돌아간 건.
      env.DB.prepare(
        `SELECT
           COUNT(*) AS asked,
           SUM(CASE WHEN direct > 0 THEN 1 ELSE 0 END) AS answered,
           SUM(CASE WHEN direct = 0 AND proxy > 0 THEN 1 ELSE 0 END) AS proxied
         FROM (
           SELECT o.application_id,
             (SELECT COUNT(*) FROM decision_log d
               WHERE d.application_id = o.application_id AND d.link_kind = ?) AS direct,
             (SELECT COUNT(*) FROM decision_log d
               WHERE d.application_id = o.application_id AND d.link_kind = ?) AS proxy
           FROM outcome o
           WHERE (SELECT COUNT(*) FROM tool_use u WHERE u.application_id = o.application_id) > 0
         )`
      )
        .bind(OUTCOME_KIND, OUTCOME_PROXY_KIND)
        .first(),

      // ④ 시험판을 써 보고 알려 달라 — 시험판이 한 번이라도 나온 건.
      env.DB.prepare(
        `SELECT
           COUNT(DISTINCT r.application_id) AS asked,
           COUNT(DISTINCT CASE WHEN f.id IS NOT NULL THEN r.application_id END) AS answered,
           0 AS proxied
         FROM beta_round r
         LEFT JOIN beta_feedback f ON f.application_id = r.application_id`
      ).first(),

      // ⑤ 보류 조건이 풀리면 알려 달라 — 지금 보류인 건.
      env.DB.prepare(
        `SELECT
           COUNT(*) AS asked,
           SUM(CASE WHEN told > 0 THEN 1 ELSE 0 END) AS answered,
           0 AS proxied
         FROM (
           SELECT a.id,
             (SELECT COUNT(*) FROM decision_log d
               WHERE d.application_id = a.id AND d.link_kind = ?) AS told
           FROM application a WHERE a.status = '보류'
         )`
      )
        .bind(HOLD_LIFT_KIND)
        .first(),
    ])

    const rows = [
      { key: 'signoff', ...signoff },
      { key: 'accept', ...accept },
      { key: 'outcome', ...outcome },
      { key: 'beta', ...beta },
      { key: 'hold', ...hold },
    ]

    const rate = responseRate(rows)
    return jsonResponse({
      ...rate,
      line: responseLine(rate),
      note: responseNote(rate),
    })
  } catch (err) {
    return jsonError(`부서 응답을 세지 못했습니다. (${String(err.message).slice(0, 160)})`, 503)
  }
}
