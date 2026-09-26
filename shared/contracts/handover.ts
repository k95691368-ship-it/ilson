// The GET contract is the projection consumed by HandoverPanel. The endpoint
// also returns server evidence (for example signoff/latestBeta); those objects
// are deliberately not asserted or validated by this client boundary.
import type { HandoverInput, HumanCriterionReference } from '../handover.ts'
export type { HandoverAction, HandoverHumanCheck as HumanCheck } from '../handover.ts'
export type HumanCriterion = HumanCriterionReference & { body: string }
export type HandoverDraft = Omit<HandoverInput, 'action' | 'dailyLimit' | 'maxFileMb'> & {
  dailyLimit: string
  maxFileMb: string
}
export type HandoverRequest =
  | { action: 'stop'; reason: string; expectedEvidence: string }
  | (Omit<HandoverInput, 'action'> & { action: 'create' | 'restore'; expectedEvidence: string })
export type HandoverMutationResponse =
  | { ok: true; action: 'stop'; slug: string }
  | { ok: true; action: 'create' | 'restore'; slug: string; href: string }

export type HandoverEvidenceResponse = {
  application: { id: string; title: string; dept: string }
  expectedEvidence: string
  blockers: string[]
  humanCriteria: HumanCriterion[]
  scope: string
  handover: null | {
    slug: string
    title: string
    handed_to_dept: string
    handed_to_person: string
    daily_limit: number
    max_file_mb: number
    rolled_back_at: string | null
  }
  manual: null | {
    when_to_run: string | null
    what_to_do_after: string | null
    contact: string | null
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const nullableString = (value: unknown): value is string | null => value === null || typeof value === 'string'

export function isHandoverEvidence(value: unknown): value is HandoverEvidenceResponse {
  if (!isRecord(value) || !isRecord(value.application)
    || typeof value.application.id !== 'string' || typeof value.application.title !== 'string' || typeof value.application.dept !== 'string'
    || typeof value.expectedEvidence !== 'string' || !/^[a-f0-9]{64}$/.test(value.expectedEvidence)
    || typeof value.scope !== 'string'
    || !Array.isArray(value.blockers) || !value.blockers.every((item: unknown) => typeof item === 'string')
    || !Array.isArray(value.humanCriteria) || !value.humanCriteria.every((item: unknown) => isRecord(item) && typeof item.id === 'string' && typeof item.body === 'string')) return false
  const handover = value.handover
  if (handover !== null && (!isRecord(handover)
    || typeof handover.slug !== 'string' || typeof handover.title !== 'string'
    || typeof handover.handed_to_dept !== 'string' || typeof handover.handed_to_person !== 'string'
    || typeof handover.daily_limit !== 'number' || !Number.isFinite(handover.daily_limit)
    || typeof handover.max_file_mb !== 'number' || !Number.isFinite(handover.max_file_mb)
    || !nullableString(handover.rolled_back_at))) return false
  const manual = value.manual
  return manual === null || (isRecord(manual) && nullableString(manual.when_to_run)
    && nullableString(manual.what_to_do_after) && nullableString(manual.contact))
}

export function readHandoverEvidence(value: unknown): HandoverEvidenceResponse {
  if (!isHandoverEvidence(value)) throw new Error('서버 응답을 확인하지 못했습니다. 같은 내용으로 다시 시도해주세요.')
  return value
}
