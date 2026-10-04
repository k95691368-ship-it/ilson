// @vitest-environment node
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { createSupabaseDb } from '../functions/_lib/dbBridge.ts'
import { onRequestGet as loadOverride } from '../functions/api/override.js'
import { onRequestGet as loadOverview } from '../functions/api/overview.js'
import { onRequestGet as loadHonesty } from '../functions/api/honesty.js'
import { onRequestGet as loadDept } from '../functions/api/depts/[dept].js'

// OverrideLoop 운영 화면(가장 큰 페이지)의 자료 조회는 서로 기대지 않는 조회를 함께 보낸다.
// 통계 조회는 제품 이름만 나중에 붙이므로 운영 자료 조회와 함께 시작하고, 사내 모드의
// 제보용 제품 목록과 담당자 목록도 운영 자료를 기다리지 않는다. 모든 DB 호출은 Supabase
// RPC(fetch)를 거치므로, fetch 가 비어 있다가 새로 시작되는 횟수(DB 대기 단계)와 RPC 수를 센다.
const pg = new PGlite()
const base = 'https://override-stages.supabase.co'
const DB = createSupabaseDb(base, 'local-test-only')
const staff = 'staff@test.invalid'
let queue = Promise.resolve(), inFlight = 0, stages = 0, rpcCalls = 0
beforeAll(async () => {
  await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;')
  for (const file of ['0000_schema.sql', '0001_execute_sql.sql', '0002_override_loop.sql', '0003_journey_workspaces.sql', '0004_audit_hardening.sql', '0005_field_feedback.sql', '0006_access_scope.sql', '0007_issue_workflow.sql', '0008_feedback_rechecks.sql', '0009_participation_quota.sql', '0010_application_ownership.sql', '0011_tool_run_receipts.sql', '0012_beta_round_receipts.sql', '0013_review_revision.sql'])
    await pg.exec(readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'))
  vi.stubGlobal('fetch', (url, options) => {
    if (!String(url).startsWith(base + '/rest/v1/rpc/')) throw Error('External call blocked')
    rpcCalls++
    if (inFlight++ === 0) stages++
    const response = queue.then(async () => {
      try {
        await pg.exec('SET ROLE service_role')
        const args = Object.values(JSON.parse(options.body)), name = new URL(url).pathname.split('/').at(-1)
        return Response.json((await pg.query(`SELECT public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) data`, args)).rows[0].data)
      } catch (error) { return Response.json({ code: error.code, message: error.message }, { status: 400 }) }
      finally { await pg.exec('RESET ROLE') }
    })
    queue = response.catch(() => {})
    // 응답이 끝난 뒤 한 틱 쉬어, 이어지는 질의가 같은 단계로 잘못 세이지 않게 한다.
    return response.finally(() => new Promise((resolve) => setTimeout(resolve, 5))).finally(() => { inFlight-- })
  })
  await DB.prepare('INSERT INTO override_actor(email,display_name,role,departments_json,product_ids_json) VALUES(?,?,?,?,?)')
    .bind(staff, staff, 'product', JSON.stringify(['Finance']), JSON.stringify(['product-a'])).run()
  await DB.prepare("INSERT INTO override_product(id,name,domain,owner_team,model_name,model_version,prompt_version,policy_version) VALUES('product-a','제품 A','Test','Finance','model','v1','p1','policy1')").run()
}, 60000)
afterAll(async () => { vi.unstubAllGlobals(); await pg.close() })

it('사내 모드의 운영 화면 자료는 통계·제품 목록·담당자 목록을 운영 자료와 함께 읽는다', async () => {
  stages = 0
  rpcCalls = 0
  const response = await loadOverride({
    env: { DB: DB.forActor(staff), UNSCOPED_DB: DB, OVERRIDE_DEMO_MODE: 'false',
      AUTH_ACTOR: { email: staff, label: staff, role: 'product', mode: 'access', departments: ['Finance'], product_ids: ['product-a'] } },
    request: new Request('https://local.invalid/api/override'),
  })
  expect(response.status).toBe(200)
  const body = await response.json()
  expect(body.products.map((product) => product.id)).toEqual(['product-a'])
  expect(body.capture_products).toEqual([{ id: 'product-a', name: '제품 A' }])
  expect(body.assignment_candidates.map((candidate) => candidate.email)).toEqual([staff])
  expect(body.metrics).toHaveProperty('total_decisions')
  // 운영 자료·통계·제품 목록·담당자 목록이 한 단계에 함께 나간다.
  // 예전에는 운영 자료 → 통계 → 제품 목록 → 담당자 목록, 네 단계였다.
  expect(stages).toBe(1)
  // 운영 자료 10개·통계 7개 질의가 각각 한 번의 batch 로 묶였다. 예전에는 19번의 RPC 였고,
  // Worker 의 동시 외부 연결(6개) 제한 때문에 실제로는 여러 번에 나눠 기다렸다.
  expect(rpcCalls).toBe(4)
  // Capability fallback is also a current baseline; it runs identical SQL without
  // batching so equality checks fields and visibility, not only fewer requests.
  rpcCalls = 0
  const withoutReadBatch = db => ({ ...db, readBatch: undefined, forActor: email => withoutReadBatch(db.forActor(email)) })
  const unbatchedDb = withoutReadBatch(DB.forActor(staff))
  const unbatched = await loadOverride({
    env: { DB: unbatchedDb, UNSCOPED_DB: DB, OVERRIDE_DEMO_MODE: 'false',
      AUTH_ACTOR: { email: staff, label: staff, role: 'product', mode: 'access', departments: ['Finance'], product_ids: ['product-a'] } },
    request: new Request('https://local.invalid/api/override'),
  })
  expect(unbatched.status).toBe(200)
  const unbatchedBody = await unbatched.json()
  expect(unbatchedBody.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  expect({ ...unbatchedBody, generated_at: body.generated_at }).toEqual(body)
  expect(rpcCalls).toBe(19)
})

it('현황·정직·부서 화면은 서로 기대지 않는 조회를 한 번의 RPC 로 묶는다', async () => {
  for (const [name, call] of [['overview', () => loadOverview({ env: { DB } })], ['honesty', () => loadHonesty({ env: { DB }, request: new Request('https://local.invalid/api/honesty') })], ['dept', () => loadDept({ env: { DB }, params: { dept: 'Finance' }, request: new Request('https://local.invalid/api/depts/Finance') })]]) {
    rpcCalls = 0
    const response = await call()
    expect(response.status, name).toBe(200)
    // 예전에는 현황 13번, 정직 10번, 부서 10번의 RPC 였다.
    expect(rpcCalls, name).toBe(1)
    const body = await response.json()
    const fallback = { ...DB, readBatch: undefined }
    const unbatched = name === 'overview' ? await loadOverview({ env: { DB: fallback } })
      : name === 'honesty' ? await loadHonesty({ env: { DB: fallback }, request: new Request('https://local.invalid/api/honesty') })
      : await loadDept({ env: { DB: fallback }, params: { dept: 'Finance' } })
    expect(unbatched.status, name).toBe(200)
    expect(await unbatched.json(), name).toEqual(body)
    expect(rpcCalls - 1, name).toBe(name === 'overview' ? 13 : 10)
  }
})

it('read batching keeps other departments out of source records and propagates revoked actor access', async () => {
  await DB.prepare("INSERT INTO override_product(id,name,domain,owner_team,model_name,model_version,prompt_version,policy_version) VALUES('product-b','제품 B','Test','Sales','model','v1','p1','policy1')").run()
  await DB.prepare('INSERT INTO override_actor(email,display_name,role,departments_json,product_ids_json) VALUES(?,?,?,?,?)')
    .bind('other@local.invalid', 'Other', 'product', JSON.stringify(['Sales']), JSON.stringify(['product-b'])).run()
  for (const [email, department, productId] of [[staff, 'Finance', 'product-a'], ['other@local.invalid', 'Sales', 'product-b']]) {
    const response = await loadOverride({ env: { DB: DB.forActor(email), UNSCOPED_DB: DB, OVERRIDE_DEMO_MODE: 'false',
      AUTH_ACTOR: { email, label: email, role: 'product', mode: 'access', departments: [department], product_ids: [productId] } },
      request: new Request('https://local.invalid/api/override') })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.products.map(row => row.id)).toEqual([productId])
    expect(body.assignment_candidates.map(row => row.email)).toEqual([email])
    // Cross-team capture keeps only the deliberately public report picker projection.
    expect(body.capture_products).toEqual([{ id: 'product-a', name: '제품 A' }, { id: 'product-b', name: '제품 B' }])
  }
  await DB.prepare('UPDATE override_actor SET active=0 WHERE email=?').bind(staff).run()
  const revoked = await loadOverride({ env: { DB: DB.forActor(staff), UNSCOPED_DB: DB, OVERRIDE_DEMO_MODE: 'false',
    AUTH_ACTOR: { email: staff, label: staff, role: 'product', mode: 'access', departments: ['Finance'], product_ids: ['product-a'] } },
    request: new Request('https://local.invalid/api/override') })
  expect(revoked.status).toBe(401)
  expect(await revoked.json()).toMatchObject({ code: 'ACCESS_REVOKED' })
})
