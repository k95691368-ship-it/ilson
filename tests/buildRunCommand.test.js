// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { normalizeBuildRunCommand as normalize, assertBuildRunCommitBudget, BUILD_RUN_LIMITS } from '../functions/_lib/buildRun.ts'
import { mutationFingerprint } from '../functions/_lib/atomicMutation.ts'
import { compileSql } from '../functions/_lib/dbBridge.ts'
const row = changes => ({ date: '2026-06-01', iso_week: '2026-W23', sku: 'unregistered-legacy', channel: 'legacy', ...changes })
const body = changes => ({ kind: 'run', rows: [row()], ...changes })
function rejects(value, status = 400) {
  try { normalize(value); throw Error('accepted invalid command') }
  catch (error) { expect(error.status).toBe(status) }
}
describe('typed build run command and compiled transaction budgets', () => {
  it('keeps exact known text/order, existing defaults and top-level note trimming without arbitrary originals', () => {
    const normalized = normalize(body({ files: [{ name: ' file.csv ', note: ' note ', raw: ['SECRET'] }], note: '  operator  ',
      rows: [row({ sku_name: ' Name ', country: 'not persisted', trace: [{ step: ' step ', value: ' value ', raw: 'SECRET' }], raw: ['SECRET'], extra: 'SECRET',
        source: { file: ' file.csv ', sheet: ' sheet ', rowNo: 2, raw: 'SECRET' } })], quarantine: [{ reason: ' reason ', note: ' note ', raw: ['SECRET'] }] }))
    expect(normalized.note).toBe('operator')
    expect(normalized.rows[0].slice(0,9)).toEqual(['2026-06-01','2026-W23','unregistered-legacy',' Name ','legacy',0,0,'KRW',1])
    expect(normalized.rows[0].slice(19,22)).toEqual([' file.csv ',' sheet ',2])
    expect(JSON.parse(normalized.rows[0][22]).steps).toEqual([{ step: ' step ', value: ' value ' }])
    expect(normalized.quarantine[0][0]).toBe(' reason ')
    expect(normalized.quarantine[0][7]).toBe(' note ')
    expect(JSON.stringify(normalized)).not.toContain('SECRET')
    expect(JSON.stringify(normalized)).not.toContain('not persisted')
  })
  it('does not impose new date/week/catalog rules or recalculate fractional monetary/quantity values', () => {
    const result = normalize(body({ rows: [row({ date: 'legacy date', iso_week: 'legacy week', qty: '1.5', return_qty: '.5', gross_krw: '-12.25', fx_rate: '1e3' })] }))
    expect(result.rows[0].slice(0,3)).toEqual(['legacy date','legacy week','unregistered-legacy'])
    expect(result.rows[0][5]).toBe(1.5); expect(result.rows[0][6]).toBe(0.5); expect(result.rows[0][8]).toBe(1000); expect(result.rows[0][9]).toBe(-12.25)
  })
  it.each([true, [], {}, '', ' ', 'NaN', 'Infinity', NaN, Infinity, 9007199254740992])('rejects unsafe numeric scalar %j', value => rejects(body({ rows: [row({ qty: value })] })))
  it.each(['date','iso_week','sku','channel'])('requires a nonempty textual %s without trimming legitimate text', field => {
    for (const value of ['',0,{},[],true]) rejects(body({ rows: [row({ [field]: value })] }))
    expect(normalize(body({ rows: [row({ [field]: ' ' })] })).rows).toHaveLength(1)
  })
  it.each(['\0','\ud800','\udc00'])('rejects invalid PostgreSQL text in persisted fields: %j', invalid => {
    rejects(body({ rows: [row({ sku_name: invalid })] }))
    rejects(body({ files: [{ name: 'legacy', note: invalid }] }))
    rejects(body({ rows: [row({ trace: [{ step: invalid, value: 'x' }] })] }))
    rejects(body({ rows: [row({ source: { file: 'x', sheet: invalid } })] }))
    rejects(body({ rows: [row({ duplicate_of: { file: 'x', sheet: invalid, rowNo: 1 } })] }))
    rejects(body({ quarantine: [{ reason: 'x', externalCode: invalid }] }))
    rejects(body({ note: invalid }))
  })
  it('accepts real Unicode surrogate pairs and does not alter Unicode identifiers', () => {
    expect(normalize(body({ rows: [row({ sku_name: '😀한글' })] })).rows[0][3]).toBe('😀한글')
  })
  it.each([{ rows: [], quarantine: [] }, { rows: {} }, { quarantine: {} }, { rows: [null] }, { quarantine: [null] }, { rows: [row({ trace: {} })] },
    { duplicate_suspects: -1 }, { duplicate_suspects: 0.5 }, { duration_ms: -1 }, { rows: [row({ has_duplicate: 'false' })] }])('rejects malformed structure/counts %j', changes => rejects(body(changes)))
  it('allows a quarantine-only legacy result but no fabricated missing reason', () => {
    expect(normalize(body({ rows: [], quarantine: [{ reason: 'legacy' }] })).rows).toEqual([])
    rejects(body({ rows: [], quarantine: [{}] }))
  })
  it.each([
    { all: true }, { all: [] }, { byChannel: {} }, { byChannelWeek: [null] },
    { all: { qty: {} } }, { all: { qty: true } }, { all: { qty: 'secret' } },
    { all: { qty: 'NaN' } }, { all: { qty: 'Infinity' } }, { all: { qty: '9007199254740992' } },
    { all: { rows: -1 } }, { all: { rows: 0.5 } }, { byChannel: [{ channel: {}, qty: 1 }] },
  ])('does not erase malformed known totals metadata into an apparently valid empty object: %j', totals => rejects(body({ totals })))
  it('retains nullable and empty totals, legacy numeric strings, signed fractions and scalar trace metadata', () => {
    for (const totals of [null,{}, { all: {} }, { all: null, byChannel: null }]) expect(normalize(body({ totals })).rows).toHaveLength(1)
    const totals = { all: { rows: '2', qty: '1.5', return_qty: null, gross_krw: '-12.25' }, byChannel: [], byChannelWeek: [] }
    const result = normalize(body({ totals, rows: [row({ trace: [{ step: ' exact ', value: 1.5 }, { step: null, value: false }] })] }))
    expect(JSON.parse(result.totalsJson)).toEqual(totals)
    expect(JSON.parse(result.rows[0][22]).steps).toEqual([{ step: ' exact ', value: 1.5 }, { step: null, value: false }])
  })
  it.each([[null], [true], [{ step: {} }], [{ value: [] }], [{ value: NaN }], [{ value: Number.MAX_SAFE_INTEGER + 1 }]].map(trace => ({ trace })))('does not silently discard known trace metadata $trace', ({ trace }) => rejects(body({ rows: [row({ trace })] })))
  it.each([{ rowsIn: true }, { rowsIn: '1' }, { rowsIn: {} }, { rowsOut: -1 }, { headerRowNo: 0.5 }, { note: {} }, { warnOnly: 'true' }])('retains strict pre-projection file metadata validation: %j', changes => rejects(body({ files: [{ name: 'legacy.csv', ...changes }] })))
  it('fingerprints only the explicit persisted projection and preserves provenance changes', async () => {
    const first = normalize(body()), extra = normalize(body({ ignored: 'SECRET', rows: [row({ raw: ['SECRET'], country: 'ignored' })] }))
    expect(await mutationFingerprint(first)).toBe(await mutationFingerprint(extra))
    expect(await mutationFingerprint(first)).not.toBe(await mutationFingerprint(normalize(body({ rows: [row({ source: { file: 'different.csv', rowNo: 2 } })] }))))
  })
  it('rejects over-1000 statement inputs before visiting any row', () => {
    const rows = new Array((BUILD_RUN_LIMITS.statements - 3) * 500 + 1)
    Object.defineProperty(rows, 0, { get: () => { throw Error('must not inspect oversized input') } })
    rejects(body({ rows }), 413)
  })
  it('rejects escaped SQL inflation while the browser JSON is below the request cap', () => {
    const value = body({ rows: [row({ trace: [{ step: 'slashes', value: '\\'.repeat(2 * 1024 * 1024) }] })] })
    expect(Buffer.byteLength(JSON.stringify(value))).toBeLessThan(BUILD_RUN_LIMITS.rpcBytes)
    rejects(value, 413)
  })
  it('includes read snapshots and response JSON in the final RPC budget', () => {
    const response = { status: 201, body: { ok: true } }, key = 'request-key-123456', hash = 'a'.repeat(64)
    expect(() => assertBuildRunCommitBudget(key, hash, [], [], response, null)).not.toThrow()
    expect(() => assertBuildRunCommitBudget(key, hash, [{ sql: 'SELECT 1', rows: [{ oversized: '\\'.repeat(9 * 1024 * 1024) }] }], [], response, null)).toThrow()
    expect(() => assertBuildRunCommitBudget(key, hash, [], [], { status: 201, body: { oversized: '\\'.repeat(9 * 1024 * 1024) } }, null)).toThrow()
  })
  it('checks actual compiled escaped SQL, statement count and workspace wrapper allowance', () => {
    const key = 'request-key-123456', hash = 'b'.repeat(64), response = { status: 201, body: {} }
    const writes = [{ sql: 'INSERT INTO sample(value) VALUES(?)', binds: ["back\\slash'한글😀"] }]
    expect(compileSql(writes[0].sql, writes[0].binds)).toContain("E'back\\\\slash''한글😀'")
    expect(() => assertBuildRunCommitBudget(key, hash, [], writes, response, 'x@local.invalid')).not.toThrow()
    expect(() => assertBuildRunCommitBudget(key, hash, [], new Array(1001).fill({ sql: 'SELECT 1' }), response, null)).toThrow()
    expect(() => assertBuildRunCommitBudget(key, hash, new Array(101).fill({ sql: 'SELECT 1', rows: [] }), [], response, null)).toThrow()
  })
})
