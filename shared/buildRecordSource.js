// These hashes are client-supplied provenance claims, not proof that the server
// received or verified the original bytes. Existing JSON columns keep the schema
// compatible; old trace/raw arrays are read without rewriting historical data.
const TRACE = 'ilson.build-trace.v1'
const QUARANTINE = 'ilson.build-quarantine.v1'
const SHA256 = /^[a-f0-9]{64}$/i
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const own = (value, key) => Object.hasOwn(value, key)
const nullableText = (value, max) => value == null || (typeof value === 'string' && value.length <= max && !value.includes('\0'))
const integer = value => value == null || (Number.isSafeInteger(value) && value >= 0)
const referenceError = () => new Error('파일 출처 정보의 형식이나 지문이 올바르지 않습니다.')

function validateSource(source, file = false) {
  if (source == null) return
  if (!record(source)) throw referenceError()
  if (!nullableText(source[file ? 'name' : 'file'], 500) || !nullableText(source.sheet, 200)) throw referenceError()
  if (source.sha256 != null && (typeof source.sha256 !== 'string' || !SHA256.test(source.sha256))) throw referenceError()
  if (source.ambiguousName != null && typeof source.ambiguousName !== 'boolean') throw referenceError()
  if (!file && !integer(source.rowNo)) throw referenceError()
}

export function validateBuildRecordSources(body) {
  if (!record(body)) throw referenceError()
  for (const key of ['files','rows','quarantine']) if (own(body, key) && !Array.isArray(body[key])) throw referenceError()
  const files = body.files ?? [], manifest = new Map(), contentsByName = new Map()
  for (const file of files) {
    if (!record(file) || typeof file.name !== 'string' || !file.name) throw referenceError()
    validateSource(file, true)
    for (const key of ['headerRowNo','rowsIn','rowsOut','quarantined']) if (!integer(file[key])) throw referenceError()
    for (const key of ['ok','encodingConfident','skippedDuplicate','warnOnly']) if (file[key] != null && typeof file[key] !== 'boolean') throw referenceError()
    for (const key of ['channel','encoding','skippedPeriod','note']) if (!nullableText(file[key], 2000)) throw referenceError()
    if (file.sha256) {
      const hash = file.sha256.toLowerCase(), key = JSON.stringify([file.name, hash])
      if (!manifest.has(key)) manifest.set(key, [])
      manifest.get(key).push(file)
      if (!contentsByName.has(file.name)) contentsByName.set(file.name, new Set())
      contentsByName.get(file.name).add(hash)
    }
    if (file.duplicateOf != null) {
      validateSource(file.duplicateOf)
      if (!record(file.duplicateOf) || typeof file.duplicateOf.file !== 'string' || !file.duplicateOf.file) throw referenceError()
      if (file.sha256 && file.duplicateOf.sha256?.toLowerCase() !== file.sha256.toLowerCase()) throw referenceError()
    }
  }
  const hashed = manifest.size > 0
  // All-unhashed payloads retain legacy compatibility. Once a payload claims
  // fingerprinted provenance, missing parts cannot silently downgrade a row.
  if (hashed) for (const file of files) {
    if (!file.sha256 || file.ambiguousName !== (contentsByName.get(file.name).size > 1)) throw referenceError()
  }
  const checkReference = (source, row = null, quarantined = false) => {
    validateSource(source)
    if (hashed && !source?.sha256) throw referenceError()
    const matches = source?.sha256 ? manifest.get(JSON.stringify([source.file, source.sha256.toLowerCase()])) : null
    if (source?.sha256 && !matches) throw referenceError()
    if (hashed && row) {
      if (source.ambiguousName !== (contentsByName.get(source.file).size > 1)) throw referenceError()
      const positiveRow = Number.isSafeInteger(source.rowNo) && source.rowNo > 0
      // readCsv uses row 0 only when the file has no header at all. This is a
      // file-level quarantine, not a fabricated first row in the original.
      const missingHeader = quarantined && row.reason === 'unknown_channel' && source.rowNo === 0
        && matches.some(file => file.ok === false && file.headerRowNo === 0 && (file.sheet ?? '') === (source.sheet ?? ''))
      if (!positiveRow && !missingHeader) throw referenceError()
    }
  }
  for (const file of files) if (file.duplicateOf != null) checkReference(file.duplicateOf)
  for (const [rows, quarantined] of [[body.rows ?? [], false], [body.quarantine ?? [], true]]) {
    for (const row of rows) {
      if (!record(row)) throw referenceError()
      checkReference(row.source, row, quarantined)
      if (row.duplicate_of != null) checkReference(row.duplicate_of, row)
    }
  }
}

const metadata = source => ({
  sha256: typeof source?.sha256 === 'string' && SHA256.test(source.sha256) ? source.sha256.toLowerCase() : null,
  ambiguousName: typeof source?.ambiguousName === 'boolean' ? source.ambiguousName : null,
})
function duplicateReference(source) {
  if (!record(source) || typeof source.file !== 'string' || !nullableText(source.file, 500)
    || !nullableText(source.sheet, 200) || !integer(source.rowNo)) return null
  return { file: source.file, sheet: source.sheet ?? null, rowNo: source.rowNo ?? 0, ...metadata(source) }
}
export const encodeBuildTrace = (steps, source, duplicateSource) => JSON.stringify({ format: TRACE, source: metadata(source), steps,
  ...(duplicateSource ? { duplicateSource: duplicateReference(duplicateSource) } : {}) })
export const encodeBuildQuarantine = source => JSON.stringify({ format: QUARANTINE, source: metadata(source) })
function parse(value) {
  try { return typeof value === 'string' ? JSON.parse(value) : value } catch { return null }
}
function decode(parsed, format, field) {
  if (Array.isArray(parsed)) return { [field]: parsed, source_sha256: null, source_ambiguous_name: null }
  const envelope = record(parsed) && parsed.format === format ? parsed : null
  const source = metadata(envelope?.source)
  return { [field]: field === 'trace' && Array.isArray(envelope?.steps) ? envelope.steps : [],
    source_sha256: source.sha256, source_ambiguous_name: source.ambiguousName }
}
export const decodeBuildTrace = value => {
  const parsed = parse(value)
  return { ...decode(parsed, TRACE, 'trace'),
    duplicate_source: parsed?.format === TRACE ? duplicateReference(parsed.duplicateSource) : null }
}
export const decodeBuildQuarantine = value => decode(parse(value), QUARANTINE, 'raw')
