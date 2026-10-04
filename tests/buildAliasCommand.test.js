// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { normalizeBuildAliasCommand, saveBuildAlias } from '../functions/_lib/buildAlias.ts'
import { mutationFingerprint } from '../functions/_lib/atomicMutation.ts'

const input = changes => ({ external_code: 'mixed-Code', canonical_code: 'NR-CM-100', ...changes })
describe('build alias exact command boundary', () => {
  it('normalizes snake-case semantics while excluding untrusted product and author metadata', async () => {
    const base = normalizeBuildAliasCommand(input(), true)
    const other = normalizeBuildAliasCommand(input({ external_code: ' mixed-Code ', canonical_code: ' nr-cm-100 ',
      product_name: { arbitrary: true }, taught_by: ['forged'], owner_email: 'another', affected: -1 }), true)
    expect(base).toEqual({ ok: true, value: { externalCode: 'mixed-Code', canonicalCode: 'NR-CM-100', channel: null, note: null, teacher: null } })
    expect(other).toEqual(base)
    expect(await mutationFingerprint(other.value)).toBe(await mutationFingerprint(base.value))
  })
  it('preserves the demo default and explicit trimmed demo teacher', () => {
    expect(normalizeBuildAliasCommand(input(), false)).toMatchObject({ ok: true, value: { teacher: 'AX 담당자' } })
    expect(normalizeBuildAliasCommand(input({ taught_by: ' 체험 담당자 ', channel: ' shop ', note: ' 근거 ' }), false))
      .toMatchObject({ ok: true, value: { teacher: '체험 담당자', channel: 'shop', note: '근거' } })
  })
  it.each([null, [], 'text', 1])('rejects a non-record %j', body => {
    expect(normalizeBuildAliasCommand(body, true)).toMatchObject({ ok: false, fields: { body: expect.any(String) } })
  })
  it.each([['external_code', 80], ['canonical_code', 40], ['channel', 40], ['note', 300], ['taught_by', 60]])('enforces exact %s length and type without truncation', (field, limit) => {
    for (const value of [[], {}, 1, false, 'x'.repeat(limit + 1), 'invalid\0', 'invalid\ud800']) {
      expect(normalizeBuildAliasCommand(input({ [field]: value }), false)).toMatchObject({ ok: false, fields: { [field]: expect.any(String) } })
    }
    if (field !== 'canonical_code') {
      for (const value of ['x'.repeat(limit), '😀']) expect(normalizeBuildAliasCommand(input({ [field]: value }), false).ok).toBe(true)
    }
  })
  it.each(['__proto__', 'constructor', 'unknown', ''])('requires an own catalog canonical key: %s', canonical_code => {
    expect(normalizeBuildAliasCommand(input({ canonical_code }), true)).toMatchObject({ ok: false, fields: { canonical_code: expect.any(String) } })
  })
  it('does not alter external code case and rejects self-aliases', () => {
    expect(normalizeBuildAliasCommand(input({ external_code: '__proto__' }), true).ok).toBe(true)
    expect(normalizeBuildAliasCommand(input({ external_code: 'nr-cm-100' }), true)).toMatchObject({ ok: false, fields: { external_code: expect.any(String) } })
  })
  it.each([null, 'short', 'x'.repeat(101), 'invalid.key.1234567'])('requires the existing idempotency-key contract: %j', async key => {
    const prepare = vi.fn()
    expect((await saveBuildAlias({ DB: { prepare }, DEMO_WORKSPACE: true }, 'app', input(), key)).status).toBe(400)
    expect(prepare).not.toHaveBeenCalled()
  })
  it('fails closed before helper SQL or receipt lookup on unsupported or mismatched adapters', async () => {
    const prepare = vi.fn(), mutationReceipt = vi.fn(), commitMutation = vi.fn(), key = crypto.randomUUID()
    expect((await saveBuildAlias({ DB: { prepare, workspace: true }, DEMO_WORKSPACE: true }, 'app', input(), key)).status).toBe(503)
    for (const DB of [{ prepare, mutationReceipt, commitMutation }, { prepare, mutationReceipt, commitMutation, actorEmail: 'other' },
      { prepare, mutationReceipt, commitMutation, actorEmail: 'one', workspace: true }]) {
      expect((await saveBuildAlias({ DB, AUTH_ACTOR: { mode: 'access', email: 'one' } }, 'app', input(), key)).status).toBe(401)
    }
    expect((await saveBuildAlias({ DB: { prepare, mutationReceipt, commitMutation } }, 'app', input(), key)).status).toBe(503)
    expect(prepare).not.toHaveBeenCalled(); expect(mutationReceipt).not.toHaveBeenCalled(); expect(commitMutation).not.toHaveBeenCalled()
  })
})
