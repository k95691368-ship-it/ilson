import { newId } from './ids.js'

function reject(message, status = 409) {
  const error = new Error(message)
  error.status = status
  error.publicStatus = status
  throw error
}

export async function assertClusterClosable(DB, clusterId, status) {
  if (!['resolved', 'accepted_exception'].includes(status)) return
  const pending = await DB.prepare("SELECT id FROM issue_followup WHERE cluster_id=? AND status='open' ORDER BY id LIMIT 1")
    .bind(clusterId).first()
  if (pending) reject('미해결 후속 과제가 남아 있습니다. 처리 근거를 남긴 뒤 문제를 종료해주세요.')
}

// The original decision and its evidence stay unchanged. A follow-up is a new,
// source-linked task, not a retrospective rewrite of the employee's decision.
export async function createIssueFollowup(DB, actor, { sourceKind, sourceId, event, reason, evidenceRefs = '' }) {
  const prior = await DB.prepare('SELECT id,cluster_id FROM issue_followup WHERE source_kind=? AND source_id=?')
    .bind(sourceKind, sourceId).first()
  if (prior) return prior
  const product = await DB.prepare('SELECT id,domain,owner_team FROM override_product WHERE id=?').bind(event.product_id).first()
  if (!product) reject('원본 사건의 제품을 찾을 수 없습니다.', 404)
  let clusterId = event.cluster_id
  const cluster = clusterId ? await DB.prepare('SELECT id,status FROM issue_cluster WHERE id=?').bind(clusterId).first() : null
  if (!cluster) {
    clusterId = newId('olc')
    const title = `${sourceKind === 'quality_sample' ? '승인 표본 오류' : '현장 재검토'} · ${reason}`.slice(0, 160)
    await DB.prepare(`INSERT INTO issue_cluster
      (id,title,summary,sample_text,cause_code,cause_status,cause_candidates_json,policy_refs_json,affected_workflow,owner_team,status,scope_product_id,created_by_email)
      VALUES(?,?,?,?,'unknown','candidate','[]',?,?,?,'open',?,?)`)
      .bind(clusterId, title, reason, `${event.ai_decision}\n${event.human_decision}`, event.policy_refs_json || '[]', product.domain, product.owner_team, product.id, actor.email || null).run()
  } else {
    // A reopened task needs a fresh acknowledgment; ongoing work retains its
    // current acknowledgment, owner and response date.
    await DB.prepare(`UPDATE issue_cluster SET acknowledged_at=CASE WHEN status IN ('resolved','accepted_exception') THEN NULL ELSE acknowledged_at END,
      status=CASE WHEN status IN ('resolved','accepted_exception') THEN 'open' ELSE status END,
      updated_at=datetime('now') WHERE id=?`).bind(clusterId).run()
  }
  const id = newId('ifu')
  await DB.prepare(`INSERT INTO issue_followup
    (id,cluster_id,source_kind,source_id,product_id,event_id,reason,evidence_refs,created_by)
    VALUES(?,?,?,?,?,?,?,?,?)`)
    .bind(id, clusterId, sourceKind, sourceId, event.product_id, event.id, reason, evidenceRefs, actor.label).run()
  return { id, cluster_id: clusterId }
}
