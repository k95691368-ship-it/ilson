// Reads are checked again under a database lock; writes and the audit trail commit together.
// Handlers must not read their own staged writes. Derived updates belong in SQL.
import type { Database, MutationRead, MutationWrite, PreparedStatement, SqlRow, SqlValue } from './runtimeTypes.ts'

export type MutationAction = (db: Database) => Promise<Response>
export type MutationOptions = { commitError?: boolean }

export async function atomicMutation(db: Database, requestId: string, fingerprint: string, action: MutationAction, { commitError = false }: MutationOptions = {}): Promise<Response> {
  if (!db.mutationReceipt || !db.commitMutation) throw new Error('Atomic mutation migration is required')
  const prior = await db.mutationReceipt(requestId, fingerprint)
  if (prior) return Response.json(prior.body, { status: prior.status, headers: {'X-Idempotency-Replayed':'1'} })
  const reads: MutationRead[] = [], writes: MutationWrite[] = []
  const prepare = (sql: string, binds: SqlValue[] = []): PreparedStatement => {
    // Generic rows/columns retain the database bridge's schema assertion
    // boundary. Runtime reads still pass through that bridge and are replayed
    // under the commit lock; TypeScript must not replace that comparison.
    function first<Row extends object = SqlRow>(): Promise<Row | null>
    function first<Value = unknown>(column: string): Promise<Value | null>
    async function first(column?: string): Promise<unknown> {
      const result = await stmt.all()
      return column === undefined ? result.results[0] ?? null : result.results[0]?.[column] ?? null
    }
    const stmt: PreparedStatement = {
      bind: (...values: SqlValue[]) => prepare(sql, values),
      all: async <Row extends object = SqlRow>() => {
        if (!/^\s*(SELECT|WITH)\b/i.test(sql)) throw new Error('Use run() for atomic writes')
        const result = await db.prepare(sql).bind(...binds).all<Row>()
        reads.push({ sql, binds, rows: result.results })
        return result
      },
      first,
      run: async () => {
        writes.push({ sql, binds })
        return { success: true, results: [], meta: { changes: 1 } }
      },
    }
    return stmt
  }
  const staged: Database = { ...db, prepare, batch: statements => Promise.all(statements.map(statement => statement.run())) }
  const response = await action(staged)
  if (!response.ok && !commitError) return response
  const body: unknown = await response.json()
  const result = { status: response.status, body }
  const committed = await db.commitMutation(requestId, fingerprint, reads, writes, result)
  return Response.json(committed.response.body, { status: committed.response.status, headers: {'X-Idempotency-Replayed':committed.replayed ? '1' : '0'} })
}

export async function mutationFingerprint(value: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)))
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('')
}
