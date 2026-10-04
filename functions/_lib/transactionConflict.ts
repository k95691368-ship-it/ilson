// dbBridge includes the SQLSTATE in a /CODE) suffix. Only serialization
// failures and deadlocks are retryable edit conflicts; access failures must
// reach failUnexpected so its trusted, scope-bound access brand is preserved.
export function isTransactionConflict(error: unknown): boolean {
  const message = error !== null && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
    ? error.message
    : ''
  return /\/(?:40001|40P01)(?:\)|$)/.test(message)
}
