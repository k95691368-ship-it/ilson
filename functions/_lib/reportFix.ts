// Existing report correction, with no new schema or authority policy. The
// expected original is a state-equality check, not proof of its whole history.
import { atomicMutation, mutationFingerprint } from './atomicMutation.ts'
import { canUseBusinessRoute } from './authorization.js'
import { logDecision } from './decisions.js'
import { sha256Hex } from './ids.js'
import { jsonError, jsonResponse, failUnexpected } from './http.ts'
import { isTransactionConflict } from './transactionConflict.ts'
import { REPORT_KIND, REPORT_FIX } from '../../shared/report.js'
import type { Database, SqlRow } from './runtimeTypes.ts'

export const REPORT_SOURCE_FIELDS = Object.freeze([
  'id', 'application_id', 'stage', 'actor', 'title', 'what', 'why',
  'alternatives', 'unrequested', 'link_kind', 'link_id', 'created_at',
] as const)
export const REPORT_SOURCE_COLUMNS = REPORT_SOURCE_FIELDS.join(',')
export const REPORT_FIX_ACTOR_SQL = 'SELECT email,display_name,role,active,departments_json,product_ids_json,updated_at FROM override_actor WHERE email=?'
export const REPORT_FIX_APPLICATION_SQL = 'SELECT id,owner_email,dept,updated_at FROM application WHERE id=?'
export const REPORT_FIX_EXISTING_SQL = 'SELECT id FROM decision_log WHERE application_id=? AND link_kind=? AND link_id=? ORDER BY created_at DESC,id DESC LIMIT 1'

export interface ReportFixCommand {
  reportId: string
  expectedVersion: string
  how: string
  why: string
  // Real attribution is read from the current actor and is not semantic input.
  demoAuthor: string | null
}
export type ReportFixCommandResult =
  | { ok: true; value: ReportFixCommand }
  | { ok: false; fields: Record<string, string> }

const record = (value: unknown): value is SqlRow => value !== null && typeof value === 'object' && !Array.isArray(value)
const storable = (value: string): boolean => !value.includes('\0') && !/[\uD800-\uDFFF]/u.test(value)
const VERSION = /^[a-f0-9]{64}$/
const KEY = /^[a-zA-Z0-9_-]{16,100}$/

export function normalizeReportFixCommand(body: unknown, accountMode: boolean): ReportFixCommandResult {
  if (!record(body)) return { ok: false, fields: { body: '요청 형식이 올바르지 않습니다.' } }
  const input = body
  const fields: Record<string, string> = {}
  function text(field: string, max: number, min = 1, optional = false): string {
    const raw = input[field]
    if (optional && (raw === undefined || raw === null)) return ''
    if (typeof raw !== 'string') {
      fields[field] = '문자로 입력해주세요.'
      return ''
    }
    const value = raw.trim()
    if (!storable(value)) fields[field] = '저장할 수 없는 문자가 포함되어 있습니다.'
    else if (value.length > max) fields[field] = `${max}자 이내로 입력해주세요.`
    else if (value.length < min) fields[field] = field === 'reportId' ? '어느 신고를 처리하셨는지 골라주세요.' : '5자 이상으로 구체적으로 적어주세요.'
    return value
  }
  const reportId = text('reportId', 100)
  // A digest is opaque: do not trim, change case, or guess a missing version.
  const expectedVersion = typeof body.expectedVersion === 'string' ? body.expectedVersion : ''
  if (!VERSION.test(expectedVersion)) fields.expectedVersion = '최신 신고 내용을 다시 확인해주세요.'
  const how = text('how', 2000, 5)
  const why = text('why', 2000, 5)
  // Completely ignore client author in real mode, including invalid type and
  // length. Neither current display name nor caller input changes a retry key.
  const demoAuthor = accountMode ? null : text('author', 60, 0, true) || 'AX 담당자'
  if (Object.keys(fields).length) return { ok: false, fields }
  return { ok: true, value: { reportId, expectedVersion, how, why, demoAuthor } }
}

export async function reportSourceVersion(row: unknown): Promise<string> {
  if (!record(row) || REPORT_SOURCE_FIELDS.some(field => !Object.hasOwn(row, field))) throw Error('Report original projection unavailable')
  for (const field of ['id', 'application_id', 'stage', 'actor', 'title', 'what', 'why', 'created_at'] as const) {
    if (typeof row[field] !== 'string' || !storable(row[field] as string)) throw Error('Invalid report original text')
  }
  if (!row.id || !row.application_id || !row.created_at || row.link_kind !== REPORT_KIND
    || (row.alternatives !== null && (typeof row.alternatives !== 'string' || !storable(row.alternatives)))
    || (row.link_id !== null && (typeof row.link_id !== 'string' || !storable(row.link_id)))
    || (row.unrequested !== 0 && row.unrequested !== 1)) throw Error('Invalid report original')
  return sha256Hex(JSON.stringify(['original-report-v1', ...REPORT_SOURCE_FIELDS.map(field => row[field])]))
}

type ScopedDatabase = Database & { actorEmail?: string | null; workspace?: boolean }
interface Environment { DB: ScopedDatabase; AUTH_ACTOR?: { mode?: string; email?: string | null }; DEMO_WORKSPACE?: boolean }
interface Actor { email: string; display_name: string; role: string; active: number; departments_json: string; product_ids_json: string; updated_at: string }

const sourceChanged = (): Response => jsonResponse({ error: '신고 내용이 바뀌었습니다. 최신 내용을 확인해주세요. 이전에 확정 저장된 처리 기록은 유지됩니다.', code: 'REPORT_SOURCE_CHANGED' }, 409)
const conflicting = (): Response => jsonResponse({ error: '같은 요청의 내용이나 기록·권한이 변경되었습니다. 최신 신고와 처리 이력을 확인해주세요.', code: 'REPORT_FIX_CONFLICT' }, 409)

async function currentOriginal(env: Environment, DB: Database, command: ReportFixCommand): Promise<Response | { report: SqlRow; author: string }> {
  let author = command.demoAuthor
  if (env.AUTH_ACTOR?.mode === 'access') {
    // Capture all authority/attribution fields in the atomic read set. A later
    // role, assignment, activation or label change cannot write a stale claim.
    const actor = await DB.prepare(REPORT_FIX_ACTOR_SQL).bind(env.AUTH_ACTOR.email ?? null).first<Actor>()
    if (!actor || Number(actor.active) !== 1) return jsonError('현재 계정의 접근 권한을 확인할 수 없습니다.', 401)
    if (!canUseBusinessRoute(actor, '/api/reports', 'POST')) return jsonError('현재 계정에는 이 작업 권한이 없습니다.', 403)
    if (typeof actor.display_name !== 'string' || !actor.display_name.trim() || !storable(actor.display_name)) throw Error('Current report attribution unavailable')
    author = actor.display_name
  }
  if (typeof author !== 'string' || !author) throw Error('Report attribution unavailable')
  const report = await DB.prepare('SELECT ' + REPORT_SOURCE_COLUMNS + ' FROM decision_log WHERE id=? AND link_kind=?')
    .bind(command.reportId, REPORT_KIND).first<SqlRow>()
  if (!report || report.id !== command.reportId || typeof report.application_id !== 'string' || !report.application_id) {
    return jsonError('그 신고를 찾지 못했습니다.', 404)
  }
  // No handover requirement: the existing workflow also permits fixing reports
  // on unpublished or stopped tools. Visibility of the actual application is
  // independently required, including replay of a formerly successful receipt.
  const app = await DB.prepare(REPORT_FIX_APPLICATION_SQL).bind(report.application_id).first<{ id: string }>()
  if (!app || app.id !== report.application_id) return jsonError('그 신고를 찾지 못했습니다.', 404)
  if (await reportSourceVersion(report) !== command.expectedVersion) return sourceChanged()
  return { report, author }
}

// Called by the thin POST route. Receipt replay deliberately has a stricter
// current-source check than general atomicMutation: past success stays stored,
// but must not present the changed original as the same evidence just confirmed.
export async function handleReportFix(env: Environment, request: Request): Promise<Response> {
  let body: unknown
  try { body = await request.json() } catch {
    return jsonResponse({ error: '보내주신 내용을 읽지 못했습니다.', notSaved: true }, 400)
  }
  const normalized = normalizeReportFixCommand(body, env.AUTH_ACTOR?.mode === 'access')
  if (!normalized.ok) return jsonResponse({ error: '적어주신 것을 다시 확인해주세요.', fields: normalized.fields, notSaved: true }, 400)
  const requestId = request.headers.get('X-Idempotency-Key')
  if (!requestId || !KEY.test(requestId)) return jsonResponse({ error: '중복 방지 요청 번호가 필요합니다.', notSaved: true }, 400)
  const command = normalized.value
  try {
    if (typeof env.DB?.mutationReceipt !== 'function' || typeof env.DB?.commitMutation !== 'function') throw Error('Atomic report storage unavailable')
    if (env.AUTH_ACTOR?.mode === 'access') {
      if (!env.AUTH_ACTOR.email || env.DB.actorEmail !== env.AUTH_ACTOR.email || env.DB.workspace !== false) {
        return jsonError('인증된 사내 계정이 필요합니다.', 401)
      }
    } else if (env.AUTH_ACTOR || env.DEMO_WORKSPACE !== true || env.DB.workspace !== true) {
      return jsonError('개인 체험 공간의 데이터 접근 설정이 필요합니다.', 503)
    }
    const fingerprint = await mutationFingerprint({ kind: 'report-fix', command })
    const response = await atomicMutation(env.DB, requestId, fingerprint, async DB => {
      const current = await currentOriginal(env, DB, command)
      if (current instanceof Response) return current
      const already = await DB.prepare(REPORT_FIX_EXISTING_SQL)
        .bind(current.report.application_id as string, REPORT_FIX, command.reportId).first<{ id: string }>()
      if (already) return jsonError('그 신고에는 이미 처리 기록이 있습니다. 최신 이력을 확인해주세요.', 409)
      const id = await logDecision({ DB }, { applicationId: current.report.application_id as string,
        stage: '배포', actor: 'human', title: current.author, what: command.how, why: command.why,
        linkKind: REPORT_FIX, linkId: command.reportId })
      return jsonResponse({ ok: true, id, reportId: command.reportId, author: current.author })
    })
    if (response.ok && response.headers.get('X-Idempotency-Replayed') === '1') {
      // Covers both receipt-before-action and a commit-time replay race.
      const current = await currentOriginal(env, env.DB, command)
      if (current instanceof Response) return current
    }
    return response
  } catch (error) {
    if (isTransactionConflict(error)) return conflicting()
    return failUnexpected(error, '처리 기록의 저장 여부를 확인하지 못했습니다. 같은 요청으로 다시 확인하거나 처리 이력을 확인해주세요.')
  }
}
