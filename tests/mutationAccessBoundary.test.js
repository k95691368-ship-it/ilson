// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSupabaseDb } from '../functions/_lib/dbBridge.ts'
import { agreementMutation } from '../functions/_lib/agreementEvidence.js'
import { departmentMutation } from '../functions/_lib/departmentMutation.js'
import { outcomeMutation } from '../functions/_lib/outcomeEvidence.js'
import { onRequestPost as handover } from '../functions/api/applications/[id]/handover.ts'
import { api } from '../src/api/client.ts'
import { beginAccessCheck, completeAccessCheck, getAccessSession } from '../src/lib/accessSession.js'

const request = () => new Request('https://local.invalid/api/mutation', { method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': 'mutation-access-boundary-0001' },
  body: JSON.stringify({ expectedEvidence: 'f'.repeat(64) }) })
const success = async () => Response.json({ ok: true })
const cases = [
  ['agreement', DB => agreementMutation({ DB, DEMO_WORKSPACE: true }, request(), 'local', {}, success)],
  ['department', DB => departmentMutation({ DB }, request(), 'local', {}, success)],
  ['outcome', DB => outcomeMutation(DB, request(), 'local', {}, success)],
  ['handover', DB => handover({ env: { DB, DEMO_WORKSPACE: true }, params: { id: 'local' }, request: request() })],
]
afterEach(() => vi.unstubAllGlobals())
function databaseFailure(code, scope = 'actor') {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ code, message: 'PRIVATE SQL CREDENTIAL DATA' }, { status: 400 })))
  return createSupabaseDb('https://local-boundary.supabase.co', 'memory-only', scope === 'workspace' ? 'a'.repeat(64) : null,
    scope === 'actor' ? 'builder@local.invalid' : null)
}

describe.each(cases)('%s scoped mutation error boundary', (_name, invoke) => {
  it.each(['actor', 'workspace'])('%s expiration is 401 with a trusted access code, not an edit conflict', async scope => {
    const response = await invoke(databaseFailure('28000', scope)), body = await response.json()
    expect(response.status).toBe(401)
    expect(body).toMatchObject({ code: 'ACCESS_REVOKED' })
    expect(body).not.toHaveProperty('notSaved')
    expect(JSON.stringify(body)).not.toMatch(/PRIVATE|CREDENTIAL|28000|Database request/)
  })

  it('preserves scoped local denial as 403 without widening it to session expiration', async () => {
    const response = await invoke(databaseFailure('42501'))
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'ACCESS_DENIED' })
  })

  it.each(['40001', '40P01'])('keeps a genuine %s transaction conflict at 409', async code => {
    const response = await invoke(databaseFailure(code))
    expect(response.status).toBe(409)
    expect(JSON.stringify(await response.json())).not.toMatch(/ACCESS_REVOKED|ACCESS_DENIED|PRIVATE|CREDENTIAL/)
  })

  it.each(['28000', '42501'])('does not promote unscoped %s to a user access failure or edit conflict', async code => {
    const response = await invoke(databaseFailure(code, 'unscoped'))
    expect(response.status).toBe(503)
    expect(await response.json()).not.toHaveProperty('code')
  })

  it.each(['280001', '400010', '40001X', '40P010', 'XX000'])('does not classify lookalike/other SQLSTATE %s as a conflict', async code => {
    expect((await invoke(databaseFailure(code))).status).toBe(503)
  })

  it.each([null, undefined, 'PRIVATE MESSAGE', { message: { secret: 'PRIVATE MESSAGE' } }])('returns a safe failure for unknown thrown values %j', async error => {
    const response = await invoke({ mutationReceipt: async () => { throw error }, commitMutation: vi.fn() })
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain('PRIVATE MESSAGE')
  })

  it.each([['28000', 401, 'blocked'], ['42501', 403, 'active'], ['40001', 409, 'active']])('the real client handles %s as %s with the correct session state', async (code, status, sessionStatus) => {
    const response = await invoke(databaseFailure(code))
    completeAccessCheck(beginAccessCheck(), { ok: true, mode: 'access', scope: 'b'.repeat(64) })
    const fetcher = vi.fn().mockResolvedValueOnce(response).mockResolvedValueOnce(Response.json({ other: 'allowed' }))
    vi.stubGlobal('fetch', fetcher)
    await expect(api.post('/mutation-boundary', {})).rejects.toMatchObject({ status })
    expect(getAccessSession().status).toBe(sessionStatus)
    if (sessionStatus === 'blocked') {
      await expect(api.get('/other-resource')).rejects.toMatchObject({ status: 401 })
      expect(fetcher).toHaveBeenCalledOnce()
    } else {
      await expect(api.get('/other-resource')).resolves.toEqual({ other: 'allowed' })
      expect(fetcher).toHaveBeenCalledTimes(2)
    }
  })
})
