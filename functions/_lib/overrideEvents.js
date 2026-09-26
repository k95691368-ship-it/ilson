import { DECISION_ACTIONS, safeJson } from '../../shared/override.js'
import { withOverrideEditVersion } from './overrideEditVersion.js'

const PAGE_SIZE = 100
function demand(condition, message, status = 400) {
  if (!condition) { const error = new Error(message); error.status = status; throw error }
}
export function hydrateEvent(row) {
  return { ...row, changed_fields: safeJson(row.changed_fields_json, []), policy_refs: safeJson(row.policy_refs_json, []),
    data_refs: safeJson(row.data_refs_json, []), tools: safeJson(row.tools_json, []) }
}
function cursorFrom(value) {
  if (!value) return null
  try {
    demand(value.length <= 1000 && /^[A-Za-z0-9+/]+={0,2}$/.test(value), '사건 페이지 주소를 확인해주세요.')
    const cursor = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(value), c => c.charCodeAt(0))))
    demand(Array.isArray(cursor) && cursor.length === 2 && typeof cursor[0] === 'string' && cursor[0].length <= 40 && Number.isFinite(Date.parse(cursor[0]))
      && typeof cursor[1] === 'string' && cursor[1].length > 0 && cursor[1].length <= 100, '사건 페이지 주소를 확인해주세요.')
    return cursor
  } catch { demand(false, '사건 페이지 주소를 확인해주세요.') }
}
const encodeCursor = row => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify([row.occurred_at, row.id]))))

export async function readOverrideEvents(db, params) {
  const conditions = [], values = []
  for (const [name, column] of [['productId', 'product_id'], ['clusterId', 'cluster_id'], ['eventId', 'id']]) {
    const value = params.get(name)
    if (!value) continue
    demand(value.length <= 100 && value.trim() === value && [...value].every(character => character.charCodeAt(0) >= 32), '조회할 사건·제품·문제 번호를 확인해주세요.')
    conditions.push(`e.${column}=?`); values.push(value)
  }
  for (const [name, column, allowed] of [['action', 'decision_action', DECISION_ACTIONS.map(item => item.key)], ['validity', 'validity', ['pending', 'valid', 'invalid', 'uncertain']]]) {
    const value = params.get(name)
    if (!value) continue
    demand(allowed.includes(value), '사건 검색 조건을 확인해주세요.')
    conditions.push(`e.${column}=?`); values.push(value)
  }
  const query = (params.get('q') ?? '').trim()
  demand(query.length <= 200, '검색어는 200자 이내로 입력해주세요.')
  if (query) {
    conditions.push("strpos(lower(concat_ws(' ',e.id,e.ai_decision,e.human_decision,e.reason_detail,e.external_ref,p.name)),lower(?))>0")
    values.push(query)
  }
  const cursor = cursorFrom(params.get('cursor'))
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const pageConditions = [...conditions, ...(cursor ? ['(e.occurred_at<? OR (e.occurred_at=? AND e.id<?))'] : [])]
  const pageValues = [...values, ...(cursor ? [cursor[0], cursor[0], cursor[1]] : [])]
  const [count, result] = await db.batch([
    db.prepare(`SELECT count(*) AS n FROM override_event e JOIN override_product p ON p.id=e.product_id ${where}`).bind(...values),
    db.prepare(`SELECT e.*,p.name AS product_name FROM override_event e JOIN override_product p ON p.id=e.product_id
      ${pageConditions.length ? `WHERE ${pageConditions.join(' AND ')}` : ''} ORDER BY e.occurred_at DESC,e.id DESC LIMIT ${PAGE_SIZE + 1}`).bind(...pageValues),
  ])
  const total = Number(count.results[0]?.n ?? 0), rows = result.results.slice(0, PAGE_SIZE), hasMore = result.results.length > PAGE_SIZE
  if (params.get('eventId')) demand(total > 0, '이 판단 사건을 찾을 수 없습니다.', 404)
  return { events: await Promise.all(rows.map(async row => hydrateEvent(await withOverrideEditVersion('event', row)))), page: { limit: PAGE_SIZE, total, hasMore, nextCursor: hasMore ? encodeCursor(rows.at(-1)) : null } }
}
