// A UI lifetime, not an authentication credential. The server remains the
// authority; a new lifetime opens only after its protected session probe.
let snapshot = Object.freeze({ generation: 0, status: 'unverified', scope: null, mode: null, error: '' })
const listeners = new Set()

export const getAccessSession = () => snapshot
export function subscribeAccessSession(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
export const accessBlocked = state => ['checking', 'blocked'].includes(state.status)

function publish(next) {
  snapshot = Object.freeze(next)
  // A prefetched response may belong to the previous account/workspace.
  if (typeof window !== 'undefined') delete window.__boot
  for (const listener of listeners) listener()
}

export function beginAccessCheck() {
  publish({ ...snapshot, generation: snapshot.generation + 1, status: 'checking', scope: null, error: '' })
  return snapshot.generation
}

export function completeAccessCheck(generation, result) {
  if (snapshot.generation !== generation || snapshot.status !== 'checking') return false
  if (result?.ok !== true || !['access', 'demo'].includes(result.mode) || typeof result.scope !== 'string' || !/^[a-f0-9]{64}$/.test(result.scope)) return false
  publish({ generation, status: 'active', scope: result.scope, mode: result.mode, error: '' })
  return true
}

export function failAccessCheck(generation, error = '') {
  if (snapshot.generation !== generation || snapshot.status !== 'checking') return false
  publish({ ...snapshot, status: 'blocked', scope: null, error })
  return true
}

export function revokeAccess(generation, error = '접근 권한을 다시 확인해 주세요.') {
  if (snapshot.generation !== generation || accessBlocked(snapshot)) return false
  publish({ ...snapshot, generation: generation + 1, status: 'blocked', scope: null, error })
  return true
}
