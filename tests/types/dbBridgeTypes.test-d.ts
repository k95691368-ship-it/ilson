import type { SupabaseDatabase } from '../../functions/_lib/dbBridge.ts'
import type {
  CommittedMutation, Database, DatabaseResult, MutationReceipt, PreparedStatement, SqlRow, SqlValue,
} from '../../functions/_lib/runtimeTypes.ts'

type Assert<Condition extends true> = Condition
type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2) ? true : false

export type BigintBindingsSupported = Assert<Equal<Extract<SqlValue, bigint>, bigint>>
export type ObjectBindingsRejected = Assert<Equal<Extract<SqlValue, object>, never>>
export type DefaultRowsAreUnknownFields = Assert<Equal<SqlRow[string], unknown>>
export type StagedRowCountIsOptional = Assert<Equal<DatabaseResult['meta']['row_count'], number | undefined>>
export type ReceiptBodyIsUntrusted = Assert<Equal<MutationReceipt['body'], unknown>>
export type ReplayFlagIsBoolean = Assert<Equal<CommittedMutation['replayed'], boolean>>
export type LegacyAtomicSupportRemainsOptional = Assert<Equal<undefined extends Database['commitMutation'] ? true : false, true>>
export type SupabaseAtomicSupportIsRequired = Assert<Equal<undefined extends SupabaseDatabase['commitMutation'] ? true : false, false>>
export type UnmigratedRpcStaysUnknown = Assert<Equal<Awaited<ReturnType<SupabaseDatabase['recordToolRun']>>, unknown>>
export type BindingValuesMatchSql = Assert<Equal<Parameters<PreparedStatement['bind']>[number], SqlValue>>

// Compile-only examples exercise the overloads without emitting or running SQL.
export async function checkProjectionContracts(db: Database) {
  const statement = db.prepare('SELECT id,total FROM example').bind(9007199254740993n)
  const row: { id: string; total: number } | null = await statement.first<{ id: string; total: number }>()
  const column: number | null = await statement.first<number>('total')
  const unknownColumn: unknown = await statement.first('total')
  const rows: { id: string }[] = (await statement.all<{ id: string }>()).results
  const run: DatabaseResult<{ id: string }> = await statement.run<{ id: string }>()
  return { row, column, unknownColumn, rows, run }
}
