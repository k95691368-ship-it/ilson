// The server wraps user text after validation. An apparent envelope supplied by
// a client is still just userNote, never trusted provenance.
const MARKER = 'ilson.beta-evidence.v1'
export function encodeBetaNote(criteriaRevision, userNote) {
  const encoded = JSON.stringify({ format: MARKER, criteriaRevision, userNote: userNote ?? null })
  return encoded.length <= 10000 ? encoded : null
}

export function decodeBetaRound(round) {
  if (!round) return null
  try {
    const data = JSON.parse(round.note)
    if (data?.format === MARKER && Number.isSafeInteger(data.criteriaRevision) && data.criteriaRevision >= 0
      && (data.userNote === null || typeof data.userNote === 'string')) {
      return { ...round, note: data.userNote, criteriaRevision: data.criteriaRevision }
    }
  } catch { /* Historical plain text is preserved, not treated as proof. */ }
  return { ...round, criteriaRevision: null }
}
