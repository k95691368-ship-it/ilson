import { allScopedReads } from '../../functions/_lib/allScopedReads.ts'
import type { Database, DatabaseResult } from '../../functions/_lib/runtimeTypes.ts'

// Compile-only: a coordinator must not erase each query's projection or turn
// a readonly input tuple into an unordered union array.
export async function checkScopedReadContracts(db: Database) {
  const statement = db.prepare('SELECT id FROM example')
  const reads = [statement.first<{ id: string }>(), statement.all<{ id: string }>(), 7] as const
  const result: [{ id: string } | null, DatabaseResult<{ id: string }>, 7] = await allScopedReads(reads)
  const empty: [] = await allScopedReads([])
  const dynamic: DatabaseResult[] = await allScopedReads([statement.all(), statement.all()])
  return { result, empty, dynamic }
}
