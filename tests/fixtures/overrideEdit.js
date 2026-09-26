import { overrideEditVersion } from '../../functions/_lib/overrideEditVersion.js'

// Existing business-flow tests model a fresh read before each action. Tests of
// stale forms keep their originally-read token explicitly instead of this helper.
export async function viewedOverrideBody(DB, body) {
  if (!body || Object.hasOwn(body, 'expectedVersion')) return body
  const kinds = { update_cluster:'cluster', create_experiment:'cluster', validate_event:'event', approve_experiment:'experiment', record_run:'experiment', decide_experiment:'experiment', save_integration:'integration', save_actor:'actor', record_volume:'volume' }
  const tables = { cluster:'issue_cluster', event:'override_event', experiment:'change_experiment', integration:'override_integration', actor:'override_actor', volume:'override_volume' }
  const kind = kinds[body.action]
  if (!kind) return body
  let row
  if (kind === 'volume') row = await DB.prepare('SELECT * FROM override_volume WHERE product_id=? AND measured_on=? AND segment=?').bind(body.productId,body.measuredOn,body.segment || '전체').first()
  else {
    const id = kind === 'actor' ? body.email?.trim().toLowerCase() : body[`${kind}Id`]
    if (!id) return body
    row = await DB.prepare(`SELECT * FROM ${tables[kind]} WHERE ${kind === 'actor' ? 'email' : 'id'}=?`).bind(id).first()
  }
  return row ? { ...body, expectedVersion:await overrideEditVersion(kind, row) } : body
}

export function viewedOverrideRequests() {
  const snapshots = new Map()
  return async (DB, body, requestId) => {
    const key = requestId ? requestId + ':' + JSON.stringify(body) : null
    if (key && snapshots.has(key)) return snapshots.get(key)
    const viewed = await viewedOverrideBody(DB, body)
    if (key) snapshots.set(key, viewed)
    return viewed
  }
}
