// The server wraps user text after validation. An apparent envelope supplied by
// a client is still just userNote, never trusted provenance.
const MARKER = 'ilson.beta-evidence.v1'
export interface BetaNoteEnvelope {
  format: typeof MARKER
  criteriaRevision: number
  userNote: string | null
}

export interface BetaRoundInput {
  note?: unknown
}

export type DecodedBetaRound<Round extends BetaRoundInput = BetaRoundInput> =
  Omit<Round, 'criteriaRevision' | 'note'> & {
    note?: Round['note'] | string | null
    criteriaRevision: number | null
  }

function isBetaNoteEnvelope(value: unknown): value is BetaNoteEnvelope {
  if (value === null || typeof value !== 'object') return false
  const data = value as Record<string, unknown>
  return data.format === MARKER && typeof data.criteriaRevision === 'number'
    && Number.isSafeInteger(data.criteriaRevision) && data.criteriaRevision >= 0
    && (data.userNote === null || typeof data.userNote === 'string')
}

export function encodeBetaNote(criteriaRevision: number, userNote?: string | null): string | null {
  const encoded = JSON.stringify({ format: MARKER, criteriaRevision, userNote: userNote ?? null })
  return encoded.length <= 10000 ? encoded : null
}

export function decodeBetaRound<Round extends BetaRoundInput>(round: Round): DecodedBetaRound<Round>
export function decodeBetaRound<Round extends BetaRoundInput>(round: Round | null | undefined): DecodedBetaRound<Round> | null
export function decodeBetaRound<Round extends BetaRoundInput>(round: Round | null | undefined): DecodedBetaRound<Round> | null {
  if (!round) return null
  try {
    const data: unknown = JSON.parse(String(round.note))
    if (isBetaNoteEnvelope(data)) {
      return { ...round, note: data.userNote, criteriaRevision: data.criteriaRevision }
    }
  } catch { /* Historical plain text is preserved, not treated as proof. */ }
  return { ...round, criteriaRevision: null }
}
