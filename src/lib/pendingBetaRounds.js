// Keep only the submitted judgement, never the uploaded source files. This queue
// lives in the tab, is separated by the server's account/workspace scope, and is
// intentionally not persisted in localStorage or sessionStorage.
const rounds = new Map()
const listeners = new Set()
const notify = () => { for (const listener of listeners) listener() }
const keyFor = (scope, applicationId) => scope ? `${scope}:${applicationId}` : null
const warnBeforeClosing = event => { event.preventDefault(); event.returnValue = '' }

export function pendingBetaRound(scope, applicationId) {
  return rounds.get(keyFor(scope, applicationId)) ?? null
}

export function subscribeBetaRounds(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function keepBetaRound(scope, applicationId, record) {
  const key = keyFor(scope, applicationId)
  if (!key || record.payload.run_scope && record.payload.run_scope !== scope) return
  const existing = rounds.get(key)
  if (existing && existing.payload.run_id !== record.payload.run_id) return
  rounds.set(key, record)
  window.addEventListener('beforeunload', warnBeforeClosing)
  notify()
}

export function forgetBetaRound(scope, applicationId, runId) {
  const key = keyFor(scope, applicationId)
  if (runId && rounds.get(key)?.payload.run_id !== runId) return
  const changed = rounds.delete(key)
  if (rounds.size === 0) window.removeEventListener('beforeunload', warnBeforeClosing)
  if (changed) notify()
}
