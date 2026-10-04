import { describe, expect, it } from 'vitest'
import { buildRunPayload, buildRecordPayload } from '../shared/buildPayload.js'
import { runPipeline } from '../shared/pipeline.js'
import { validateBuildRecordSources, encodeBuildTrace, encodeBuildQuarantine, decodeBuildTrace, decodeBuildQuarantine } from '../shared/buildRecordSource.js'

const hash = 'a'.repeat(64), secret = 'PRIVATE_RAW_CELL_MUST_STAY_LOCAL'
const source = { file: 'same.csv', sheet: 'Sheet1', rowNo: 7, sha256: hash, ambiguousName: false }
const row = { date: '2026-06-01', iso_week: '2026-W23', sku: 'SKU-1', channel: 'A', qty: 1, gross_krw: 1000, contribution_krw: 500,
  source: { ...source, cells: [secret] }, trace: [{ step: '최종', value: '1000원', raw: [secret] }], raw: [secret], extra: secret }
const result = { files: [{ name: source.file, sheet: source.sheet, sha256: hash, ambiguousName: false, ok: true, rowsIn: 2, rowsOut: 1, quarantined: 1,
  buffer: secret, raw: [secret], unmappedColumns: [secret], extra: secret }],
  rows: [row], quarantine: [{ reason: 'bad_amount', source, externalCode: 'X', productName: '상품', note: '확인', raw: [secret], extra: secret }],
  totals: { all: { rows: 1, qty: 1, gross_krw: 1000, raw: secret }, byChannel: [{ channel: 'A', gross_krw: 1000, raw: secret }], byChannelWeek: [], raw: secret },
  stats: { duplicateSuspects: 0, durationMs: 5 }, raw: secret }

describe('build record network projection', () => {
  it('keeps calculation and lineage metadata while excluding every raw or arbitrary field', () => {
    const before = JSON.stringify(result), payload = buildRunPayload(result)
    expect(JSON.stringify(payload)).not.toContain(secret)
    expect(JSON.stringify(result)).toBe(before)
    expect(payload).toMatchObject({ kind: 'run', duplicate_suspects: 0, duration_ms: 5,
      rows: [{ gross_krw: 1000, contribution_krw: 500, source, trace: [{ step: '최종', value: '1000원' }] }],
      quarantine: [{ reason: 'bad_amount', source, externalCode: 'X', productName: '상품' }] })
    expect(payload.totals.all.gross_krw).toBe(1000)
    expect(() => validateBuildRecordSources(payload)).not.toThrow()
  })
  it('uses the same projection for older HTTP callers even if they send raw cells', () => {
    const payload = buildRecordPayload({ ...result, kind: 'run', duplicate_suspects: 2, duration_ms: 9 })
    expect(JSON.stringify(payload)).not.toContain(secret)
    expect(payload.duplicate_suspects).toBe(2)
    expect(payload.duration_ms).toBe(9)
  })
  it('retains duplicate references without extra raw fields', () => {
    const payload = buildRunPayload({ ...result, files: [{ ...result.files[0], duplicateOf: { file: 'original.csv', sha256: hash, raw: secret } }],
      rows: [{ ...row, duplicate_of: { ...source, raw: secret } }] })
    expect(payload.files[0].duplicateOf).toEqual({ file: 'original.csv', sha256: hash })
    expect(payload.rows[0].duplicate_of).toEqual(source)
    expect(JSON.stringify(payload)).not.toContain(secret)
  })
})

describe('versioned source envelopes', () => {
  it('decodes new records into legacy trace/raw arrays with separate provenance', () => {
    expect(decodeBuildTrace(encodeBuildTrace([{ step: '최종', value: '1000원' }], source))).toEqual({
      trace: [{ step: '최종', value: '1000원' }], source_sha256: hash, source_ambiguous_name: false, duplicate_source: null })
    expect(decodeBuildQuarantine(encodeBuildQuarantine(source))).toEqual({ raw: [], source_sha256: hash, source_ambiguous_name: false })
  })
  it('reads old arrays without inventing provenance or removing historical raw cells', () => {
    expect(decodeBuildTrace('[{"step":"기존","value":"100"}]')).toEqual({ trace: [{ step: '기존', value: '100' }], source_sha256: null, source_ambiguous_name: null, duplicate_source: null })
    expect(decodeBuildQuarantine(JSON.stringify([secret]))).toEqual({ raw: [secret], source_sha256: null, source_ambiguous_name: null })
  })
  it.each(['bad json', '{}', '{"format":"future","raw":[1]}', 'null'])('does not treat unknown or invalid envelopes as verified references: %s', value => {
    expect(decodeBuildTrace(value)).toEqual({ trace: [], source_sha256: null, source_ambiguous_name: null, duplicate_source: null })
    expect(decodeBuildQuarantine(value)).toEqual({ raw: [], source_sha256: null, source_ambiguous_name: null })
  })
  it('preserves an exact duplicate reference without retaining arbitrary original data', () => {
    const encoded = encodeBuildTrace([], source, { ...source, raw: [secret] })
    expect(encoded).not.toContain(secret)
    expect(decodeBuildTrace(encoded).duplicate_source).toEqual(source)
  })
})

describe('source manifest validation before persistence', () => {
  const payload = () => buildRunPayload(result)
  it('accepts absent legacy provenance and valid uppercase hashes', () => {
    expect(() => validateBuildRecordSources({ rows: [{ source: { file: 'legacy.csv' } }] })).not.toThrow()
    const value = payload(); value.files[0].sha256 = hash.toUpperCase()
    expect(() => validateBuildRecordSources(value)).not.toThrow()
  })
  it.each([
    value => { value.files = 'not-an-array' },
    value => { value.files[0].name = 42 },
    value => { value.files[0].sha256 = 'short' },
    value => { value.files[0].ambiguousName = 'true' },
    value => { value.files[0].rowsIn = -1 },
    value => { value.files[0].duplicateOf = { file: 'absent.csv', sha256: hash } },
    value => { value.rows[0].source.sha256 = 'b'.repeat(64) },
    value => { delete value.rows[0].source.sha256 },
    value => { delete value.rows[0].source.rowNo },
    value => { value.rows[0].source.rowNo = 0 },
    value => { delete value.rows[0].source },
    value => { value.quarantine[0].source.rowNo = 0 },
    value => { delete value.quarantine[0].source.sha256 },
    value => { value.files.push({ ...value.files[0], sha256: 'b'.repeat(64) }) },
    value => { value.rows[0].source.ambiguousName = true },
    value => { delete value.files[0].ambiguousName },
    value => { value.rows[0].source = [] },
    value => { value.rows[0].source.rowNo = 0.1 },
    value => { value.quarantine[0].source.file = 'foreign.csv' },
    value => { value.quarantine[0].source.sha256 = {} },
  ])('rejects malformed or manifest-mismatched claims', mutate => {
    const value = payload(); mutate(value)
    expect(() => validateBuildRecordSources(value)).toThrow('파일 출처 정보')
  })
  it('keeps all-unhashed legacy results valid without inventing a row number or fingerprint', () => {
    expect(() => validateBuildRecordSources({ files: [{ name: 'legacy.csv' }], rows: [{ source: { file: 'legacy.csv' } }],
      quarantine: [{ reason: 'legacy', source: { file: 'legacy.csv', rowNo: 0 } }] })).not.toThrow()
  })
  it('allows a file-level duplicate reference without a row number', () => {
    const value = payload()
    value.files.push({ name: 'copy.csv', sha256: hash, ambiguousName: false, skippedDuplicate: true, duplicateOf: { file: 'same.csv', sha256: hash } })
    expect(() => validateBuildRecordSources(value)).not.toThrow()
  })
  it('keeps the actual empty CSV quarantine as a file-level source, not a fabricated first row', async () => {
    const result = await runPipeline({ files: [{ name: 'empty.csv', buffer: new Uint8Array() }] })
    expect(result.quarantine[0]).toMatchObject({ reason: 'unknown_channel', source: { rowNo: 0 } })
    const payload = buildRunPayload(result)
    expect(payload.files[0]).toMatchObject({ headerRowNo: 0, ok: false })
    expect(() => validateBuildRecordSources(payload)).not.toThrow()
  })
})
