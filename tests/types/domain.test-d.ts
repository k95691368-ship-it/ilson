import type {
  ReviewInput, ReviewValue, ReviewVerdict, ReviewValidationResult,
} from '../../shared/review.ts'
import type {
  AgreementGateInput, AgreementGateResult, CriterionKey, CriterionKind,
} from '../../shared/acceptance.ts'
import type {
  OutcomeInput, OutcomeValidationResult, BaselineValidationResult,
} from '../../shared/outcomeInputs.ts'
import type { BetaNoteEnvelope, DecodedBetaRound } from '../../shared/betaEvidence.ts'
import type { HandoverAction, HandoverInput, HandoverErrors } from '../../shared/handover.ts'

type Assert<Condition extends true> = Condition
type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2) ? true : false

// These assertions are checked by tsc, not executed as application or test code.
// No suppression comments are needed: an unintended contract change fails tsc.
export type ReviewUnknownBoundary = Assert<Equal<ReviewInput['impact_score'], unknown>>
export type ReviewSuccess = Assert<Equal<Extract<ReviewValidationResult, { ok: true }>['value'], ReviewValue>>
export type ReviewFailureHasNoValue = Assert<Equal<'value' extends keyof Extract<ReviewValidationResult, { ok: false }> ? true : false, false>>
export type ReviewScoreIsValidated = Assert<Equal<ReviewValue['impact_score'], number>>
export type ReviewVerdictIsClosed = Assert<Equal<ReviewVerdict, '수용' | '반려' | '보류'>>
export type UnsupportedReviewVerdict = Assert<Equal<Extract<ReviewVerdict, '자동승인'>, never>>

export type CriterionKindIsClosed = Assert<Equal<CriterionKind, 'rule' | 'human'>>
export type UnknownCriterionRejected = Assert<Equal<Extract<CriterionKey, 'invented_rule'>, never>>
export type AgreementCollectionsAreReadonly = Assert<Equal<AgreementGateInput['criteria'], readonly { confirmed_at?: unknown }[]>>
export type AgreementBlockersAreText = Assert<Equal<AgreementGateResult['blockers'], string[]>>

export type OutcomeUnknownBoundary = Assert<Equal<OutcomeInput['dev_hours'], unknown>>
export type OutcomeSuccessIsNumeric = Assert<Equal<Extract<OutcomeValidationResult, { ok: true }>['value']['dev_hours'], number>>
export type OutcomeFailureRetainsInvalidValue = Assert<Equal<Extract<OutcomeValidationResult, { ok: false }>['value']['dev_hours'], number | null>>
export type BaselineSuccessIsNumeric = Assert<Equal<Extract<BaselineValidationResult, { ok: true }>['value']['people'], number>>
export type BaselineFailureRetainsInvalidValue = Assert<Equal<Extract<BaselineValidationResult, { ok: false }>['value']['people'], number | null>>

export type BetaMarkerIsExact = Assert<Equal<BetaNoteEnvelope['format'], 'ilson.beta-evidence.v1'>>
export type LegacyBetaIsNotEvidence = Assert<Equal<DecodedBetaRound<{ id: string; note: string | null }>['criteriaRevision'], number | null>>
export type BetaRetainsRowIdentity = Assert<Equal<DecodedBetaRound<{ id: string; note: string | null }>['id'], string>>

export type HandoverActionIsClosed = Assert<Equal<HandoverAction, 'create' | 'stop' | 'restore'>>
export type HandoverHumanEvidenceIsText = Assert<Equal<HandoverInput['humanChecks'][string]['evidence'], string>>
export type HandoverErrorsMatchFields = Assert<Equal<keyof HandoverErrors, keyof HandoverInput>>
