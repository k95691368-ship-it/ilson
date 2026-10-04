import { describe, it, expect } from 'vitest'
import { onRequestPost } from '../functions/api/applications/[id]/build.js'

// Unit boundary: staged writes are never applied by prepare(). Actual database
// rollback (including audit/status/chunk failures) is tested in buildRunMutationPostgres.
const APP = { id: 'app_1', ticket_no: 'AX-001-001', dept: '재무', title: 'x', status: '수용', owner_email: null, updated_at: '2026-01-01' }
function fixture({ failCommit = false, atomic = true } = {}) {
  const requested = [], directWrites = [], committed = []
  const prepare = (sql, binds = []) => ({
    bind: (...values) => prepare(sql, values),
    first: async () => { requested.push(sql); return sql.includes('FROM application') ? APP : { n: 0 } },
    all: async () => { requested.push(sql); return { results: sql.includes('FROM application') ? [APP] : [{ n: 0 }] } },
    run: async () => { directWrites.push({ sql, binds }); throw Error('No direct mutation is allowed') },
  })
  return {
    requested, directWrites, committed, workspace: true, prepare,
    ...(atomic ? {
      mutationReceipt: async () => null,
      commitMutation: async (_key, _fingerprint, reads, writes, response) => {
        requested.push(...writes.map(write => write.sql))
        expect(reads.some(read => read.sql.includes('FROM application'))).toBe(true)
        if (failCommit) throw Error('Synthetic transaction failure')
        committed.push(...writes)
        return { response, replayed: false }
      },
    } : {}),
  }
}
const post = (DB, body) => onRequestPost({
  env: { DB, DEMO_WORKSPACE: true }, params: { id: APP.id },
  request: new Request('https://x/api/applications/app_1/build', {
    method: 'POST', headers: { 'content-type': 'application/json', 'X-Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify(body),
  }),
})
const ROW = { date: '2026-08-01', iso_week: '2026-W31', sku: 'SKU-1', channel: 'A', gross_krw: 1000 }
describe('invalid or failed build commits leave no partial record', () => {
  it.each([['date','날짜'],['iso_week','주차']])('reports missing %s in human-readable text before any write', async (field, label) => {
    const db = fixture(), row = { ...ROW }; delete row[field]
    const response = await post(db, { kind: 'run', rows: [row] })
    expect(response.status).toBe(400)
    expect(JSON.stringify(await response.json())).toContain(label)
    expect(db.directWrites).toEqual([]); expect(db.committed).toEqual([])
    expect(db.requested.some(sql => sql.includes('INSERT INTO build_run'))).toBe(false)
  })
  it('rejects a quarantine item with no reason before any write', async () => {
    const db = fixture(), response = await post(db, { kind: 'run', quarantine: [{ source: { file: 'a.csv' } }] })
    expect(response.status).toBe(400)
    expect(JSON.stringify(await response.json())).toContain('사유')
    expect(db.committed).toEqual([])
  })
  it('never compensates with DELETE after an uncertain transaction failure', async () => {
    const db = fixture({ failCommit: true })
    expect((await post(db, { kind: 'run', rows: [ROW] })).status).toBe(503)
    expect(db.requested.some(sql => sql.includes('INSERT INTO build_run'))).toBe(true)
    expect(db.requested.some(sql => /^DELETE/.test(sql))).toBe(false)
    expect(db.committed).toEqual([]); expect(db.directWrites).toEqual([])
  })
  it('commits all related writes through the atomic adapter on success', async () => {
    const db = fixture(), response = await post(db, { kind: 'run', rows: [ROW] })
    expect(response.status).toBe(201)
    expect(db.committed.map(write => write.sql).join('\n')).toMatch(/INSERT INTO build_run[\s\S]*INSERT INTO build_row[\s\S]*INSERT INTO decision_log[\s\S]*UPDATE application/)
    expect(db.directWrites).toEqual([])
    expect(db.requested.some(sql => /^DELETE/.test(sql))).toBe(false)
  })
  it('fails closed without atomic support instead of falling back to partial inserts', async () => {
    const db = fixture({ atomic: false })
    expect((await post(db, { kind: 'run', rows: [ROW] })).status).toBe(503)
    expect(db.directWrites).toEqual([]); expect(db.committed).toEqual([])
    expect(db.requested.some(sql => sql.includes('INSERT INTO build_run'))).toBe(false)
  })
})
