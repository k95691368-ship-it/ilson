// The subset of the existing Supabase SQL bridge used by migrated handlers.
// These types describe trusted database rows; they do not validate HTTP input.
export type SqlValue = string | number | boolean | null

export interface PreparedStatement {
  bind(...values: SqlValue[]): PreparedStatement
  first<Row extends object = Record<string, unknown>>(): Promise<Row | null>
  all<Row extends object = Record<string, unknown>>(): Promise<{ results: Row[] }>
  run(): Promise<unknown>
}

export interface Database {
  prepare(sql: string): PreparedStatement
  batch(statements: PreparedStatement[]): Promise<unknown>
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
