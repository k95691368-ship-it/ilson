// @vitest-environment node
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { createSupabaseDb } from '../functions/_lib/dbBridge.js'
import { DEMO_APPLICATIONS } from '../functions/_lib/demoApplications.js'
import { seedOverrideWorkspace } from '../functions/_lib/override.js'
import { onRequestGet as journey, onRequestPost as link } from '../functions/api/applications/[id]/journey.js'
import { onRequest as middleware } from '../functions/api/_middleware.js'
import { onRequestGet as applications } from '../functions/api/applications/index.js'

const pg = new PGlite()
const tokenA = 'a'.repeat(64), tokenB = 'b'.repeat(64), tokenC = 'c'.repeat(64)
const seed = DEMO_APPLICATIONS.map((row, i) => ({ ...row, id: `demo_application_${i + 1}` }))
let queue = Promise.resolve()
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
    queue = run.catch(() => {})
    return run
  })
}, 60000)
afterAll(async () => { vi.unstubAllGlobals(); await pg.close() })
const root = createSupabaseDb('https://test.supabase.co', 'local-test')
const a = createSupabaseDb('https://test.supabase.co', 'local-test', tokenA)
const b = createSupabaseDb('https://test.supabase.co', 'local-test', tokenB)

describe.sequential('isolated PostgreSQL workspaces', () => {
  it('upgrades an existing private schema without dropping its application records',async()=>{
    const existing=createSupabaseDb('https://test.supabase.co','local-test','f'.repeat(64))
    expect((await existing.prepare('SELECT count(*) AS n FROM application').first()).n).toBe(3)
    expect(await existing.readiness()).toMatchObject({schemaReady:true,ready:true})
    expect((await existing.prepare('SELECT approval_id,mutation_version FROM change_experiment').all()).results).toEqual([])
    expect((await existing.prepare('SELECT id FROM field_feedback_case').all()).results).toEqual([])
    expect((await existing.prepare('SELECT id FROM quality_sample_item').all()).results).toEqual([])
  })
  it('creates two spaces with identical fixtures but no production rows', async () => {
    await root.workspaceOpen(tokenA, seed)
    await root.workspaceOpen(tokenB, seed)
    expect((await a.prepare('SELECT COUNT(*) AS n FROM application').first()).n).toBe(3)
    expect((await b.prepare('SELECT COUNT(*) AS n FROM application').first()).n).toBe(3)
    expect((await root.prepare('SELECT COUNT(*) AS n FROM application').first()).n).toBe(0)
    await a.prepare('UPDATE application SET title=? WHERE id=?').bind('A 전용 변경', seed[0].id).run()
    expect((await b.prepare('SELECT title FROM application WHERE id=?').bind(seed[0].id).first()).title).toBe(seed[0].title)
  }, 60000)
  it('keeps foreign keys and sequences local, rolls back failed batches', async () => {
    const foreignKeys = await pg.query(`SELECT count(*)::int AS n FROM pg_constraint c
      JOIN pg_class a ON a.oid=c.conrelid JOIN pg_namespace na ON na.oid=a.relnamespace
      JOIN pg_class b ON b.oid=c.confrelid JOIN pg_namespace nb ON nb.oid=b.relnamespace
      WHERE c.contype='f' AND na.nspname LIKE 'ilson_demo_%' AND na.nspname<>nb.nspname`)
    expect(foreignKeys.rows[0].n).toBe(0)
    const hitA = await a.prepare('INSERT INTO rate_limit_hits(bucket) VALUES (?)').bind('a').run()
    const hitB = await b.prepare('INSERT INTO rate_limit_hits(bucket) VALUES (?)').bind('b').run()
    expect(hitA.meta.last_row_id).toBe(1); expect(hitB.meta.last_row_id).toBe(1)
    await expect(a.batch([a.prepare('DELETE FROM application'), a.prepare('INSERT INTO missing_table VALUES (1)')])).rejects.toThrow()
    expect((await a.prepare('SELECT COUNT(*) AS n FROM application').first()).n).toBe(3)
  })
  it('preserves isolation through the actual Pages next-context binding contract', async () => {
    const bindings = { DEMO_WORKSPACES: 'true', SUPABASE_URL: 'https://test.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'local-test' }
    const data = {}
    const request = new Request('https://ilson.test/api/applications', { headers: { Cookie: `ilson_workspace=${tokenB}`, 'X-Ilson-Scope': await createSupabaseDb('https://test.supabase.co', 'local-test', tokenB).toolRunScope() } })
    const response = await middleware({ env: bindings, data, request,
      next: () => applications({ env: bindings, data, request }) })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.items).toHaveLength(3)
    expect(body.items.find(row => row.id === seed[0].id).title).toBe(seed[0].title)
    expect(bindings.DB).toBeUndefined()
    expect(data.requestEnv.DB.workspace).toBe(true)
  })
  it('executes existing OverrideLoop fixtures and the linked journey against scoped tables', async () => {
    const env = { DB: a, DEMO_WORKSPACE: true, SUPABASE_URL: 'https://test.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'local-test' }
    await seedOverrideWorkspace(env)
    const response = await link({ env, params: { id: seed[0].id }, request: new Request('https://ilson.test/api/applications/a/journey', { method: 'POST', body: JSON.stringify({ productId: 'olp_loan' }) }) })
    expect(response.status).toBe(200)
    const linked = await journey({ env, params: { id: seed[0].id } })
    expect(linked.status).toBe(200)
    const body = await linked.json()
    expect(body.operations.products).toHaveLength(1)
    expect(body.operations.events.length).toBeGreaterThan(0)
    expect(body.operations.events.every(e => e.product_id === 'olp_loan')).toBe(true)
    expect(body.operations.experiments.length).toBeGreaterThan(0)
    expect(body.entries.some(e => e.kind === '실험 결과')).toBe(true)
    const unlinked = await journey({ env, params: { id: seed[1].id } })
    expect((await unlinked.json()).operations.events).toEqual([])
    expect((await b.prepare('SELECT COUNT(*) AS n FROM application_product_link').first()).n).toBe(0)
    const removed = await link({ env, params: { id: seed[0].id }, request: new Request('https://ilson.test/api/applications/a/journey', { method: 'POST', body: JSON.stringify({ action: 'unlink', productId: 'olp_loan' }) }) })
    expect(removed.status).toBe(200)
    expect((await a.prepare('SELECT COUNT(*) AS n FROM override_event').first()).n).toBeGreaterThan(0)
    expect((await (await journey({ env, params: { id: seed[0].id } })).json()).operations.events).toEqual([])
  }, 60000)
  it('resets only A, revokes its old token, preserves B and production', async () => {
    await root.workspaceReset(tokenA, seed, tokenC)
    await expect(a.prepare('SELECT 1').first()).rejects.toThrow('28000')
    const c = createSupabaseDb('https://test.supabase.co', 'local-test', tokenC)
    expect((await c.prepare('SELECT title FROM application WHERE id=?').bind(seed[0].id).first()).title).toBe(seed[0].title)
    expect((await c.prepare('SELECT COUNT(*) AS n FROM application_product_link').first()).n).toBe(0)
    expect((await b.prepare('SELECT COUNT(*) AS n FROM application').first()).n).toBe(3)
    expect((await root.prepare('SELECT COUNT(*) AS n FROM application').first()).n).toBe(0)
  }, 60000)
  it('denies anonymous RPC and cannot fall back to public data on a missing table', async () => {
    await pg.exec('SET ROLE anon')
    await expect(rpc('ilson_workspace_query', { p_token: tokenB, p_sql: 'SELECT 1' })).rejects.toThrow()
    await pg.exec('RESET ROLE')
    await root.prepare("INSERT INTO override_actor(email,display_name,role) VALUES ('production','production','admin')").run()
    const schema = (await pg.query('SELECT schema_name FROM ilson_private.workspaces WHERE token_hash=encode(sha256(convert_to($1,\'UTF8\')),\'hex\')', [tokenB])).rows[0].schema_name
    await pg.exec(`DROP TABLE ${schema}.override_actor`)
    await expect(b.prepare('SELECT * FROM override_actor').all()).rejects.toThrow('42P01')
    expect((await root.prepare('SELECT COUNT(*) AS n FROM override_actor').first()).n).toBe(1)
  })
})
