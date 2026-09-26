import { afterEach, describe, expect, it, vi } from 'vitest'
import { compileSql, createSupabaseDb, databaseAccessFailure, withDbBinding } from '../functions/_lib/dbBridge.ts'
import { failUnexpected } from '../functions/_lib/http.ts'

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
    expect(fetch.mock.calls.every(([, options]) => options.redirect === 'manual')).toBe(true)
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
  for (const scope of ['actor', 'workspace']) it.each([['28000',401], ['42501',403]])(`${scope} 범위의 %s는 안전한 접근 거절 %s로 전달한다`, async (code,status) => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ code, message: 'PRIVATE SQL AND SERVICE KEY', details: 'PRIVATE ROW', hint: 'PRIVATE TOKEN' }, { status: 400 })))
    const db = createSupabaseDb(url, 'test-key', scope === 'workspace' ? 'a'.repeat(64) : null, scope === 'actor' ? 'person@local.invalid' : null)
    const error = await db.prepare('SELECT 1').all().catch(error => error)
    expect(error.message).toBe(`Database request failed (400/${code})`)
    expect(databaseAccessFailure(error)).toMatchObject({ status, code: code === '28000' ? 'ACCESS_REVOKED' : 'ACCESS_DENIED' })
    const response = failUnexpected(error, '일반 DB 오류')
    expect(response.status).toBe(status)
    const body = await response.text()
    expect(body).not.toMatch(/PRIVATE|test-key|Database request|28000|42501|person@/)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  })
  it.each(['28000','42501','PGRST301','42P01'])('범위 없는 설정·DB 오류 %s는 503을 유지한다', async code => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ code, message: 'PRIVATE SQL' }, { status: 401 })))
    const error = await createSupabaseDb(url, 'test-key').prepare('SELECT 1').all().catch(error => error)
    expect(databaseAccessFailure(error)).toBeNull()
    const response = failUnexpected(error, '서버 설정을 확인해야 합니다.')
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: '서버 설정을 확인해야 합니다.' })
  })
  it.each(['PGRST301','42P01','23505','23514','40001'])('scoped RPC라도 접근 SQLSTATE가 아닌 %s는 기존 오류 계약을 유지한다', async code => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ code, message: 'PRIVATE SQL' }, { status: 400 })))
    const error = await createSupabaseDb(url, 'test-key').forActor('person@local.invalid').prepare('SELECT 1').all().catch(error => error)
    expect(databaseAccessFailure(error)).toBeNull()
    expect(failUnexpected(error, 'DB 오류').status).toBe(503)
  })
  it('임의 오류의 상태·문구로 공개 접근 오류를 위조할 수 없다', () => {
    const fake = Object.assign(Error('Database request failed (400/28000)'), { name: 'DatabaseAccessError', status: 401, publicStatus: 401 })
    expect(databaseAccessFailure(fake)).toBeNull()
    expect(failUnexpected(fake, '일반 오류').status).toBe(503)
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
