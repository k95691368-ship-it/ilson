// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { createSupabaseDb } from '../functions/_lib/dbBridge.ts'
import { onRequest as middleware } from '../functions/api/_middleware.js'
import { onRequest as session, onRequestGet } from '../functions/api/session.js'

const pg = new PGlite()
const base = 'https://session-local.supabase.co'
const issuer = 'https://session-local.cloudflareaccess.com'
const emailA = 'session-a@local.invalid', emailB = 'session-b@local.invalid'
const tokenA = 'a'.repeat(64), tokenB = 'b'.repeat(64)
const DB = createSupabaseDb(base, 'local-session-test-only')
const bindings = {
  DB, DBBridgeApplied: true, SUPABASE_URL: base, SUPABASE_SERVICE_ROLE_KEY: 'local-session-test-only',
  ACCESS_TEAM_DOMAIN: issuer, ACCESS_AUD: 'session-local', DEMO_WORKSPACES: 'false', OVERRIDE_DEMO_MODE: 'false',
}
let pair, jwk, queue = Promise.resolve(), rpcFailure
const rpcCalls = []

beforeAll(async () => {
  await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;')
  const folder = new URL('../supabase/migrations/', import.meta.url)
  for (const name of readdirSync(folder).filter(name => /^\d+.*\.sql$/.test(name)).sort()) {
    await pg.exec(readFileSync(new URL(name, folder), 'utf8'))
  }
  pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])
  jwk = { ...await crypto.subtle.exportKey('jwk', pair.publicKey), kid: 'session-local', alg: 'RS256', use: 'sig' }
  vi.stubGlobal('fetch', (url, options) => {
    if (String(url) === issuer + '/cdn-cgi/access/certs') return Promise.resolve(Response.json({ keys: [jwk] }))
    if (!String(url).startsWith(base + '/rest/v1/rpc/')) throw new Error('External network blocked')
    const result = queue.then(async () => {
      const name = new URL(url).pathname.split('/').at(-1)
      const body = JSON.parse(options.body)
      rpcCalls.push({ name, body })
      const code = rpcFailure?.(name, body)
      if (code) return Response.json({ code, message: 'PRIVATE SQL SENTINEL' }, { status: 500 })
      const values = Object.values(body)
      try {
        await pg.exec('SET ROLE service_role')
        return Response.json((await pg.query(`SELECT public.${name}(${values.map((_, i) => '$' + (i + 1)).join(',')}) data`, values)).rows[0].data)
      } catch (error) {
        return Response.json({ code: error.code, message: 'PRIVATE SQL SENTINEL', details: 'PRIVATE ROW SENTINEL' }, { status: 400 })
      } finally { await pg.exec('RESET ROLE') }
    })
    queue = result.catch(() => {})
    return result
  })
  await pg.query("INSERT INTO public.override_actor(email,display_name,role) VALUES($1,'Private A','product'),($2,'Private B','reviewer')", [emailA, emailB])
  await DB.workspaceOpen(tokenA, [])
  await DB.workspaceOpen(tokenB, [])
}, 60000)

beforeEach(async () => {
  rpcCalls.length = 0
  rpcFailure = null
  await pg.exec("UPDATE public.override_actor SET active=1; UPDATE ilson_private.workspaces SET expires_at=now()+interval '7 days'")
})
afterAll(async () => { vi.unstubAllGlobals(); await pg.close() })

const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url')
async function assertion(email = emailA) {
  const now = Math.floor(Date.now() / 1000)
  const unsigned = encode({ alg: 'RS256', kid: jwk.kid }) + '.' + encode({ iss: issuer, aud: ['session-local'], email, iat: now, exp: now + 300 })
  const signature = Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(unsigned))).toString('base64url')
  return unsigned + '.' + signature
}
async function invoke({ mode = 'access', method = 'GET', email = emailA, authenticated = true, token = tokenA, extraHeaders = {}, beforeHandler } = {}) {
  const env = { ...bindings, DEMO_WORKSPACES: mode === 'demo' ? 'true' : 'false' }
  const headers = { Origin: 'https://session.local', 'X-Ilson-Request': '1', ...extraHeaders }
  if (mode === 'access' && authenticated) headers['Cf-Access-Jwt-Assertion'] = await assertion(email)
  if (mode === 'demo' && token) headers.Cookie = `ilson_workspace=${token}`
  if (method !== 'GET') headers['X-Ilson-Scope'] = await (mode === 'demo' ? createSupabaseDb(base, 'local-session-test-only', token) : DB.forActor(email)).toolRunScope()
  const request = new Request('https://session.local/api/session', { method, headers })
  const next = vi.fn(async forwarded => {
    await beforeHandler?.(context.data.requestEnv)
    // Pages gives handlers the original platform bindings and shared request
    // data. Success therefore also proves requestData.requestEnv is used.
    return session({ env, data: context.data, request: forwarded ?? request })
  })
  const context = { env, request, data: {}, next }
  return { response: await middleware(context), next }
}
async function readSafe(response, status) {
  expect(response.status, await response.clone().text()).toBe(status)
  expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  const text = await response.text()
  expect(text).not.toMatch(/PRIVATE|Private [AB]|session-[ab]@|local-session-test-only|Database request|28000|42501|53300/)
  expect(text).not.toContain(tokenA)
  expect(text).not.toContain(tokenB)
  const body = JSON.parse(text)
  if (status !== 200) expect(body).not.toHaveProperty('scope')
  return body
}

describe.sequential('세션 확인의 실제 인증·scoped PostgreSQL 경계', () => {
  it('실제 서명과 활성 계정은 개인정보 없는 최소 응답과 기존 도구 scope를 반환한다', async () => {
    const { response, next } = await invoke()
    const body = await readSafe(response, 200)
    expect(body).toEqual({ ok: true, mode: 'access', scope: await DB.forActor(emailA).toolRunScope() })
    expect(body.scope).toMatch(/^[a-f0-9]{64}$/)
    expect(next).toHaveBeenCalledTimes(1)
    expect(rpcCalls.some(call => call.name === 'ilson_actor_query' && call.body.p_actor === emailA && call.body.p_sql === 'SELECT 1')).toBe(true)
    expect(response.headers.get('Vary')).toMatch(/Cookie/)
    expect(response.headers.get('Vary')).toMatch(/Authorization/)
  })

  it('같은 계정은 같은 scope를 사용하고 다른 계정은 다른 scope를 사용한다', async () => {
    const first = await readSafe((await invoke()).response, 200)
    const again = await readSafe((await invoke()).response, 200)
    const other = await readSafe((await invoke({ email: emailB })).response, 200)
    expect(again.scope).toBe(first.scope)
    expect(other.scope).not.toBe(first.scope)
  })

  it('인증 뒤 계정이 회수되면 SELECT 1에서 401로 거절한다', async () => {
    const { response } = await invoke({ beforeHandler: () => pg.query('UPDATE public.override_actor SET active=0 WHERE email=$1', [emailA]) })
    expect(await readSafe(response, 401)).toMatchObject({ code: 'ACCESS_REVOKED' })
  })

  it('이미 비활성화된 계정의 유효한 서명도 허용하지 않는다', async () => {
    await pg.query('UPDATE public.override_actor SET active=0 WHERE email=$1', [emailA])
    const { response, next } = await invoke()
    await readSafe(response, 401)
    expect(next).not.toHaveBeenCalled()
  })

  it.each([{}, { 'Cf-Access-Authenticated-User-Email': emailA, 'X-User-Email': emailA }, { 'Cf-Access-Jwt-Assertion': 'forged.invalid.signature' }])('서명 증명 없이 클라이언트 헤더만으로는 세션을 열 수 없다 (%j)', async extraHeaders => {
    const { response, next } = await invoke({ authenticated: false, extraHeaders })
    await readSafe(response, 401)
    expect(next).not.toHaveBeenCalled()
    expect(rpcCalls.some(call => call.name === 'ilson_actor_query')).toBe(false)
  })

  it('실제 JWT의 이메일만 바꾸고 원래 서명을 붙여도 인증되지 않는다', async () => {
    const parts = (await assertion()).split('.')
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString())
    parts[1] = encode({ ...claims, email: emailB })
    const { response, next } = await invoke({ authenticated: false, extraHeaders: { 'Cf-Access-Jwt-Assertion': parts.join('.') } })
    await readSafe(response, 401)
    expect(next).not.toHaveBeenCalled()
    expect(rpcCalls).toHaveLength(0)
  })

  it('서명이 유효해도 등록되지 않은 계정은 허용하지 않는다', async () => {
    const { response, next } = await invoke({ email: 'unregistered@local.invalid' })
    await readSafe(response, 401)
    expect(next).not.toHaveBeenCalled()
  })

  it('활성 체험 공간은 같은 토큰에 같은 scope를, 다른 공간에는 다른 scope를 반환한다', async () => {
    const first = await readSafe((await invoke({ mode: 'demo' })).response, 200)
    const again = await readSafe((await invoke({ mode: 'demo' })).response, 200)
    const other = await readSafe((await invoke({ mode: 'demo', token: tokenB })).response, 200)
    const demoDb = createSupabaseDb(base, 'local-session-test-only', tokenA)
    expect(first).toEqual({ ok: true, mode: 'demo', scope: await demoDb.toolRunScope() })
    expect(again.scope).toBe(first.scope)
    expect(other.scope).not.toBe(first.scope)
    expect(first.scope).not.toBe(await DB.forActor(emailA).toolRunScope())
  })

  it.each(['before middleware', 'before handler'])('체험 공간 만료는 안전한 401이다 (%s)', async timing => {
    const expire = () => pg.exec("UPDATE ilson_private.workspaces SET expires_at=now()-interval '1 second'")
    if (timing === 'before middleware') await expire()
    const { response, next } = await invoke({ mode: 'demo', ...(timing === 'before handler' ? { beforeHandler: expire } : {}) })
    expect(await readSafe(response, 401)).toMatchObject({ code: 'ACCESS_REVOKED' })
    expect(next).toHaveBeenCalledTimes(timing === 'before handler' ? 1 : 0)
  })

  it('체험 쿠키가 없으면 새 공간을 만들지 않고 428로 거절한다', async () => {
    const { response, next } = await invoke({ mode: 'demo', token: null })
    await readSafe(response, 428)
    expect(next).not.toHaveBeenCalled()
    expect(rpcCalls).toHaveLength(0)
  })

  it('존재하지 않는 체험 토큰을 소유 증명으로 취급하지 않는다', async () => {
    const { response, next } = await invoke({ mode: 'demo', token: 'f'.repeat(64) })
    await readSafe(response, 401)
    expect(next).not.toHaveBeenCalled()
  })

  it.each([['53300', 503, null], ['42501', 403, 'ACCESS_DENIED']])('scoped 확인의 %s는 개인정보 없는 %s 응답이다', async (code, status, publicCode) => {
    const { response } = await invoke({ beforeHandler: () => { rpcFailure = (name, body) => name === 'ilson_actor_query' && body.p_sql === 'SELECT 1' ? code : null } })
    const body = await readSafe(response, status)
    if (publicCode) expect(body.code).toBe(publicCode)
    else expect(body).not.toHaveProperty('code', 'ACCESS_REVOKED')
  })

  it.each([undefined, null, '', 'a'.repeat(63), 'a'.repeat(65), 'A'.repeat(64), 'g'.repeat(64), 123, {}])('잘못된 scope 응답을 성공으로 보내지 않는다 (%j)', async scope => {
    const scopeSpy = vi.fn(async () => scope)
    const { response } = await invoke({ beforeHandler: env => { env.DB = { ...env.DB, toolRunScope: scopeSpy } } })
    await readSafe(response, 503)
    expect(scopeSpy).toHaveBeenCalledTimes(1)
    expect(rpcCalls.some(call => call.name === 'ilson_actor_query' && call.body.p_sql === 'SELECT 1')).toBe(true)
  })

  it.each(['access', 'demo'])('GET 외 POST는 업무 동작이나 scope를 반환하지 않는다 (%s)', async mode => {
    const { response, next } = await invoke({ mode, method: 'POST' })
    await readSafe(response, mode === 'access' ? 403 : 405)
    if (mode === 'access') expect(next).not.toHaveBeenCalled()
    else expect(response.headers.get('Allow')).toBe('GET')
  })

  it.each(['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])('라우트 자체도 %s를 읽기 성공으로 처리하지 않는다', async method => {
    const prepare = vi.fn(), toolRunScope = vi.fn()
    const context = { env: { DEMO_WORKSPACE: true, DB: { workspace: true, prepare, toolRunScope } }, request: new Request('https://session.local/api/session', { method }) }
    const response = await session(context)
    await readSafe(response, 405)
    expect(response.headers.get('Allow')).toBe('GET')
    expect(prepare).not.toHaveBeenCalled()
    expect(toolRunScope).not.toHaveBeenCalled()
  })

  it.each([
    { DB },
    { DB, AUTH_ACTOR: { mode: 'demo' } },
    { DB, DEMO_WORKSPACE: 'true' },
  ])('명시적인 검증 세션이 없으면 unscoped 해시로 성공하지 않는다', async env => {
    await readSafe(await onRequestGet({ env, request: new Request('https://session.local/api/session') }), 401)
  })

  it.each([
    { DB, AUTH_ACTOR: { mode: 'access', email: emailA } },
    { DB: DB.forActor(emailB), AUTH_ACTOR: { mode: 'access', email: emailA } },
    { DB, DEMO_WORKSPACE: true },
    { DB: createSupabaseDb(base, 'local-session-test-only', tokenA), DEMO_WORKSPACE: true, AUTH_ACTOR: { mode: 'access', email: emailA } },
  ])('세션 표시와 DB 범위가 불일치하면 안전하게 차단한다', async env => {
    await readSafe(await onRequestGet({ env, request: new Request('https://session.local/api/session') }), 503)
  })
})
