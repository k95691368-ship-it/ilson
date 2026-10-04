// 1단계 — 신청서 접수와 목록.
//
// 운영 계정/개인 체험 범위는 middleware가 고른다. 같은 제출 의도의 재시도는
// 접수번호를 다시 돌려주며, 신청·성공 한도·재시도 영수증은 DB에서 함께 커밋한다.

import { jsonResponse, failUnexpected } from '../../_lib/http.ts'
import { newId, newTicketNo, hashIp } from '../../_lib/ids.js'
import { mutationFingerprint } from '../../_lib/atomicMutation.ts'
import {
  validateApplication,
  annualHours,
  DEPTS,
  APP_STATUSES,
} from '../../_lib/applications.js'

const PAGE_LIMIT = 200

export async function onRequestGet({ env, data: requestData, request }) {
  env = requestData?.requestEnv ?? env
  const url = new URL(request.url)
  const dept = url.searchParams.get('dept')
  const status = url.searchParams.get('status')

  try {
    const where = []
    const binds = []
    // 아는 값만 조건으로 쓴다. 모르는 값이 오면 조건을 아예 붙이지 않는다.
    // 오타 하나에 빈 화면을 주는 것보다 전체를 주는 편이 낫다.
    if (DEPTS.includes(dept)) {
      where.push('a.dept = ?')
      binds.push(dept)
    }
    if (APP_STATUSES.includes(status)) {
      where.push('a.status = ?')
      binds.push(status)
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''

    const [listed, counted] = await Promise.all([
      env.DB.prepare(
        `SELECT a.id, a.ticket_no, a.dept, a.applicant_label, a.title, a.bottleneck,
                a.problem, a.wish, a.impact_if_wrong,
                a.current_minutes, a.current_people, a.current_frequency, a.is_measured,
                a.status, a.created_at, a.review_revision,
                CAST((julianday('now') - julianday(a.created_at)) * 24 AS INTEGER) AS hours_since,
              -- 아직 답 못 받은 질문. 이게 있으면 지금 멈춰 있는 이유가
              -- 부서 쪽에 있다는 뜻이라, 담당자 할 일로 세면 안 된다.
              (SELECT COUNT(*) FROM decision_log q
                WHERE q.application_id = a.id AND q.link_kind = '질문'
                  AND NOT EXISTS (
                    SELECT 1 FROM decision_log ans
                     WHERE ans.link_kind = '답변' AND ans.link_id = q.id
                  )) AS waiting_answers,
              -- 되물었고 **답을 받은** 것. 이제 막고 있던 것이 없다.
              --
              -- 지금까지는 답이 오면 위의 waiting_answers 가 0이 되는 것이
              -- 전부였다. 배지가 조용히 사라질 뿐, 아무도 "답이 왔습니다"라고
              -- 말해 주지 않는다. 담당자는 막혀서 되물었던 건인데, 풀린 것을
              -- 배지가 없어진 것으로 알아채야 했다. 한 번도 안 물어본 신청서와
              -- 화면에서 구분이 안 된다.
              (SELECT MAX(ans.created_at) FROM decision_log ans
                JOIN decision_log q ON q.id = ans.link_id
                WHERE ans.link_kind = '답변' AND q.application_id = a.id) AS answered_at,
              -- 부서가 **먼저** 물어 놓고 답을 기다리는 것.
              --
              -- 부서가 먼저 묻는 길을 열어 놓고 이 목록은 그걸 안 셌다.
              -- 첫 화면 할 일에는 "부서가 물어 놓고 답을 기다리는 것 N건"이
              -- 뜨는데, 눌러서 접수함에 와도 어느 줄인지 표시가 없었다.
              -- 담당자는 N건이라는 것만 알고 그게 어느 건인지는 모른다.
              --
              -- 그리고 위의 waiting_answers 와 뜻이 반대다. 저건 공이 부서
              -- 쪽에 있다는 뜻이고, 이건 공이 담당자 쪽에 있다는 뜻이다.
              -- 한 칸으로 합치면 접수함이 둘을 같은 색으로 칠한다.
              (SELECT COUNT(*) FROM decision_log q
                WHERE q.application_id = a.id AND q.link_kind = '부서질문'
                  AND NOT EXISTS (
                    -- 별칭을 r 로 쓰면 같은 문장 안의 review r 과 겹친다.
                    -- 사람도 헷갈리고 스키마 검사기도 review 표에서
                    -- link_kind 를 찾다가 없다고 한다.
                    SELECT 1 FROM decision_log dr
                     WHERE dr.link_kind = '담당자답' AND dr.link_id = q.id
                  )) AS dept_asked,
              -- 보류해 둔 것의 조건이 풀렸다고 부서가 알려 왔는가.
              --
              -- 목록에서 안 보이면 담당자는 첫 화면 할 일에서 "N건"만 읽고
              -- 여기 와서 어느 것인지 찾아 헤맨다. 마지막 알림이 마지막
              -- 취소보다 뒤이고, 그 뒤로 다시 판정하지 않았을 때만 센다.
              (SELECT MAX(l.created_at) FROM decision_log l
                WHERE l.application_id = a.id AND l.link_kind = '보류해제요청'
                  AND l.created_at > COALESCE(
                        (SELECT MAX(c.created_at) FROM decision_log c
                          WHERE c.application_id = a.id AND c.link_kind = '보류해제취소'), '')
                  AND l.created_at > COALESCE(
                        (SELECT r.updated_at FROM review r WHERE r.application_id = a.id), '')
              ) AS hold_lift_at
         FROM application a
         ${clause}
         ORDER BY a.created_at DESC
         LIMIT ${PAGE_LIMIT}`
      )
        .bind(...binds)
        .all(),

      // 상한 밖에 무엇이 있는지 알려면 세는 수밖에 없다. 화면이 "없습니다"라고
      // 말할 때, 그것이 진짜 없는 것인지 여기까지만 받아 온 것인지 구분해야
      // 한다. 둘을 같게 취급하면 화면이 조용히 거짓말을 한다.
      env.DB.prepare(`SELECT COUNT(*) AS n FROM application a ${clause}`)
        .bind(...binds)
        .first(),
    ])

    const items = listed.results.map((r) => ({ ...r, annual_hours: annualHours(r) }))
    const stored = counted?.n ?? items.length

    return jsonResponse({
      items,
      summary: {
        total: items.length,
        waiting: items.filter((i) => i.status === '접수').length,
        // 접수 후 하루가 지나도록 아무도 안 본 것. 담당자가 밀어 둔 것이지
        // 시스템이 기다리는 것이 아니다.
        overdue: items.filter((i) => i.status === '접수' && i.hours_since >= 24).length,
        stored,
        capped: stored > items.length,
        limit: PAGE_LIMIT,
      },
    })
  } catch (error) {
    return failUnexpected(error, '신청서를 불러오지 못했습니다.')
  }
}

export async function onRequestPost({ env, data: requestData, request }) {
  env = requestData?.requestEnv ?? env
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown'

  let form
  try {
    form = await request.formData()
  } catch {
    return jsonResponse({ error: '신청서 형식이 올바르지 않습니다.', notSaved: true }, 400)
  }

  for (const value of form.values()) {
    if (typeof value !== 'string') {
      return jsonResponse({ error: '신청서는 텍스트만 받습니다. 정산 파일은 제작 화면에서 처리해주세요.', notSaved: true }, 400)
    }
  }
  const fields = Object.fromEntries(form)
  if (env.AUTH_ACTOR) fields.applicant_label = env.AUTH_ACTOR.label

  const check = validateApplication(fields)
  if (!check.ok) {
    return jsonResponse({ error: '적어 주신 내용을 확인해주세요.', fields: check.errors, notSaved: true }, 400)
  }

  const requestId = request.headers.get('X-Idempotency-Key')
  if (!requestId || !/^[a-zA-Z0-9_-]{16,100}$/.test(requestId)) {
    return jsonResponse({ error: '제출 확인 정보가 없습니다. 접수 내역을 확인한 뒤 신청 화면을 다시 열어주세요.', code: 'APPLICATION_INTENT_REQUIRED', notSaved: true }, 400)
  }
  if (typeof env.DB?.recordApplication !== 'function') {
    return jsonResponse({ error: '안전한 신청 접수 기능을 준비 중입니다. 잠시 후 같은 내용으로 다시 시도해주세요.', notSaved: true }, 503)
  }

  try {
    const value = check.value
    // Network changes and newly generated record IDs must not change the intent.
    // The DB independently scopes receipts to the verified actor/workspace.
    const fingerprint = await mutationFingerprint({ operation: 'application.create', value })
    const committed = await env.DB.recordApplication(`apply:${ip}`, requestId, fingerprint, {
      ...value, id: newId('app'), ticket_no: newTicketNo(), source_ip_hash: await hashIp(ip),
    })
    const { status, body } = committed.response
    if (![201, 429].includes(status) || !body || typeof body !== 'object' || Array.isArray(body)
      || (status === 201 && (typeof body.id !== 'string' || !/^app_[a-zA-Z0-9_-]{16,90}$/.test(body.id)
        || typeof body.ticket_no !== 'string' || !/^AX-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{3}-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{3}$/.test(body.ticket_no)
        || typeof body.message !== 'string' || !body.message.trim()))
      || (status === 429 && (typeof body.error !== 'string' || !body.error.trim() || body.notSaved !== true))) {
      throw new Error('Invalid application receipt response')
    }
    return jsonResponse(body, status, { 'X-Idempotency-Replayed': committed.replayed ? '1' : '0' })
  } catch (error) {
    if (/\/(40001)\)/.test(error?.message ?? '')) {
      return jsonResponse({ error: '이 제출 번호에 이미 다른 내용이나 이전 접근 상태의 접수 기록이 있습니다. 접수 내역을 먼저 확인해주세요.', code: 'APPLICATION_INTENT_CONFLICT' }, 409)
    }
    // A failed/lost response may follow a committed insert. Never refund its
    // quota or generate another intent; retrying the same key recovers it.
    return failUnexpected(error, '신청서의 저장 여부를 확인하지 못했습니다. 같은 내용으로 다시 시도해주세요.')
  }
}
