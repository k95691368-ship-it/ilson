import { databaseAccessFailure } from './dbBridge.ts'

// Independent reads may fail for different reasons. A fast transient failure
// must not hide a scoped access failure already being checked by another read.
// Observe every started read (each RPC retains its own timeout), then select a
// verified revocation, verified denial, or the first ordinary failure in input
// order. Arbitrary message/code/status properties never establish access scope.
// This is a read coordinator, not a transaction or a write rollback mechanism.
export function allScopedReads<T extends readonly unknown[] | []>(reads: T): Promise<{ -readonly [P in keyof T]: Awaited<T[P]> }>
export async function allScopedReads(reads: readonly unknown[]): Promise<unknown[]> {
  const settled = await Promise.allSettled(reads)
  let revoked: PromiseRejectedResult | undefined
  let denied: PromiseRejectedResult | undefined
  let ordinary: PromiseRejectedResult | undefined
  for (const result of settled) {
    if (result.status !== 'rejected') continue
    const access = databaseAccessFailure(result.reason)
    if (access?.status === 401) revoked ??= result
    else if (access?.status === 403) denied ??= result
    else ordinary ??= result
  }
  const failure = revoked ?? denied ?? ordinary
  if (failure) throw failure.reason
  // Return only the settled values. Resolving the inputs a second time would
  // invoke a custom thenable again and could repeat its underlying read.
  return settled.map(result => {
    if (result.status === 'rejected') throw result.reason
    return result.value
  })
}
