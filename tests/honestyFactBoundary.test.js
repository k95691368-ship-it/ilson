// @vitest-environment node
// Real signed middleware and current scoped RPCs run against disposable PG.
// Neither fixture records nor provider responses represent operating evidence.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { createSupabaseDb } from '../functions/_lib/dbBridge.ts'
import { onRequest as middleware } from '../functions/api/_middleware.js'
import { onRequestGet as honesty } from '../functions/api/honesty.js'
import { onRequestGet as health } from '../functions/api/health.js'

const pg = new PGlite(), base = 'https://honesty-local.supabase.co', issuer = 'https://honesty-local.cloudflareaccess.com'
const DB = createSupabaseDb(base, 'synthetic-facts-only'), emailA = 'honesty-a@local.invalid', emailB = 'honesty-b@local.invalid'
const token = 'c'.repeat(64), keys = ['sample_size', 'fake_data', 'one_case', 'no_ai', 'not_operated']
const bindings = { DB, DBBridgeApplied: true, SUPABASE_URL: base, SUPABASE_SERVICE_ROLE_KEY: 'synthetic-facts-only',
  ACCESS_TEAM_DOMAIN: issuer, ACCESS_AUD: 'honesty-local', DEMO_WORKSPACES: 'false', OVERRIDE_DEMO_MODE: 'false' }
let pair, jwk, queue = Promise.resolve(), proofOverride, rpcFailure
const calls = []

beforeAll(async () => {
  await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;')
  const directory = new URL('../supabase/migrations/', import.meta.url)
  for (const name of readdirSync(directory).filter(file => /^\d+.*\.sql$/.test(file)).sort()) await pg.exec(readFileSync(new URL(name, directory), 'utf8'))
  pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])
  jwk = { ...await crypto.subtle.exportKey('jwk', pair.publicKey), kid: bindings.ACCESS_AUD, alg: 'RS256', use: 'sig' }
  vi.stubGlobal('fetch', (url, options) => {
    if (String(url) === issuer + '/cdn-cgi/access/certs') return Promise.resolve(Response.json({ keys: [jwk] }))
    if (!String(url).startsWith(base + '/rest/v1/rpc/')) throw Error('External network prohibited')
    const name = new URL(url).pathname.split('/').at(-1), args = JSON.parse(options.body)
    calls.push({ name, args })
    const task = queue.then(async () => {
      if (rpcFailure && name === 'ilson_actor_batch') return Response.json({ code: rpcFailure, message: 'PRIVATE SQL AND DATA SENTINEL' }, { status: 400 })
      try {
        await pg.exec('SET ROLE service_role')
        const values = Object.values(args)
        const data = (await pg.query(`SELECT public.${name}(${values.map((_, index) => '$' + (index + 1)).join(',')}) AS data`, values)).rows[0].data
        // Corrupt only the queried proof projection after SQL executes. This
        // checks unknown-count handling without changing domain rows/schema.
        const proofIndex = Array.isArray(args.p_statements) ? args.p_statements.findIndex(sql => sql.includes('AS finished')) : -1
        if (proofOverride !== undefined && proofIndex >= 0) data[proofIndex] = { rows: proofOverride === null ? [] : [proofOverride], rowCount: proofOverride === null ? 0 : 1 }
        return Response.json(data)
      } catch (error) { return Response.json({ code: error.code, message: 'PRIVATE SQL AND DATA SENTINEL' }, { status: 400 }) }
      finally { await pg.exec('RESET ROLE') }
    })
    queue = task.catch(() => {})
    return task
  })
  await pg.query(`INSERT INTO override_actor(email,display_name,role,departments_json) VALUES
    ($1,'A 합성 담당자','product','["Finance"]'),($2,'B 합성 담당자','product','["Other"]')`, [emailA, emailB])
  for (const [id, owner, dept] of [['facts-a', emailA, 'Finance'], ['facts-b', emailB, 'Other']]) {
    await DB.prepare(`INSERT INTO application(id,ticket_no,dept,applicant_label,title,bottleneck,problem,status,owner_email)
      VALUES(?,?,?,'가상 신청자','합성 업무','취합','반복 업무','수용',?)`).bind(id, id, dept, owner).run()
  }
  await addRecords('facts-b', 'Other', 3)
  await DB.workspaceOpen(token, [])
}, 60000)

beforeEach(async () => {
  await queue; calls.length = 0; proofOverride = undefined; rpcFailure = undefined
  await pg.query('UPDATE override_actor SET active=1 WHERE email=$1', [emailA])
  await pg.exec("UPDATE ilson_private.workspaces SET expires_at=now()+interval '7 days'")
})
afterAll(async () => { await queue; vi.unstubAllGlobals(); await pg.close() })

async function addRecords(id, dept, sampleN) {
  await DB.prepare('INSERT INTO handover(application_id,slug,title,handed_to_dept,handed_to_person) VALUES(?,?,?,?,?)')
    .bind(id, id + '-tool', '합성 도구', dept, '합성 담당자').run()
  await DB.prepare('INSERT INTO outcome(application_id) VALUES(?)').bind(id).run()
  await DB.prepare('INSERT INTO baseline(application_id,median_seconds,min_seconds,max_seconds,sample_n) VALUES(?,?,?,?,?)')
    .bind(id, 300, 250, 350, sampleN).run()
  for (const ok of [0, 1]) await DB.prepare('INSERT INTO tool_use(id,application_id,ok,duration_ms,human_review_seconds) VALUES(?,?,?,?,?)')
    .bind(id + '-use-' + ok, id, ok, 1000, 30).run()
}

const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url')
async function assertion(email) {
  const now = Math.floor(Date.now() / 1000)
  const text = encode({ alg: 'RS256', kid: jwk.kid }) + '.' + encode({ iss: issuer, aud: [bindings.ACCESS_AUD], email, iat: now, exp: now + 600 })
  return text + '.' + Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(text))).toString('base64url')
}

async function invoke({ mode = 'access', authenticated = true, email = emailA, path = '/honesty', spoof = false, beforeHandler } = {}) {
  const env = { ...bindings, DEMO_WORKSPACES: String(mode === 'demo') }
  const headers = {}
  if (mode === 'demo') {
    headers.Cookie = 'ilson_workspace=' + token
    headers['X-Ilson-Scope'] = await createSupabaseDb(base, 'synthetic-facts-only', token).toolRunScope()
  } else {
    if (authenticated) headers['Cf-Access-Jwt-Assertion'] = await assertion(email)
    headers['X-Ilson-Scope'] = await DB.forActor(email).toolRunScope()
  }
  if (spoof) { headers['X-Override-Role'] = 'product'; headers['X-Ilson-Mode'] = 'demo' }
  const request = new Request('https://facts.local/api' + path + (spoof ? '?mode=demo&demo=true' : ''), { headers })
  const context = { env, request, data: {} }
  context.next = async forwarded => {
    await beforeHandler?.(context.data.requestEnv)
    return (path === '/health' ? health : honesty)({ env: bindings, data: context.data, request: forwarded ?? request })
  }
  const response = await middleware(context), body = await response.json()
  expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  expect(JSON.stringify(body)).not.toMatch(/PRIVATE SQL|synthetic-facts-only|honesty-[ab]@/)
  return { status: response.status, body, bound: context.data.requestEnv }
}

function entries(body) {
  expect(body.unproven.map(item => item.key)).toEqual(keys)
  expect(body.summary.unproven).toBe(5)
  for (const item of body.unproven) expect(Object.keys(item)).toEqual(['key', 'title', 'body', 'instead'])
  return Object.fromEntries(body.unproven.map(item => [item.key, item]))
}

describe.sequential('honesty facts at signed middleware and scoped PostgreSQL boundary', () => {
  it('describes only visible zero records even when another department has baseline, handover, outcome and executions', async () => {
    const a = await invoke(), b = await invoke({ email: emailB })
    expect(a.status).toBe(200); expect(b.status).toBe(200)
    const seenA = entries(a.body), seenB = entries(b.body)
    expect(seenA.sample_size.title).toContain('기준선 기록이 없습니다')
    expect(seenA.one_case.title).toContain('신청서가 없습니다'); expect(seenA.not_operated.title).toContain('기록이 없습니다')
    expect(seenB.sample_size.title).toContain('기준선 1건에 측정 3회')
    expect(seenB.one_case.title).toContain('신청서 1건'); expect(seenB.not_operated.title).toContain('2회')
    expect(seenA.one_case.body).toContain('현재 접근 범위')
    expect(JSON.stringify(a.body)).not.toContain('facts-b')
    expect(a.bound.DB.actorEmail).toBe(emailA); expect(a.bound.AUTH_ACTOR.mode).toBe('access')
  })

  it('does not call two existing records six-stage validation or count a failed attempt as successful use', async () => {
    await addRecords('facts-a', 'Finance', 10)
    const reply = await invoke(), by = entries(reply.body)
    expect(reply.status).toBe(200)
    expect(by.one_case.title).toContain('인수인계·성과 기록이 함께 있는 신청서 1건')
    expect(by.one_case.body).toContain('여섯 단계의 검증 완료나 현업 효과를 보증하지 않습니다')
    expect(by.sample_size.title).toContain('측정 10회')
    expect(by.sample_size.body).toContain('충분성이나 대표성을 판단하지 않습니다')
    expect(by.not_operated.title).toContain('2회'); expect(by.not_operated.body).toContain('실행 시도 수')
    expect(by.not_operated.body).toContain('운영 기간이나 성공 완료·장기 활용 효과를 판단하지 않습니다')
    for (const table of ['review', 'build_run', 'beta_round']) expect((await DB.prepare('SELECT count(*) AS n FROM ' + table + ' WHERE application_id=?').bind('facts-a').first()).n).toBe(0)
  })

  it('ignores client mode/role claims and requires real signed authentication despite healthy infrastructure', async () => {
    const rejected = await invoke({ authenticated: false, spoof: true })
    expect(rejected.status).toBe(401); expect(rejected.body).not.toHaveProperty('unproven')
    const configured = await invoke({ path: '/health', authenticated: false })
    expect(configured.status).toBe(200); expect(configured.body.ready).toBe(true)
    const real = await invoke({ spoof: true }), by = entries(real.body)
    expect(real.status).toBe(200)
    expect(by.one_case.instead).toContain('인증된 계정과 허용된 접근 범위')
    expect(by.one_case.instead).not.toContain('로그인 없이')
    expect(by.fake_data.body).toContain('실제 회사 자료임을 증명하지 않습니다')
  })

  it('keeps isolated demo defaults distinct from extra input and real operational evidence', async () => {
    const reply = await invoke({ mode: 'demo' }), by = entries(reply.body)
    expect(reply.status).toBe(200); expect(reply.bound.DEMO_WORKSPACE).toBe(true); expect(reply.bound.DB.workspace).toBe(true)
    expect(by.fake_data.title).toContain('기본 자료는 가상')
    expect(by.fake_data.body).toContain('사용자가 추가한 자료')
    expect(by.one_case.instead).toContain('로그인 없이')
    expect(by.no_ai.instead).toContain('외부 AI 호출을 차단')
    expect(by.not_operated.title).toContain('기록이 없습니다')
    expect(JSON.stringify(reply.body)).not.toMatch(/facts-a|facts-b/)
  })

  it.each([{}, null, { finished: null, baselines: undefined, baseline_samples: '', runs: false },
    { finished: 0.5, baselines: -1, baseline_samples: '9007199254740991.1', runs: '1e-324' }])('missing or malformed proof %j remains unknown, never fabricated zero', async bad => {
    proofOverride = bad
    const reply = await invoke(), by = entries(reply.body)
    expect(reply.status).toBe(200)
    for (const key of ['sample_size', 'one_case', 'not_operated']) {
      expect(by[key].title).toContain('확인하지 못했습니다'); expect(by[key].title).not.toContain('없습니다')
    }
  })

  it('supports actual decimal integer text from DB without claims of statistical weakness or elapsed months', async () => {
    proofOverride = { finished: '2', baselines: '2', baseline_samples: '30', runs: '40' }
    const reply = await invoke(), by = entries(reply.body)
    expect(reply.status).toBe(200)
    expect(by.sample_size.title).toContain('기준선 2건에 측정 30회')
    expect(by.one_case.title).toContain('2건'); expect(by.not_operated.title).toContain('40회')
    expect(JSON.stringify(by)).not.toMatch(/20분|97분|통계적으로 약|몇 달|나머지는 앞|한 건을 얕게/)
  })

  it('does not inspect keys, provider status or call AI to explain optional authenticated drafts', async () => {
    const reply = await invoke(), by = entries(reply.body)
    expect(reply.status).toBe(200)
    expect(by.no_ai.instead).toContain('사내 권한과 서버 설정이 충족되면')
    expect(by.no_ai.instead).toContain('키 설정·호출 성공을 확인하지 않으며')
    expect(by.no_ai.instead).toContain('사람의 최종 승인을 대신하지 않습니다')
    const dataCalls = calls.filter(call => /batch$/.test(call.name))
    expect(dataCalls.filter(call => call.args.p_statements.some(sql => sql.includes('AS finished')))).toHaveLength(1)
    expect(dataCalls.find(call => call.args.p_statements.some(sql => sql.includes('AS finished'))).args.p_statements).toHaveLength(10)
    expect(JSON.stringify(calls)).not.toMatch(/override_ai_call|ai_assist|anthropic|openai|claim_rate|commit|INSERT|UPDATE/)
  })

  it.each(['42501', '53300'])('failed scoped read %s is an error, not a zero narrative', async code => {
    rpcFailure = code
    const reply = await invoke()
    expect(reply.status).toBe(code === '42501' ? 403 : 503); expect(reply.body).not.toHaveProperty('unproven')
  })

  it('rejects an actor revoked after middleware rather than generating a stale fact report', async () => {
    const reply = await invoke({ beforeHandler: () => pg.query('UPDATE override_actor SET active=0 WHERE email=$1', [emailA]) })
    expect(reply.status).toBe(401); expect(reply.body.code).toBe('ACCESS_REVOKED'); expect(reply.body).not.toHaveProperty('unproven')
  })

  it.each([
    { DEMO_WORKSPACE: 'true' },
    { DEMO_WORKSPACE: true },
    { OVERRIDE_DEMO_MODE: 'true' },
    { AUTH_ACTOR: { mode: 'demo' } },
    { AUTH_ACTOR: { mode: 'access', email: emailB } },
    { AUTH_ACTOR: { mode: 'access', email: 'invalid-email' } },
  ])('unconfirmed server context %j does not invent an operating mode or data provenance', async context => {
    const response = await honesty({ env: { DB: DB.forActor(emailA), ...context } }), body = await response.json()
    expect(response.status).toBe(200)
    const by = entries(body)
    expect(by.fake_data.title).toContain('실행 환경을 확인하지 못했습니다')
    expect(by.one_case.instead).not.toMatch(/로그인 없이|인증된 계정/)
    expect(by.no_ai.instead).toContain('설정이나 활성 상태는 이 조회로 확인하지 않습니다')
  })

  it('uses Pages requestEnv for the verified mode as well as for DB queries', async () => {
    const selected = { DB: DB.forActor(emailA), AUTH_ACTOR: { mode: 'access', email: emailA } }
    const response = await honesty({ env: { DB: { prepare() { throw Error('Reusable env read forbidden') } }, DEMO_WORKSPACE: true }, data: { requestEnv: selected } })
    expect(response.status).toBe(200)
    expect(entries(await response.json()).one_case.instead).toContain('인증된 계정과 허용된 접근 범위')
  })
})
