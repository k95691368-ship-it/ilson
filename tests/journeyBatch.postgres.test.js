// @vitest-environment node
// 통합 이력(journey)과 그 안의 기록 조회(record)는 서로 기대지 않는 조회를 한 번의 RPC(batch)로 묶는다.
// 실제 PostgreSQL 체험 공간에서, 한 번 조회할 때 Supabase 로 나가는 RPC 수를 센다.
import { beforeAll, afterAll, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { createSupabaseDb } from '../functions/_lib/dbBridge.ts'
import { DEMO_APPLICATIONS } from '../functions/_lib/demoApplications.js'
import { seedOverrideWorkspace } from '../functions/_lib/override.js'
import { onRequestGet as journey, onRequestPost as link } from '../functions/api/applications/[id]/journey.js'
import { readTogether, one } from '../functions/_lib/readTogether.js'
import { atomicMutation } from '../functions/_lib/atomicMutation.ts'

const pg = new PGlite()
const tokenA = 'a'.repeat(64)
const seed = DEMO_APPLICATIONS.map((row, i) => ({ ...row, id: `demo_application_${i + 1}` }))
let queue = Promise.resolve(), rpcCalls = 0
const rpc = async (name, args) => {
  const params = Object.values(args)
  return (await pg.query(`SELECT public.${name}(${params.map((_, i) => '$' + (i + 1)).join(',')}) AS data`, params)).rows[0].data
}
beforeAll(async () => {
  await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;')
for (const file of ['0000_schema.sql', '0001_execute_sql.sql', '0002_override_loop.sql', '0003_journey_workspaces.sql', '0004_audit_hardening.sql','0005_field_feedback.sql','0006_access_scope.sql','0007_issue_workflow.sql','0008_feedback_rechecks.sql','0009_participation_quota.sql','0010_application_ownership.sql','0011_tool_run_receipts.sql','0012_beta_round_receipts.sql','0013_review_revision.sql']) {
    if (file === '0004_audit_hardening.sql') await rpc('ilson_workspace_open',{p_token:'f'.repeat(64),p_applications:seed})
    await pg.exec(readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'))
  }
  vi.stubGlobal('fetch', (url, options) => {
    const run = queue.then(async () => {
      try {
        await pg.exec('SET ROLE service_role')
        const body = JSON.parse(options.body)
        const data = await rpc(new URL(url).pathname.split('/').at(-1), body)
        return Response.json(data)
      } catch (error) { return Response.json({ code: error.code }, { status: 400 }) }
      finally { await pg.exec('RESET ROLE') }
    })
    rpcCalls++
    queue = run.catch(() => {})
    return run
  })
}, 60000)
afterAll(async () => { vi.unstubAllGlobals(); await pg.close() })
const root = createSupabaseDb('https://test.supabase.co', 'local-test')
const a = createSupabaseDb('https://test.supabase.co', 'local-test', tokenA)

it('통합 이력 조회는 운영 자료를 한 번에 묶어 읽는다', async () => {
  await root.workspaceOpen(tokenA, seed)
  const env = { DB: a, DEMO_WORKSPACE: true, SUPABASE_URL: 'https://test.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'local-test' }
  await seedOverrideWorkspace(env)
  expect((await link({ env, params: { id: seed[0].id }, request: new Request('https://ilson.test/api/applications/a/journey', { method: 'POST', body: JSON.stringify({ productId: 'olp_loan' }) }) })).status).toBe(200)
  rpcCalls = 0
  const response = await journey({ env, params: { id: seed[0].id } })
  expect(response.status).toBe(200)
  const body = await response.json()
  expect(body.operations.experiments.length).toBeGreaterThan(0)
  expect(body.operations.runs.length + body.operations.decisions.length).toBeGreaterThan(0)
  // 기록 조회의 16개 질의와 운영 자료 7개 질의를 batch 로 묶어, 예전 29회에서 9회다.
  // (Worker 는 한 요청 안에서 동시에 6개까지만 외부 연결을 열어, 따로 보낸 질의는 여러 번에 나눠 기다렸다.)
  expect(rpcCalls).toBe(9)
  // The fallback executes the same SQL individually: compare every returned field,
  // not only a successful status or request count.
  rpcCalls = 0
  const unbatched = await journey({ env: { ...env, DB: { ...a, readBatch: undefined } }, params: { id: seed[0].id } })
  expect(unbatched.status).toBe(200)
  expect(await unbatched.json()).toEqual(body)
  expect(rpcCalls).toBe(29)
}, 60000)

it('explicit read batches retain workspace isolation and reject mixed owners before sending SQL', async () => {
  const tokenB = 'b'.repeat(64), b = createSupabaseDb('https://test.supabase.co', 'local-test', tokenB)
  await root.workspaceOpen(tokenB, seed)
  await a.prepare('UPDATE application SET title=? WHERE id=?').bind('A only', seed[0].id).run()
  const reads = db => [one(db.prepare('SELECT title FROM application WHERE id=?').bind(seed[0].id)), db.prepare('SELECT product_id FROM application_product_link')]
  expect(await readTogether(a, reads(a))).toMatchObject([{ title: 'A only' }, { results: [{ product_id: 'olp_loan' }] }])
  expect(await readTogether(b, reads(b))).toMatchObject([{ title: seed[0].title }, { results: [] }])
  expect(await readTogether(root, [one(root.prepare('SELECT count(*) AS n FROM application'))])).toEqual([{ n: 0 }])
  rpcCalls = 0
  await expect(a.readBatch([b.prepare('SELECT title FROM application')])).rejects.toThrow('Invalid batch statement')
  expect(rpcCalls).toBe(0)
}, 60000)

it('a staged read batch remains in the actual PostgreSQL CAS check and cannot commit stale writes', async () => {
  const id = seed[0].id
  const before = await a.prepare('SELECT applicant_label FROM application WHERE id=?').bind(id).first()
  await expect(atomicMutation(a, 'batch-cas-stale-request', 'f'.repeat(64), async tx => {
    const [row] = await readTogether(tx, [one(tx.prepare('SELECT title FROM application WHERE id=?').bind(id))])
    expect(row.title).toBe('A only')
    // A concurrent editor changes the evidence after this transaction read it.
    await a.prepare('UPDATE application SET title=? WHERE id=?').bind('Concurrent edit', id).run()
    await tx.prepare('UPDATE application SET applicant_label=? WHERE id=?').bind('Must not commit', id).run()
    return Response.json({ saved: true })
  })).rejects.toThrow('40001')
  expect(await a.prepare('SELECT applicant_label FROM application WHERE id=?').bind(id).first()).toEqual(before)
  expect(await a.mutationReceipt('batch-cas-stale-request', 'f'.repeat(64))).toBeNull()
})
