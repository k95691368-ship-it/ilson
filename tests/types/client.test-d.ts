import { api, ApiError } from '../../src/api/client.ts'
import type { FieldErrors, JsonValue } from '../../src/api/client.ts'
import type { HandoverDraft, HandoverRequest, HandoverMutationResponse } from '../../shared/contracts/handover.ts'
import { readHandoverEvidence } from '../../shared/contracts/handover.ts'

type Assert<Condition extends true> = Condition
type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2) ? true : false

export type SuccessJsonRemainsUnknown = Assert<Equal<Awaited<ReturnType<typeof api.get>>, unknown>>
export type MutationJsonRemainsUnknown = Assert<Equal<Awaited<ReturnType<typeof api.post>>, unknown>>
export type DecoderAcceptsUnknown = Assert<Equal<Parameters<typeof readHandoverEvidence>[0], unknown>>
export type DecoderChecksNumericLimits = Assert<Equal<NonNullable<ReturnType<typeof readHandoverEvidence>['handover']>['daily_limit'], number>>
export type JsonBodyExcludesFunctions = Assert<Equal<(() => void) extends JsonValue ? true : false, false>>
export type JsonBodyExcludesBigInts = Assert<Equal<bigint extends JsonValue ? true : false, false>>
export type FileFormRequiresFormData = Assert<Equal<Parameters<typeof api.form>[1], FormData>>
export type ApiErrorFieldsAreText = Assert<Equal<ApiError['fields'], FieldErrors | null>>
export type ApiErrorCodeIsText = Assert<Equal<ApiError['code'], string | null>>
export type UiLimitIsEditableText = Assert<Equal<HandoverDraft['dailyLimit'], string>>
export type WireLimitIsNumeric = Assert<Equal<Extract<HandoverRequest, { action: 'create' | 'restore' }>['dailyLimit'], number>>
export type RetryIncludesEvidence = Assert<Equal<HandoverRequest['expectedEvidence'], string>>
export type HandoverRequestIsSerializable = Assert<Equal<HandoverRequest extends JsonValue ? true : false, true>>
export type StopResponseDoesNotInventHref = Assert<Equal<'href' extends keyof Extract<HandoverMutationResponse, { action: 'stop' }> ? true : false, false>>
export type StopDoesNotRequireInstructions = Assert<Equal<Extract<HandoverRequest, { action: 'stop' }>, { action: 'stop'; reason: string; expectedEvidence: string }>>
