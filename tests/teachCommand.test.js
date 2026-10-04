// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { normalizeTeachCommand } from '../shared/teachCommand.ts'
import { mutationFingerprint } from '../functions/_lib/atomicMutation.ts'

const body = changes => ({ externalCode: 'mixed-Code', canonicalCode: 'NR-CM-100', teacher: '현장 담당자', affected: 1, ...changes })

describe('teaching commands retain identity without coercion or truncation', () => {
  it('normalizes only the existing semantic fields and preserves code case', () => {
    expect(normalizeTeachCommand(body({ externalCode: '  mixed-Code  ', canonicalCode: ' nr-cm-100 ', channel: ' shop ', note: ' 근거 ', ignored: 'x' }), false))
      .toEqual({ ok: true, value: { externalCode: 'mixed-Code', canonicalCode: 'NR-CM-100', channel: 'shop', note: '근거', affected: 1, teacher: '현장 담당자' } })
    expect(normalizeTeachCommand(body({ externalCode: '__proto__', affected: undefined, channel: '', note: null }), false)).toMatchObject({ ok: true, value: { externalCode: '__proto__', affected: 0, channel: null, note: null } })
  })

  it.each([null, [], 'text', 1, true])('rejects a non-record body: %j', value => {
    expect(normalizeTeachCommand(value, true)).toMatchObject({ ok: false, fields: { body: expect.any(String) } })
  })

  it.each(['externalCode', 'canonicalCode', 'channel', 'note', 'teacher'])('does not stringify malformed %s values', field => {
    for (const value of [1, true, [], {}, null]) {
      if (value === null && ['channel', 'note'].includes(field)) continue
      expect(normalizeTeachCommand(body({ [field]: value }), false)).toMatchObject({ ok: false, fields: { [field]: expect.any(String) } })
    }
  })

  it.each([['externalCode', 80], ['canonicalCode', 40], ['channel', 40], ['note', 300], ['teacher', 60]])('rejects oversized %s without cutting it', (field, limit) => {
    expect(normalizeTeachCommand(body({ [field]: 'x'.repeat(limit + 1) }), false)).toMatchObject({ ok: false, fields: { [field]: expect.any(String) } })
    if (field !== 'canonicalCode') expect(normalizeTeachCommand(body({ [field]: 'x'.repeat(limit) }), false).ok).toBe(true)
  })

  it.each(['externalCode', 'canonicalCode', 'channel', 'note', 'teacher'])('rejects PostgreSQL-invalid text in %s but keeps paired Unicode', field => {
    for (const value of ['bad\0code', 'bad\ud800code', 'bad\udcffcode']) {
      expect(normalizeTeachCommand(body({ [field]: value }), false)).toMatchObject({ ok: false, fields: { [field]: expect.any(String) } })
    }
    if (field !== 'canonicalCode') expect(normalizeTeachCommand(body({ [field]: 'valid-😀' }), false).ok).toBe(true)
  })

  it.each([null, '1', true, {}, [], -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid affected count %j', affected => {
    expect(normalizeTeachCommand(body({ affected }), true)).toMatchObject({ ok: false, fields: { affected: expect.any(String) } })
  })

  it('accepts nonnegative safe integer counts, unknown catalog and same-code checks stay enforced', () => {
    for (const affected of [0, 1, 500000, Number.MAX_SAFE_INTEGER]) expect(normalizeTeachCommand(body({ affected }), true).ok).toBe(true)
    for (const canonicalCode of ['__proto__', 'constructor', 'unknown']) expect(normalizeTeachCommand(body({ canonicalCode }), true)).toMatchObject({ ok: false, fields: { canonicalCode: expect.any(String) } })
    expect(normalizeTeachCommand(body({ externalCode: 'nr-cm-100' }), true)).toMatchObject({ ok: false, fields: { externalCode: expect.any(String) } })
  })

  it('completely ignores caller teacher in account mode including malformed text', async () => {
    const normalized = normalizeTeachCommand(body(), true)
    for (const teacher of [undefined, null, {}, 1, ['fake'], 'bad\0\ud800' + 'x'.repeat(100)]) {
      expect(normalizeTeachCommand(body({ teacher }), true)).toEqual(normalized)
    }
    expect(normalized).toMatchObject({ ok: true, value: { teacher: null } })
    const one = normalizeTeachCommand(body({ externalCode: ' mixed-Code ', canonicalCode: ' nr-cm-100 ', teacher: {} }), true)
    const two = normalizeTeachCommand(body({ unused: 'does not change intent' }), true)
    expect(await mutationFingerprint({ kind: 'teach', slug: 'tool', command: one.value })).toBe(await mutationFingerprint({ kind: 'teach', slug: 'tool', command: two.value }))
  })
})
