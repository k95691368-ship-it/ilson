// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { PGlite } from '@electric-sql/pglite'
import { compileSql } from '../functions/_lib/dbBridge.ts'
import { onRequestGet as decisionsGet } from '../functions/api/decisions.js'
import { onRequestGet as applicationGet } from '../functions/api/applications/[id]/index.js'
import { onRequestGet as recordGet } from '../functions/api/applications/[id]/record.js'
import { CODE_REVIEW_PREFIX } from '../shared/codeReviewEvidence.ts'
import { dossierText } from '../shared/dossier.js'

const pg = new PGlite()
const sqlite = new DatabaseSync(':memory:')
const app = 'code-consumer-app'
const revision = 'a'.repeat(64)
const evidence = (externalCode, extra = {}) => CODE_REVIEW_PREFIX + JSON.stringify({
  version: 1, action: 'confirm', externalCode, reviewedMappingRevision: revision,
  beforeCanonicalCode: 'NR-CM-100', afterCanonicalCode: 'NR-CM-100',
  provenance: { state: 'linked', applicationId: app }, ...extra,
})
const rawRows = [
  { id: 'valid', link_kind: '코드확인', link_id: 'X-valid', alternatives: evidence('X-valid'), metadata: true, status: 'verified' },
  { id: 'correction', link_kind: '코드정정', link_id: 'X-correction', alternatives: evidence('X-correction', { action: 'correct', afterCanonicalCode: 'NR-PA-030' }), metadata: true, status: 'verified' },
  { id: 'broken', link_kind: '코드확인', link_id: 'X-broken', alternatives: CODE_REVIEW_PREFIX + '{"version":1,"payload":"hidden-malformed-only', metadata: true, status: 'unreadable' },
  { id: 'future', link_kind: '코드확인', link_id: 'X-future', alternatives: evidence('X-future', { version: 999 }), metadata: true, status: 'unreadable' },
  { id: 'wrong-app', link_kind: '코드확인', link_id: 'X-wrong-app', alternatives: evidence('X-wrong-app', { provenance: { state: 'linked', applicationId: 'unrelated-app' } }), metadata: true, status: 'unreadable' },
  { id: 'wrong-code', link_kind: '코드확인', link_id: 'X-wrong-code', alternatives: evidence('unrelated-external-code'), metadata: true, status: 'unreadable' },
  { id: 'wrong-kind', link_kind: '코드정정', link_id: 'X-wrong-kind', alternatives: evidence('X-wrong-kind'), metadata: true, status: 'unreadable' },
  // This family's marker has meaning only for the two code review kinds.
  { id: 'other-kind', link_kind: 'review', link_id: 'X-other', alternatives: evidence('X-other') },
  { id: 'legacy', link_kind: '코드확인', link_id: 'X-legacy', alternatives: '  legacy-choice: 원문 "인용"과\n줄바꿈을 보존합니다.  ' },
  { id: 'null-kind', link_kind: null, link_id: null, alternatives: 'legacy-choice: 종류 없는 예전 대안' },
  { id: 'uppercase', link_kind: '코드확인', link_id: 'X-upper', alternatives: evidence('X-upper').replace(CODE_REVIEW_PREFIX, CODE_REVIEW_PREFIX.toUpperCase()) },
  { id: 'infix', link_kind: '코드확인', link_id: 'X-infix', alternatives: 'legacy-choice: ' + evidence('X-infix') },
  { id: 'near-prefix', link_kind: '코드확인', link_id: 'X-near', alternatives: 'ilson-code-review 원문 대안' },
  { id: 'empty', link_kind: '코드확인', link_id: 'X-empty', alternatives: '' },
  { id: 'null', link_kind: '코드확인', link_id: 'X-null', alternatives: null },
].map((row, index) => ({ ...row, application_id: app, stage: '제작', actor: 'human',
  title: `검토자 ${row.id}`, what: `원본 기록 ${row.id}`, why: `근거 ${row.id}`, unrequested: 0,
  created_at: `2026-10-04 01:00:${String(index).padStart(2, '0')}`,
}))
const persistedFields = ['id', 'application_id', 'stage', 'actor', 'title', 'what', 'why', 'alternatives', 'link_kind', 'link_id', 'created_at', 'unrequested']
const persisted = row => Object.fromEntries(persistedFields.map(key => [key, row[key]]))
const queryCounts = { pg: [], sqlite: [] }

function adapter(engine) {
  return { prepare(sql) {
    const statement = binds => ({
      bind: (...values) => statement(values),
      async all() {
        const rows = engine === 'pg'
          ? (await pg.query(compileSql(sql, binds))).rows
          : sqlite.prepare(sql).all(...binds)
        queryCounts[engine].push({ sql, returned: rows.length })
        return { results: rows }
      },
      async first(column) {
        const row = (await this.all()).results[0] ?? null
        return column === undefined ? row : row?.[column] ?? null
      },
    })
    return statement([])
  } }
}
const envs = { pg: { DB: adapter('pg') }, sqlite: { DB: adapter('sqlite') } }

beforeAll(async () => {
  await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;')
  const directory = new URL('../supabase/migrations/', import.meta.url)
  for (const name of readdirSync(directory).filter(name => /^\d+.*\.sql$/.test(name)).sort()) {
    await pg.exec(readFileSync(new URL(name, directory), 'utf8'))
  }
  await pg.query(`INSERT INTO application(id,ticket_no,dept,applicant_label,title,bottleneck,problem,status)
    VALUES($1,'AX-COD-001','재무','가상 신청자','코드 확인 이력','반복 취합','시간 소요','수용')`, [app])
  sqlite.exec(`CREATE TABLE application(id TEXT,ticket_no TEXT,dept TEXT,title TEXT);
    CREATE TABLE review(application_id TEXT,verdict TEXT,refuse_alternative TEXT);
    CREATE TABLE decision_log(id TEXT,application_id TEXT,stage TEXT,actor TEXT,title TEXT,what TEXT,why TEXT,
      alternatives TEXT,link_kind TEXT,link_id TEXT,created_at TEXT,unrequested INTEGER);`)
  sqlite.prepare('INSERT INTO application VALUES(?,?,?,?)').run(app, 'AX-COD-001', '재무', '코드 확인 이력')
  const columns = persistedFields.join(',')
  for (const row of rawRows) {
    const values = persistedFields.map(key => row[key])
    await pg.query(`INSERT INTO decision_log(${columns}) VALUES(${values.map((_, i) => '$' + (i + 1)).join(',')})`, values)
    sqlite.prepare(`INSERT INTO decision_log(${columns}) VALUES(${values.map(() => '?').join(',')})`).run(...values)
  }
}, 60000)
afterAll(async () => { sqlite.close(); await pg.close() })

async function history(engine, query = '') {
  const response = await decisionsGet({ env: envs[engine], request: new Request('https://local.invalid/api/decisions' + query) })
  expect(response.status).toBe(200)
  return response.json()
}

function expectProjection(rows) {
  expect(rows).toHaveLength(rawRows.length)
  for (const source of rawRows) {
    const shown = rows.find(row => row.id === source.id)
    for (const field of ['id', 'application_id', 'stage', 'actor', 'title', 'what', 'why', 'link_kind', 'link_id', 'created_at']) {
      expect(shown[field], `${source.id}.${field}`).toEqual(source[field])
    }
    expect(shown.alternatives).toBe(source.metadata ? null : source.alternatives)
    if (source.metadata) {
      expect(shown.code_review_evidence_status).toBe(source.status)
      if (source.status === 'unreadable') expect(shown.code_review_evidence).toBeUndefined()
      else expect(shown.code_review_evidence).toMatchObject({ externalCode: source.link_id, provenance: { state: 'linked', applicationId: app } })
    } else expect(shown.code_review_evidence_status).toBeUndefined()
  }
}

describe.each(['pg', 'sqlite'])('%s decision metadata presentation', engine => {
  it('projects only reserved review metadata while keeping every source field and legacy alternative', async () => {
    const result = await history(engine)
    expectProjection(result.items)
    expect(result.items.map(row => row.id)).toEqual(rawRows.map(row => row.id).reverse())
    expect(result.totals).toMatchObject({ total: rawRows.length, human: rawRows.length,
      withAlternatives: rawRows.filter(row => !row.metadata && row.alternatives).length })
  })

  it('excludes metadata-only search matches, retains human evidence and exact legacy text searches', async () => {
    expect((await history(engine, '?q=hidden-malformed-only')).items).toEqual([])
    const hashMatches = await history(engine, '?q=' + revision)
    expect(hashMatches.items.map(row => row.id).sort()).toEqual(['other-kind', 'uppercase', 'infix'].sort())
    const legacyMatches = await history(engine, '?q=legacy-choice')
    expect(legacyMatches.items.map(row => row.id).sort()).toEqual(['legacy', 'null-kind', 'infix'].sort())
    expect((await history(engine, '?q=' + encodeURIComponent('근거 valid'))).items.map(row => row.id)).toEqual(['valid'])
  })

  it('keeps full-scope totals when the visible list is empty and returns aggregate rows, not all history', async () => {
    const result = await history(engine, '?actor=ai')
    expect(result.items).toEqual([])
    expect(result.totals.withAlternatives).toBe(rawRows.filter(row => !row.metadata && row.alternatives).length)
    expect(result.sides.total).toBe(rawRows.length)
    const totalsQuery = queryCounts[engine].findLast(entry => entry.sql.includes('AS with_alternatives'))
    expect(totalsQuery.returned).toBe(1)
  })
})

it('application detail and printable record project the same code metadata without changing original storage', async () => {
  const before = (await pg.query('SELECT * FROM decision_log ORDER BY id')).rows
  const detailResponse = await applicationGet({ env: envs.pg, params: { id: app } })
  const recordResponse = await recordGet({ env: envs.pg, params: { id: app } })
  expect(detailResponse.status).toBe(200)
  expect(recordResponse.status).toBe(200)
  const detail = await detailResponse.json(), record = await recordResponse.json()
  expectProjection(detail.decisions)
  expectProjection(record.decisions)
  expect(detail.decisions.map(row => row.id)).toEqual(rawRows.map(row => row.id))
  expect(record.decisions.map(row => row.id)).toEqual(rawRows.map(row => row.id))
  expect((await pg.query('SELECT * FROM decision_log ORDER BY id')).rows).toEqual(before)
})

it('independent TXT export suppresses valid and malformed metadata but preserves the original decision count and prose', () => {
  const selected = rawRows.filter(row => row.metadata || row.id === 'legacy')
  const record = { application: { id: app, ticket_no: 'AX-COD-001', title: '코드 이력', dept: '재무' },
    decisions: selected.map(persisted), done: { 신청서: true } }
  const snapshot = structuredClone(record)
  const text = dossierText(record)
  expect(text).not.toContain(CODE_REVIEW_PREFIX)
  expect(text).not.toContain(revision)
  expect(text).not.toContain('hidden-malformed-only')
  expect(text).toContain(`이 신청서에서 내린 결정 ${selected.length}건`)
  expect(text).toContain(rawRows.find(row => row.id === 'legacy').alternatives)
  for (const row of selected) {
    expect(text).toContain(row.title)
    expect(text).toContain(row.what)
    expect(text).toContain(row.why)
  }
  expect(record).toEqual(snapshot)
})
