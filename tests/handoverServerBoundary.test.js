import { describe, expect, it, vi } from 'vitest'
import { onRequestPost, validatedHandoverBody } from '../functions/api/applications/[id]/handover.ts'

const version = 'a'.repeat(64)
const release = () => ({ action: 'create', title: '정산 도구', person: '재무 담당', whenToRun: '시연 파일 확인 시',
  afterRun: '원본과 비교', contact: 'AX 담당', dailyLimit: 20, maxFileMb: 10, reason: '검증한 범위에서 인계합니다.',
  scopeAccepted: true, humanChecks: {}, expectedEvidence: version })

function context(body, extra = {}) {
  const prepare = vi.fn(() => { throw new Error('Unexpected database read') })
  const DB = { prepare, mutationReceipt: vi.fn(async () => null), commitMutation: vi.fn() }
  return { env: { DB }, params: { id: 'contract-only' }, request: new Request('https://local.invalid/api/handover', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify(body),
  }), ...extra }
}

describe('handover server raw-input boundary', () => {
  it.each([null, [], 'text', 1, true])('rejects non-object HTTP input %j before database use', async body => {
    const ctx = context(body)
    expect((await onRequestPost(ctx)).status).toBe(400)
    expect(ctx.env.DB.prepare).not.toHaveBeenCalled()
    expect(ctx.env.DB.mutationReceipt).not.toHaveBeenCalled()
  })

  it.each([undefined, null, 1, [], 'short', 'z'.repeat(64)])('keeps missing/invalid evidence %j as a not-saved conflict', async expectedEvidence => {
    const ctx = context({ ...release(), expectedEvidence })
    const response = await onRequestPost(ctx)
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'HANDOVER_CONFLICT', notSaved: true })
    expect(ctx.env.DB.prepare).not.toHaveBeenCalled()
    expect(ctx.env.DB.mutationReceipt).not.toHaveBeenCalled()
  })

  it('checks authentication inside the atomic action without trusting an otherwise valid body', async () => {
    const ctx = context(release())
    const response = await onRequestPost(ctx)
    expect(response.status).toBe(401)
    expect(ctx.env.DB.mutationReceipt).toHaveBeenCalledOnce()
    expect(ctx.env.DB.prepare).not.toHaveBeenCalled()
    expect(ctx.env.DB.commitMutation).not.toHaveBeenCalled()
  })

  it('preserves the minimal stop request without requiring release instructions', () => {
    expect(validatedHandoverBody({ action: 'stop', reason: '현장 검증을 위해 중단합니다.' }, [], version)).toEqual({
      ok: true, value: { action: 'stop', reason: '현장 검증을 위해 중단합니다.', expectedEvidence: version },
    })
  })

  it('constructs only server-consumed human checks while preserving text until persistence', () => {
    const humanCriteria = [{ id: 'human' }]
    const body = { ...release(), humanChecks: { human: { confirmed: true, evidence: '  담당자가 직접 실행했습니다.  ' },
      ignored: { confirmed: 'untrusted', evidence: {} } }, ignored: 'not persisted' }
    const result = validatedHandoverBody(body, humanCriteria, version)
    expect(result.ok).toBe(true)
    expect(result.value.humanChecks).toEqual({ human: { confirmed: true, evidence: '  담당자가 직접 실행했습니다.  ' } })
    expect(result.value).not.toHaveProperty('ignored')
    expect(body.humanChecks).toHaveProperty('ignored')
  })

  it('does not require unused human-check data when no human criteria exist', () => {
    for (const humanChecks of [undefined, null, [], { unused: 'raw historical input' }]) {
      expect(validatedHandoverBody({ ...release(), humanChecks }, [], version)).toMatchObject({ ok: true, value: { humanChecks: {} } })
    }
  })

  it.each([
    { action: 'invented' }, { title: null }, { reason: [] }, { dailyLimit: '20' }, { maxFileMb: 11 }, { scopeAccepted: 'true' },
  ])('returns field errors rather than a trusted value for malformed release input %j', patch => {
    const result = validatedHandoverBody({ ...release(), ...patch }, [], version)
    expect(result.ok).toBe(false)
    expect(Object.keys(result.fields).length).toBeGreaterThan(0)
    expect(result).not.toHaveProperty('value')
  })

  it.each([null, [], { human: null }, { human: { confirmed: 'true', evidence: '직접 확인했습니다.' } },
    { human: { confirmed: true, evidence: [] } }])('does not trust malformed nested human evidence %j', humanChecks => {
    const result = validatedHandoverBody({ ...release(), humanChecks }, [{ id: 'human' }], version)
    expect(result).toMatchObject({ ok: false, fields: { humanChecks: expect.any(String) } })
    expect(result).not.toHaveProperty('value')
  })
})
