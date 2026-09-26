import { afterEach, describe, expect, it, vi } from 'vitest'
import { compileSql, createSupabaseDb, databaseAccessFailure } from '../functions/_lib/dbBridge.ts'

afterEach(() => vi.unstubAllGlobals())
const endpoint = 'https://typed-bridge-test.supabase.co'
const testKey = 'local-test-only'
const receipt = { status: 201, body: { ok: true, id: 'test-result' } }
const stubPayload = (payload, status = 200) => vi.stubGlobal('fetch', vi.fn(async () => Response.json(payload, { status })))

describe('typed SQL bridge preserves runtime projection contracts', () => {
  it('retains exact bigint bindings and immutable statements', async () => {
    const fetch = vi.fn(async () => Response.json({ rows: [{ id: 'row' }], rowCount: '1', last_row_id: '23' }))
    vi.stubGlobal('fetch', fetch)
    const db = createSupabaseDb(endpoint, testKey)
    const statement = db.prepare('SELECT ? AS id')
    const large = 9007199254740993n
    expect(compileSql('SELECT ?', [large])).toBe('SELECT 9007199254740993')
    expect(await statement.bind(large).all()).toEqual({ success: true, results: [{ id: 'row' }], meta: { changes: 1, row_count: 1, last_row_id: 23 } })
    await statement.bind(false).run()
    expect(JSON.parse(fetch.mock.calls[0][1].body).p_sql).toBe('SELECT 9007199254740993 AS id')
    expect(JSON.parse(fetch.mock.calls[1][1].body).p_sql).toBe('SELECT 0 AS id')
  })

  it('first() preserves a row while first(column) preserves scalar and null values', async () => {
    stubPayload({ rows: [{ id: 'row', total: 0, accepted: false, empty: '', missing: null }], rowCount: 1 })
    const statement = createSupabaseDb(endpoint, testKey).prepare('SELECT * FROM example')
    expect(await statement.first()).toEqual({ id: 'row', total: 0, accepted: false, empty: '', missing: null })
    expect(await statement.first('total')).toBe(0)
    expect(await statement.first('accepted')).toBe(false)
    expect(await statement.first('empty')).toBe('')
    expect(await statement.first('missing')).toBeNull()
    expect(await statement.first('absent')).toBeNull()
    stubPayload({ rows: [], rowCount: 0 })
    expect(await statement.first()).toBeNull()
    expect(await statement.first('id')).toBeNull()
  })

  it.each([
    null, [], {}, { rows: {}, rowCount: 0 }, { rows: [null], rowCount: 1 },
    { rows: ['untrusted'], rowCount: 1 }, { rows: [[1]], rowCount: 1 },
    { rows: [{}], rowCount: 'not-a-number' }, { rows: [], rowCount: 0, last_row_id: 'not-an-id' },
  ])('rejects malformed row responses before exposing a trusted projection: %j', async payload => {
    stubPayload(payload)
    await expect(createSupabaseDb(endpoint, testKey).prepare('SELECT 1').all()).rejects.toThrow('Invalid Supabase database response')
  })

  it('retains valid row containers without claiming to validate individual column types', async () => {
    const rows = [{ id: null, nested: { result: true }, values: [1, '2'] }]
    stubPayload({ rows, rowCount: 1 })
    expect((await createSupabaseDb(endpoint, testKey).prepare('SELECT example').all()).results).toEqual(rows)
  })

  it('rejects malformed batches and foreign ownership without partial local execution', async () => {
    stubPayload([{ rows: [], rowCount: 0 }, { rows: [null], rowCount: 1 }])
    const db = createSupabaseDb(endpoint, testKey)
    await expect(db.batch([db.prepare('SELECT 1'), db.prepare('SELECT 2')])).rejects.toThrow('Invalid Supabase database response')
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await expect(db.batch([createSupabaseDb(endpoint, testKey).prepare('SELECT 1')])).rejects.toThrow('Invalid batch statement')
    expect(await db.batch([])).toEqual([])
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('typed atomic RPC responses fail closed', () => {
  it.each([null, receipt, { status: 409, body: null }])('preserves a missing or valid receipt: %j', async payload => {
    stubPayload(payload)
    expect(await createSupabaseDb(endpoint, testKey).mutationReceipt('request-test', 'test-fingerprint')).toEqual(payload)
  })

  it.each([{}, [], false, 0, { status: 201 }, { status: '201', body: {} }, { status: 199, body: {} }, { status: 600, body: {} }, { status: 200.5, body: {} }])('rejects malformed receipts: %j', async payload => {
    stubPayload(payload)
    await expect(createSupabaseDb(endpoint, testKey).mutationReceipt('request-test', 'test-fingerprint')).rejects.toThrow('Invalid Supabase mutation receipt')
  })

  it.each([null, {}, [], { response: receipt }, { response: null, replayed: false }, { response: receipt, replayed: 1 }, { response: { status: 201 }, replayed: false }])('rejects malformed commit outcomes: %j', async payload => {
    stubPayload(payload)
    await expect(createSupabaseDb(endpoint, testKey).commitMutation('request-test', 'test-fingerprint', [], [], receipt)).rejects.toThrow('Invalid Supabase mutation response')
  })

  it.each(['public', 'workspace', 'actor'])('preserves %s RPC names, scopes, compiled reads/writes and receipts', async scope => {
    const fetch = vi.fn(async () => Response.json({ response: receipt, replayed: true, serverMetadata: 'preserved' }))
    vi.stubGlobal('fetch', fetch)
    const token = 'a'.repeat(64), actor = 'typed@local.invalid'
    const db = createSupabaseDb(endpoint, testKey, scope === 'workspace' ? token : null, scope === 'actor' ? actor : null)
    expect(await db.commitMutation('request-test', 'test-fingerprint', [{ sql: 'SELECT datetime(?)', binds: ['now'], rows: [{ checked: 1 }] }], [{ sql: 'UPDATE example SET value=?', binds: [123n] }], receipt))
      .toEqual({ response: receipt, replayed: true, serverMetadata: 'preserved' })
    const [target, options] = fetch.mock.calls[0]
    expect(target).toBe(endpoint + '/rest/v1/rpc/' + (scope === 'actor' ? 'ilson_actor_commit' : 'ilson_commit_mutation'))
    const body = JSON.parse(options.body)
    expect(body).toEqual({
      ...(scope === 'actor' ? { p_actor: actor } : { p_token: scope === 'workspace' ? token : null }),
      p_request_id: 'request-test', p_fingerprint: 'test-fingerprint',
      p_reads: [{ sql: `SELECT ${scope === 'workspace' ? 'public.' : ''}datetime(E'now')`, rows: [{ checked: 1 }] }],
      p_writes: ['UPDATE example SET value=123'], p_response: receipt,
    })
  })

  it('does not promote numeric or nested SQLSTATE lookalikes to verified access failures', async () => {
    for (const code of [28000, 42501, ['28000'], { value: '42501' }]) {
      stubPayload({ code, message: 'PRIVATE DATA' }, 400)
      const error = await createSupabaseDb(endpoint, testKey, 'a'.repeat(64)).prepare('SELECT 1').all().catch(error => error)
      expect(databaseAccessFailure(error)).toBeNull()
      expect(error.message).not.toContain('PRIVATE')
    }
    for (const value of [null, undefined, 1, 'DatabaseAccessError', Symbol('error')]) expect(databaseAccessFailure(value)).toBeNull()
  })
})
