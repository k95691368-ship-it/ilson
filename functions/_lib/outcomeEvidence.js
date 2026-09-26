import { mutationFingerprint, atomicMutation } from './atomicMutation.ts'
import { computeOutcome, annualize, buildChallenges, daysSince, labelForOutcome } from '../../shared/outcome.js'
import { OUTCOME_KIND, OUTCOME_PROXY_KIND } from '../../shared/accept.js'
import { jsonError, failUnexpected } from './http.ts'

export const OUTCOME_RESOLUTION_KIND = '성과검증해소'
export const OUTCOME_INPUT_KIND = '성과산정변경'
const kinds = [OUTCOME_KIND, OUTCOME_PROXY_KIND, OUTCOME_RESOLUTION_KIND, OUTCOME_INPUT_KIND]
const numeric = value => value == null ? null : Number(value)
const pick = (row, fields) => row ? Object.fromEntries(fields.map(key => [key, row[key] ?? null])) : null
function metadata(row) {
  try { return JSON.parse(row?.alternatives) ?? {} } catch { return {} }
}
const latest = rows => rows.at(-1) ?? null

export function outcomeConflict() {
  return jsonError('성과의 계산 근거나 확인 기록이 변경되었습니다. 작성한 내용은 유지됩니다. 최신 수치를 확인한 뒤 다시 저장해주세요.', 409)
}

export async function outcomeMutation(DB, request, identity, body, action) {
  const requestId = request.headers.get('X-Idempotency-Key') || crypto.randomUUID()
  if (!/^[a-zA-Z0-9_-]{16,100}$/.test(requestId)) return jsonError('중복 방지 요청 번호가 올바르지 않습니다.', 400)
  try {
    return await atomicMutation(DB, requestId, await mutationFingerprint({ identity, body }), action)
  } catch (error) {
    if (/\/28000/.test(error.message)) return jsonError('계정 권한이 변경되었습니다. 작성한 내용은 유지됩니다. 다시 접속하여 권한을 확인해주세요.', 409)
    if (/\/(40001|40P01)/.test(error.message)) return outcomeConflict()
    return failUnexpected(error, '성과 기록을 저장하지 못했습니다.')
  }
}

export async function loadOutcomeEvidenceMany(DB, applicationIds, { detail = false } = {}) {
  const ids = [...new Set(applicationIds.filter(Boolean))]
  if (!ids.length) return new Map()
  const holes = ids.map(() => '?').join(',')
  const queries = [
    `SELECT * FROM baseline WHERE application_id IN (${holes}) ORDER BY application_id`,
    `SELECT application_id,COUNT(*) AS count,
      SUM(CASE WHEN ok=1 THEN 1 ELSE 0 END) AS "successCount",SUM(CASE WHEN ok=0 THEN 1 ELSE 0 END) AS "failedCount",
      SUM(COALESCE(duration_ms,0)::double precision/1000 ORDER BY used_at,id) AS "autoSeconds",
      SUM(COALESCE(human_review_seconds,0) ORDER BY used_at,id) AS "reviewSeconds",
      SUM(COALESCE(rework_seconds,0) ORDER BY used_at,id) AS "reworkSeconds",
      (array_agg(quarantined ORDER BY used_at DESC,id DESC))[1] AS "quarantineLeft",
      encode(sha256(convert_to(string_agg(encode(sha256(convert_to(jsonb_build_array(id,used_at,duration_ms,human_review_seconds,rework_seconds,rows_out,quarantined,ok)::text,'UTF8')),'hex'),'' ORDER BY used_at,id),'UTF8')),'hex') AS digest
      FROM tool_use WHERE application_id IN (${holes}) GROUP BY application_id ORDER BY application_id`,
    `SELECT * FROM outcome WHERE application_id IN (${holes}) ORDER BY application_id`,
    `SELECT id,application_id,title,what,alternatives,link_kind,link_id,created_at FROM decision_log WHERE application_id IN (${holes}) AND link_kind IN (${kinds.map(() => '?').join(',')}) ORDER BY application_id,created_at,id`,
    `SELECT * FROM outcome_challenge WHERE application_id IN (${holes}) ORDER BY application_id,rule_code`,
  ]
  if(detail) queries.push(`SELECT id,application_id,used_at,duration_ms,human_review_seconds,rework_seconds,rows_out,quarantined,ok FROM tool_use WHERE application_id IN (${holes}) ORDER BY application_id,used_at,id`)
  const results = await Promise.all(queries.map((sql, index) => DB.prepare(sql).bind(...ids, ...(index === 3 ? kinds : [])).all()))
  const grouped = results.map(result => {
    const group = new Map(ids.map(id => [id, []]))
    for (const row of result.results) group.get(row.application_id)?.push(row)
    return group
  })
  const entries = []
  for(const id of ids) entries.push([id, await assessOutcomeEvidence({
    baseline: grouped[0].get(id)[0] ?? null, uses: detail ? grouped[5].get(id) : [], saved: grouped[2].get(id)[0] ?? null,
    runSummary: grouped[1].get(id)[0] ?? {count:0,successCount:0,failedCount:0,autoSeconds:0,reviewSeconds:0,reworkSeconds:0,quarantineLeft:0,digest:null},
    records: grouped[3].get(id), resolutions: grouped[4].get(id),
  })])
  return new Map(entries)
}

export async function loadOutcomeEvidence(DB, applicationId, options) {
  return (await loadOutcomeEvidenceMany(DB, [applicationId], options)).get(applicationId)
}

export async function assessOutcomeEvidence({ baseline = null, uses = [], saved = null, records = [], resolutions = [], runSummary = null }) {
  const inputs = { dev_hours: numeric(saved?.dev_hours) ?? 0, ops_cost_krw: numeric(saved?.ops_cost_krw) ?? 0, amortize_months: numeric(saved?.amortize_months) ?? 24 }
  const snapshot = {
    baseline: pick(baseline, ['median_seconds', 'min_seconds', 'max_seconds', 'sample_n', 'people', 'frequency', 'hourly_wage_krw', 'sealed_at', 'error_rate']),
    runs: runSummary ? { digest:runSummary.digest } : uses.map(run => pick(run, ['id', 'used_at', 'duration_ms', 'human_review_seconds', 'rework_seconds', 'rows_out', 'quarantined', 'ok'])),
    inputs,
  }
  const coreFingerprint = await mutationFingerprint(snapshot)
  const parsed = new Map(records.map(record => [record.id, metadata(record)]))
  const proofOf = record => parsed.get(record?.id)?.outcomeEvidence
  const matching = record => proofOf(record)?.version === 1 && proofOf(record)?.fingerprint === coreFingerprint
  const confirmations = records.filter(row => [OUTCOME_KIND, OUTCOME_PROXY_KIND].includes(row.link_kind))
  // A new declaration supersedes an old one even within the same second. The
  // append-only metadata chain orders our records without changing legacy rows.
  const terminal = rows => {
    const superseded = new Set(rows.map(row => proofOf(row)?.supersedes).filter(Boolean))
    return latest(rows.filter(row => !superseded.has(row.id))) ?? latest(rows)
  }
  const lastConfirmation = terminal(confirmations)
  const confirmationById = new Map(confirmations.map(row => [row.id, row]))
  const inConfirmationOrder = predicate => {
    const visited = new Set()
    let record = lastConfirmation
    while (record && !visited.has(record.id)) {
      if (predicate(record)) return record
      visited.add(record.id)
      record = confirmationById.get(proofOf(record)?.supersedes)
    }
    return latest(confirmations.filter(predicate))
  }
  const recent = inConfirmationOrder(matching)
  const previous = recent ?? terminal(confirmations) ?? (saved?.dept_confirmed_at ? { title: saved.dept_confirmed_by, what: saved.dept_comment, created_at: saved.dept_confirmed_at } : null)
  const current = Boolean(recent)
  const confirmation = {
    current, kind: recent?.link_kind ?? null, by: recent?.title ?? null, at: recent?.created_at ?? null,
    comment: recent?.what ?? null, recordId: recent?.id ?? null,
    previous: previous ? { by: previous.title, at: previous.created_at, comment: previous.what, kind: previous.link_kind ?? null } : null,
    legacy: Boolean(previous && !proofOf(previous)),
  }
  const currentSaved = saved ? { ...saved, dept_confirmed_at: confirmation.at, dept_confirmed_by: confirmation.by, dept_comment: confirmation.comment } : null
  const direct = inConfirmationOrder(row => row.link_kind === OUTCOME_KIND && matching(row))
  const deptFelt = direct ? parsed.get(direct.id).felt ?? null : null
  const outcome = computeOutcome({ baseline, runs: uses, runTotals:runSummary, devHours: inputs.dev_hours, opsCostKrw: inputs.ops_cost_krw, amortizeMonths: inputs.amortize_months })
  const context = { outcome, quarantineLeft: runSummary?.quarantineLeft ?? uses.at(-1)?.quarantined ?? 0, deptConfirmed: current, baselineAgeDays: daysSince(baseline?.sealed_at), deptFelt }
  const shouldHave = outcome.status === '산정불가' ? [] : buildChallenges(context)
  const challenges = await Promise.all(shouldHave.map(async challenge => {
    const fingerprint = await mutationFingerprint({ coreFingerprint, code: challenge.code,
      ...(challenge.code === 'dept_disagrees' ? { declaration: direct?.id ?? null, deptFelt } : {}),
      ...(challenge.code === 'no_dept_confirm' ? { confirmed: current } : {}),
      ...(challenge.code === 'baseline_stale' ? { stale: context.baselineAgeDays > 90 } : {}),
    })
    const logs = records.filter(row => row.link_kind === OUTCOME_RESOLUTION_KIND && row.link_id === challenge.code)
    const proof = terminal(logs.filter(row => proofOf(row)?.version === 1 && proofOf(row)?.fingerprint === fingerprint))
    const old = terminal(logs) ?? resolutions.find(row => row.rule_code === challenge.code)
    return { ...challenge, fingerprint, id: proof?.id ?? null, resolved_at: proof?.created_at ?? null,
      resolution: proof?.what ?? null, previousResolution: proof ? null : old?.what ?? old?.resolution ?? null,
      previousResolvedAt: proof ? null : old?.resolved_at ?? old?.created_at ?? null }
  }))
  const resolvedCodes = challenges.filter(row => row.resolved_at).map(row => row.code)
  const unresolvedCount = challenges.length - resolvedCodes.length
  const mutationToken = await mutationFingerprint({ coreFingerprint, nextBottleneck: saved?.next_bottleneck ?? null,
    records: records.map(row => ({ id: row.id, kind: row.link_kind, alternatives: row.alternatives })) })
  return { baseline, uses, saved, currentSaved, snapshot, coreFingerprint, mutationToken, confirmation, deptFelt, runSummary,
    directConfirmed:Boolean(direct),
    previousConfirmationId: terminal(confirmations)?.id ?? null,
    outcome, annual: annualize(outcome, baseline?.frequency, { devKrw: outcome.devKrw ?? 0, opsCostKrw: inputs.ops_cost_krw }),
    challenges, resolvedCodes, unresolvedCount, label: labelForOutcome(outcome, unresolvedCount),
    canConfirm: Boolean(baseline) && (runSummary?.count ?? uses.length) > 0,
  }
}

export function evidenceMetadata(evidence, { fingerprint = evidence.coreFingerprint, supersedes = evidence.previousConfirmationId, ...extra } = {}) {
  // No original settlement file or rows are stored in the audit proof. The
  // fingerprint binds the complete source set; the summary explains the amounts.
  return JSON.stringify({ ...extra, outcomeEvidence: { version: 1, fingerprint, supersedes: supersedes ?? null,
    summary: { baseline: evidence.snapshot.baseline, inputs: evidence.snapshot.inputs,
      attempts: evidence.runSummary?.count ?? evidence.uses.length, success: evidence.outcome.successCount ?? 0,
      savedSeconds: evidence.outcome.savedSeconds ?? null, netKrw: evidence.outcome.netKrw ?? null } } })
}
