// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { createSupabaseDb } from '../functions/_lib/dbBridge.ts'
import { feedbackActorKey } from '../functions/_lib/fieldFeedback.js'
import { seedOverrideWorkspace } from '../functions/_lib/override.js'
import { onRequest } from '../functions/api/_middleware.js'
import { onRequestGet } from '../functions/api/feedback.js'

const pg = new PGlite(), base = 'https://linked-local.supabase.co', issuer = 'https://linked-local.cloudflareaccess.com'
const DB = createSupabaseDb(base, 'test-only')
const env = { DB, DBBridgeApplied: true, SUPABASE_URL: base, SUPABASE_SERVICE_ROLE_KEY: 'test-only',
  ACCESS_TEAM_DOMAIN: issuer, ACCESS_AUD: 'linked-local', OVERRIDE_DEMO_MODE: 'false', DEMO_WORKSPACES: 'false' }
const tokens = ['c'.repeat(64), 'd'.repeat(64)]
const demos = tokens.map(token => createSupabaseDb(base, 'test-only', token))
let queue = Promise.resolve(), pair, jwk
const enc = value => Buffer.from(JSON.stringify(value)).toString('base64url')
async function get(mode, query = '', email = 'manager@local.invalid', role = 'product') {
  const headers = {}, isDemo = mode.startsWith('demo')
  const bindings = isDemo ? { ...env, DEMO_WORKSPACES: 'true', OVERRIDE_DEMO_MODE: 'true' } : env
  if (isDemo) headers.Cookie = `ilson_workspace=${tokens[mode === 'demo-other' ? 1 : 0]}`
  else {
    const now = Math.floor(Date.now() / 1000), unsigned = enc({ alg: 'RS256', kid: 'local' }) + '.' + enc({ iss: issuer, aud: ['linked-local'], iat: now, exp: now + 300, email })
    headers['Cf-Access-Jwt-Assertion'] = unsigned + '.' + Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(unsigned))).toString('base64url')
  }
  headers['X-Ilson-Scope'] = await (isDemo ? demos[mode === 'demo-other' ? 1 : 0] : DB.forActor(email)).toolRunScope()
  const context = { env: bindings, data: {}, request: new Request(`https://local.invalid/api/feedback?role=${role}${query ? '&' + query : ''}`, { headers }),
    next: request => onRequestGet({ env: bindings, data: context.data, request }) }
  const response = await onRequest(context), body = await response.json()
  expect(response.status, JSON.stringify(body)).toBe(200)
  return body
}
const oldCursor = encodeURIComponent(Buffer.from(JSON.stringify(['2021-01-01 00:00:00', 'any'])).toString('base64'))
async function seed(db, mode) {
  const key = await feedbackActorKey({ mode, email: 'worker@local.invalid' })
  await db.prepare("INSERT INTO override_product(id,name,domain,owner_team,model_name,model_version,prompt_version,policy_version) VALUES('linked-product','연결 점검 AI','지원','지원','test','v1','p1','policy1')").run()
  await db.prepare("INSERT INTO issue_cluster(id,title,summary,cause_code,owner_team,scope_product_id,created_by_email) VALUES('linked-cluster','이전 후속 검토','연결 보존','model','지원','linked-product','worker@local.invalid')").run()
  await db.prepare(`INSERT INTO override_event(id,product_id,cluster_id,reviewer_label,reviewer_role,decision_action,is_override,ai_decision,human_decision,reason_code,reason_detail,model_version,prompt_version,reporter_email)
    SELECT 'linked-event-' || g,'linked-product','linked-cluster','작성자','reviewer','modify',1,'원문 ' || g,'현장 판단','unknown','근거 ' || g,'v1','p1','worker@local.invalid' FROM generate_series(1,201) g`).run()
  await db.prepare(`INSERT INTO field_feedback_case(id,event_id,reporter_key,created_at)
    SELECT 'linked-case-' || g,'linked-event-' || g,?,CASE WHEN g=1 THEN '2020-01-01 00:00:00' ELSE '2026-01-01 00:00:00' END FROM generate_series(1,201) g`).bind(key).run()
  await db.prepare(`INSERT INTO field_feedback_update(id,case_id,kind,body,effective_on,actor_label)
    SELECT 'linked-update-' || g,'linked-case-' || g,'applied','적용 안내','2020-01-01','담당자' FROM generate_series(1,201) g`).run()
  await db.prepare(`INSERT INTO issue_followup(id,cluster_id,source_kind,source_id,product_id,event_id,reason,created_by,created_at)
    SELECT 'linked-followup-' || g,'linked-cluster','feedback','linked-update-' || g,'linked-product','linked-event-' || g,'미해결 ' || g,'작성자',CASE WHEN g=1 THEN '2020-01-01 00:00:00' ELSE '2026-01-01 00:00:00' END FROM generate_series(1,201) g`).run()
  for (const [id, status] of [['second', 'open'], ['resolved', 'resolved']]) {
    await db.prepare("INSERT INTO field_feedback_update(id,case_id,kind,body,effective_on,actor_label) VALUES(?,'linked-case-1','applied','추가 안내','2020-01-01','담당자')").bind('old-update-' + id).run()
    await db.prepare(`INSERT INTO issue_followup(id,cluster_id,source_kind,source_id,product_id,event_id,reason,created_by,created_at,status,resolution,resolved_at,resolved_by)
      VALUES(?,'linked-cluster','feedback',?,'linked-product','linked-event-1',?,'작성자','2019-01-01 00:00:00',?,?,?,?)`)
      .bind('old-followup-' + id, 'old-update-' + id, '과거 검토 ' + id, status, status === 'resolved' ? '확인 완료' : null, status === 'resolved' ? '2020-01-01 00:00:00' : null, status === 'resolved' ? '담당자' : null).run()
  }
  await db.prepare(`INSERT INTO quality_sample_batch(id,product_id,start_at,end_at,requested_size,sample_size,eligible_count,seed,created_by,created_at)
    SELECT 'linked-batch-' || g,'linked-product','2019-01-01','2020-01-01',2,CASE WHEN g=1 THEN 2 ELSE 0 END,2,'seed','담당자',CASE WHEN g=1 THEN '2020-01-01 00:00:00' ELSE '2026-01-01 00:00:00' END FROM generate_series(1,51) g`).run()
  for (const [g, status] of [[2, 'open'], [3, 'resolved']]) {
    await db.prepare("INSERT INTO quality_sample_item(id,batch_id,event_id,snapshot_json,verdict,reason,evidence_refs,reviewed_by,reviewed_at) VALUES(?,'linked-batch-1',?,'{\"ai_decision\":\"추출 원문\"}','issue','이전 오류','정책 원문','담당자','2020-01-01 00:00:00')").bind('old-sample-' + g, 'linked-event-' + g).run()
    await db.prepare(`INSERT INTO issue_followup(id,cluster_id,source_kind,source_id,product_id,event_id,reason,created_by,created_at,status,resolution,resolved_at,resolved_by)
      VALUES(?,'linked-cluster','quality_sample',?,'linked-product',?,'과거 표본 문제','담당자','2020-01-01 00:00:00',?,?,?,?)`)
      .bind('sample-followup-' + g, 'old-sample-' + g, 'linked-event-' + g, status, status === 'resolved' ? '표본 확인 완료' : null, status === 'resolved' ? '2020-01-02 00:00:00' : null, status === 'resolved' ? '담당자' : null).run()
  }
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
  await seed(DB, 'access')
  for (const [email, role, products] of [['manager@local.invalid', 'product', '["linked-product"]'], ['auditor@local.invalid', 'audit', '[]'], ['worker@local.invalid', 'reviewer', '[]'], ['other-worker@local.invalid', 'reviewer', '[]'], ['outsider@local.invalid', 'product', '[]']])
    await DB.prepare('INSERT INTO override_actor(email,display_name,role,product_ids_json) VALUES(?,?,?,?)').bind(email, email, role, products).run()
  for (let i = 0; i < tokens.length; i++) {
    await DB.workspaceOpen(tokens[i], [])
    await seedOverrideWorkspace({ DB: demos[i], DEMO_WORKSPACE: true })
  }
  await seed(demos[0], 'demo')
}, 60000)
afterAll(async () => { vi.unstubAllGlobals(); await pg.close() })

describe.sequential('page-linked followups beyond the 200-row overview', () => {
  it.each(['access', 'demo'])('%s: retains every old case followup without enlarging or duplicating the overview', async mode => {
    const data = await get(mode, 'caseCursor=' + oldCursor, 'worker@local.invalid', 'reviewer')
    const item = data.cases.find(item => item.id === 'linked-case-1')
    expect(item.followups.map(row => row.id)).toEqual(['linked-followup-1', 'old-followup-second', 'old-followup-resolved'])
    expect(item.followups.map(row => row.status)).toEqual(['open', 'open', 'resolved'])
    expect(item.followups[2].resolution).toBe('확인 완료')
    expect(data.followups).toHaveLength(200)
    expect(data.followups.some(row => item.followups.some(link => link.id === row.id))).toBe(false)
    expect(data.batches).toEqual([])
    const current = await get(mode, '', 'worker@local.invalid', 'reviewer')
    for (const entry of current.cases) expect(new Set(entry.followups.map(row => row.id)).size).toBe(entry.followups.length)
  })
  it.each(['access', 'demo'])('%s: restores open and resolved links in an old quality batch and keeps unrelated links out', async mode => {
    const data = await get(mode, 'caseCursor=' + oldCursor + '&batchCursor=' + oldCursor)
    const samples = data.samples.filter(item => item.batch_id === 'linked-batch-1')
    expect(samples.map(item => [item.id, item.followup?.id, item.followup?.status])).toEqual([
      ['old-sample-2', 'sample-followup-2', 'open'], ['old-sample-3', 'sample-followup-3', 'resolved'],
    ])
    expect(samples[1].followup.resolution).toBe('표본 확인 완료')
    expect(data.followups).toHaveLength(200)
    expect(data.followups.some(row => row.source_kind === 'quality_sample')).toBe(false)
    expect(data.cases.find(item => item.id === 'linked-case-1').followups).toHaveLength(3)
  })
  it('retains audit quality access without exposing another reporter feedback through the OR branch', async () => {
    const data = await get('access', 'caseCursor=' + oldCursor + '&batchCursor=' + oldCursor, 'auditor@local.invalid')
    expect(data.cases).toEqual([])
    expect(data.samples).toHaveLength(2)
    expect(data.samples.every(item => item.followup?.source_kind === 'quality_sample')).toBe(true)
    expect(data.followups.every(item => item.source_kind === 'quality_sample')).toBe(true)
  })
  it.each(['other-worker@local.invalid', 'outsider@local.invalid'])('does not widen %s access with old case and batch cursors', async email => {
    const data = await get('access', 'caseCursor=' + oldCursor + '&batchCursor=' + oldCursor, email)
    expect(data.cases).toEqual([]); expect(data.samples).toEqual([]); expect(data.followups).toEqual([])
  })
  it('never adds the other private workspace history', async () => {
    const data = await get('demo-other', 'caseCursor=' + oldCursor + '&batchCursor=' + oldCursor)
    expect(data.cases).toEqual([]); expect(data.samples).toEqual([])
    expect(data.followups.some(item => item.product_id === 'linked-product')).toBe(false)
  })
})
