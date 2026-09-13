// Reads are checked again under a database lock; writes and the audit trail commit together.
// Handlers must not read their own staged writes. Derived updates belong in SQL.
export async function atomicMutation(db, requestId, fingerprint, action, { commitError = false } = {}) {
  if (!db.mutationReceipt || !db.commitMutation) throw new Error('Atomic mutation migration is required')
  const prior = await db.mutationReceipt(requestId, fingerprint)
  if (prior) return Response.json(prior.body, { status: prior.status, headers: {'X-Idempotency-Replayed':'1'} })
  const reads = [], writes = []
  const prepare = (sql, binds = []) => {
    const stmt = {
      bind: (...values) => prepare(sql, values),
      all: async () => {
        if (!/^\s*(SELECT|WITH)\b/i.test(sql)) throw new Error('Use run() for atomic writes')
        const result = await db.prepare(sql).bind(...binds).all()
        reads.push({ sql, binds, rows: result.results })
        return result
      },
      first: async column => {
        const result = await stmt.all()
        return column === undefined ? result.results[0] ?? null : result.results[0]?.[column] ?? null
      },
      run: async () => {
        writes.push({ sql, binds })
        return { success: true, results: [], meta: { changes: 1 } }
      },
    }
    return stmt
  }
  const staged = { ...db, prepare, batch: statements => Promise.all(statements.map(statement => statement.run())) }
  const response = await action(staged)
  if (!response.ok && !commitError) return response
  const result = { status: response.status, body: await response.json() }
  const committed = await db.commitMutation(requestId, fingerprint, reads, writes, result)
  return Response.json(committed.response.body, { status: committed.response.status, headers: {'X-Idempotency-Replayed':committed.replayed ? '1' : '0'} })
}

export async function mutationFingerprint(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)))
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('')
}
