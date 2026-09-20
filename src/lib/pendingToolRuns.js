// Tab-memory only: never persist file contents or credentials to browser storage.
// Server-supplied opaque scope separates accounts and private demo workspaces.
const records = new Map()
const listeners = new Set()
const notify = () => { for (const listener of listeners) listener() }
const warnBeforeClosing = event => { event.preventDefault(); event.returnValue = '' }
const keyFor = (scope, slug) => scope ? `${scope}:${slug}` : null

export function pendingToolRun(scope, slug) {
  return records.get(keyFor(scope, slug)) ?? null
}
export function subscribeToolRuns(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
export function keepToolRun(scope, slug, record) {
  const key = keyFor(scope, slug)
  if (!key || record.payload.run_scope && record.payload.run_scope !== scope) return
  const existing = records.get(key)
  if (existing && existing.payload.run_id !== record.payload.run_id) return
  records.set(key, record)
  window.addEventListener('beforeunload', warnBeforeClosing)
  notify()
}
export function forgetToolRun(scope, slug, runId) {
  const key = keyFor(scope, slug)
  if (runId && records.get(key)?.payload.run_id !== runId) return
  const changed = records.delete(key)
  if (records.size === 0) window.removeEventListener('beforeunload', warnBeforeClosing)
  if (changed) notify()
}
