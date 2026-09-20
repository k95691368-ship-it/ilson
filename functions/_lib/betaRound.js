// Validate the transport shape only. Current criteria and permissions are checked
// again inside the database transaction; a client cannot declare its own gate.
const verdicts = new Set(['통과', '실패', '판정불가', '사람확인'])
const isText = (value, max) => typeof value === 'string' && value.length <= max

export function betaRoundPayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || !Number.isSafeInteger(body.criteria_revision) || body.criteria_revision < 0
    || !Array.isArray(body.graded) || body.graded.length < 1 || body.graded.length > 500) return null
  const seen = new Set()
  const graded = []
  for (const row of body.graded) {
    if (!row || typeof row !== 'object' || Array.isArray(row)
      || !isText(row.id, 100) || !row.id || seen.has(row.id)
      || !isText(row.body, 10000) || !row.body
      || !Number.isSafeInteger(row.ord) || row.ord < 0
      || !['rule', 'human'].includes(row.kind)
      || !(row.check_key == null || isText(row.check_key, 100))
      || ![true, false, 0, 1].includes(row.is_required_safety)
      || !verdicts.has(row.verdict)
      || !(row.evidence == null || isText(row.evidence, 10000))
      || !(row.samples == null || Array.isArray(row.samples) && row.samples.length <= 100)) return null
    seen.add(row.id)
    graded.push({ id: row.id, ord: row.ord, body: row.body, kind: row.kind,
      check_key: row.check_key ?? null, is_required_safety: row.is_required_safety === true || row.is_required_safety === 1,
      verdict: row.verdict, evidence: row.evidence ?? null, samples: row.samples ?? [] })
  }
  const duration = body.summary?.durationMs ?? null
  if (!(duration === null || Number.isSafeInteger(duration) && duration >= 0 && duration <= 2147483647)
    || !(body.build_run_id == null || isText(body.build_run_id, 100))
    || !(body.fixed_what == null || isText(body.fixed_what, 10000))
    || !(body.note == null || isText(body.note, 10000))) return null
  return { criteria_revision: body.criteria_revision, graded,
    build_run_id: body.build_run_id || null, duration_ms: duration,
    claimed: ['통과', '조건부', '차단'].includes(body.summary?.overall) ? body.summary.overall : null,
    fixed_what: body.fixed_what?.trim() || null, note: body.note?.trim() || null }
}
