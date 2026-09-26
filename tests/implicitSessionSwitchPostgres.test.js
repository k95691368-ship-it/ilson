// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { createSupabaseDb } from '../functions/_lib/dbBridge.ts'
import { onRequest as middleware } from '../functions/api/_middleware.js'
import { onRequestGet as sessionGet } from '../functions/api/session.js'
import { onRequestGet as applicationGet } from '../functions/api/applications/[id]/index.js'
import { onRequestPost as askPost } from '../functions/api/applications/[id]/ask.js'
import { onRequestDelete as workspaceDelete } from '../functions/api/demo/workspace.js'
import { api, readAccessSession } from '../src/api/client.ts'
import { beginAccessCheck, completeAccessCheck, getAccessSession } from '../src/lib/accessSession.js'

// Uses real middleware, signed JWTs, scoped RPCs and an in-memory PostgreSQL DB.
// Both browser rejection and server rejection are checked: bypassing the local
// gate must still not put an A-confirmed draft into B's current database scope.
const pg = new PGlite(), base = 'https://implicit-switch-local.supabase.co', issuer = 'https://implicit-switch-local.cloudflareaccess.com'
const DB = createSupabaseDb(base, 'local-test-only')
const tokens = ['c'.repeat(64), 'd'.repeat(64)], emails = ['switch-a@local.invalid', 'switch-b@local.invalid']
const bindings = { DB, DBBridgeApplied: true, SUPABASE_URL: base, SUPABASE_SERVICE_ROLE_KEY: 'local-test-only', ACCESS_TEAM_DOMAIN: issuer, ACCESS_AUD: 'implicit-switch-local', OVERRIDE_DEMO_MODE: 'false' }
let queue = Promise.resolve(), currentIdentity = 0, mode = 'demo', pair, jwk, handlerCalls = 0
const rpcCalls = []
beforeAll(async () => {
  await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;')
  const folder = new URL('../supabase/migrations/', import.meta.url)
  for (const file of readdirSync(folder).filter(file => /^\d+.*\.sql$/.test(file)).sort()) await pg.exec(readFileSync(new URL(file, folder), 'utf8'))
  pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])
  jwk = { ...await crypto.subtle.exportKey('jwk', pair.publicKey), kid: 'implicit-switch-local', alg: 'RS256', use: 'sig' }
  vi.stubGlobal('fetch', (url, options = {}) => {
    if (String(url) === issuer + '/cdn-cgi/access/certs') return Promise.resolve(Response.json({ keys: [jwk] }))
    if (String(url).startsWith('/api/')) return browserRequest(String(url), options)
    if (!String(url).startsWith(base + '/rest/v1/rpc/')) throw Error('External call blocked')
    const result = queue.then(async () => {
      try {
        await pg.exec('SET ROLE service_role')
        const name = new URL(url).pathname.split('/').at(-1), args = Object.values(JSON.parse(options.body))
        rpcCalls.push({ name, args })
        return Response.json((await pg.query(`SELECT public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) data`, args)).rows[0].data)
      } catch (error) { return Response.json({ code: error.code }, { status: 400 }) }
      finally { await pg.exec('RESET ROLE') }
    })
    queue = result.catch(() => {})
    return result
  })
  await pg.query("INSERT INTO public.override_actor(email,display_name,role,departments_json) VALUES($1,'계정 A','product','[\"재무\"]'),($2,'계정 B','product','[\"재무\"]')", emails)
  await pg.query("INSERT INTO public.application(id,ticket_no,dept,applicant_label,title,bottleneck,problem,owner_email) VALUES('switch-shared','AX-AAA-BBB','재무','작성자','공유 업무','취합','반복',$1)", [emails[0]])
  for (const [index, token] of tokens.entries()) {
    await DB.workspaceOpen(token, [])
    const demoDB = createSupabaseDb(base, 'local-test-only', token)
    await demoDB.prepare("INSERT INTO application(id,ticket_no,dept,applicant_label,title,bottleneck,problem) VALUES('switch-shared','AX-AAA-BBB','재무','작성자',?,'취합','반복')").bind(index === 0 ? 'A 공간 신청' : 'B 공간 신청').run()
  }
}, 60000)
afterAll(async () => { vi.unstubAllGlobals(); await pg.close() })
const enc = value => Buffer.from(JSON.stringify(value)).toString('base64url')
async function signed(email) {
  const now = Math.floor(Date.now() / 1000)
  const unsigned = enc({ alg: 'RS256', kid: jwk.kid }) + '.' + enc({ iss: issuer, aud: ['implicit-switch-local'], email, iat: now, exp: now + 300 })
  return unsigned + '.' + Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(unsigned))).toString('base64url')
}
async function browserRequest(path, options) {
  const env = { ...bindings, DEMO_WORKSPACES: mode === 'demo' ? 'true' : 'false' }
  const headers = new Headers(options.headers)
  headers.set('Origin', 'https://local.invalid')
  if (mode === 'demo') headers.set('Cookie', `ilson_workspace=${tokens[currentIdentity]}`)
  else headers.set('Cf-Access-Jwt-Assertion', await signed(emails[currentIdentity]))
  const request = new Request('https://local.invalid' + path, { ...options, headers })
  const handler = path === '/api/session' ? sessionGet : path === '/api/demo/workspace' ? workspaceDelete : options.method === 'POST' ? askPost : applicationGet
  const context = { env, request, data: {}, next: forwarded => { handlerCalls++; return handler({ env, data: context.data, request: forwarded, params: { id: 'switch-shared' } }) } }
  return middleware(context)
}

describe.sequential('implicit cookie/account changes require a matching verified scope', () => {
  it.each(['demo', 'access'])('%s: stale A requests cannot read or write B, even with a valid B identity', async selectedMode => {
    mode = selectedMode; currentIdentity = 0
    const generation = beginAccessCheck()
    const initialSession = await readAccessSession(generation)
    expect(completeAccessCheck(generation, initialSession)).toBe(true)
    expect((await api.get('/applications/switch-shared')).application.id).toBe('switch-shared')
    const draft = { question: `${mode} A 연결에서 작성한 비공개 질문입니다.`, why: 'A 연결에서 신청 내용을 확인하기 위한 질문입니다.', author: '계정 A' }
    currentIdentity = 1 // same-origin cookie/JWT replacement, e.g. another tab
    const beforeHandler = handlerCalls
    await expect(api.get('/applications/switch-shared')).rejects.toMatchObject({ status: 409, code: 'SESSION_SCOPE_CHANGED' })
    expect(getAccessSession()).toMatchObject({ status: 'blocked', scope: null })
    expect(handlerCalls).toBe(beforeHandler)
    const beforeRpc = rpcCalls.length
    // This deliberately bypasses the client-side blocked state.
    const response = await browserRequest('/api/applications/switch-shared/ask', { method: 'POST', headers: { 'X-Ilson-Request': '1', 'X-Ilson-Scope': initialSession.scope, 'Content-Type': 'application/json' }, body: JSON.stringify(draft) })
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'SESSION_SCOPE_CHANGED' })
    expect(handlerCalls).toBe(beforeHandler)
    expect(rpcCalls.slice(beforeRpc).some(call => /rate_limit|mutation|batch/.test(call.name) || call.args.some(value => typeof value === 'string' && /\b(INSERT|UPDATE|DELETE)\b/.test(value)))).toBe(false)
    const actualB = mode === 'demo' ? createSupabaseDb(base, 'local-test-only', tokens[1]) : DB.forActor(emails[1])
    const bScope = await actualB.toolRunScope()
    expect(bScope).not.toBe(initialSession.scope)
    expect(await actualB.prepare('SELECT id FROM decision_log WHERE what=?').bind(draft.question).first()).toBeNull()
    // Recovery explicitly verifies B before a newly confirmed B write.
    const newGeneration = beginAccessCheck()
    expect(completeAccessCheck(newGeneration, await readAccessSession(newGeneration))).toBe(true)
    expect(getAccessSession().scope).toBe(bScope)
    const saved = await api.post('/applications/switch-shared/ask', { ...draft, question: `${mode} B 연결 확인 후 새 질문입니다.` })
    expect(saved.ok).toBe(true)
    expect((await actualB.prepare('SELECT what,title FROM decision_log WHERE id=?').bind(saved.id).first()).what).toContain('B 연결 확인 후')
  })
  it('a stale A reset cannot delete the currently selected B workspace', async () => {
    mode = 'demo'; currentIdentity = 1
    const oldScope = await createSupabaseDb(base, 'local-test-only', tokens[0]).toolRunScope()
    const beforeHandler = handlerCalls, beforeRpc = rpcCalls.length
    const response = await browserRequest('/api/demo/workspace', { method: 'DELETE', headers: { 'X-Ilson-Request': '1', 'X-Ilson-Scope': oldScope, 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: 'reset-my-workspace' }) })
    expect(response.status).toBe(409)
    expect(handlerCalls).toBe(beforeHandler)
    expect(rpcCalls.slice(beforeRpc).some(call => /reset|rate_limit/.test(call.name))).toBe(false)
    expect((await createSupabaseDb(base, 'local-test-only', tokens[1]).prepare("SELECT title FROM application WHERE id='switch-shared'").first()).title).toBe('B 공간 신청')
  })
  it.each(['demo', 'access'])('%s scope cannot be omitted or malformed to evade the precondition', async selectedMode => {
    mode = selectedMode; currentIdentity = 1
    for (const [scope, status, code] of [[null, 428, 'SESSION_SCOPE_REQUIRED'], ['', 400, 'SESSION_SCOPE_INVALID'], ['not-a-scope', 400, 'SESSION_SCOPE_INVALID']]) {
      const beforeHandler = handlerCalls, beforeRpc = rpcCalls.length
      const headers = { 'X-Ilson-Request': '1', 'Content-Type': 'application/json', ...(scope === null ? {} : { 'X-Ilson-Scope': scope }) }
      const response = await browserRequest('/api/applications/switch-shared/ask', { method: 'POST', headers, body: JSON.stringify({ question: '임의 연결에서 질문하지 않습니다.', why: '서버의 필수 사전조건을 확인합니다.' }) })
      expect(response.status).toBe(status)
      expect(await response.json()).toMatchObject({ code })
      expect(handlerCalls).toBe(beforeHandler)
      expect(rpcCalls.slice(beforeRpc).some(call => /rate_limit|mutation|batch/.test(call.name))).toBe(false)
    }
  })
})
