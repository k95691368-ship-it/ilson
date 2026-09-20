import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSupabaseDb } from '../functions/_lib/dbBridge.js'
import { onRequestPost as build } from '../functions/api/applications/[id]/build.js'
import { onRequestPatch as agreement } from '../functions/api/applications/[id]/agreement.js'

afterEach(() => vi.unstubAllGlobals())

// Execute the real handler and scoped RPC bridge. Only the RPC transport is
// simulated; access errors must be branded by dbBridge, not forged by the test.
function fixture({ failure, sqlstate, firstBuild = false }) {
  const requested = []
  const accepted = []
  const denied = []
  const fetcher = vi.fn(async (url, options) => {
    expect(String(url)).toMatch(/\/rpc\/ilson_actor_(query|batch)$/)
    const body = JSON.parse(options.body)
    expect(body.p_actor).toBe('local-builder@example.test')
    const statements = body.p_statements ?? [body.p_sql]
    requested.push(...statements)
    const rejected = statements.find(sql => failure(sql))
    if (rejected) {
      denied.push(rejected)
      return Response.json({ code: sqlstate, message: 'private SQL details must not escape' }, { status: 500 })
    }
    const results = statements.map(sql => {
      if (/^SELECT id, ticket_no/.test(sql)) return { rows: [{ id: 'local-app', ticket_no: 'AX-LOCAL', dept: 'finance', title: 'Synthetic application', status: '수용' }], rowCount: 1 }
      if (/^SELECT MAX\(seq\)/.test(sql)) return { rows: [{ n: firstBuild ? 0 : 1 }], rowCount: 1 }
      accepted.push(sql)
      return { rows: [], rowCount: 1 }
    })
    return Response.json(body.p_statements ? results : results[0])
  })
  vi.stubGlobal('fetch', fetcher)
  const DB = createSupabaseDb('https://local-test.supabase.co', 'synthetic-credential-only', null, 'local-builder@example.test')
  const invoke = (handler, method, body) => handler({
    env: { DB }, params: { id: 'local-app' },
    request: new Request('https://local.test/api/applications/local-app', {
      method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }),
  })
  return { requested, accepted, denied, invoke }
}

const buildPayload = { kind: 'run', quarantine: [{ reason: 'synthetic review item' }] }
const agreementPayload = { kind: 'conflict', id: 'local-conflict', verdict: 'A우선', verdict_reason: 'Synthetic decision evidence' }
const auditInsert = sql => sql.includes('INSERT INTO decision_log')
const statusUpdate = sql => sql.startsWith('UPDATE application SET status')
const accessCases = [['28000', 401, 'ACCESS_REVOKED'], ['42501', 403, 'ACCESS_DENIED']]

async function expectAccessFailure(response, status, code) {
  expect(response.status).toBe(status)
  const body = await response.json()
  expect(body).toMatchObject({ code, error: expect.any(String) })
  expect(body).not.toHaveProperty('ok', true)
  expect(JSON.stringify(body)).not.toContain('private SQL')
  expect(JSON.stringify(body)).not.toContain('synthetic-credential')
}

describe('본 저장 뒤 발생한 scoped 권한 오류의 응답 경계', () => {
  it.each(accessCases)('제작 상태 변경에서 %s가 발생하면 HTTP %s를 반환하고 선행 기록을 삭제하지 않는다', async (sqlstate, status, code) => {
    const test = fixture({ failure: statusUpdate, sqlstate })
    const response = await test.invoke(build, 'POST', buildPayload)
    await expectAccessFailure(response, status, code)
    expect(test.denied).toHaveLength(1)
    expect(test.accepted.some(sql => sql.includes('INSERT INTO build_run'))).toBe(true)
    expect(test.accepted.some(sql => sql.includes('INSERT INTO build_quarantine'))).toBe(true)
    expect(test.requested.some(sql => /^DELETE\b/.test(sql))).toBe(false)
  })

  it.each(accessCases)('제작의 후속 감사가 %s로 거절되면 HTTP %s로 전파하고 선행 기록을 삭제하지 않는다', async (sqlstate, status, code) => {
    const test = fixture({ failure: auditInsert, sqlstate, firstBuild: true })
    const response = await test.invoke(build, 'POST', buildPayload)
    await expectAccessFailure(response, status, code)
    expect(test.denied).toHaveLength(1)
    expect(test.accepted.some(sql => sql.includes('INSERT INTO build_run'))).toBe(true)
    expect(test.accepted.some(sql => sql.includes('INSERT INTO build_quarantine'))).toBe(true)
    expect(test.requested.some(sql => /^DELETE\b/.test(sql))).toBe(false)
    expect(test.requested.some(statusUpdate)).toBe(false)
  })

  it.each(accessCases)('협의 판단 뒤 감사의 %s는 HTTP %s로 전파하며 완료된 본 변경을 되돌리지 않는다', async (sqlstate, status, code) => {
    const test = fixture({ failure: auditInsert, sqlstate })
    const response = await test.invoke(agreement, 'PATCH', agreementPayload)
    await expectAccessFailure(response, status, code)
    expect(test.denied).toHaveLength(1)
    expect(test.accepted.filter(sql => sql.startsWith('UPDATE requirement_conflict'))).toHaveLength(1)
    expect(test.requested.some(sql => /^DELETE\b/.test(sql))).toBe(false)
  })

  it('제작의 선택 감사 기록이 일반 장애로 실패하면 기존 저장 성공 계약을 유지한다', async () => {
    const test = fixture({ failure: auditInsert, sqlstate: 'XX000', firstBuild: true })
    const response = await test.invoke(build, 'POST', buildPayload)
    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({ ok: true, seq: 1 })
    expect(test.denied).toHaveLength(1)
    expect(test.accepted.some(statusUpdate)).toBe(true)
    expect(test.requested.some(sql => /^DELETE\b/.test(sql))).toBe(false)
  })

  it('협의 판단의 선택 감사 기록이 일반 장애로 실패해도 본 변경 성공을 실패로 바꾸지 않는다', async () => {
    const test = fixture({ failure: auditInsert, sqlstate: 'XX000' })
    const response = await test.invoke(agreement, 'PATCH', agreementPayload)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(test.denied).toHaveLength(1)
    expect(test.accepted.filter(sql => sql.startsWith('UPDATE requirement_conflict'))).toHaveLength(1)
  })
})
