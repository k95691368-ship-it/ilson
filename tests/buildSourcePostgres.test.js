// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { createSupabaseDb } from '../functions/_lib/dbBridge.ts'
import { onRequestGet as load, onRequestPost as save } from '../functions/api/applications/[id]/build.js'
import { buildRunPayload } from '../shared/buildPayload.js'
import { runPipeline } from '../shared/pipeline.js'

const pg = new PGlite(), base = 'https://build-source.supabase.co', root = createSupabaseDb(base, 'local-only')
const token = 'a'.repeat(64), tokenB = 'b'.repeat(64)
const DB = createSupabaseDb(base, 'local-only', token), other = createSupabaseDb(base, 'local-only', tokenB)
const secret = 'PRIVATE_RAW_CELL_MUST_STAY_LOCAL', application = 'source-app'
let queue = Promise.resolve(), failNextQuarantine = false
const statements = []
const file = gross => ({ name: 'same.csv', buffer: new TextEncoder().encode([
  '주문일자,상품코드,상품명,수량,판매가,할인액,개인메모',
  `2026-06-01,NR-CM-100,합성 상품,1,${gross},0,${secret}`,
  `2026-06-02,UNKNOWN,검토할 상품,1,${gross},0,${secret}`,
].join('\n')) })
const request = body => new Request('https://local.invalid/api/applications/source-app/build', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const post = (body, db = DB) => save({ env: { DB: db }, params: { id: application }, request: request(body) })
const get = (db = DB) => load({ env: { DB: db }, params: { id: application }, request: new Request('https://local.invalid/api/applications/source-app/build?rows=1') })
const counts = () => DB.prepare('SELECT (SELECT count(*) FROM build_run) AS runs,(SELECT count(*) FROM build_row) AS rows,(SELECT count(*) FROM build_quarantine) AS quarantine').first()
beforeAll(async () => {
  await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;')
  const dir = new URL('../supabase/migrations/', import.meta.url)
  for (const file of readdirSync(dir).filter(name => /^\d+.*\.sql$/.test(name)).sort()) await pg.exec(readFileSync(new URL(file, dir), 'utf8'))
  vi.stubGlobal('fetch', (url, options) => {
    if (!String(url).startsWith(base + '/rest/v1/rpc/')) throw Error('External calls forbidden')
    const task = queue.then(async () => {
      try {
        const body = JSON.parse(options.body), sql = body.p_statements ?? (body.p_sql ? [body.p_sql] : [])
        statements.push(...sql)
        if (failNextQuarantine && sql.some(text => text.includes('INSERT INTO build_quarantine'))) {
          failNextQuarantine = false
          return Response.json({ code: 'XX000' }, { status: 400 })
        }
        await pg.exec('SET ROLE service_role')
        const args = Object.values(body), name = new URL(url).pathname.split('/').at(-1)
        return Response.json((await pg.query(`SELECT public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) data`, args)).rows[0].data)
      } catch (error) { return Response.json({ code: error.code }, { status: 400 }) }
      finally { await pg.exec('RESET ROLE') }
    })
    queue = task.catch(() => {})
    return task
  })
  await root.workspaceOpen(token, [])
  await root.workspaceOpen(tokenB, [])
  await DB.prepare("INSERT INTO application(id,ticket_no,dept,applicant_label,title,bottleneck,problem,status) VALUES(?,'AX-SOURCE','재무','합성 신청자','원본 경계','취합','합성 문제','수용')").bind(application).run()
}, 60000)
afterAll(async () => { vi.unstubAllGlobals(); await pg.close() })

describe.sequential('browser-only originals and persisted build provenance', () => {
  it('keeps raw cell markers out of current HTTP payload and DB while preserving same-name file identity after reload', async () => {
    const result = await runPipeline({ files: [file(10000), file(15000)] })
    expect(JSON.stringify(result)).toContain(secret)
    const payload = buildRunPayload(result)
    expect(await request(payload).text()).not.toContain(secret)
    statements.length = 0
    const response = await post(payload)
    expect(response.status).toBe(201)
    expect(statements.join('\n')).not.toContain(secret)
    const reloaded = await get()
    expect(reloaded.status).toBe(200)
    const body = await reloaded.json()
    expect(JSON.stringify(body)).not.toContain(secret)
    expect(body.runs[0].totals.all.net_revenue_krw).toBe(25000)
    expect(body.rows.map(row => row.source_sha256)).toEqual(result.rows.map(row => row.source.sha256))
    expect(new Set(body.rows.map(row => row.source_sha256)).size).toBe(2)
    expect(body.rows.every(row => row.source_ambiguous_name === true)).toBe(true)
    expect(body.rows.map(row => row.trace)).toEqual(result.rows.map(row => row.trace))
    expect(body.quarantine.every(row => row.source_sha256 && row.source_ambiguous_name === true && row.raw.length === 0)).toBe(true)
    expect(body.runs[0].files.map(item => item.sha256)).toEqual(result.files.map(item => item.sha256))
    const stored = await DB.prepare('SELECT raw_json FROM build_quarantine').all()
    expect(stored.results.every(row => JSON.parse(row.raw_json).format === 'ilson.build-quarantine.v1')).toBe(true)
  })

  it('drops raw and arbitrary nested fields from legacy client submissions before writing', async () => {
    const result = await runPipeline({ files: [file(17000)] })
    result.files[0].raw = [secret]; result.files[0].extra = secret
    result.rows[0].extra = secret; result.rows[0].trace[0].raw = [secret]
    result.totals.raw = secret
    const body = { ...result, kind: 'run', duplicate_suspects: 0, duration_ms: 3 }
    expect(await request(body).text()).toContain(secret)
    statements.length = 0
    expect((await post(body)).status).toBe(201)
    expect(statements.join('\n')).not.toContain(secret)
    expect(JSON.stringify(await (await get()).json())).not.toContain(secret)
  })

  it('retains duplicate-source fingerprints through a write and reload without merging distinct originals', async () => {
    const first = file(18000), second = { ...first, buffer: new TextEncoder().encode(new TextDecoder().decode(first.buffer) + '\n') }
    const result = await runPipeline({ files: [first, second] })
    expect(result.rows).toHaveLength(2)
    expect(result.rows[1].duplicate_of.sha256).not.toBe(result.rows[1].source.sha256)
    expect((await post(buildRunPayload(result))).status).toBe(201)
    const body = await (await get()).json()
    expect(body.rows[1].duplicate_source).toEqual(result.rows[1].duplicate_of)
    expect(body.rows[1].duplicate_of).toBe(`${first.name}:2`)
    expect(body.rows[0].duplicate_source).toBeNull()
  })

  it('rejects malformed fingerprints before a run header or line is written', async () => {
    const result = await runPipeline({ files: [file(20000)] }), payload = buildRunPayload(result)
    const before = await counts()
    payload.files[0].sha256 = 'invalid'
    statements.length = 0
    expect((await post(payload)).status).toBe(400)
    expect(statements.some(sql => /^(INSERT|UPDATE|DELETE)/.test(sql))).toBe(false)
    expect(await counts()).toEqual(before)
  })

  it.each([
    ['missing row hash', value => { delete value.rows[0].source.sha256 }],
    ['missing row number', value => { delete value.rows[0].source.rowNo }],
    ['zero row number', value => { value.rows[0].source.rowNo = 0 }],
    ['false ambiguity claim', value => { value.rows[0].source.ambiguousName = false }],
    ['missing quarantine hash', value => { delete value.quarantine[0].source.sha256 }],
    ['invented missing-header exception', value => { value.quarantine[0].reason = 'unknown_channel'; value.quarantine[0].source.rowNo = 0 }],
  ])('rejects incomplete hashed source claims without any write: %s', async (_name, mutate) => {
    const payload = buildRunPayload(await runPipeline({ files: [file(10000), file(15000)] }))
    mutate(payload)
    const before = await counts()
    statements.length = 0
    expect((await post(payload)).status).toBe(400)
    expect(statements.some(sql => /^(INSERT|UPDATE|DELETE)/.test(sql))).toBe(false)
    expect(await counts()).toEqual(before)
  })

  it('preserves historical raw/trace arrays in storage and marks absent fingerprints as unknown', async () => {
    const latest = (await (await get()).json()).runs[0]
    const legacyRaw = ['LEGACY_RAW_PRESERVE'], legacyTrace = [{ step: '기존', value: '보존' }]
    await DB.prepare('UPDATE build_quarantine SET raw_json=? WHERE run_id=?').bind(JSON.stringify(legacyRaw), latest.id).run()
    await DB.prepare('UPDATE build_row SET trace_json=? WHERE run_id=?').bind(JSON.stringify(legacyTrace), latest.id).run()
    const body = await (await get()).json()
    expect(body.rows[0]).toMatchObject({ trace: legacyTrace, source_sha256: null, source_ambiguous_name: null })
    expect(body.quarantine[0]).toMatchObject({ raw: legacyRaw, source_sha256: null, source_ambiguous_name: null })
    expect(JSON.parse((await DB.prepare('SELECT raw_json FROM build_quarantine WHERE run_id=?').bind(latest.id).first()).raw_json)).toEqual(legacyRaw)
  })

  it('cleans up only the failed new run after a later write failure and keeps earlier records', async () => {
    const before = await counts(), result = await runPipeline({ files: [file(25000)] })
    failNextQuarantine = true
    const response = await post(buildRunPayload(result))
    expect(response.status).toBe(500)
    expect(await counts()).toEqual(before)
    expect((await (await get()).json()).quarantine[0].raw).toEqual(['LEGACY_RAW_PRESERVE'])
  })

  it('does not expose the record or create a build in another workspace or production', async () => {
    expect((await get(other)).status).toBe(404)
    expect((await post(buildRunPayload(await runPipeline({ files: [file(30000)] })), other)).status).toBe(404)
    expect((await root.prepare('SELECT count(*) AS n FROM build_run').first()).n).toBe(0)
    expect((await other.prepare('SELECT count(*) AS n FROM build_run').first()).n).toBe(0)
  })

  it('keeps all-unhashed older client submissions readable without inventing fingerprint claims', async () => {
    const body = { kind: 'run', files: [{ name: 'legacy.csv' }],
      rows: [{ date: '2026-06-01', iso_week: '2026-W23', sku: 'SKU-1', channel: 'A', gross_krw: 10000, source: { file: 'legacy.csv' } }],
      quarantine: [{ reason: 'legacy', source: { file: 'legacy.csv', rowNo: 0 }, raw: [secret] }] }
    expect((await post(body)).status).toBe(201)
    const data = await (await get()).json()
    expect(data.rows[0]).toMatchObject({ gross_krw: 10000, source_sha256: null, source_ambiguous_name: null })
    expect(data.quarantine[0]).toMatchObject({ raw: [], source_sha256: null, source_ambiguous_name: null })
  })

  it('persists the actual empty CSV as a fingerprinted file-level quarantine with no fabricated row', async () => {
    const result = await runPipeline({ files: [{ name: 'empty.csv', buffer: new Uint8Array() }] })
    expect(result.rows).toEqual([])
    expect((await post(buildRunPayload(result))).status).toBe(201)
    const data = await (await get()).json()
    expect(data.quarantine[0]).toMatchObject({ reason: 'unknown_channel', source_row_no: 0,
      source_sha256: result.files[0].sha256, source_ambiguous_name: false, raw: [] })
    expect(data.runs[0].rows_out).toBe(0)
  })
})
