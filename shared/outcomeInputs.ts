export interface OutcomeInputs {
  dev_hours: number
  ops_cost_krw: number
  amortize_months: number
  next_bottleneck: string
}

export type OutcomeInput = Partial<Record<keyof OutcomeInputs, unknown>>
export type OutcomeInputErrors = Partial<Record<keyof OutcomeInputs, string>>
export type UncheckedOutcomeInputs = Omit<OutcomeInputs, 'dev_hours' | 'ops_cost_krw' | 'amortize_months'> & {
  dev_hours: number | null
  ops_cost_krw: number | null
  amortize_months: number | null
}
export type OutcomeValidationResult =
  | { ok: true; value: OutcomeInputs; errors: OutcomeInputErrors }
  | { ok: false; value: UncheckedOutcomeInputs; errors: OutcomeInputErrors }

export interface BaselineInput {
  people?: unknown
  hourly_wage_krw?: unknown
}
export interface BaselineApplication {
  current_people?: unknown
}
export interface BaselineInputs {
  people: number
  wage: number
}
export type BaselineInputErrors = Partial<Record<keyof BaselineInput, string>>
export type BaselineValidationResult =
  | { ok: true; value: BaselineInputs; errors: BaselineInputErrors }
  | { ok: false; value: { people: number | null; wage: number | null }; errors: BaselineInputErrors }

function numberIn(value: unknown, fallback: number, min: number, max: number, integer = false): number | null {
  if (value === undefined || value === null || value === '') return fallback
  if (!['number', 'string'].includes(typeof value) || (typeof value === 'string' && !value.trim())) return null
  const n = Number(value)
  return Number.isFinite(n) && n >= min && n <= max && (!integer || Number.isSafeInteger(n)) ? n : null
}

export function validateOutcomeInputs(rawBody: unknown = {}): OutcomeValidationResult {
  if (rawBody == null) throw new TypeError('Outcome input is required.')
  const body = Object(rawBody) as OutcomeInput
  const value = {
    dev_hours: numberIn(body.dev_hours, 0, 0, 1000000),
    ops_cost_krw: numberIn(body.ops_cost_krw, 0, 0, 1000000000000),
    amortize_months: numberIn(body.amortize_months, 24, 1, 1200, true),
    next_bottleneck: String(body.next_bottleneck ?? '').trim(),
  }
  const errors: OutcomeInputErrors = {}
  if (value.dev_hours === null) errors.dev_hours = '제작 시간은 0 이상 1,000,000 이하의 숫자로 적어주세요.'
  if (value.ops_cost_krw === null) errors.ops_cost_krw = '운영비는 0 이상 1조 원 이하의 숫자로 적어주세요.'
  if (value.amortize_months === null) errors.amortize_months = '상각 기간은 1~1,200개월의 정수로 적어주세요.'
  if (value.next_bottleneck.length > 2000) errors.next_bottleneck = '병목 설명은 2,000자 이내로 적어주세요.'
  if (Object.keys(errors).length > 0 || value.dev_hours === null || value.ops_cost_krw === null || value.amortize_months === null) {
    return { value, errors, ok: false }
  }
  return { value: { ...value, dev_hours: value.dev_hours, ops_cost_krw: value.ops_cost_krw, amortize_months: value.amortize_months }, errors, ok: true }
}

export function validateBaselineInputs(rawBody: unknown, app: BaselineApplication, defaultWage: number): BaselineValidationResult {
  if (rawBody == null) throw new TypeError('Baseline input is required.')
  const body = Object(rawBody) as BaselineInput
  const value = {
    people: numberIn(body.people, Number(app.current_people) || 1, 1, 100000, true),
    wage: numberIn(body.hourly_wage_krw, defaultWage, 1, 1000000000),
  }
  const errors: BaselineInputErrors = {}
  if (value.people === null) errors.people = '참여 인원은 1~100,000명의 정수로 적어주세요.'
  if (value.wage === null) errors.hourly_wage_krw = '시급은 1 이상 10억 원 이하의 숫자로 적어주세요.'
  if (Object.keys(errors).length > 0 || value.people === null || value.wage === null) return { value, errors, ok: false }
  return { value: { people: value.people, wage: value.wage }, errors, ok: true }
}
