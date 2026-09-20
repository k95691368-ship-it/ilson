import { jsonError } from './http.js'
import { scopedActorDb } from './dataScope.js'

export const isAccessAdmin = actor => ['audit', 'executive'].includes(actor?.role)
const operators = ['operations', 'product', 'ml', 'engineer', 'policy', 'audit', 'executive']
const reviewers = ['operations', 'product', 'policy', 'audit', 'executive']
const builders = ['product', 'ml', 'engineer', 'audit', 'executive']

// This is an action boundary; row-level access is independently enforced by the DB.
// Unknown write routes are denied until their intended actors are explicitly listed.
export function canUseBusinessRoute(actor, path, method) {
  if (!actor) return false
  if (path.startsWith('/api/demo/')) return false
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return true
  if (path === '/api/override' || path === '/api/feedback' || path === '/api/override/assist') return method === 'POST'
  if (path === '/api/applications') return method === 'POST'
  if (path === '/api/applications/similar') return method === 'POST'
  if (/^\/api\/track\/[^/]+\/(ask|answer|resubmit|signoff|outcome|hold|beta)$/.test(path)) return method === 'POST'
  if (/^\/api\/tools\/[^/]+\/(report|accept|unclear)$/.test(path)) return method === 'POST'
  if (/^\/api\/tools\/[^/]+$/.test(path)) return method === 'POST'
  if (/^\/api\/tools\/[^/]+\/teach$/.test(path)) return method === 'POST' && operators.includes(actor.role)
  if (path === '/api/compare') return ['POST', 'DELETE'].includes(method) && reviewers.includes(actor.role)
  if (path === '/api/applications/bulk') return method === 'POST' && reviewers.includes(actor.role)
  if (/^\/api\/applications\/[^/]+\/owner$/.test(path)) return method === 'POST' && isAccessAdmin(actor)
  if (/^\/api\/applications\/[^/]+\/(review|ask|reply|agreement|signoff|join)$/.test(path)) return ['POST', 'PATCH', 'DELETE'].includes(method) && reviewers.includes(actor.role)
  if (/^\/api\/applications\/[^/]+\/journey$/.test(path)) return method === 'POST' && operators.includes(actor.role)
  if (/^\/api\/applications\/[^/]+\/(build|beta|outcome)$/.test(path)) return method === 'POST' && builders.includes(actor.role)
  if (path === '/api/bugs') return method === 'POST'
  if (['/api/reports', '/api/codes', '/api/priority'].includes(path)) return method === 'POST' && operators.includes(actor.role)
  return false
}

export function scopeEnvironment(env, actor) {
  if (actor?.mode === 'demo') return env
  return { ...env, AUTH_ACTOR: actor, UNSCOPED_DB: env.UNSCOPED_DB ?? env.DB, DB: scopedActorDb(env.DB, actor) }
}

// Attribution is server-owned in real mode. A form cannot impersonate its approver.
export async function verifiedAttribution(request, actor) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return request
  // Only the application upload route accepts forms and stamps its own fields.
  // Legacy JSON handlers parse JSON even without a matching Content-Type, so
  // attribution must not be bypassable by supplying text/plain or no header.
  const path = new URL(request.url).pathname.replace(/\/$/, '')
  const contentType = request.headers.get('Content-Type')?.toLowerCase() ?? ''
  if (path === '/api/applications' && request.method === 'POST' && (contentType.startsWith('multipart/form-data') || contentType.startsWith('application/x-www-form-urlencoded'))) return request
  let body
  try { body = await request.json() } catch { return jsonError('요청 형식이 올바르지 않습니다.', 400) }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return jsonError('요청 형식이 올바르지 않습니다.', 400)
  for (const field of ['by', 'author', 'reviewer_label', 'reviewerLabel', 'actorLabel', 'taught_by', 'reporter']) body[field] = actor.label
  const headers = new Headers(request.headers)
  headers.delete('Content-Length')
  headers.set('Content-Type', 'application/json')
  return new Request(request.url, { method: request.method, headers, body: JSON.stringify(body), signal: request.signal })
}
