import { afterEach, describe, expect, it, vi } from 'vitest'
import { compileSql, createSupabaseDb, withDbBinding } from '../functions/_lib/dbBridge.js'

afterEach(() => vi.unstubAllGlobals())
const url = 'https://test.supabase.co'
const payload = { rows: [{ id: 'text-id' }, { id: 'second-id' }], rowCount: 2 }

describe('Supabase statement bridge', () => {
  it('keeps quotes, comments and identifiers separate from bindings', () => {
    expect(compileSql(`SELECT '?', "?", ? -- ?\n/* ? */`, ["O'Reilly?\\path"]))
      .toBe(`SELECT '?', "?", E'O''Reilly?\\\\path' -- ?\n/* ? */`)
  })
  it('preserves SQLite integer truncation and 64-bit real precision', () => {
    expect(compileSql('SELECT CAST((? + 0.1) AS INTEGER), CAST(? AS REAL)', [-1.9, 1.234]))
      .toBe('SELECT CAST(TRUNC(((-1.9 + 0.1) )::numeric) AS BIGINT), CAST(1.234 AS DOUBLE PRECISION)')
  })
  it('rejects missing, extra, undefined, object and nonfinite values', () => {
    expect(() => compileSql('SELECT ?')).toThrow('Missing')
    expect(() => compileSql('SELECT 1', [1])).toThrow('Extra')
    for (const value of [undefined, {}, NaN, Infinity, 'nul\0']) {
      expect(() => compileSql('SELECT ?', [value])).toThrow('Unsupported')
    }
  })
  it('represents null and booleans like D1', () => {
    expect(compileSql('SELECT ?, ?, ?', [null, true, false])).toBe('SELECT NULL, 1, 0')
  })
  it('retains every returned row and immutable statement bindings', async () => {
    const fetch = vi.fn(async () => Response.json(payload))
    vi.stubGlobal('fetch', fetch)
    const db = createSupabaseDb(url, 'test-key')
    const statement = db.prepare('SELECT ?')
    const one = statement.bind('one'), two = statement.bind('two')
    expect((await one.all()).results).toHaveLength(2)
    await two.run()
    expect(JSON.parse(fetch.mock.calls[0][1].body).p_sql).toBe("SELECT E'one'")
    expect(JSON.parse(fetch.mock.calls[1][1].body).p_sql).toBe("SELECT E'two'")
  })
  it('supports first(column), changes and generated integer IDs', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ...payload, last_row_id: 42 })))
    const db = createSupabaseDb(url, 'test-key')
    expect(await db.prepare('SELECT id FROM application').first('id')).toBe('text-id')
    expect((await db.prepare('INSERT INTO rate_limit_hits(bucket) VALUES (?)').bind('test').run()).meta)
      .toMatchObject({ changes: 2, last_row_id: 42 })
  })
  it('sends a batch as exactly one RPC transaction', async () => {
    const fetch = vi.fn(async () => Response.json([payload, payload]))
    vi.stubGlobal('fetch', fetch)
    const db = createSupabaseDb(url, 'test-key')
    expect(await db.batch([db.prepare('SELECT 1'), db.prepare('SELECT 2')])).toHaveLength(2)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0][0]).toContain('/ilson_batch')
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ p_statements: ['SELECT 1', 'SELECT 2'] })
  })
  it('rejects foreign statements before contacting Supabase', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
    const db = createSupabaseDb(url, 'test-key')
    await expect(db.batch([createSupabaseDb(url, 'other').prepare('SELECT 1')])).rejects.toThrow('Invalid batch')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('does not expose upstream SQL or credentials in errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ code: '23505', message: 'PRIVATE SQL' }, { status: 400 })))
    await expect(createSupabaseDb(url, 'test-key').prepare('SELECT 1').all()).rejects.toThrow('Database request failed (400/23505)')
  })
  it('fails closed when only one Supabase setting is present', async () => {
    await expect(withDbBinding({ SUPABASE_URL: url, DB: {} })).rejects.toThrow('Incomplete')
    await expect(withDbBinding({ SUPABASE_SERVICE_ROLE_KEY: 'x', DB: {} })).rejects.toThrow('Incomplete')
  })
  it('rejects credentials in URL and non-Supabase destinations', () => {
    for (const bad of ['http://test.supabase.co', 'https://example.com', 'https://user:pass@test.supabase.co']) {
      expect(() => createSupabaseDb(bad, 'key')).toThrow('Invalid Supabase URL')
    }
  })
})
