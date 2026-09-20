// @vitest-environment node
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { createSupabaseDb } from '../functions/_lib/dbBridge.js'
import { seedOverrideWorkspace } from '../functions/_lib/override.js'
import { onRequest } from '../functions/api/_middleware.js'
import { onRequestGet as events } from '../functions/api/override/events.js'
import { onRequestGet as workspace, onRequestPost as mutate } from '../functions/api/override.js'

const pg = new PGlite(), base = 'https://events-local.supabase.co', issuer = 'https://events-local.cloudflareaccess.com'
const DB = createSupabaseDb(base, 'test-only')
const env = { DB, DBBridgeApplied: true, SUPABASE_URL: base, SUPABASE_SERVICE_ROLE_KEY: 'test-only',
  ACCESS_TEAM_DOMAIN: issuer, ACCESS_AUD: 'events-local', OVERRIDE_DEMO_MODE: 'false', DEMO_WORKSPACES: 'false' }
const tokens = ['a'.repeat(64), 'b'.repeat(64)]
const demos = tokens.map(token => createSupabaseDb(base, 'test-only', token))
let queue = Promise.resolve(), pair, jwk
const enc = value => Buffer.from(JSON.stringify(value)).toString('base64url')
async function invoke(mode, handler, query = '', body = null, email = 'manager@local.invalid') {
  const headers = { Origin: 'https://local.invalid', 'X-Ilson-Request': '1', 'X-Idempotency-Key': crypto.randomUUID(), 'Content-Type': 'application/json' }
  const bindings = mode.startsWith('demo') ? { ...env, DEMO_WORKSPACES: 'true', OVERRIDE_DEMO_MODE: 'true' } : env
  if (mode.startsWith('demo')) headers.Cookie = `ilson_workspace=${tokens[mode === 'demo-other' ? 1 : 0]}`
  else if (email) {
    const now = Math.floor(Date.now() / 1000), unsigned = enc({ alg: 'RS256', kid: 'local' }) + '.' + enc({ iss: issuer, aud: ['events-local'], iat: now, exp: now + 300, email })
    headers['Cf-Access-Jwt-Assertion'] = unsigned + '.' + Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(unsigned))).toString('base64url')
  }
  const path = handler === events ? '/api/override/events' : '/api/override'
  if (mode.startsWith('demo') || email) headers['X-Ilson-Scope'] = await (mode.startsWith('demo') ? demos[mode === 'demo-other' ? 1 : 0] : DB.forActor(email)).toolRunScope()
  const context = { env: bindings, data: {}, request: new Request(`https://local.invalid${path}${query ? '?' + query : ''}`, {
    method: body ? 'POST' : 'GET', headers, ...(body ? { body: JSON.stringify({ role: 'product', ...body }) } : {}),
  }), next: request => handler({ env: bindings, data: context.data, request }) }
  const response = await onRequest(context)
  return { status: response.status, body: await response.json() }
}
async function ok(result) { expect(result.status, JSON.stringify(result.body)).toBe(200); return result.body }
async function seed(db, label) {
  await db.prepare("INSERT INTO override_product(id,name,domain,owner_team,model_name,model_version,prompt_version,policy_version) VALUES('page-product','페이지 AI','상담','지원','test','v1','p1','policy1')").run()
  await db.prepare("INSERT INTO issue_cluster(id,title,summary,cause_code,owner_team,scope_product_id,created_by_email) VALUES('old-cluster','이전 사건 군집','원문 보존','model','지원','page-product','worker@local.invalid')").run()
  await db.prepare(`INSERT INTO override_event(id,product_id,cluster_id,occurred_at,reviewer_label,reviewer_role,decision_action,is_override,ai_decision,human_decision,reason_code,reason_detail,model_version,prompt_version,reporter_email,validity,policy_refs_json)
    SELECT 'page-event-' || lpad(g::text,3,'0'),'page-product',CASE WHEN g=1 THEN 'old-cluster' ELSE NULL END,
      CASE WHEN g=1 THEN '2025-01-01 00:00:00' ELSE '2026-01-01 00:00:00' END,'작성자','reviewer',CASE WHEN g=1 THEN 'modify' ELSE 'approve' END,CASE WHEN g=1 THEN 1 ELSE 0 END,
      ? || ' 원문 ' || g,'사람 판단 ' || g,'unknown','고유 근거 ' || g,'v1','p1',CASE WHEN g=1 THEN 'worker@local.invalid' ELSE 'other-worker@local.invalid' END,
      CASE WHEN g=1 THEN 'pending' ELSE 'valid' END,'["보존 정책"]' FROM generate_series(1,501) g`).bind(label).run()
}
beforeAll(async () => {
  await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;')
  const folder = new URL('../supabase/migrations/', import.meta.url)
  for (const file of readdirSync(folder).filter(file => /^\d+.*\.sql$/.test(file)).sort()) await pg.exec(readFileSync(new URL(file, folder), 'utf8'))
  pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])
  jwk = { ...await crypto.subtle.exportKey('jwk', pair.publicKey), kid: 'local', alg: 'RS256', use: 'sig' }
  vi.stubGlobal('fetch', (url, options) => {
    if (String(url) === issuer + '/cdn-cgi/access/certs') return Promise.resolve(Response.json({ keys: [jwk] }))
    if (!String(url).startsWith(base + '/rest/v1/rpc/')) throw Error('External network blocked')
    const result = queue.then(async () => {
      try {
        await pg.exec('SET ROLE service_role')
        const name = new URL(url).pathname.split('/').at(-1), values = Object.values(JSON.parse(options.body))
        return Response.json((await pg.query(`SELECT public.${name}(${values.map((_, i) => '$' + (i + 1)).join(',')}) data`, values)).rows[0].data)
      } catch (error) { return Response.json({ code: error.code }, { status: 400 }) }
      finally { await pg.exec('RESET ROLE') }
    }); queue = result.catch(() => {}); return result
  })
  await seed(DB, 'Access')
  for (const [email, role, products] of [['manager@local.invalid', 'product', '["page-product"]'], ['worker@local.invalid', 'reviewer', '[]'], ['outsider@local.invalid', 'product', '[]']])
    await DB.prepare('INSERT INTO override_actor(email,display_name,role,product_ids_json) VALUES(?,?,?,?)').bind(email, email, role, products).run()
  for (let i = 0; i < tokens.length; i++) {
    await DB.workspaceOpen(tokens[i], [])
    await seedOverrideWorkspace({ DB: demos[i], DEMO_WORKSPACE: true })
  }
  await seed(demos[0], '개인 체험')
}, 60000)
afterAll(async () => { vi.unstubAllGlobals(); await pg.close() })

describe.sequential('full event evidence through signed Access/private demo middleware', () => {
  it('requires authenticated identity for the separate events endpoint', async () => {
    expect((await invoke('access', events, '', null, null)).status).toBe(401)
  })
  it.each(['access', 'demo'])('%s: pages 501 records without duplicates at identical timestamps and leaves workspace totals unchanged', async mode => {
    const before = await ok(await invoke(mode, workspace))
    expect(before.events).toHaveLength(500)
    expect(before.events.some(event => event.id === 'page-event-001')).toBe(false)
    let cursor = '', ids = [], sizes = []
    do {
      const result = await ok(await invoke(mode, events, 'productId=page-product' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : '')))
      expect(result.page.total).toBe(501)
      sizes.push(result.events.length); ids.push(...result.events.map(event => event.id))
      cursor = result.page.nextCursor
      expect(result.page.hasMore).toBe(Boolean(cursor))
    } while (cursor)
    expect(sizes).toEqual([100, 100, 100, 100, 100, 1])
    expect(ids).toHaveLength(501); expect(new Set(ids).size).toBe(501)
    expect(ids.at(-1)).toBe('page-event-001')
    expect((await ok(await invoke(mode, workspace))).metrics).toEqual(before.metrics)
  })
  it.each(['access', 'demo'])('%s: server filters, direct ID and selected-cluster queries reach the old source and permit its validation', async mode => {
    for (const query of ['eventId=page-event-001', 'clusterId=old-cluster', 'validity=pending&productId=page-product', 'action=modify&productId=page-product', 'q=page-event-001', 'q=' + encodeURIComponent('고유 근거 1') + '&action=modify']) {
      const result = await ok(await invoke(mode, events, query))
      expect(result.page.total, query).toBe(1)
      expect(result.events[0]).toMatchObject({ id: 'page-event-001', policy_refs: ['보존 정책'], human_decision: '사람 판단 1', validity: 'pending' })
      expect(result.events[0].ai_decision).toBe((mode === 'access' ? 'Access' : '개인 체험') + ' 원문 1')
    }
    expect((await ok(await invoke(mode, events, 'productId=missing-product'))).events).toEqual([])
    await ok(await invoke(mode, mutate, '', { action: 'validate_event', eventId: 'page-event-001', validity: 'valid', reason: '이전 원문과 정책을 확인했습니다.' }))
    const result = await ok(await invoke(mode, events, 'eventId=page-event-001'))
    expect(result.events[0]).toMatchObject({ validity: 'valid', validity_reason: '이전 원문과 정책을 확인했습니다.' })
  })
  it('does not widen reporter scope through filters, direct IDs or a forged cursor', async () => {
    const managerPage = await ok(await invoke('access', events))
    const own = await ok(await invoke('access', events, '', null, 'worker@local.invalid'))
    expect(own.events.map(event => event.id)).toEqual(['page-event-001'])
    expect((await invoke('access', events, 'eventId=page-event-002', null, 'worker@local.invalid')).status).toBe(404)
    expect((await invoke('access', events, 'eventId=page-event-001', null, 'outsider@local.invalid')).status).toBe(404)
    expect((await ok(await invoke('access', events, 'clusterId=old-cluster', null, 'outsider@local.invalid'))).events).toEqual([])
    expect((await ok(await invoke('access', events, 'cursor=' + encodeURIComponent(managerPage.page.nextCursor), null, 'outsider@local.invalid'))).page.total).toBe(0)
    await DB.prepare("UPDATE override_actor SET product_ids_json='[]' WHERE email='manager@local.invalid'").run()
    expect((await ok(await invoke('access', events))).events).toEqual([])
    await DB.prepare(`UPDATE override_actor SET product_ids_json='["page-product"]' WHERE email='manager@local.invalid'`).run()
  })
  it('never finds another visitor source in a different private workspace', async () => {
    expect((await invoke('demo-other', events, 'eventId=page-event-001')).status).toBe(404)
    expect((await ok(await invoke('demo-other', events, 'productId=page-product'))).page.total).toBe(0)
  })
  it.each(['cursor=broken', 'validity=unknown', 'action=delete', 'q=' + 'x'.repeat(201), 'eventId=' + 'x'.repeat(101)])('rejects invalid event query %s', async query => {
    expect((await invoke('access', events, query)).status).toBe(400)
  })
  it('treats SQL-looking search and identifier values as literal parameters', async () => {
    expect((await ok(await invoke('access', events, 'q=' + encodeURIComponent("' OR true --")))).events).toEqual([])
    expect((await invoke('access', events, 'eventId=' + encodeURIComponent("' OR true --"))).status).toBe(404)
  })
})
