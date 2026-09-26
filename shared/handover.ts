import { PERIOD } from './master.js'

export const HANDOVER_KIND = '현장인계'
export const STOP_KIND = '인계중단'
export const TOOL_SCOPE = `기존 브라우저 정산 도구입니다. 새 AI 도구나 코드를 자동으로 만들지 않습니다. 지원 기간은 ${PERIOD.start}~${PERIOD.end}이며 시연용 상품 목록과 고정 환율(KRW 1, USD 1385, JPY 8.9)을 사용합니다. 이 범위 밖의 실제 정산에 사용하지 마십시오. 원본 파일은 서버에 저장하지 않습니다.`

export type HandoverAction = 'create' | 'stop' | 'restore'

export type HandoverHumanCheck = {
  confirmed: boolean
  evidence: string
}

export interface HandoverInput {
  action: HandoverAction
  reason: string
  title: string
  person: string
  whenToRun: string
  afterRun: string
  contact: string
  dailyLimit: number
  maxFileMb: number
  scopeAccepted: boolean
  humanChecks: Record<string, HandoverHumanCheck>
}

export interface HumanCriterionReference {
  id: string
}

export type HandoverErrors = Partial<Record<keyof HandoverInput, string>>
type UncheckedHandoverInput = Partial<Record<keyof HandoverInput, unknown>>

const TEXT_FIELDS = [
  ['title', '도구 이름', 120], ['person', '받는 담당자', 120],
  ['whenToRun', '실행 시점', 2000], ['afterRun', '결과 확인 방법', 2000],
  ['contact', '문의 담당자', 200],
] as const

export function validateHandover(rawBody: unknown, humanCriteria: readonly HumanCriterionReference[] = []): HandoverErrors {
  const body = rawBody == null ? undefined : Object(rawBody) as UncheckedHandoverInput
  const fields: HandoverErrors = {}
  if (body?.action !== 'create' && body?.action !== 'stop' && body?.action !== 'restore') fields.action = '인계 작업을 선택해주세요.'
  if (typeof body?.reason !== 'string' || body.reason.trim().length < 5 || body.reason.length > 2000) fields.reason = '판단 근거를 5~2,000자로 적어주세요.'
  if (body?.action === 'stop') return fields
  for (const [key, label, max] of TEXT_FIELDS) {
    const value = body?.[key]
    if (typeof value !== 'string' || !value.trim() || value.length > max) fields[key] = `${label}을 ${max}자 이내로 적어주세요.`
  }
  if (typeof body?.dailyLimit !== 'number' || !Number.isSafeInteger(body.dailyLimit) || body.dailyLimit < 1 || body.dailyLimit > 100) fields.dailyLimit = '하루 성공 실행 횟수는 1~100회로 정해주세요.'
  if (typeof body?.maxFileMb !== 'number' || !Number.isSafeInteger(body.maxFileMb) || body.maxFileMb < 1 || body.maxFileMb > 10) fields.maxFileMb = '파일 제한은 1~10MB로 정해주세요.'
  if (body?.scopeAccepted !== true) fields.scopeAccepted = '지원 범위와 고정 환율의 제한을 확인해주세요.'
  const checks = body?.humanChecks
  if (!checks || typeof checks !== 'object' || Array.isArray(checks)
    || humanCriteria.some(c => {
      const entry = (checks as Record<string, unknown>)[c.id]
      const check = entry == null ? undefined : Object(entry) as Partial<Record<keyof HandoverHumanCheck, unknown>>
      return check?.confirmed !== true || typeof check?.evidence !== 'string' || check.evidence.trim().length < 5 || check.evidence.length > 2000
    })) {
    if (humanCriteria.length) fields.humanChecks = '사람 확인 기준마다 확인 결과와 근거를 5~2,000자로 남겨주세요.'
  }
  return fields
}
