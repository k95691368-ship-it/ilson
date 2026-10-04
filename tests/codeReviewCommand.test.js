// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { CODE_REVIEW_PREFIX, normalizeCodeReviewCommand, encodeCodeReviewEvidence, decodeCodeReviewEvidence, projectCodeReviewDecision,
  codeMappingRevision, codeEditVersion, nextCodeReviewTimestamp, CodeReviewTimestampError } from '../shared/codeReviewEvidence.ts'

const version = 'a'.repeat(64)
const command = changes => ({ externalCode: 'mixed-Code', action: 'correct', expectedVersion: version, canonicalCode: 'NR-PA-030', why: '원본 상품과 다르게 연결되어 정정합니다.', author: 'AX 담당자', ...changes })
const evidence = changes => ({ version: 1, action: 'confirm', externalCode: 'mixed-Code', reviewedMappingRevision: version,
  beforeCanonicalCode: 'NR-CM-100', afterCanonicalCode: 'NR-CM-100', provenance: { state: 'linked', applicationId: 'app' }, ...changes })
const context = changes => ({ link_kind: '코드확인', link_id: 'mixed-Code', application_id: 'app', ...changes })
const alias = { external_code: 'mixed-Code', canonical_code: 'NR-CM-100', product_name: '상품', channel: null, note: null, taught_by: '담당자', owner_email: 'synthetic@local.invalid', created_at: '2026-10-04 01:00:00' }

describe('exact code review command validation', () => {
  it('projects only normalized semantics while ignoring real author completely', () => {
    const result = normalizeCodeReviewCommand(command({ externalCode: ' mixed-Code ', canonicalCode: ' nr-pa-030 ', author: { malicious: 'bad\0\ud800' }, applicationId: 'fake' }), true)
    expect(result).toEqual({ ok: true, value: { externalCode: 'mixed-Code', expectedVersion: version, action: 'correct', canonicalCode: 'NR-PA-030', why: '원본 상품과 다르게 연결되어 정정합니다.', author: null } })
    for (const author of [1, [], null, undefined, 'x'.repeat(100)]) expect(normalizeCodeReviewCommand(command({ author }), true)).toEqual(result)
  })
  it('uses a displayed-mapping confirmation, never inventing source-file examination', () => {
    const result = normalizeCodeReviewCommand({ externalCode: 'code', action: 'confirm', expectedVersion: version }, false)
    expect(result).toMatchObject({ ok: true, value: { action: 'confirm', why: '표시된 상품 연결이 맞다고 확인했습니다.', author: 'AX 담당자' } })
    expect(result.value).not.toHaveProperty('canonicalCode')
  })
  it.each([null, [], 'text', 1])('rejects non-record input %j', body => expect(normalizeCodeReviewCommand(body, true).ok).toBe(false))
  it.each(['externalCode', 'expectedVersion', 'canonicalCode', 'why', 'author'])('rejects malformed %s without string coercion', field => {
    for (const value of [null, true, {}, [], 1]) expect(normalizeCodeReviewCommand(command({ [field]: value }), false)).toMatchObject({ ok: false, fields: { [field]: expect.any(String) } })
  })
  it.each([['externalCode', 80], ['canonicalCode', 40], ['why', 2000], ['author', 60]])('enforces %s length without truncation', (field, max) => {
    expect(normalizeCodeReviewCommand(command({ [field]: 'x'.repeat(max + 1) }), false)).toMatchObject({ ok: false, fields: { [field]: expect.any(String) } })
    if (field !== 'canonicalCode') expect(normalizeCodeReviewCommand(command({ [field]: 'x'.repeat(max) }), false).ok).toBe(true)
  })
  it.each(['externalCode', 'canonicalCode', 'why', 'author'])('rejects NUL/lone surrogates in %s while preserving paired astral text', field => {
    for (const value of ['bad\0text', 'bad\ud800text', 'bad\udffftext']) expect(normalizeCodeReviewCommand(command({ [field]: value }), false)).toMatchObject({ ok: false, fields: { [field]: expect.any(String) } })
    if (field !== 'canonicalCode') expect(normalizeCodeReviewCommand(command({ [field]: 'valid-😀text' }), false).ok).toBe(true)
  })
  it('requires exact action/version and catalog own-membership; confirm cannot pretend to review another target', () => {
    for (const action of [' correct ', 'other', 1]) expect(normalizeCodeReviewCommand(command({ action }), true).ok).toBe(false)
    for (const expectedVersion of ['', 'a'.repeat(63), 'A'.repeat(64), 'a'.repeat(65)]) expect(normalizeCodeReviewCommand(command({ expectedVersion }), true).ok).toBe(false)
    for (const canonicalCode of ['__proto__', 'constructor', 'unknown']) expect(normalizeCodeReviewCommand(command({ canonicalCode }), true).ok).toBe(false)
    expect(normalizeCodeReviewCommand(command({ why: '짧음' }), true).ok).toBe(false)
    expect(normalizeCodeReviewCommand(command({ action: 'confirm' }), true)).toMatchObject({ ok: false, fields: { canonicalCode: expect.any(String) } })
  })
})

describe('strict reserved code evidence and consumer projection', () => {
  it('round-trips only exact versioned metadata bound to its row context', () => {
    const value = evidence(), encoded = encodeCodeReviewEvidence(value)
    expect(decodeCodeReviewEvidence(encoded, context())).toEqual(value)
    for (const row of [context({ link_kind: '코드정정' }), context({ link_id: 'other' }), context({ application_id: null })]) expect(decodeCodeReviewEvidence(encoded, row)).toBeNull()
    expect(decodeCodeReviewEvidence(encodeCodeReviewEvidence(evidence({ provenance: { state: 'unknown', applicationId: null } })), context({ application_id: null }))).not.toBeNull()
  })
  it.each([{ version: 2 }, { extra: true }, { reviewedMappingRevision: 'bad' }, { afterCanonicalCode: 'NR-PA-030' }, { externalCode: [] }, { provenance: { state: 'linked', applicationId: 'app', extra: true } }])('rejects malformed envelope %j', change => {
    const raw = CODE_REVIEW_PREFIX + JSON.stringify(evidence(change))
    expect(decodeCodeReviewEvidence(raw, context())).toBeNull()
    expect(projectCodeReviewDecision({ ...context(), alternatives: raw })).toMatchObject({ alternatives: null, code_review_evidence_status: 'unreadable' })
  })
  it('hides malformed/unknown-version metadata, but preserves legacy and other-kind alternatives byte for byte', () => {
    for (const alternatives of [CODE_REVIEW_PREFIX + '{', CODE_REVIEW_PREFIX + '{"version":9}']) expect(projectCodeReviewDecision({ ...context(), alternatives })).toMatchObject({ alternatives: null, code_review_evidence_status: 'unreadable' })
    for (const row of [{ ...context(), alternatives: '  원문 대안  ' }, { ...context({ link_kind: 'review' }), alternatives: CODE_REVIEW_PREFIX + '{' }, { ...context(), alternatives: null }]) {
      expect(projectCodeReviewDecision(row)).toBe(row)
    }
    const row = { ...context(), id: 'id', title: '이름', what: '내용', why: '근거', created_at: 'time', alternatives: encodeCodeReviewEvidence(evidence()) }
    const result = projectCodeReviewDecision(row)
    expect(result).toMatchObject({ id: 'id', title: '이름', what: '내용', why: '근거', created_at: 'time', alternatives: null, code_review_evidence_status: 'verified' })
    expect(row.alternatives).toContain(CODE_REVIEW_PREFIX)
  })
})

describe('opaque edit identities and advancing writer timestamps', () => {
  it('ignores history retrieval order and unrelated columns but changes on a same-second correction event set', async () => {
    const history = [{ id: 'z', link_kind: '코드정정', link_id: alias.external_code, created_at: alias.created_at }, { id: 'a', link_kind: '코드정정', link_id: alias.external_code, created_at: alias.created_at }]
    expect(await codeMappingRevision(alias, history)).toBe(await codeMappingRevision({ ...alias, ignored: 'unrelated' }, [...history].reverse()))
    expect(await codeMappingRevision(alias, history)).not.toBe(await codeMappingRevision(alias, []))
    const before = await codeEditVersion(alias, history), confirmation = { id: 'confirm', link_kind: '코드확인', link_id: alias.external_code, created_at: alias.created_at }
    expect(await codeMappingRevision(alias, [...history, confirmation])).toBe(await codeMappingRevision(alias, history))
    expect(await codeEditVersion(alias, [...history, confirmation])).not.toBe(before)
  })
  it('shows the limit of an unaudited external writer reverting the entire snapshot', async () => {
    expect(await codeEditVersion({ ...alias }, [])).toBe(await codeEditVersion(alias, []))
    expect(await codeEditVersion({ ...alias, canonical_code: 'NR-PA-030' }, [])).not.toBe(await codeEditVersion(alias, []))
    // Without a persistent event/revision, a reverted byte-identical snapshot
    // is indistinguishable. This helper makes no global build-writer guarantee.
  })
  it('parses legacy SQL times as UTC and strictly advances identical/future valid writer values', () => {
    const now = Date.parse('2026-10-04T01:00:00.000Z')
    expect(nextCodeReviewTimestamp('2026-10-04 01:00:00', now)).toBe('2026-10-04T01:00:00.001Z')
    expect(nextCodeReviewTimestamp('2026-10-04T01:00:00.001Z', now)).toBe('2026-10-04T01:00:00.002Z')
    expect(nextCodeReviewTimestamp('2027-10-04 01:00:00', now)).toBe('2027-10-04T01:00:00.001Z')
    expect(nextCodeReviewTimestamp('2026-10-04 01:00:00.123456', now)).toBe('2026-10-04T01:00:00.124Z')
  })
  it('handles invalid legacy time conservatively and fails closed at the Date maximum/clock overflow', () => {
    const now = Date.parse('2026-10-04T01:00:00.000Z')
    for (const previous of ['invalid', '2026-02-31 12:00:00', null]) expect(nextCodeReviewTimestamp(previous, now)).toBe('2026-10-04T01:00:00.000Z')
    expect(() => nextCodeReviewTimestamp('+275760-09-13T00:00:00.000Z', now)).toThrow(CodeReviewTimestampError)
    for (const clock of [NaN, Infinity, 8640000000000001, 1.5]) expect(() => nextCodeReviewTimestamp(null, clock)).toThrow(CodeReviewTimestampError)
  })
})
