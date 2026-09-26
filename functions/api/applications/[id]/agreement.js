// 3단계 — 협의안.
//
// 이해관계자, 회의록, 요구, 충돌 판정, 합격 기준, 기준선이 전부 여기 붙는다.
// 화면 하나가 쓰는 것이라 한 곳에 모았다. 여러 라우트로 나누면 화면이 요청을
// 예닐곱 번 보내야 하고, 그중 일부만 온 중간 상태가 화면에 남는다.

import { jsonResponse, jsonError, failFields, failUnexpected } from '../../../_lib/http.js'
import { rethrowDatabaseAccessFailure } from '../../../_lib/dbBridge.js'
import { newId } from '../../../_lib/ids.js'
import { logDecision } from '../../../_lib/decisions.js'
import { HOURLY_WAGE_KRW } from '../../../../shared/outcome.js'
import { validateBaselineInputs } from '../../../../shared/outcomeInputs.ts'
import { loadOutcomeEvidence } from '../../../_lib/outcomeEvidence.js'
import { loadCriteriaEvidence, baselineSourceVersion, agreementMutation, agreementConflict } from '../../../_lib/agreementEvidence.js'
import { pendingJoinDepts } from '../../../../shared/join.js'
import { loadJoins } from './join.js'
import {
  quoteFound,
  CRITERION_BY_KEY,
  CONFLICT_VERDICTS,
  REQUIREMENT_KINDS,
  REQUIREMENT_STATUSES,
  PRIORITIES,
} from '../../../../shared/acceptance.ts'

// 요구를 기각할 때 받는 최소 길이. 판정 근거와 같은 선을 쓴다 — 화면마다
// 다른 기준을 두면 담당자는 어디서 얼마나 적어야 하는지 매번 헷갈린다.
//
// 스무 자였다가 풀었다. 글자 수로는 근거가 있는지를 못 가린다. 비어
// 있는지만 막는다.
const MIN_REJECT_REASON = 1

async function findApplication(env, id) {
  return env.DB.prepare(
    `SELECT id, ticket_no, dept, title, status,
            current_minutes, current_people, current_frequency
     FROM application WHERE id = ? OR ticket_no = ?`
  )
    .bind(id, id)
    .first()
}

export async function onRequestGet({ env, data: requestData, params }) {
  env = requestData?.requestEnv ?? env
  const app = await findApplication(env, params.id)
  if (!app) return jsonError('그런 신청서가 없습니다.', 404)

  try {
    const [stakeholders, meetings, requirements, conflicts, criteria, shadowRuns, baseline] =
      await Promise.all([
        env.DB.prepare(
          'SELECT * FROM stakeholder WHERE application_id = ? ORDER BY is_owner DESC, created_at'
        )
          .bind(app.id)
          .all(),
        env.DB.prepare('SELECT * FROM meeting WHERE application_id = ? ORDER BY seq')
          .bind(app.id)
          .all(),
        env.DB.prepare(
          `SELECT * FROM requirement WHERE application_id = ?
           ORDER BY CASE status WHEN '기각' THEN 1 ELSE 0 END,
                    CASE priority WHEN '필수' THEN 0 WHEN '보통' THEN 1 ELSE 2 END,
                    created_at`
        )
          .bind(app.id)
          .all(),
        env.DB.prepare(
          `SELECT * FROM requirement_conflict WHERE application_id = ?
           ORDER BY CASE WHEN verdict IS NULL THEN 0 ELSE 1 END,
                    CASE severity WHEN '높음' THEN 0 WHEN '보통' THEN 1 ELSE 2 END`
        )
          .bind(app.id)
          .all(),
        loadCriteriaEvidence(env.DB, app.id),
        env.DB.prepare('SELECT * FROM shadow_run WHERE application_id = ? ORDER BY seq,id')
          .bind(app.id)
          .all(),
        env.DB.prepare('SELECT * FROM baseline WHERE application_id = ?').bind(app.id).first(),
      ])

    // 인용이 회의록에 실제로 있는지 대조한다. 없다고 지우지는 않는다 —
    // 담당자가 회의록을 나중에 고쳤을 수도 있고, 다른 회의의 말일 수도 있다.
    // 표시만 하고 판단은 사람이 한다.
    const minutesAll = meetings.results.map((m) => m.minutes_text ?? '').join('\n')
    const reqs = requirements.results.map((r) => ({
      ...r,
      quote_verified: r.quote ? quoteFound(minutesAll, r.quote) : null,
    }))

    const reqById = new Map(reqs.map((r) => [r.id, r]))

    const pendingJoins = pendingJoinDepts({
      joins: await loadJoins(env, app.id),
      requirements: reqs,
    })

    return jsonResponse({
      application: app,
      stakeholders: stakeholders.results,
      meetings: meetings.results.map((m) => ({
        ...m,
        depts: safeParse(m.depts_json, []),
      })),
      requirements: reqs,
      // 손든 부서 중 아직 협의안에 사정이 안 들어온 곳.
      //
      // 표에 새로 담지 않는다. "그 부서 이름으로 된 요구가 있느냐 없느냐"만
      // 본다. 그래서 요구를 지우면 저절로 다시 뜨고, 손들기를 풀면 한꺼번에
      // 빠진다 — 되돌리는 코드를 한 줄도 안 쓰고 되돌리기가 된다.
      pendingJoins,
      conflicts: conflicts.results.map((c) => ({
        ...c,
        a: reqById.get(c.req_a_id) ?? null,
        b: reqById.get(c.req_b_id) ?? null,
      })),
      criteria: criteria.versioned,
      criteria_source_version: criteria.sourceVersion,
      baseline_source_version: await baselineSourceVersion(app,shadowRuns.results,baseline),
      shadowRuns: shadowRuns.results.map((s) => ({
        ...s,
        steps: safeParse(s.step_timings_json, null),
      })),
      baseline: baseline ?? null,
    })
  } catch (error) {
    return failUnexpected(error, '협의안을 불러오지 못했습니다.')
  }
}

// 무엇을 추가할지는 kind로 정한다.
export async function onRequestPost({ env, data: requestData, params, request }) {
  env = requestData?.requestEnv ?? env
  const app = await findApplication(env, params.id)
  if (!app) return jsonError('그런 신청서가 없습니다.', 404)

  let body
  try {
    body = await request.json()
  } catch {
    return jsonError('요청 형식이 올바르지 않습니다.', 400)
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return jsonError('요청 형식이 올바르지 않습니다.',400)

  const t = (v) => String(v ?? '').trim()

  try {
    switch (body.kind) {
      case 'stakeholder': {
        if (!t(body.dept) || !t(body.wants)) {
          return failFields({ wants: '어느 부서가 무엇을 원하는지 적어주세요.' })
        }
        const id = newId('stk')
        await env.DB.prepare(
          `INSERT INTO stakeholder (id, application_id, dept, role_label, person_label, wants, is_owner)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
          .bind(
            id,
            app.id,
            t(body.dept),
            t(body.role_label) || '담당',
            t(body.person_label) || '담당자',
            t(body.wants),
            body.is_owner ? 1 : 0
          )
          .run()
        return jsonResponse({ ok: true, id }, 201)
      }

      case 'meeting': {
        const seq =
          ((
            await env.DB.prepare(
              'SELECT MAX(seq) AS n FROM meeting WHERE application_id = ?'
            )
              .bind(app.id)
              .first()
          )?.n ?? 0) + 1
        const id = newId('mtg')
        await env.DB.prepare(
          `INSERT INTO meeting (id, application_id, seq, title, depts_json, held_at, minutes_text, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
          .bind(
            id,
            app.id,
            seq,
            t(body.title) || `${seq}차 회의`,
            JSON.stringify(body.depts ?? []),
            t(body.held_at) || null,
            t(body.minutes_text) || null,
            t(body.minutes_text) ? '완료' : '준비'
          )
          .run()
        return jsonResponse({ ok: true, id, seq }, 201)
      }

      case 'requirement': {
        if (!t(body.body)) return failFields({ body: '무엇을 요구하는지 적어주세요.' })
        if (!REQUIREMENT_KINDS.includes(t(body.req_kind))) {
          return failFields({ req_kind: '요구·제약·미결·가정 중에서 골라주세요.' })
        }
        const id = newId('req')
        await env.DB.prepare(
          `INSERT INTO requirement
             (id, application_id, meeting_id, kind, dept, body, quote, priority, measurable, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '초안')`
        )
          .bind(
            id,
            app.id,
            t(body.meeting_id) || null,
            t(body.req_kind),
            t(body.dept) || app.dept,
            t(body.body),
            t(body.quote) || null,
            PRIORITIES.includes(t(body.priority)) ? t(body.priority) : '보통',
            t(body.measurable) || null
          )
          .run()
        return jsonResponse({ ok: true, id }, 201)
      }

      case 'conflict': {
        if (!t(body.req_a_id) || !t(body.req_b_id) || body.req_a_id === body.req_b_id) {
          return failFields({ req_b_id: '서로 다른 요구 두 개를 골라주세요.' })
        }
        if (!t(body.reason)) {
          return failFields({ reason: '왜 둘이 동시에 될 수 없는지 적어주세요.' })
        }
        const id = newId('cfl')
        await env.DB.prepare(
          `INSERT INTO requirement_conflict
             (id, application_id, req_a_id, req_b_id, reason, tradeoff_axis, severity)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
          .bind(
            id,
            app.id,
            t(body.req_a_id),
            t(body.req_b_id),
            t(body.reason),
            t(body.tradeoff_axis) || null,
            ['낮음', '보통', '높음'].includes(t(body.severity)) ? t(body.severity) : '보통'
          )
          .run()
        return jsonResponse({ ok: true, id }, 201)
      }

      case 'criterion': {
        const preset = CRITERION_BY_KEY[t(body.check_key)]
        const text = t(body.body) || preset?.body
        if (!text || text.length > 10000) return failFields({body:'합격 기준은 1~10,000자로 적어주세요.'})
        if(body.is_required_safety!=null && typeof body.is_required_safety!=='boolean') return failFields({is_required_safety:'필수 안전 여부를 확인해주세요.'})
        return agreementMutation(env,request,`criterion-create:${app.id}`,body,async DB=>{
          const evidence=await loadCriteriaEvidence(DB,app.id)
          if(!evidence) return jsonError('그런 신청서가 없습니다.',404)
          if(body.expectedVersion!==evidence.sourceVersion) return agreementConflict()
          const ord=Math.max(0,...evidence.criteria.map(row=>Number(row.ord)))+1
          const id=newId('acc'),safety=body.is_required_safety??preset?.safetyDefault??false
          await DB.prepare(`INSERT INTO acceptance_criterion
            (id,application_id,ord,body,from_requirement_id,check_kind,check_key,is_required_safety)
            VALUES(?,?,?,?,?,?,?,?)`).bind(id,app.id,ord,text,t(body.from_requirement_id)||null,preset?.kind??'human',preset?.key??null,safety?1:0).run()
          await logDecision({DB},{applicationId:app.id,stage:'협의안',title:'합격 기준을 추가했다',what:text,
            why:'부서가 확인할 기준을 기록한다.',alternatives:JSON.stringify({before:evidence.sourceVersion,criterion:{id,body:text,check_key:preset?.key??null,is_required_safety:safety}}),linkKind:'criterion',linkId:id})
          return jsonResponse({ok:true,id,ord},201)
        })
      }

      case 'shadow_run': {
        const seconds = Number(body.total_seconds)
        const errorCount = body.error_count == null || body.error_count === '' ? 0 : Number(body.error_count)
        if (!['number','string'].includes(typeof body.total_seconds) || !Number.isFinite(seconds) || Math.round(seconds) <= 0 || seconds > 2147483647) {
          return failFields({ total_seconds: '잰 시간이 없습니다.' })
        }
        if ((body.error_count != null && body.error_count !== '' && !['number','string'].includes(typeof body.error_count)) || !Number.isSafeInteger(errorCount) || errorCount < 0 || errorCount > 2147483647) return failFields({error_count:'오류 수는 0 이상의 정수로 적어주세요.'})
        return agreementMutation(env, request, `baseline-measurement:${app.id}`, body, async DB => {
        // 세 번을 넘겨도 막지 않는다. 더 재면 기준선이 더 단단해진다.
        const seq =
          ((
            await DB.prepare(
              'SELECT MAX(seq) AS n FROM shadow_run WHERE application_id = ?'
            )
              .bind(app.id)
              .first()
          )?.n ?? 0) + 1
        const id = newId('shd')
        await DB.prepare(
          `INSERT INTO shadow_run (id, application_id, seq, total_seconds, error_count, step_timings_json, note)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
          .bind(
            id,
            app.id,
            seq,
            Math.round(seconds),
            errorCount,
            body.steps ? JSON.stringify(body.steps) : null,
            t(body.note) || null
          )
          .run()
        return jsonResponse({ ok: true, id, seq }, 201)
        })
      }

      case 'baseline': {
        const checked = validateBaselineInputs(body, app, HOURLY_WAGE_KRW)
        if (!checked.ok) return failFields(checked.errors)
        return agreementMutation(env, request, `baseline:${app.id}`, body, async DB => {
        const currentApp=await findApplication({...env,DB},app.id)
        if(!currentApp) return jsonError('그런 신청서가 없습니다.',404)
        const sourceRuns=(await DB.prepare('SELECT * FROM shadow_run WHERE application_id=? ORDER BY seq,id').bind(app.id).all()).results
        const previousBaseline=await DB.prepare('SELECT * FROM baseline WHERE application_id=?').bind(app.id).first()
        if(body.expectedVersion!==await baselineSourceVersion(currentApp,sourceRuns,previousBaseline)) return agreementConflict()
        // Share the confirmation/tool-run commit lock and recheck the complete
        // prior evidence so a baseline cannot change inside an attestation.
        await loadOutcomeEvidence(DB, app.id)
        const { results: runs } = await DB.prepare(
          'SELECT total_seconds, error_count FROM shadow_run WHERE application_id = ? ORDER BY total_seconds'
        )
          .bind(app.id)
          .all()

        if (runs.length < 3) {
          return jsonError(
            `기준선을 봉인하려면 최소 세 번은 재야 합니다. 지금 ${runs.length}번 쟀습니다.`,
            400
          )
        }

        const times = runs.map((r) => r.total_seconds)
        const median =
          times.length % 2 === 1
            ? times[(times.length - 1) / 2]
            : (times[times.length / 2 - 1] + times[times.length / 2]) / 2

        await DB.prepare(
          `INSERT INTO baseline
             (application_id, median_seconds, min_seconds, max_seconds, sample_n, error_rate,
              people, frequency, hourly_wage_krw, sealed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
           ON CONFLICT(application_id) DO UPDATE SET
             median_seconds = excluded.median_seconds,
             min_seconds = excluded.min_seconds,
             max_seconds = excluded.max_seconds,
             sample_n = excluded.sample_n,
             error_rate = excluded.error_rate,
             people = excluded.people,
             frequency = excluded.frequency,
             hourly_wage_krw = excluded.hourly_wage_krw,
             sealed_at = datetime('now')`
        )
          .bind(
            app.id,
            median,
            times[0],
            times[times.length - 1],
            times.length,
            runs.filter((r) => r.error_count > 0).length / runs.length,
            // 신청서에 적힌 값을 기본으로 봉인한다.
            //
            // 처음에는 `Number(body.people) || 1`이었다. 그런데 봉인 화면에
            // 인원 칸이 없어서 화면이 people을 한 번도 안 보냈고, 결국
            // **몇 명이 하던 일이든 전부 1명으로 봉인됐다.** 신청서에 세
            // 명이라고 적혀 있어도 8단계 계산식이 "90분 × 1명 × 12회"로
            // 뜨고, 아낀 시간과 금액이 3분의 1로 나왔다. 아무 오류도 안 떴다.
            //
            // 주기도 같았다. 늘 null이라 성과 화면의
            // `baseline?.frequency ?? app.current_frequency` 앞가지가
            // 죽은 코드였다.
            checked.value.people,
            t(body.frequency) || app.current_frequency || null,
            checked.value.wage
          )
          .run()

        await logDecision({ DB }, {
          applicationId: app.id,
          stage: '협의안',
          title: '기준선을 봉인했다',
          what: `${times.length}번 재서 중앙값 ${Math.round(median / 60)}분으로 봉인했다. (가장 빠를 때 ${Math.round(times[0] / 60)}분, 가장 느릴 때 ${Math.round(times[times.length - 1] / 60)}분)`,
          why: '신청서에 적힌 값은 신청자의 체감이라 근거가 되지 못한다. 나중에 반드시 "그 시간은 어떻게 아셨어요"라는 질문을 받는데, 만들고 나서 기억으로 적은 숫자로는 답할 수 없다.',
          alternatives:
            '지난 몇 주를 회상해 적게 하는 안. 회상 편향이 크고 바쁜 주가 과대 대표된다.',
          linkKind: 'baseline',
          linkId: app.id,
        })

        return jsonResponse({ ok: true, median_seconds: median, sample_n: times.length })
        })
      }

      default:
        return jsonError('무엇을 추가할지 알 수 없습니다.', 400)
    }
  } catch (error) {
    return failUnexpected(error, '저장하지 못했습니다.', 500)
  }
}

// 요구 판단, 충돌 판정, 합격 기준 확정.
export async function onRequestPatch({ env, data: requestData, params, request }) {
  env = requestData?.requestEnv ?? env
  const app = await findApplication(env, params.id)
  if (!app) return jsonError('그런 신청서가 없습니다.', 404)

  let body
  try {
    body = await request.json()
  } catch {
    return jsonError('요청 형식이 올바르지 않습니다.', 400)
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) return jsonError('요청 형식이 올바르지 않습니다.',400)

  const t = (v) => String(v ?? '').trim()

  try {
    if (body.kind === 'requirement') {
      if (!REQUIREMENT_STATUSES.includes(t(body.status))) {
        return failFields({ status: '채택·수정채택·기각 중에서 골라주세요.' })
      }

      // 기각하려면 왜인지를 받는다.
      //
      // 지금까지는 비워 둬도 저장됐고, 기록에는 `(사유 미기재)`가 그대로
      // 남았다. 그런데 부서 화면은 그걸 **"사유 없이 기각한 요구"**라고
      // 담당자가 그 부서에 진 빚으로 세고 있다. 어길 수 있게 열어 두고
      // 어긴 것을 세는 셈이다.
      //
      // 요구를 낸 것은 회의에서 부서 사람이 입으로 말한 것이다. 그걸
      // 이유 없이 접으면 그 사람은 다음 회의에서 아무 말도 안 한다.
      if (t(body.status) === '기각' && t(body.reject_reason).length < MIN_REJECT_REASON) {
        return failFields({
          reject_reason: '왜 기각하시는지 적어주세요. 회의에서 나온 말을 이유 없이 접으면 그 부서는 다음부터 말하지 않습니다.',
        })
      }
      await env.DB.prepare(
        `UPDATE requirement
         SET status = ?, decided_body = ?, reject_reason = ?, decided_at = datetime('now')
         WHERE id = ? AND application_id = ?`
      )
        .bind(
          t(body.status),
          t(body.decided_body) || null,
          t(body.reject_reason) || null,
          t(body.id),
          app.id
        )
        .run()

      if (t(body.status) === '기각') {
        await logDecision(env, {
          applicationId: app.id,
          stage: '협의안',
          title: '요구 하나를 기각했다',
          what: t(body.summary) || '요구를 기각했다.',
          // 위에서 막으므로 여기 오는 것은 반드시 사유가 있다.
          why: t(body.reject_reason),
          linkKind: 'requirement',
          linkId: t(body.id),
        }).catch(rethrowDatabaseAccessFailure)
      }
      return jsonResponse({ ok: true })
    }

    if (body.kind === 'conflict') {
      if (!CONFLICT_VERDICTS.includes(t(body.verdict))) {
        return failFields({ verdict: '판정을 골라주세요.' })
      }
      await env.DB.prepare(
        `UPDATE requirement_conflict
         SET verdict = ?, verdict_reason = ?, tradeoff_note = ?, decided_at = datetime('now')
         WHERE id = ? AND application_id = ?`
      )
        .bind(
          t(body.verdict),
          t(body.verdict_reason) || null,
          t(body.tradeoff_note) || null,
          t(body.id),
          app.id
        )
        .run()

      await logDecision(env, {
        applicationId: app.id,
        stage: '협의안',
        title: `충돌을 ${t(body.verdict)}(으)로 판정했다`,
        what: t(body.summary) || '부딪히는 요구 두 개 사이에서 하나를 택했다.',
        why: t(body.verdict_reason) || '(근거 미기재)',
        alternatives: t(body.tradeoff_note) || null,
        linkKind: 'conflict',
        linkId: t(body.id),
      }).catch(rethrowDatabaseAccessFailure)

      return jsonResponse({ ok: true })
    }

    if (body.kind === 'criterion') {
      if(typeof body.confirmed!=='boolean'||typeof body.is_required_safety!=='boolean') return failFields({confirmed:'확정과 필수 안전 여부를 확인해주세요.'})
      return agreementMutation(env,request,`criterion-update:${app.id}`,body,async DB=>{
        const evidence=await loadCriteriaEvidence(DB,app.id)
        const row=evidence?.versioned.find(item=>item.id===t(body.id))
        if(!row) return jsonError('그런 합격 기준이 없습니다.',404)
        if(body.expectedVersion!==row.edit_version) return agreementConflict()
        await DB.prepare(`UPDATE acceptance_criterion SET confirmed_at=CASE WHEN ?<>0 THEN datetime('now') ELSE NULL END,is_required_safety=?
          WHERE id=? AND application_id=?`).bind(body.confirmed?1:0,body.is_required_safety?1:0,row.id,app.id).run()
        await logDecision({DB},{applicationId:app.id,stage:'협의안',title:body.confirmed?'합격 기준을 확정했다':'합격 기준 확정을 해제했다',what:row.body,
          why:'담당자가 확정 여부와 필수 안전 여부를 확인했다.',alternatives:JSON.stringify({before:{confirmed_at:row.confirmed_at,is_required_safety:row.is_required_safety},
            after:{confirmed:body.confirmed,is_required_safety:body.is_required_safety}}),linkKind:'criterion',linkId:row.id})
        return jsonResponse({ok:true})
      })
    }

    if (body.kind === 'meeting') {
      await env.DB.prepare(
        `UPDATE meeting SET title = ?, minutes_text = ?, held_at = ?, status = ?
         WHERE id = ? AND application_id = ?`
      )
        .bind(
          t(body.title) || '회의',
          t(body.minutes_text) || null,
          t(body.held_at) || null,
          t(body.minutes_text) ? '완료' : '준비',
          t(body.id),
          app.id
        )
        .run()
      return jsonResponse({ ok: true })
    }

    return jsonError('무엇을 고칠지 알 수 없습니다.', 400)
  } catch (error) {
    return failUnexpected(error, '고치지 못했습니다.', 500)
  }
}

const TABLE_BY_KIND = {
  stakeholder: 'stakeholder',
  meeting: 'meeting',
  requirement: 'requirement',
  conflict: 'requirement_conflict',
  criterion: 'acceptance_criterion',
  shadow_run: 'shadow_run',
}

export async function onRequestDelete({ env, data: requestData, params, request }) {
  env = requestData?.requestEnv ?? env
  const app = await findApplication(env, params.id)
  if (!app) return jsonError('그런 신청서가 없습니다.', 404)

  let body
  try {
    body = await request.json()
  } catch {
    return jsonError('요청 형식이 올바르지 않습니다.', 400)
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) return jsonError('요청 형식이 올바르지 않습니다.',400)

  const table = TABLE_BY_KIND[body.kind]
  if (!table) return jsonError('무엇을 지울지 알 수 없습니다.', 400)

  if(body.kind==='criterion'||body.kind==='shadow_run') {
    return agreementMutation(env,request,`agreement-delete:${app.id}`,body,async DB=>{
      if(body.kind==='criterion') {
        const evidence=await loadCriteriaEvidence(DB,app.id)
        const row=evidence?.versioned.find(item=>item.id===String(body.id??''))
        if(!row) return jsonError('그런 합격 기준이 없습니다.',404)
        if(body.expectedVersion!==row.edit_version) return agreementConflict()
        const signed=await DB.prepare("SELECT id FROM decision_log WHERE application_id=? AND link_kind='기준서명' LIMIT 1").bind(app.id).first()
        const tested=await DB.prepare('SELECT r.id FROM beta_result r JOIN beta_round b ON b.id=r.round_id WHERE b.application_id=? AND r.criterion_id=? LIMIT 1').bind(app.id,row.id).first()
        if(row.confirmed_at||signed||tested) return jsonError('확정·서명·시험에 사용한 기준은 삭제할 수 없습니다. 확정을 해제하고 변경 근거를 남겨주세요.',409)
        await DB.prepare('DELETE FROM acceptance_criterion WHERE id=? AND application_id=?').bind(row.id,app.id).run()
        await logDecision({DB},{applicationId:app.id,stage:'협의안',title:'미확정 합격 기준을 삭제했다',what:row.body,why:'확정·서명·시험에 사용하지 않은 초안을 정리했다.',linkKind:'criterion',linkId:row.id})
      } else {
        const baseline=await DB.prepare('SELECT * FROM baseline WHERE application_id=?').bind(app.id).first()
        if(baseline) return jsonError('봉인한 기준선의 측정 원본은 삭제할 수 없습니다. 추가 측정 후 기준선을 다시 확인해주세요.',409)
        const row=await DB.prepare('SELECT * FROM shadow_run WHERE id=? AND application_id=?').bind(String(body.id??''),app.id).first()
        if(!row) return jsonError('그런 측정 기록이 없습니다.',404)
        await DB.prepare('DELETE FROM shadow_run WHERE id=? AND application_id=?').bind(row.id,app.id).run()
      }
      return jsonResponse({ok:true})
    })
  }
  try {
    await env.DB.prepare(`DELETE FROM ${table} WHERE id = ? AND application_id = ?`)
      .bind(String(body.id ?? ''), app.id)
      .run()
    return jsonResponse({ ok: true })
  } catch (error) {
    return failUnexpected(error, '지우지 못했습니다.', 500)
  }
}

function safeParse(text, fallback) {
  try {
    return text ? JSON.parse(text) : fallback
  } catch {
    return fallback
  }
}
