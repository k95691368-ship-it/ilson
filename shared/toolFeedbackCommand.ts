import { validateReport, REPORT_CODES } from './report.js'
import { validateUnclear, SECTION_KEYS } from './unclear.js'

export type ToolFeedbackKind = 'report' | 'unclear'
export type ToolFeedbackCommand =
  | { kind: 'report'; code: string; body: string; reporter: string | null }
  | { kind: 'unclear'; section: string; body: string }
type Result = { ok: true; value: ToolFeedbackCommand } | { ok: false; fields: Record<string, string> }

export const feedbackTextIsStorable = (value: string): boolean => !value.includes('\0') && !/[\uD800-\uDFFF]/u.test(value)

// Only semantic feedback fields enter storage/fingerprints. Unknown/raw fields
// are ignored; malformed known fields must not stringify to "[object Object]".
export function normalizeToolFeedback(kind: ToolFeedbackKind, value: unknown, accountMode: boolean): Result {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, fields: { body: '요청 형식이 올바르지 않습니다.' } }
  }
  const input = value as Record<string, unknown>, fields: Record<string, string> = {}
  function text(key: string, max: number, trim = true): string {
    const raw = input[key]
    if (typeof raw !== 'string') { fields[key] = '문자로 입력해주세요.'; return '' }
    const text = trim ? raw.trim() : raw
    if (!feedbackTextIsStorable(text)) fields[key] = '저장할 수 없는 문자가 포함되어 있습니다.'
    else if (text.length > max) fields[key] = max + '자 이내로 입력해주세요.'
    return text
  }
  const body = text('body', kind === 'report' ? 3000 : 1000)
  let command: ToolFeedbackCommand
  let required: Record<string, string>
  if (kind === 'report') {
    const code = text('code', 40)
    // Preserve the existing authenticated attribution contract. A forged form
    // label cannot replace it or poison a same-intent retry fingerprint.
    const reporter = accountMode ? null : text('reporter', 60)
    required = validateReport({ code, body, reporter: accountMode ? '계정' : reporter })
    if (!REPORT_CODES.includes(code)) fields.code = '무엇이 이상한지 골라주세요.'
    command = { kind, code, body, reporter }
  } else {
    const section = text('section', 40, false)
    required = validateUnclear({ section, body })
    if (!SECTION_KEYS.includes(section)) fields.section = '어느 대목인지 골라주세요.'
    command = { kind, section, body }
  }
  for (const [key, message] of Object.entries(required)) if (!fields[key]) fields[key] = message
  return Object.keys(fields).length ? { ok: false, fields } : { ok: true, value: command }
}
