import { validateTeach } from './teach.js'
import { SKU_BY_CODE } from './master.js'

export interface TeachCommand {
  externalCode: string
  canonicalCode: string
  channel: string | null
  note: string | null
  affected: number
  // Real attribution is resolved from the current actor, not client input.
  teacher: string | null
}

export type TeachCommandResult =
  | { ok: true; value: TeachCommand }
  | { ok: false; fields: Record<string, string> }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

// PostgreSQL text cannot contain NUL, and JSON input rejects lone surrogates.
function storableText(value: string): boolean {
  return !value.includes('\0') && !/[\uD800-\uDFFF]/u.test(value)
}

export function normalizeTeachCommand(body: unknown, accountMode: boolean): TeachCommandResult {
  if (!isRecord(body)) return { ok: false, fields: { body: '요청 형식이 올바르지 않습니다.' } }
  const input = body
  const fields: Record<string, string> = {}
  function text(field: string, max: number, optional = false): string | null {
    const raw = input[field]
    if (optional && (raw === undefined || raw === null)) return null
    if (typeof raw !== 'string') {
      fields[field] = '문자로 입력해주세요.'
      return null
    }
    const value = raw.trim()
    if (!storableText(value)) fields[field] = '저장할 수 없는 문자가 포함되어 있습니다.'
    else if (value.length > max) fields[field] = `${max}자 이내로 입력해주세요.`
    return value || null
  }
  const externalCode = text('externalCode', 80) ?? ''
  const canonicalCode = (text('canonicalCode', 40) ?? '').toUpperCase()
  const channel = text('channel', 40, true)
  const note = text('note', 300, true)
  // Ignore real teacher completely, including its type and length. It must
  // not poison a retry fingerprint for a server-owned attribution field.
  const teacher = accountMode ? null : text('teacher', 60)
  const affected = body.affected === undefined ? 0 : body.affected
  if (typeof affected !== 'number' || !Number.isSafeInteger(affected) || affected < 0) {
    fields.affected = '처리 대상 줄 수는 0 이상의 안전한 정수여야 합니다.'
  }
  const legacy = validateTeach({ externalCode, canonicalCode, teacher: accountMode ? '계정' : teacher ?? '' })
  for (const [field, message] of Object.entries(legacy)) {
    if (!fields[field] && typeof message === 'string') fields[field] = message
  }
  if (canonicalCode && !Object.hasOwn(SKU_BY_CODE, canonicalCode) && !fields.canonicalCode) {
    fields.canonicalCode = '저희 목록에 없는 상품코드입니다. 목록에서 골라주세요.'
  }
  if (Object.keys(fields).length) return { ok: false, fields }
  if (typeof affected !== 'number') throw new Error('Validated affected count is not a number')
  return { ok: true, value: { externalCode, canonicalCode, channel, note, affected, teacher } }
}
