import { SKU_BY_CODE } from './master.js'

export const CODE_REVIEW_PREFIX = 'ilson-code-review:'
const CONFIRM = '코드확인', CORRECT = '코드정정'
const HEX = /^[a-f0-9]{64}$/

export type CodeReviewAction = 'confirm' | 'correct'
export type CodeReviewProvenance = { state: 'linked'; applicationId: string } | { state: 'unknown'; applicationId: null }
export interface CodeReviewEvidence {
  version: 1
  action: CodeReviewAction
  externalCode: string
  reviewedMappingRevision: string
  beforeCanonicalCode: string
  afterCanonicalCode: string
  provenance: CodeReviewProvenance
}
export interface CodeReviewDecisionContext {
  link_kind?: unknown
  link_id?: unknown
  application_id?: unknown
  alternatives?: unknown
}
export type CodeReviewCommand = {
  externalCode: string; expectedVersion: string; why: string; author: string | null
} & ({ action: 'confirm' } | { action: 'correct'; canonicalCode: string })
export type CodeReviewCommandResult = { ok: true; value: CodeReviewCommand } | { ok: false; fields: Record<string, string> }

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const safeText = (value: unknown, max: number): boolean => typeof value === 'string' && value.length > 0 && value.length <= max
  && value === value.trim() && !value.includes('\0') && !/[\uD800-\uDFFF]/u.test(value)
const keys = (value: Record<string, unknown>, names: readonly string[]) => {
  const actual = Object.keys(value)
  return actual.length === names.length && names.every(name => Object.hasOwn(value, name))
}

function evidenceValue(value: unknown): value is CodeReviewEvidence {
  if (!record(value) || !keys(value, ['version', 'action', 'externalCode', 'reviewedMappingRevision', 'beforeCanonicalCode', 'afterCanonicalCode', 'provenance'])) return false
  if (value.version !== 1 || (value.action !== 'confirm' && value.action !== 'correct') || !safeText(value.externalCode, 80)
    || typeof value.reviewedMappingRevision !== 'string' || !HEX.test(value.reviewedMappingRevision)
    || !safeText(value.beforeCanonicalCode, 40) || !safeText(value.afterCanonicalCode, 40)) return false
  if ((value.action === 'confirm') !== (value.beforeCanonicalCode === value.afterCanonicalCode)) return false
  const provenance = value.provenance
  return record(provenance) && keys(provenance, ['state', 'applicationId'])
    && ((provenance.state === 'linked' && safeText(provenance.applicationId, 200)) || (provenance.state === 'unknown' && provenance.applicationId === null))
}

export function isCodeReviewMetadata(row: CodeReviewDecisionContext): boolean {
  return (row.link_kind === CONFIRM || row.link_kind === CORRECT) && typeof row.alternatives === 'string' && row.alternatives.startsWith(CODE_REVIEW_PREFIX)
}

export function encodeCodeReviewEvidence(evidence: CodeReviewEvidence): string {
  if (!evidenceValue(evidence)) throw new Error('Invalid code review evidence')
  return CODE_REVIEW_PREFIX + JSON.stringify(evidence)
}

export function decodeCodeReviewEvidence(raw: unknown, row: CodeReviewDecisionContext): CodeReviewEvidence | null {
  if (typeof raw !== 'string' || !raw.startsWith(CODE_REVIEW_PREFIX)) return null
  try {
    const value: unknown = JSON.parse(raw.slice(CODE_REVIEW_PREFIX.length))
    if (!evidenceValue(value) || row.link_kind !== (value.action === 'confirm' ? CONFIRM : CORRECT)
      || row.link_id !== value.externalCode || row.application_id !== value.provenance.applicationId) return null
    return value
  } catch { return null }
}

// This is structural/context validation, not a new authentication credential.
// Consumers hide reserved malformed metadata too, never count it as a choice.
export function projectCodeReviewDecision<Row extends CodeReviewDecisionContext>(row: Row): Row | (Omit<Row, 'alternatives'> & {
  alternatives: null; code_review_evidence_status: 'verified' | 'unreadable'; code_review_evidence?: CodeReviewEvidence
}) {
  if (!isCodeReviewMetadata(row)) return row
  const evidence = decodeCodeReviewEvidence(row.alternatives, row)
  return { ...row, alternatives: null, code_review_evidence_status: evidence ? 'verified' : 'unreadable',
    ...(evidence ? { code_review_evidence: evidence } : {}) }
}

export function normalizeCodeReviewCommand(body: unknown, accountMode: boolean): CodeReviewCommandResult {
  if (!record(body)) return { ok: false, fields: { body: '요청 형식이 올바르지 않습니다.' } }
  const input = body, fields: Record<string, string> = {}
  function text(field: string, max: number, fallback?: string): string {
    const raw = input[field]
    if (raw === undefined && fallback !== undefined) return fallback
    if (typeof raw !== 'string') { fields[field] = '문자로 입력해주세요.'; return '' }
    const value = raw.trim()
    if (!safeText(value, max)) fields[field] = value.length > max ? `${max}자 이내로 입력해주세요.` : '빈 값이나 저장할 수 없는 문자를 확인해주세요.'
    return value
  }
  const externalCode = text('externalCode', 80)
  const action = input.action
  if (action !== 'confirm' && action !== 'correct') fields.action = '무엇을 하실지 알려주세요.'
  const expectedVersion = input.expectedVersion
  if (typeof expectedVersion !== 'string' || !HEX.test(expectedVersion)) fields.expectedVersion = '최신 상품 연결을 불러온 뒤 다시 확인해주세요.'
  const why = text('why', 2000, action === 'confirm' ? '표시된 상품 연결이 맞다고 확인했습니다.' : undefined)
  if (action === 'correct' && why.length < 5) fields.why = '왜 바꾸시는지 5자 이상 적어주세요.'
  // In real mode author is server-owned; ignore even malformed caller values.
  const author = accountMode ? null : text('author', 60, 'AX 담당자')
  let canonicalCode = ''
  if (action === 'correct') {
    canonicalCode = text('canonicalCode', 40).toUpperCase()
    if (!Object.hasOwn(SKU_BY_CODE, canonicalCode) && !fields.canonicalCode) fields.canonicalCode = '저희 목록에 없는 상품코드입니다.'
  } else if (input.canonicalCode !== undefined) fields.canonicalCode = '확인은 표시된 상품 연결에만 적용됩니다. 바꾸려면 정정을 선택해주세요.'
  if (Object.keys(fields).length) return { ok: false, fields }
  if (typeof expectedVersion !== 'string' || (action !== 'confirm' && action !== 'correct')) throw new Error('Validated code command has an inconsistent shape')
  const common = { externalCode, expectedVersion, why, author }
  return { ok: true, value: action === 'correct' ? { ...common, action, canonicalCode } : { ...common, action } }
}

// Explicit projections prevent future unrelated SELECT columns from silently
// changing review identities. History is a set: UUID order is not event time.
export function codeAliasSnapshot(alias: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(['external_code', 'canonical_code', 'channel', 'product_name', 'note', 'taught_by', 'owner_email', 'created_at'].map(field => [field, alias[field] ?? null]))
}
export function codeDecisionSnapshot(decision: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(['id', 'application_id', 'link_kind', 'link_id', 'title', 'what', 'why', 'alternatives', 'created_at'].map(field => [field, decision[field] ?? null]))
}
const historySet = (history: readonly Record<string, unknown>[]) => history.map(codeDecisionSnapshot).sort((a, b) => String(a.id).localeCompare(String(b.id)))
async function digest(value: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)))
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}
export async function codeMappingRevision(alias: Record<string, unknown>, history: readonly Record<string, unknown>[]): Promise<string> {
  return digest({ kind: 'code-mapping.v1', alias: codeAliasSnapshot(alias), corrections: historySet(history.filter(row => row.link_kind === CORRECT)) })
}
export async function codeEditVersion(alias: Record<string, unknown>, history: readonly Record<string, unknown>[], mappingRevision?: string): Promise<string> {
  return digest({ kind: 'code-review.v1', mappingRevision: mappingRevision ?? await codeMappingRevision(alias, history), history: historySet(history) })
}

export class CodeReviewTimestampError extends Error {}

// This advancing writer timestamp detects correction ABA, not the actual time
// a person reviewed a source. Human event time stays in decision_log.created_at.
export function nextCodeReviewTimestamp(previous: unknown, now: number = Date.now()): string {
  const max = 8640000000000000
  if (!Number.isSafeInteger(now) || Math.abs(now) > max) throw new CodeReviewTimestampError('Invalid writer clock')
  let old: number | null = null
  if (typeof previous === 'string') {
    const match = /^([+-]\d{6}|\d{4})-(\d{2})-(\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?Z?$/.exec(previous)
    if (match) {
      const utc = `${match[1]}-${match[2]}-${match[3]}T${match[4]}.${(match[5] ?? '').padEnd(3, '0').slice(0, 3)}Z`
      const parsed = Date.parse(utc)
      if (Number.isFinite(parsed) && new Date(parsed).toISOString() === utc) old = parsed
    }
  }
  const next = Math.max(now, old === null ? now : old + 1)
  if (!Number.isSafeInteger(next) || Math.abs(next) > max) throw new CodeReviewTimestampError('Writer timestamp cannot advance')
  return new Date(next).toISOString()
}
