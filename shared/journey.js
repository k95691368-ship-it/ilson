// The same records drive the dossier and journey; no second outcome calculation.
export function buildJourney(record, operations) {
  const entries = []
  const add = (kind, id, at, title, detail, href) => entries.push({ key: `${kind}:${id}`, kind, at: at || null, title, detail: detail || '', href })
  const app = record.application
  const recordUrl = `/record/${encodeURIComponent(app.id)}`
  add('신청', app.id, app.created_at, app.title, app.problem, recordUrl)
  const loggedReviews = (record.decisions || []).filter(row => row.stage === '검토')
  for (const row of record.decisions || []) add(row.stage === '검토' ? '검토' : '결정 기록', row.id, row.created_at, row.title, [row.what, row.why].filter(Boolean).join(' · '), recordUrl)
  if (record.review && !loggedReviews.length) add('검토', app.id, record.review.updated_at || record.review.decided_at, `현재 검토 상태 · ${record.review.verdict}`, `이전 결정 이력 없음 · ${record.review.verdict_reason || ''}`, recordUrl)
  for (const row of record.meetings || []) add('협의', row.id, row.held_at || row.created_at, row.title, row.minutes_text, recordUrl)
  for (const row of record.criteria || []) add('합격 기준', row.id, row.confirmed_at || row.created_at, row.confirmed_at ? '합격 기준 확정' : '합격 기준 초안', row.body, recordUrl)
  for (const row of record.builds || []) add('제작', row.id, row.created_at, `${row.seq}차 제작 실행`, `결과 ${row.rows_out}행 · 격리 ${row.quarantined}행`, recordUrl)
  for (const row of record.betaRounds || []) add('베타', row.id, row.created_at, `${row.seq}차 베타 테스트`, row.status, recordUrl)
  if (record.handover) add('인계', app.id, record.handover.handed_at, record.handover.title || '도구 인계', record.handover.note, `/t/${encodeURIComponent(record.handover.slug)}`)
  for (const row of record.uses || []) add('도구 사용', row.id, row.used_at, '현장 도구 사용', row.note, recordUrl)
  if (record.outcome) add('성과', app.id, record.outcome.computed_at, '성과 측정', record.moneyLabel ? [record.moneyLabel.label, record.moneyLabel.note].filter(Boolean).join(' · ') : '기록 문서에서 측정 근거를 확인해 주세요.', recordUrl)
  for (const row of operations.products || []) add('운영 연결', row.id, row.linked_at, row.name, `${row.owner_team} · ${row.status}`, '/override#overview')
  for (const row of operations.linkHistory || []) add('연결 이력', row.id, row.created_at, row.action === 'unlink_product' ? '운영 제품 연결 해제' : '운영 제품 연결', row.detail?.product_name || row.detail?.product_id, recordUrl)
  for (const row of operations.events || []) add('판단 사건', row.id, row.occurred_at, row.human_decision, row.reason_detail, '/override#events')
  for (const row of operations.experiments || []) add('개선 실험', row.id, row.created_at, row.title, row.hypothesis, '/override#experiments')
  for (const row of operations.runs || []) add('실험 결과', row.id, row.created_at, `${row.phase} · ${row.status}`, `표본 ${row.sample_size}건 · 가드레일 위반 ${row.guardrail_breaches}건`, '/override#experiments')
  for (const row of operations.decisions || []) add('운영 결정', row.id, row.created_at, row.decision, row.basis, '/override#experiments')
  const timestamp = value => {
    if (!value) return 0
    const normalized = value.replace(' ', 'T')
    return Date.parse(/(?:Z|[+-]\d\d:\d\d)$/.test(normalized) ? normalized : `${normalized}Z`) || 0
  }
  return entries.sort((a, b) => timestamp(a.at) - timestamp(b.at) || a.key.localeCompare(b.key))
}
