// @vitest-environment node
import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { normalizeReportFixCommand, reportSourceVersion, REPORT_SOURCE_FIELDS, REPORT_FIX_ACTOR_SQL,
  REPORT_FIX_APPLICATION_SQL, REPORT_FIX_EXISTING_SQL } from '../functions/_lib/reportFix.ts'
import { onRequestPost } from '../functions/api/reports.js'

const source = (extra = {}) => ({ id: 'legacy-report', application_id: 'app-one', stage: '배포', actor: 'human',
  title: '현장 직원', what: '합계가 원장과 다릅니다.', why: '반품 줄이 더해졌습니다.', alternatives: null,
  unrequested: 0, link_kind: '신고', link_id: 'wrong_number', created_at: '2026-10-04 01:00:00', ...extra })
const body = (extra = {}) => ({ reportId: 'legacy-report', expectedVersion: 'a'.repeat(64), how: '반품 부호를 수정했습니다.', why: '음수를 더하지 않고 빼야 했습니다.', ...extra })
const request = (value, key = 'request-key-0123456789') => new Request('https://local.invalid/api/reports', {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(key === null ? {} : { 'X-Idempotency-Key': key }) }, body: JSON.stringify(value),
})

describe('report correction semantic command', () => {
  it('projects only known fields, trims user text and preserves legacy IDs', () => {
    expect(normalizeReportFixCommand(body({ reportId: ' local-report-200 ', how: '  수정한 내용입니다. ', why: ' 원인을 확인했습니다. ', author: ' 체험 작성자 ', arbitrary: { ignored: true } }), false))
      .toEqual({ ok: true, value: { reportId: 'local-report-200', expectedVersion: 'a'.repeat(64), how: '수정한 내용입니다.', why: '원인을 확인했습니다.', demoAuthor: '체험 작성자' } })
    expect(normalizeReportFixCommand(body(), false).value.demoAuthor).toBe('AX 담당자')
    expect(normalizeReportFixCommand(body({ author: '  ' }), false).value.demoAuthor).toBe('AX 담당자')
  })
  it.each([undefined, null, [], true, 1, 'input'])('rejects non-object bodies %#', value => {
    expect(normalizeReportFixCommand(value, false)).toMatchObject({ ok: false, fields: { body: expect.any(String) } })
  })
  it.each(['reportId', 'how', 'why'])('never coerces %s from non-text values', field => {
    for (const value of [undefined, null, true, 5, [], {}]) {
      expect(normalizeReportFixCommand(body({ [field]: value }), true)).toMatchObject({ ok: false, fields: { [field]: expect.any(String) } })
    }
  })
  it.each(['', 'a'.repeat(63), 'a'.repeat(65), 'A'.repeat(64), ' ' + 'a'.repeat(64), 'a'.repeat(64) + ' ', null, 1])('does not normalize or guess opaque versions %#', expectedVersion => {
    expect(normalizeReportFixCommand(body({ expectedVersion }), true)).toMatchObject({ ok: false, fields: { expectedVersion: expect.any(String) } })
  })
  it.each(['how', 'why'])('accepts exact 2000 text but rejects 2001 without slicing %s', field => {
    expect(normalizeReportFixCommand(body({ [field]: 'x'.repeat(2000) }), true).value[field]).toHaveLength(2000)
    expect(normalizeReportFixCommand(body({ [field]: 'x'.repeat(2001) }), true)).toMatchObject({ ok: false, fields: { [field]: expect.any(String) } })
    expect(normalizeReportFixCommand(body({ [field]: '1234' }), true).ok).toBe(false)
  })
  it('keeps identity and the established demo label within their existing limits', () => {
    expect(normalizeReportFixCommand(body({ reportId: 'x'.repeat(100), author: 'x'.repeat(60) }), false).ok).toBe(true)
    expect(normalizeReportFixCommand(body({ reportId: 'x'.repeat(101) }), true)).toMatchObject({ ok: false, fields: { reportId: expect.any(String) } })
    expect(normalizeReportFixCommand(body({ author: 'x'.repeat(61) }), false)).toMatchObject({ ok: false, fields: { author: expect.any(String) } })
    expect(normalizeReportFixCommand(body({ reportId: '全角-Case', how: '정상 🧪 처리했습니다.' }), true).value.reportId).toBe('全角-Case')
  })
  it.each(['reportId', 'how', 'why', 'author'])('rejects NUL and lone surrogates in persisted %s', field => {
    for (const value of ['12345\0tail', '12345\uD800tail', '12345\uDC00tail']) {
      expect(normalizeReportFixCommand(body({ [field]: value }), false)).toMatchObject({ ok: false, fields: { [field]: expect.any(String) } })
    }
  })
  it.each([{}, [], 5, false, '\0', '\uD800', 'x'.repeat(5000)])('real author is fully ignored, not a retry-fingerprint input %#', author => {
    expect(normalizeReportFixCommand(body({ author, demoAuthor: author }), true))
      .toEqual(normalizeReportFixCommand(body(), true))
    expect(normalizeReportFixCommand(body(), true).value.demoAuthor).toBeNull()
  })
  it('does not mutate caller objects or collapse real semantic changes', () => {
    const input = body({ author: { forged: true }, extra: 1 }), before = structuredClone(input)
    const normalized = normalizeReportFixCommand(input, true)
    expect(input).toEqual(before)
    expect(normalizeReportFixCommand(body({ how: '다르게 처리했습니다.' }), true)).not.toEqual(normalized)
    expect(normalizeReportFixCommand(body({ expectedVersion: 'b'.repeat(64) }), true)).not.toEqual(normalized)
  })
})

describe('opaque original report projection', () => {
  it('hashes the exact twelve values in known order and not arbitrary extra fields', async () => {
    const row = source(), fields = ['id', 'application_id', 'stage', 'actor', 'title', 'what', 'why', 'alternatives', 'unrequested', 'link_kind', 'link_id', 'created_at']
    expect([...REPORT_SOURCE_FIELDS]).toEqual(fields)
    const expected = createHash('sha256').update(JSON.stringify(['original-report-v1', ...fields.map(key => row[key])])).digest('hex')
    expect(await reportSourceVersion(row)).toBe(expected)
    expect(await reportSourceVersion({ extra: 'not source evidence', ...Object.fromEntries(Object.entries(row).reverse()) })).toBe(expected)
  })
  it.each(['id', 'application_id', 'stage', 'actor', 'title', 'what', 'why', 'alternatives', 'unrequested', 'link_id', 'created_at'])('detects an edit of %s including same-second changes', async field => {
    const next = source({ [field]: field === 'unrequested' ? 1 : 'changed value' })
    expect(await reportSourceVersion(next)).not.toBe(await reportSourceVersion(source()))
  })
  it.each(REPORT_SOURCE_FIELDS)('does not replace missing %s with a guessed default', async field => {
    const row = source(); delete row[field]
    await expect(reportSourceVersion(row)).rejects.toThrow()
  })
  it.each([{ unrequested: '0' }, { unrequested: false }, { unrequested: 2 }, { alternatives: {} }, { link_id: 1 },
    { link_kind: '신고처리' }, { application_id: null }, { title: '\0' }, { why: '\uD800' }])('rejects malformed original projection %j', async extra => {
    await expect(reportSourceVersion(source(extra))).rejects.toThrow()
  })
})

async function fixture({ account = true, prior = null, replayAtCommit = false, afterCommit } = {}) {
  const row = source()
  const actor = { email: 'owner@example.test', display_name: '현재 작성자', role: 'product', active: 1,
    departments_json: '[]', product_ids_json: '[]', updated_at: '2026-10-04 00:00:00' }
  const app = { id: 'app-one', owner_email: actor.email, dept: 'Finance', updated_at: '2026-10-04 00:00:00' }
  let existing = null
  const reads = []
  const prepare = vi.fn(sql => {
    const statement = binds => ({ bind: (...values) => statement(values), all: async () => {
      reads.push({ sql, binds })
      const result = sql === REPORT_FIX_ACTOR_SQL ? actor
        : sql === REPORT_FIX_APPLICATION_SQL ? app
          : sql === REPORT_FIX_EXISTING_SQL ? existing : row
      return { success: true, results: result === null ? [] : [structuredClone(result)], meta: { changes: result === null ? 0 : 1, row_count: result === null ? 0 : 1 } }
    } })
    const stmt = statement([])
    stmt.first = async () => (await stmt.all()).results[0] ?? null
    // Non-staged replay uses a bound statement's first() directly.
    function bound(values) {
      const selected = statement(values)
      return { ...selected, bind: (...next) => bound(next), first: async () => (await selected.all()).results[0] ?? null }
    }
    return bound([])
  })
  const commitMutation = vi.fn(async (_key, _fingerprint, stagedReads, writes, response) => {
    if (afterCommit) await afterCommit({ row, actor, app })
    return { response, replayed: replayAtCommit }
  })
  const DB = { actorEmail: account ? actor.email : null, workspace: !account, prepare,
    mutationReceipt: vi.fn(async () => prior), commitMutation, batch: vi.fn() }
  const env = { DB, ...(account ? { AUTH_ACTOR: { mode: 'access', email: actor.email } } : { DEMO_WORKSPACE: true }) }
  const command = body({ expectedVersion: await reportSourceVersion(row) })
  return { DB, env, row, actor, app, reads, command, setExisting: value => { existing = value } }
}

describe('thin report correction action boundary', () => {
  it('validation and malformed JSON/key failures issue no DB read or write', async () => {
    const f = await fixture()
    for (const value of [null, [], body({ how: {} }), body({ how: 'x'.repeat(2001) }), body({ expectedVersion: undefined })]) {
      const response = await onRequestPost({ env: f.env, request: request(value) })
      expect(response.status).toBe(400); expect(await response.json()).toMatchObject({ notSaved: true })
    }
    for (const key of [null, 'short', 'x'.repeat(101), ' '.repeat(16)]) {
      const response = await onRequestPost({ env: f.env, request: request(f.command, key) })
      expect(response.status).toBe(400); expect(await response.json()).toMatchObject({ notSaved: true })
    }
    const invalid = new Request('https://local.invalid/api/reports', { method: 'POST', body: '{' })
    expect(await (await onRequestPost({ env: f.env, request: invalid })).json()).toMatchObject({ notSaved: true })
    expect(f.DB.prepare).not.toHaveBeenCalled(); expect(f.DB.mutationReceipt).not.toHaveBeenCalled(); expect(f.DB.commitMutation).not.toHaveBeenCalled()
  })
  it('stages full authority/source/app and only same-app handling presence before a single audit write', async () => {
    const f = await fixture()
    const response = await onRequestPost({ env: f.env, request: request({ ...f.command, author: { forged: true } }) })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, id: expect.stringMatching(/^dec_[a-f0-9]{20}$/), reportId: 'legacy-report', author: '현재 작성자' })
    expect(f.DB.commitMutation).toHaveBeenCalledTimes(1)
    const [, , stagedReads, writes] = f.DB.commitMutation.mock.calls[0]
    expect(stagedReads).toHaveLength(4); expect(writes).toHaveLength(1)
    expect(stagedReads[0].sql).toBe(REPORT_FIX_ACTOR_SQL)
    expect(stagedReads[1].rows[0]).toEqual(f.row)
    expect(stagedReads[2].sql).toBe(REPORT_FIX_APPLICATION_SQL)
    expect(stagedReads[3]).toMatchObject({ sql: REPORT_FIX_EXISTING_SQL, binds: ['app-one', '신고처리', 'legacy-report'], rows: [] })
    expect(REPORT_FIX_EXISTING_SQL).toMatch(/LIMIT 1$/)
    expect(writes[0].binds.slice(1)).toEqual(['app-one', '배포', 'human', '현재 작성자', f.command.how, f.command.why, null, 0, '신고처리', 'legacy-report'])
  })
  it('keeps actual account label without inventing a new 60-character account policy', async () => {
    const f = await fixture(); f.actor.display_name = 'a'.repeat(61)
    const response = await onRequestPost({ env: f.env, request: request(f.command) })
    expect(response.status).toBe(200); expect((await response.json()).author).toBe('a'.repeat(61))
  })
  it('a server-isolated demo preserves its entered label without touching actor data', async () => {
    const f = await fixture({ account: false })
    const response = await onRequestPost({ env: f.env, request: request({ ...f.command, author: '체험 담당자' }) })
    expect(response.status).toBe(200); expect((await response.json()).author).toBe('체험 담당자')
    expect(f.reads.some(read => read.sql === REPORT_FIX_ACTOR_SQL)).toBe(false)
  })
  it.each([{}, { mode: 'invalid', email: 'owner@example.test' }, { mode: 'demo', email: 'owner@example.test' }])('a conflicting actor context cannot enter isolated demo %#', async actor => {
    const f = await fixture({ account: false }); f.env.AUTH_ACTOR = actor
    const response = await onRequestPost({ env: f.env, request: request(f.command) })
    expect(response.status).toBe(503)
    expect(f.DB.prepare).not.toHaveBeenCalled(); expect(f.DB.mutationReceipt).not.toHaveBeenCalled(); expect(f.DB.commitMutation).not.toHaveBeenCalled()
  })
  it('a stale original and existing same-app handling never commit a receipt', async () => {
    const f = await fixture(); f.row.what = '신고 내용을 다시 썼습니다.'
    const response = await onRequestPost({ env: f.env, request: request(f.command) })
    expect(response.status).toBe(409); expect((await response.json()).code).toBe('REPORT_SOURCE_CHANGED')
    expect(f.DB.commitMutation).not.toHaveBeenCalled()
    const g = await fixture(); g.setExisting({ id: 'existing-fix' })
    expect((await onRequestPost({ env: g.env, request: request(g.command) })).status).toBe(409)
    expect(g.DB.commitMutation).not.toHaveBeenCalled()
  })
  it.each([undefined, true])('real access cannot fall back to a non-scoped workspace flag %#', async workspace => {
    const f = await fixture(); f.DB.workspace = workspace
    expect((await onRequestPost({ env: f.env, request: request(f.command) })).status).toBe(401)
    expect(f.DB.mutationReceipt).not.toHaveBeenCalled(); expect(f.DB.commitMutation).not.toHaveBeenCalled()
  })
  it('forbidden current role or unusable current attribution cannot write', async () => {
    const f = await fixture(); f.actor.role = 'reviewer'
    expect((await onRequestPost({ env: f.env, request: request(f.command) })).status).toBe(403)
    expect(f.DB.commitMutation).not.toHaveBeenCalled()
    const g = await fixture(); g.actor.display_name = 'name\0'
    expect((await onRequestPost({ env: g.env, request: request(g.command) })).status).toBe(503)
    expect(g.DB.commitMutation).not.toHaveBeenCalled()
  })
  it('rechecks current source before exposing a historical receipt, preserving its stored body', async () => {
    const receipt = { status: 200, body: { ok: true, id: 'dec_' + '1'.repeat(20), reportId: 'legacy-report', author: '과거 작성자' } }
    const f = await fixture({ prior: receipt }); f.row.what = '변경된 신고 원문입니다.'
    const response = await onRequestPost({ env: f.env, request: request(f.command) })
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'REPORT_SOURCE_CHANGED', error: expect.stringContaining('이전에 확정 저장된 처리 기록은 유지됩니다') })
    expect(receipt.body.author).toBe('과거 작성자'); expect(f.DB.commitMutation).not.toHaveBeenCalled()
  })
  it('unchanged receipt returns original attribution; commit-time replay gets the same source guard', async () => {
    const receipt = { status: 200, body: { ok: true, id: 'dec_' + '1'.repeat(20), reportId: 'legacy-report', author: '과거 작성자' } }
    const f = await fixture({ prior: receipt })
    const response = await onRequestPost({ env: f.env, request: request(f.command) })
    expect(response.status).toBe(200); expect(await response.json()).toEqual(receipt.body)
    expect(response.headers.get('X-Idempotency-Replayed')).toBe('1'); expect(f.DB.commitMutation).not.toHaveBeenCalled()
    const g = await fixture({ replayAtCommit: true, afterCommit: ({ row }) => { row.what = '동시에 바뀐 원문입니다.' } })
    const replay = await onRequestPost({ env: g.env, request: request(g.command) })
    expect(replay.status).toBe(409); expect((await replay.json()).code).toBe('REPORT_SOURCE_CHANGED')
  })
  it('unsupported atomic storage fails closed without reading the report', async () => {
    const f = await fixture(); delete f.DB.commitMutation
    const response = await onRequestPost({ env: f.env, request: request(f.command) })
    expect(response.status).toBe(503); expect(f.DB.prepare).not.toHaveBeenCalled()
    expect(await response.json()).not.toHaveProperty('notSaved')
  })
})
