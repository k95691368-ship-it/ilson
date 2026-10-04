import { buildRecordPayload } from '../../shared/buildPayload.js'
import { validateBuildRecordSources, encodeBuildTrace, encodeBuildQuarantine } from '../../shared/buildRecordSource.js'
import { atomicMutation, mutationFingerprint } from './atomicMutation.ts'
import { compileSql } from './dbBridge.ts'
import { isTransactionConflict } from './transactionConflict.ts'
import { canUseBusinessRoute } from './authorization.js'
import { logDecision } from './decisions.js'
import { newId } from './ids.js'
import { jsonError, jsonResponse, failUnexpected } from './http.ts'
import type { Database, MutationRead, MutationWrite, MutationReceipt, SqlValue } from './runtimeTypes.ts'

export const BUILD_RUN_LIMITS = Object.freeze({ rowsPerStatement: 500, statements: 1000, sqlBytes: 16 * 1024 * 1024, rpcBytes: 16 * 1024 * 1024 })
const RESERVE = 128 * 1024
const KEY = /^[a-zA-Z0-9_-]{16,100}$/
const ROW_COLUMNS = 'id,run_id,row_no,date,iso_week,sku,sku_name,channel,qty,return_qty,src_currency,fx_rate,gross_krw,discount_krw,return_krw,net_revenue_krw,commission_krw,reported_commission_krw,cogs_krw,logistics_krw,ad_krw,contribution_krw,source_file,source_sheet,source_row_no,trace_json,has_duplicate,duplicate_of'
const QUARANTINE_COLUMNS = 'id,run_id,reason,source_file,source_sheet,source_row_no,external_code,product_name,raw_json,note'
const MONEY = ['gross_krw','discount_krw','return_krw','net_revenue_krw','commission_krw','reported_commission_krw','cogs_krw','logistics_krw','ad_krw','contribution_krw'] as const
const TOTAL_NUMBERS = ['rows','qty','return_qty','gross_krw','net_revenue_krw','commission_krw','reported_commission_krw','contribution_krw'] as const
type Input = Record<string, unknown>
// Vectors are the explicit DB projection in ROW_COLUMNS/QUARANTINE_COLUMNS order,
// excluding generated IDs (and row_no). No arbitrary input object enters a write.
export interface BuildRunCommand {
  filesJson: string; totalsJson: string; rows: SqlValue[][]; quarantine: SqlValue[][]
  duplicateSuspects: number; durationMs: number | null; note: string | null
}
type ScopedDatabase = Database & { actorEmail?: string | null; workspace?: boolean; toolRunScope?: () => Promise<string> }
interface Environment { DB: ScopedDatabase; AUTH_ACTOR?: { mode?: string; email?: string | null }; DEMO_WORKSPACE?: boolean }
interface Actor { email: string; display_name: string; role: string; active: number; departments_json: string; product_ids_json: string; updated_at: string }
interface Application { id: string; owner_email: string | null; dept: string; status: string; updated_at: string }

export class BuildRunCommandError extends Error {
  readonly status: number
  readonly field?: string
  constructor(message: string, status = 400, field?: string) { super(message); this.status = status; this.field = field }
}
function oversized(): never { throw new BuildRunCommandError('결과가 저장 한도를 넘었습니다. 파일이나 결과를 나누어 다시 실행해주세요.', 413) }
const FIELD_LABELS: Record<string, string> = { date: '날짜', iso_week: '주차', sku: '상품코드', channel: '채널', reason: '격리 사유', qty: '수량', return_qty: '반품 수량' }
function invalid(field: string): never {
  const label = FIELD_LABELS[field.split('.').at(-1) ?? '']
  throw new BuildRunCommandError(label ? '제작 결과의 ' + label + ' 형식을 확인해주세요.' : '제작 결과의 형식과 숫자를 확인해주세요.', 400, field)
}
const record = (value: unknown): value is Input => value !== null && typeof value === 'object' && !Array.isArray(value)

function text(value: unknown, field: string, fallback: string | null, required = false): string | null {
  if (value == null) { if (required) invalid(field); return fallback }
  if (typeof value !== 'string' || value.includes('\0') || /[\uD800-\uDFFF]/u.test(value) || (required && value === '')) invalid(field)
  return value
}
function number(value: unknown, field: string, fallback: number | null): number | null {
  if (value == null) return fallback
  // Preserve valid legacy numeric strings and fractional money/FX values.
  // Never coerce booleans/arrays to zero. Stored quantities are checked below.
  const parsed = typeof value === 'number' ? value
    : typeof value === 'string' && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()) ? Number(value) : NaN
  if (!Number.isFinite(parsed) || Math.abs(parsed) > Number.MAX_SAFE_INTEGER) invalid(field)
  return parsed
}
function quantity(value: unknown, field: string, rowIndex: number): number {
  const parsed = number(value, field, 0) ?? 0
  let integralText = true
  if (typeof value === 'string') {
    // Syntax is checked by number(). Inspect the decimal before binary parsing:
    // underflow or long fractions can otherwise become apparent safe integers.
    // Never allocate an exponent-sized string or BigInt.
    const [mantissa, exponent = '0'] = value.trim().toLowerCase().replace(/^[+-]/, '').split('e')
    const fractionLength = mantissa.includes('.') ? mantissa.length - mantissa.indexOf('.') - 1 : 0
    const digits = mantissa.replace('.', '')
    let nonZeroEnd = digits.length
    while (nonZeroEnd > 0 && digits.charCodeAt(nonZeroEnd - 1) === 48) nonZeroEnd -= 1
    integralText = nonZeroEnd === 0 || Number(exponent) >= fractionLength - (digits.length - nonZeroEnd)
  }
  // BIGINT silently rounds fractions. Reject this whole command before staging
  // any writes; do not change the browser's calculation or guess a unit policy.
  if (!Number.isSafeInteger(parsed) || !integralText) {
    const label = FIELD_LABELS[field.split('.').at(-1) ?? '']
    throw new BuildRunCommandError(`제작 결과 ${rowIndex + 1}번째 행의 ${label}이 소수입니다. 현재 저장 형식에서는 정확히 보존할 수 없습니다. 원본 수량과 단위를 확인해주세요.`, 400, field)
  }
  return parsed
}

// Validate known metadata before projection: an invalid nested value must not
// silently disappear and turn incomplete calculation evidence into success.
// This is a shape/finite-number check, not verification against original files.
function validateTotals(value: unknown): void {
  if (value == null) return
  if (!record(value)) invalid('totals')
  const total = (item: unknown, field: string) => {
    if (!record(item)) invalid(field)
    for (const key of TOTAL_NUMBERS) {
      const numeric = number(item[key], field + '.' + key, null)
      if (key === 'rows' && numeric !== null && (!Number.isSafeInteger(numeric) || numeric < 0)) invalid(field + '.rows')
    }
    for (const key of ['channel','iso_week']) text(item[key], field + '.' + key, null)
  }
  if (value.all != null) total(value.all, 'totals.all')
  for (const key of ['byChannel','byChannelWeek']) {
    const values = value[key]
    if (values == null) continue
    if (!Array.isArray(values)) invalid('totals.' + key)
    values.forEach((item, index) => total(item, 'totals.' + key + '.' + index))
  }
}
function validateTrace(value: unknown, field: string): void {
  if (value == null) return
  if (!Array.isArray(value)) invalid(field)
  for (const [index, step] of value.entries()) {
    if (!record(step)) invalid(field + '.' + index)
    for (const key of ['step','value']) {
      const item = step[key], name = field + '.' + index + '.' + key
      if (item == null) continue
      if (typeof item === 'number') number(item, name, null)
      else if (typeof item === 'string') text(item, name, null)
      else if (typeof item !== 'boolean') invalid(name)
    }
  }
}

// JSON UTF-8 size without first allocating the escaped JSON string. Lone
// surrogates and NUL are rejected even inside otherwise valid metadata.
function stringBytes(value: string, mode: 'json' | 'sql' = 'json'): number {
  let bytes = 0
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i)
    if (c === 0) invalid('text')
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = value.charCodeAt(++i)
      if (!(next >= 0xdc00 && next <= 0xdfff)) invalid('text')
      bytes += 4
    } else if (c >= 0xdc00 && c <= 0xdfff) invalid('text')
    else if (c === 92) bytes += mode === 'sql' ? 4 : 2
    else if (c === 39 && mode === 'sql') bytes += 2
    else if (c === 34) bytes += 2
    else if ([8,9,10,12,13].includes(c)) bytes += 2
    else if (c < 32) bytes += 6
    else bytes += c < 128 ? 1 : c < 2048 ? 2 : 3
    if (bytes > BUILD_RUN_LIMITS.rpcBytes) oversized()
  }
  return bytes
}
function jsonBytes(value: unknown): number {
  if (value === null) return 4
  if (typeof value === 'string') return stringBytes(value) + 2
  if (typeof value === 'boolean') return value ? 4 : 5
  if (typeof value === 'number') { if (!Number.isFinite(value)) invalid('number'); return String(value).length }
  if (Array.isArray(value)) {
    let bytes = 2
    for (const [i, item] of value.entries()) { bytes += (i ? 1 : 0) + jsonBytes(item); if (bytes > BUILD_RUN_LIMITS.rpcBytes) oversized() }
    return bytes
  }
  if (record(value)) {
    let bytes = 2, count = 0
    for (const [key, item] of Object.entries(value)) {
      bytes += (count++ ? 1 : 0) + jsonBytes(key) + 1 + jsonBytes(item)
      if (bytes > BUILD_RUN_LIMITS.rpcBytes) oversized()
    }
    return bytes
  }
  return invalid('metadata')
}
function json(value: unknown): string { jsonBytes(value); return JSON.stringify(value) }
function literalBytes(value: SqlValue): number {
  if (typeof value === 'string') return stringBytes(value, 'sql') + 3 // E'...'
  if (value === null) return 4
  if (typeof value === 'boolean') return 1
  return String(value).length
}

export function normalizeBuildRunCommand(body: unknown): BuildRunCommand {
  if (!record(body) || body.kind !== 'run') invalid('body')
  const rawRows = body.rows ?? [], rawQuarantine = body.quarantine ?? []
  if (!Array.isArray(rawRows) || !Array.isArray(rawQuarantine)) invalid('rows')
  const statements = Math.ceil(rawRows.length / BUILD_RUN_LIMITS.rowsPerStatement) + Math.ceil(rawQuarantine.length / BUILD_RUN_LIMITS.rowsPerStatement) + 3
  if (statements > BUILD_RUN_LIMITS.statements) oversized()
  if (!rawRows.length && !rawQuarantine.length) throw new BuildRunCommandError('저장할 결과가 없습니다.')
  try { validateBuildRecordSources(body) }
  catch { throw new BuildRunCommandError('파일 출처 정보의 형식이나 지문이 올바르지 않습니다.', 400, 'files') }
  validateTotals(body.totals)

  const metadata = buildRecordPayload({ files: body.files, totals: body.totals })
  const filesJson = json(metadata.files), totalsJson = json(metadata.totals)
  // Bound encoded SQL data incrementally before accumulating all vectors.
  // Statement syntax/generated IDs have a conservative allowance; the exact
  // compiled envelope is independently checked immediately before commit.
  let budget = RESERVE + literalBytes(filesJson) + literalBytes(totalsJson) + statements * 1024
  const add = (values: SqlValue[]) => {
    for (const value of values) { budget += literalBytes(value) + 1; if (budget > BUILD_RUN_LIMITS.rpcBytes) oversized() }
    budget += 128
  }
  const rows: SqlValue[][] = []
  for (const [i, raw] of rawRows.entries()) {
    if (!record(raw)) invalid('rows')
    const prefix = 'rows.' + i + '.', projected = buildRecordPayload({ rows: [raw] }).rows[0]
    // Known trace fields remain scalar metadata. Raw cells/unknown keys have
    // already been excluded by the shared projection; preserve order and text.
    validateTrace(raw.trace, prefix + 'trace')
    jsonBytes(projected.trace)
    jsonBytes(projected.source)
    if (projected.duplicate_of) jsonBytes(projected.duplicate_of)
    const trace = encodeBuildTrace(projected.trace, projected.source, projected.duplicate_of)
    const money = MONEY.map(field => number(raw[field], prefix + field, field === 'reported_commission_krw' ? null : 0))
    const duplicate = raw.has_duplicate
    if (duplicate != null && ![false,true,0,1].includes(duplicate as boolean | number)) invalid(prefix + 'has_duplicate')
    const source = projected.source
    const values: SqlValue[] = [
      text(raw.date, prefix + 'date', null, true), text(raw.iso_week, prefix + 'iso_week', null, true),
      text(raw.sku, prefix + 'sku', null, true), text(raw.sku_name, prefix + 'sku_name', null),
      text(raw.channel, prefix + 'channel', null, true), quantity(raw.qty, prefix + 'qty', i), quantity(raw.return_qty, prefix + 'return_qty', i),
      text(raw.src_currency, prefix + 'src_currency', 'KRW'), number(raw.fx_rate, prefix + 'fx_rate', 1), ...money,
      text(source.file, prefix + 'source.file', ''), text(source.sheet, prefix + 'source.sheet', null), source.rowNo ?? 0,
      trace, duplicate ? 1 : 0, projected.duplicate_of ? projected.duplicate_of.file + ':' + projected.duplicate_of.rowNo : null,
    ]
    add(values); rows.push(values)
  }
  const quarantine: SqlValue[][] = []
  for (const [i, raw] of rawQuarantine.entries()) {
    if (!record(raw)) invalid('quarantine')
    const prefix = 'quarantine.' + i + '.', projected = buildRecordPayload({ quarantine: [raw] }).quarantine[0], source = projected.source
    const values: SqlValue[] = [text(raw.reason, prefix + 'reason', null, true),
      text(source.file, prefix + 'source.file', ''), text(source.sheet, prefix + 'source.sheet', null), source.rowNo ?? 0,
      text(raw.externalCode, prefix + 'externalCode', null), text(raw.productName, prefix + 'productName', null),
      encodeBuildQuarantine(source), text(raw.note, prefix + 'note', null)]
    add(values); quarantine.push(values)
  }
  const duplicateSuspects = number(body.duplicate_suspects, 'duplicate_suspects', 0)!
  const duration = number(body.duration_ms, 'duration_ms', null)
  if (!Number.isSafeInteger(duplicateSuspects) || duplicateSuspects < 0 || (duration !== null && duration < 0)) invalid('counts')
  const note = text(body.note, 'note', null)?.trim() || null // established top-level note behavior
  add([note])
  return { filesJson, totalsJson, rows, quarantine, duplicateSuspects, durationMs: duration || null, note }
}

// Exact compiled statement bytes plus conservative workspace function-prefix
// overhead (including matches in literals) are counted one statement at a time.
export function assertBuildRunCommitBudget(requestId: string, fingerprint: string, reads: readonly MutationRead[], writes: readonly MutationWrite[], response: MutationReceipt, actorEmail: string | null): void {
  if (writes.length > BUILD_RUN_LIMITS.statements || reads.length > 100) oversized()
  let sqlBytes = 0
  let bytes = jsonBytes({ p_actor: actorEmail, p_token: 'x'.repeat(64), p_request_id: requestId, p_fingerprint: fingerprint, p_reads: [], p_writes: [], p_response: response })
  const compiled = (sql: string, binds: readonly SqlValue[] = []) => {
    const value = compileSql(sql, binds)
    const overhead = (value.match(/\b(?:datetime|julianday|group_concat)\s*\(/gi)?.length ?? 0) * 7
    // utf8 <= JSON encoded size: counting JSON size for the SQL cap is conservative.
    const encoded = jsonBytes(value) + overhead
    sqlBytes += encoded
    if (sqlBytes > BUILD_RUN_LIMITS.sqlBytes) oversized()
    return { value, encoded }
  }
  for (const read of reads) {
    const result = compiled(read.sql, read.binds)
    bytes += jsonBytes({ sql: '', rows: read.rows }) - 2 + result.encoded + 1
    if (bytes > BUILD_RUN_LIMITS.rpcBytes) oversized()
  }
  for (const write of writes) {
    bytes += compiled(write.sql, write.binds).encoded + 1
    if (bytes > BUILD_RUN_LIMITS.rpcBytes) oversized()
  }
}
const conflict = () => jsonResponse({ code: 'BUILD_RUN_CONFLICT', error: '같은 실행의 내용·업무 상태·권한이 변경되었습니다. 저장 기록을 확인한 뒤 같은 결과로 다시 시도해주세요.' }, 409)

export async function saveBuildRun(env: Environment, applicationId: string, body: unknown, headerKey: string | null): Promise<Response> {
  try {
    if (!record(body)) invalid('body')
    const requestId = body.run_id ?? headerKey
    if (typeof requestId !== 'string' || !KEY.test(requestId)) return jsonError('제작 실행의 중복 방지 번호가 필요합니다.', 400)
    const command = normalizeBuildRunCommand(body)
    const commit = env.DB?.commitMutation
    if (typeof commit !== 'function' || typeof env.DB?.mutationReceipt !== 'function') throw new Error('Atomic build run storage unavailable')
    const actorEmail = env.AUTH_ACTOR?.email
    if (env.AUTH_ACTOR?.mode === 'access') {
      if (!actorEmail || env.DB.actorEmail !== actorEmail || env.DB.workspace !== false) return jsonError('인증된 사내 계정이 필요합니다.', 401)
    } else if (env.AUTH_ACTOR || env.DEMO_WORKSPACE !== true || env.DB.workspace !== true) return jsonError('개인 체험 공간의 데이터 접근 설정이 필요합니다.', 503)
    if (body.run_scope !== undefined) {
      if (typeof body.run_scope !== 'string' || !body.run_scope || typeof env.DB.toolRunScope !== 'function'
        || body.run_scope !== await env.DB.toolRunScope()) return conflict()
    }
    const fingerprint = await mutationFingerprint({ kind: 'build-run', applicationId, command })
    const database: Database = { ...env.DB, commitMutation: async (key, hash, reads, writes, response) => {
      assertBuildRunCommitBudget(key, hash, reads, writes, response, actorEmail ?? null)
      return commit(key, hash, reads, writes, response)
    } }
    return await atomicMutation(database, requestId, fingerprint, async DB => {
      if (actorEmail) {
        const actor = await DB.prepare('SELECT email,display_name,role,active,departments_json,product_ids_json,updated_at FROM override_actor WHERE email=?').bind(actorEmail).first<Actor>()
        if (!actor || Number(actor.active) !== 1) return jsonError('현재 계정의 접근 권한을 확인할 수 없습니다.', 401)
        if (!canUseBusinessRoute(actor, '/api/applications/' + encodeURIComponent(applicationId) + '/build', 'POST')) return jsonError('현재 계정에는 이 작업 권한이 없습니다.', 403)
      }
      const app = await DB.prepare('SELECT id,owner_email,dept,status,updated_at FROM application WHERE id=?').bind(applicationId).first<Application>()
      if (!app) return jsonError('그런 신청서가 없습니다.', 404)
      const current = await DB.prepare('SELECT MAX(seq) AS n FROM build_run WHERE application_id = ?').bind(app.id).first<{ n: number | null }>()
      const seq = Number(current?.n ?? 0) + 1
      if (!Number.isSafeInteger(seq) || seq <= 0) throw new Error('Invalid next build sequence')
      const runId = newId('run')
      await DB.prepare("INSERT INTO build_run(id,application_id,seq,files_json,rows_out,quarantined,duplicate_suspects,duration_ms,totals_json,ran_where,note) VALUES(?,?,?,?,?,?,?,?,?,'browser',?)")
        .bind(runId, app.id, seq, command.filesJson, command.rows.length, command.quarantine.length, command.duplicateSuspects, command.durationMs, command.totalsJson, command.note).run()
      for (const [table, columns, rows, prefix] of [
        ['build_row', ROW_COLUMNS, command.rows, 'brw'], ['build_quarantine', QUARANTINE_COLUMNS, command.quarantine, 'bqr'],
      ] as const) {
        for (let i = 0; i < rows.length; i += BUILD_RUN_LIMITS.rowsPerStatement) {
          const values = rows.slice(i, i + BUILD_RUN_LIMITS.rowsPerStatement).map((row, j) => [newId(prefix), runId, ...(table === 'build_row' ? [i + j + 1] : []), ...row])
          const sql = 'INSERT INTO ' + table + '(' + columns + ') VALUES ' + values.map(row => '(' + row.map(() => '?').join(',') + ')').join(',')
          await DB.prepare(sql).bind(...values.flat()).run()
        }
      }
      if (seq === 1) await logDecision({ DB }, { applicationId: app.id, stage: '제작', title: '첫 제작 결과를 기록했습니다',
        what: command.rows.length + '줄이 나왔고 ' + command.quarantine.length + '줄은 검토함으로 뺐다.',
        why: '합계 줄과 모르는 상품코드를 조용히 버리면 합계가 조용히 틀린다. 버리지 않고 사람이 보게 한다.',
        linkKind: 'build_run', linkId: runId })
      await DB.prepare("UPDATE application SET status = '진행중', updated_at = datetime('now') WHERE id = ? AND status = '수용'").bind(app.id).run()
      return jsonResponse({ ok: true, run_id: runId, seq }, 201)
    })
  } catch (error) {
    if (error instanceof BuildRunCommandError) return jsonResponse({ error: error.message,
      ...(error.status === 413 ? { code: 'BUILD_RUN_TOO_LARGE' } : {}),
      ...(error.field ? { fields: { [error.field]: error.message } } : {}) }, error.status)
    if (isTransactionConflict(error) || (error instanceof Error && /\/23505(?:\)|$)/.test(error.message))) return conflict()
    // There is no compensating DELETE: a failed commit is atomic, whereas a
    // transport failure may hide a successful receipt. Retry the original intent.
    return failUnexpected(error, '제작 기록의 저장 여부를 확인하지 못했습니다. 다시 계산하지 말고 같은 결과로 저장해주세요.')
  }
}
