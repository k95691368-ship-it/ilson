import { describe, it, expect, vi } from 'vitest'
import { tally } from '../shared/tally.js'
import { betaRoundPayload } from '../functions/_lib/betaRound.js'
import { onRequestPost } from '../functions/api/applications/[id]/beta.js'

// The database gate is exercised against real PostgreSQL in betaRoundPostgres.
// This file covers the HTTP/RPC boundary, not simulated INSERT persistence.
const row = (over = {}) => ({ id: 'criterion-1', ord: 1, body: '금액 오차 0원', check_key: 'amount_exact',
  kind: 'rule', is_required_safety: 1, verdict: '실패', ...over })
const input = (over = {}) => ({ kind: 'round', criteria_revision: 2, run_scope: 'scope-local',
  run_id: 'local-round-identity-0001', graded: [row()], summary: { overall: '통과', passed: 999, durationMs: 5 }, ...over })
const APP = { id: 'app_1', ticket_no: 'AX-001-001', dept: '재무', title: 'x', status: '수용', beta_criteria_revision: 2 }
const answer = { ok: true, round_id: 'stored-round', seq: 1, overall: '차단', overruled: '통과', summary: { total: 1, passed: 0, failed: 1, safetyFailed: 1 } }
function fakeDB() {
  const write = vi.fn(() => { throw Error('Use the atomic round RPC') })
  const statement = { bind: () => statement, first: async () => APP, run: write }
  return { prepare: () => statement, write, toolRunScope: async () => 'scope-local',
    recordBetaRound: vi.fn(async () => ({ response: { status: 201, body: answer }, replayed: false })) }
}
async function send(body, db = fakeDB()) {
  const res = await onRequestPost({ env: { DB: db }, params: { id: APP.id },
    request: new Request('https://local.invalid/api/applications/app_1/beta', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) })
  return { res, body: await res.json(), db }
}

describe('HTTP는 판정을 선언하지 않고 원자 저장 결과를 전달한다', () => {
  it('브라우저 summary가 통과라고 해도 DB에서 재계산한 차단을 응답한다', async () => {
    const result = await send(input())
    expect(result.res.status).toBe(201)
    expect(result.body).toEqual(answer)
    expect(result.db.recordBetaRound).toHaveBeenCalledTimes(1)
    expect(result.db.write).not.toHaveBeenCalled()
  })
  it('같은 실행 ID와 현재 기준 revision을 RPC에 전달하며 임의 요약 합계는 버린다', async () => {
    const { db } = await send(input())
    const [applicationId, requestId, fingerprint, payload] = db.recordBetaRound.mock.calls[0]
    expect(applicationId).toBe(APP.id)
    expect(requestId).toBe('local-round-identity-0001')
    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(payload).toMatchObject({ criteria_revision: 2, claimed: '통과', duration_ms: 5 })
    expect(payload).not.toHaveProperty('summary')
    expect(payload).not.toHaveProperty('passed')
    expect(payload.graded[0].is_required_safety).toBe(true)
  })
  it('DB 영수증 재생을 별도 회차 INSERT 없이 알려준다', async () => {
    const db = fakeDB()
    db.recordBetaRound.mockResolvedValue({ response: { status: 201, body: answer }, replayed: true })
    const result = await send(input(), db)
    expect(result.res.headers.get('X-Idempotency-Replayed')).toBe('1')
    expect(result.body).toEqual(answer)
    expect(db.write).not.toHaveBeenCalled()
  })
  it('중복 기준과 잘못된 숫자·판정 형식은 RPC 전에 거절한다', async () => {
    for (const change of [{ graded: [] }, { graded: [row(), row()] }, { criteria_revision: -1 },
      { graded: [row({ verdict: '허용되지 않은 값' })] }, { summary: { durationMs: -1 } }, { run_id: '' }]) {
      const result = await send(input(change))
      expect(result.res.status).toBe(400)
      expect(result.db.recordBetaRound).not.toHaveBeenCalled()
    }
  })
  it('다른 계정·작업공간의 판정은 저장하지 않으며 이미 저장됐다는 가정도 하지 않는다', async () => {
    const result = await send(input({ run_scope: 'other-scope' }))
    expect(result.res.status).toBe(409)
    expect(result.body).not.toHaveProperty('notSaved')
    expect(result.db.recordBetaRound).not.toHaveBeenCalled()
  })
  it('DB가 기준 변경으로 거절한 신규 요청만 미저장을 확정한다', async () => {
    const db = fakeDB()
    db.recordBetaRound.mockRejectedValueOnce(Error('Database request failed (400/PBT01)'))
    const changed = await send(input(), db)
    expect(changed.res.status).toBe(409)
    expect(changed.body).toMatchObject({ code: 'BETA_CRITERIA_CHANGED', notSaved: true })
    db.recordBetaRound.mockRejectedValueOnce(Error('Database request failed (400/40001)'))
    const uncertain = await send(input(), db)
    expect(uncertain.res.status).toBe(409)
    expect(uncertain.body).not.toHaveProperty('notSaved')
  })
})

describe('브라우저 채점과 전송 형식', () => {
  it('필수 안전이 깨지면 차단, 아니면 조건부다', () => {
    expect(tally([row()]).overall).toBe('차단')
    expect(tally([row({ is_required_safety: 0 })]).overall).toBe('조건부')
    expect(tally([row({ verdict: '통과' })]).overall).toBe('통과')
  })
  it('사람이 볼 항목은 별도 확인 개수로 남긴다', () => {
    const result = tally([row({ verdict: '통과' }), { kind: 'human', verdict: '사람확인' }])
    expect(result.overall).toBe('통과')
    expect(result.humanNeeded).toBe(1)
  })
  it('빈 입력을 세는 함수는 안전하지만 빈 판정은 저장할 수 없다', () => {
    expect(tally(null).total).toBe(0)
    expect(betaRoundPayload(input({ graded: [] }))).toBeNull()
  })
  it('전송 값의 정수·안전 플래그·필수 메타데이터를 엄격히 검사한다', () => {
    for (const change of [{ ord: 1.1 }, { ord: -1 }, { is_required_safety: 'false' }, { id: '' }, { body: '' }, { samples: {} }]) {
      expect(betaRoundPayload(input({ graded: [row(change)] }))).toBeNull()
    }
    expect(betaRoundPayload(input({ summary: { durationMs: Infinity } }))).toBeNull()
  })
})
