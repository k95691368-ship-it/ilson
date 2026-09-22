// @vitest-environment node
import { afterAll, beforeAll, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { compileSql } from '../functions/_lib/dbBridge.js'
import { onRequestGet } from '../functions/api/decisions.js'

let database
const groupedRows = []
const env = { DB: { prepare(sql) {
  const statement = binds => ({
    bind: (...values) => statement(values),
    async all() {
      const result = await database.query(compileSql(sql, binds))
      if (sql.includes('GROUP BY link_kind')) groupedRows.push(result.rows.length)
      return { results: result.rows }
    },
    async first() { return (await this.all()).results[0] ?? null },
  })
  return statement([])
} } }

beforeAll(async () => {
  database = new PGlite()
  await database.exec(`
    CREATE TABLE application (id text, ticket_no text, dept text, title text);
    CREATE TABLE review (application_id text, verdict text, refuse_alternative text);
    CREATE TABLE decision_log (id text, application_id text, stage text, actor text,
      title text, what text, why text, alternatives text, created_at text, link_kind text, unrequested integer);
    INSERT INTO application VALUES ('app', 'AX-TEST', '재무', '정산');
    INSERT INTO decision_log
      SELECT 'decision-' || n, 'app', '검토', 'human', '검토 기록', '내용', '근거', '', '2026-09-22',
        CASE n % 4 WHEN 0 THEN NULL WHEN 1 THEN '수령확인' WHEN 2 THEN '성과대리확인' ELSE ' 코드알림 ' END, 0
      FROM generate_series(1, 10000) n;
  `)
})
afterAll(async () => { await database?.close() })

it('transfers 4 aggregate rows for 10,000 decisions and preserves every count', async () => {
  const response = await onRequestGet({ env, request: new Request('https://ilson.test/api/decisions') })
  expect(response.status).toBe(200)
  const body = await response.json()
  expect(body.sides).toEqual({ ax: 2500, dept: 5000, proxy: 2500, total: 10000 })
  expect(body.sideLine).toContain('10000건 중 5000건')
  expect(body.items).toHaveLength(200)
  expect(groupedRows.at(-1)).toBe(4)
})
it('keeps organization totals independent of the selected list filter', async () => {
  const response = await onRequestGet({ env, request: new Request('https://ilson.test/api/decisions?actor=ai') })
  const body = await response.json()
  expect(body.items).toEqual([])
  expect(body.sides).toEqual({ ax: 2500, dept: 5000, proxy: 2500, total: 10000 })
  expect(groupedRows.at(-1)).toBe(4)
})
