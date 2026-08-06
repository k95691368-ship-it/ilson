// 1단계 — 신청서 접수와 목록.
//
// 로그인을 요구하지 않는다. 부서 담당자에게 계정을 만들게 하는 순간 아무도
// 신청하지 않고, 그러면 이 시스템에 들어오는 것이 없다. 대신 접수번호를 주고
// 남용은 IP 단위 호출 한도로 막는다.

import { jsonResponse, jsonError } from '../../_lib/http.js'
import { checkRateLimit, releaseRateLimit } from '../../_lib/rateLimit.js'
import { newId, newTicketNo, hashIp, sha256Hex } from '../../_lib/ids.js'
import {
  validateApplication,
  validateFile,
  annualHours,
  MAX_FILES,
  DEPTS,
  APP_STATUSES,
} from '../../_lib/applications.js'

const PAGE_LIMIT = 200

export async function onRequestGet({ env, request }) {
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
                a.status, a.created_at,
                CAST((julianday('now') - julianday(a.created_at)) * 24 AS INTEGER) AS hours_since,
                (SELECT COUNT(*) FROM application_file f WHERE f.application_id = a.id) AS file_count,
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
  } catch (err) {
    return jsonError(`신청서를 불러오지 못했습니다. (${String(err.message).slice(0, 160)})`, 503)
  }
}

export async function onRequestPost({ env, request }) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown'

  // 한 사람이 같은 내용을 반복 제출하는 것만 막는다. 진짜 신청을 막지 않도록
  // 넉넉하게 둔다 — 부서에서 여러 명이 같은 사무실 IP로 낼 수 있다.
  const ticket = await checkRateLimit(env, `apply:${ip}`, 12, 3600)
  if (!ticket) {
    return jsonError('신청은 시간당 12건까지 받습니다. 잠시 후 다시 시도해주세요.', 429)
  }

  let form
  try {
    form = await request.formData()
  } catch {
    await releaseRateLimit(env, `apply:${ip}`, ticket)
    return jsonError('신청서 형식이 올바르지 않습니다.', 400)
  }

  const fields = Object.fromEntries(
    [...form.entries()].filter(([, v]) => typeof v === 'string')
  )
  const files = form.getAll('files').filter((f) => typeof f !== 'string')

  const check = validateApplication(fields)
  if (!check.ok) {
    await releaseRateLimit(env, `apply:${ip}`, ticket)
    return jsonResponse({ error: '적어 주신 내용을 확인해주세요.', fields: check.errors }, 400)
  }

  if (files.length > MAX_FILES) {
    await releaseRateLimit(env, `apply:${ip}`, ticket)
    return jsonError(`파일은 ${MAX_FILES}개까지 올릴 수 있습니다.`, 400)
  }
  for (const f of files) {
    const problem = validateFile(f)
    if (problem) {
      await releaseRateLimit(env, `apply:${ip}`, ticket)
      return jsonError(problem, 400)
    }
  }

  const v = check.value
  const id = newId('app')
  const ticketNo = newTicketNo()

  try {
    await env.DB.prepare(
      `INSERT INTO application
         (id, ticket_no, dept, applicant_label, contact, title, bottleneck, problem, wish,
          current_minutes, current_people, current_frequency, impact_if_wrong,
          status, source_ip_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '접수', ?)`
    )
      .bind(
        id,
        ticketNo,
        v.dept,
        v.applicant_label,
        v.contact,
        v.title,
        v.bottleneck,
        v.problem,
        v.wish,
        v.current_minutes,
        v.current_people,
        v.current_frequency,
        v.impact_if_wrong,
        await hashIp(ip)
      )
      .run()
  } catch (err) {
    await releaseRateLimit(env, `apply:${ip}`, ticket)
    return jsonError(`신청서를 저장하지 못했습니다. (${String(err.message).slice(0, 160)})`, 500)
  }

  // 파일은 신청서가 저장된 뒤에 올린다. 파일이 실패해도 신청 자체는 남아야
  // 한다 — 다 적어 낸 내용을 파일 하나 때문에 날리면 다시 쓰지 않는다.
  const saved = []
  const failed = []
  for (const f of files) {
    try {
      const buf = await f.arrayBuffer()
      const checksum = await sha256Hex(
        `${f.name}:${f.size}:${[...new Uint8Array(buf.slice(0, 4096))].join(',')}`
      )
      const key = `applications/${id}/${crypto.randomUUID()}-${f.name}`
      await env.SOURCES.put(key, buf, {
        httpMetadata: { contentType: f.type || 'application/octet-stream' },
      })
      await env.DB.prepare(
        `INSERT INTO application_file
           (id, application_id, name, byte_size, content_type, checksum, r2_key)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(newId('afl'), id, f.name, f.size, f.type || null, checksum, key)
        .run()
      saved.push(f.name)
    } catch {
      failed.push(f.name)
    }
  }

  return jsonResponse(
    {
      id,
      ticket_no: ticketNo,
      saved_files: saved,
      // 실패를 숨기지 않는다. 무엇이 안 올라갔는지 알아야 다시 올릴 수 있다.
      failed_files: failed,
      message: failed.length
        ? `접수됐습니다. 다만 파일 ${failed.length}개가 올라가지 않았습니다.`
        : '접수됐습니다.',
    },
    201
  )
}
