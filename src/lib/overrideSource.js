const SOURCE_KEYS = ['eventId', 'experimentId', 'runId', 'decisionId']

// These are record locators, never authorization. Every selected source is
// fetched again through the normal scoped API before it can be acted on.
export function readOverrideSource(search, view) {
  const params = new URLSearchParams(search)
  if (!SOURCE_KEYS.some(key => params.has(key))) return null
  const ids = Object.fromEntries(SOURCE_KEYS.map(key => [key, params.get(key)]))
  const invalid = SOURCE_KEYS.some(key => params.has(key) && (params.getAll(key).length !== 1
    || !ids[key] || ids[key].length > 100 || ids[key].trim() !== ids[key]
    || [...ids[key]].some(character => character.charCodeAt(0) < 32)))
  if (invalid) return { invalid: true }
  if (view === 'events' && ids.eventId && !ids.experimentId && !ids.runId && !ids.decisionId) return ids
  if (view === 'experiments' && ids.experimentId && !ids.eventId && !(ids.runId && ids.decisionId)) return ids
  return { invalid: true }
}

export function withoutOverrideSource(search) {
  const params = new URLSearchParams(search)
  for (const key of SOURCE_KEYS) params.delete(key)
  return params.size ? `?${params}` : ''
}
