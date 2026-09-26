// The subset of the existing Supabase SQL bridge used by migrated handlers.
// These types describe trusted database rows; they do not validate HTTP input.
export type SqlValue = string | number | bigint | boolean | null
export type SqlRow = Record<string, unknown>

export interface DatabaseResult<Row extends object = SqlRow> {
  success: true
  results: Row[]
  meta: {
    changes: number
    // Atomic staged writes have not reached the database yet and omit this.
    row_count?: number
    last_row_id?: number
  }
}

export interface MutationReceipt {
  status: number
  body: unknown
}

export interface CommittedMutation {
  response: MutationReceipt
  replayed: boolean
}

export interface MutationRead {
  sql: string
  binds?: readonly SqlValue[]
  rows: readonly unknown[]
}

export interface MutationWrite {
  sql: string
  binds?: readonly SqlValue[]
}

export interface PreparedStatement {
  bind(...values: SqlValue[]): PreparedStatement
  // Generic row/column types are declarations about a trusted SQL projection,
  // not validation of arbitrary HTTP input or JSON supplied by a browser.
  first<Row extends object = SqlRow>(): Promise<Row | null>
  first<Value = unknown>(column: string): Promise<Value | null>
  all<Row extends object = SqlRow>(): Promise<DatabaseResult<Row>>
  run<Row extends object = SqlRow>(): Promise<DatabaseResult<Row>>
}

export interface Database {
  prepare(sql: string): PreparedStatement
  batch(statements: readonly PreparedStatement[]): Promise<DatabaseResult[]>
  mutationReceipt?(requestId: string, fingerprint: string): Promise<MutationReceipt | null>
  commitMutation?(requestId: string, fingerprint: string, reads: readonly MutationRead[], writes: readonly MutationWrite[], response: MutationReceipt): Promise<CommittedMutation>
}

export interface DatabaseEnvironment {
  DB: Database
}

export interface ApplicationContext {
  env: DatabaseEnvironment
  data?: { requestEnv?: DatabaseEnvironment }
  params: { id: string }
  request: Request
}
