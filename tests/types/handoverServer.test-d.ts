import type { HandoverEvidenceResponse, HandoverRequest } from '../../shared/contracts/handover.ts'
import type { HandoverRow, ManualRow, HandoverCriterionRow, HandoverEvidence, PublicHandoverEvidence } from '../../functions/_lib/handoverEvidence.ts'
import { loadHandoverEvidence, publicHandoverEvidence } from '../../functions/_lib/handoverEvidence.ts'
import { validatedHandoverBody, onRequestGet, onRequestPost } from '../../functions/api/applications/[id]/handover.ts'

type Assert<Condition extends true> = Condition
type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2) ? true : false

export type MissingApplicationIsExplicit = Assert<Equal<Awaited<ReturnType<typeof loadHandoverEvidence>>, HandoverEvidence | null>>
export type NullableReceiptIsPreserved = Assert<Equal<HandoverRow['accepted_at'], string | null>>
export type NullableManualContactIsPreserved = Assert<Equal<ManualRow['contact'], string | null>>
export type CriterionKindUsesDomainContract = Assert<Equal<HandoverCriterionRow['check_kind'], 'rule' | 'human'>>
export type PublicEvidenceMatchesClientProjection = Assert<Equal<PublicHandoverEvidence extends HandoverEvidenceResponse ? true : false, true>>
export type PublicEvidenceKeepsSignoff = Assert<Equal<'signoff' extends keyof PublicHandoverEvidence ? true : false, true>>
export type PublicEvidenceKeepsBeta = Assert<Equal<'latestBeta' extends keyof PublicHandoverEvidence ? true : false, true>>
export type PrivateProofIsNotPublic = Assert<Equal<'proof' extends keyof ReturnType<typeof publicHandoverEvidence> ? true : false, false>>
export type RawInputValuesRemainUnknown = Assert<Equal<Parameters<typeof validatedHandoverBody>[0][string], unknown>>
export type ValidatedBodyIsTheWireContract = Assert<Equal<Extract<ReturnType<typeof validatedHandoverBody>, { ok: true }>['value'], HandoverRequest>>
export type ValidationFailureHasNoTrustedValue = Assert<Equal<'value' extends keyof Extract<ReturnType<typeof validatedHandoverBody>, { ok: false }> ? true : false, false>>
export type GetReturnsHttpResponse = Assert<Equal<ReturnType<typeof onRequestGet>, Promise<Response>>>
export type PostReturnsHttpResponse = Assert<Equal<ReturnType<typeof onRequestPost>, Promise<Response>>>
