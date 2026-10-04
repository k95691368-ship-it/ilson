// @vitest-environment node
// Current signed middleware/RPCs use disposable PostgreSQL. Synthetic provider
// replies below demonstrate a contract, not live credentials or operating proof.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { PLAIN, TECH, OVERRIDE_LOOP } from '../shared/about.js'
import { buildRunPayload } from '../shared/buildPayload.js'
import { gradeAll } from '../shared/grade.js'
import { createSupabaseDb } from '../functions/_lib/dbBridge.ts'
import { onRequest as middleware } from '../functions/api/_middleware.js'
import { onRequestGet as built } from '../functions/api/built.js'
import { onRequestGet as override } from '../functions/api/override.js'
import { onRequestPost as assist } from '../functions/api/override/assist.js'
import { onRequestGet as workspace } from '../functions/api/demo/workspace.js'

const pg = new PGlite(), base = 'https://about-facts.supabase.co', issuer = 'https://about-facts.cloudflareaccess.com'
const DB = createSupabaseDb(base, 'synthetic-only'), email = 'about@local.invalid', token = 'd'.repeat(64)
const demoDB = createSupabaseDb(base, 'synthetic-only', token)
const env = { DB, DBBridgeApplied: true, SUPABASE_URL: base, SUPABASE_SERVICE_ROLE_KEY: 'synthetic-only',
  ACCESS_TEAM_DOMAIN: issuer, ACCESS_AUD: 'about-facts', DEMO_WORKSPACES: 'false', OVERRIDE_DEMO_MODE: 'false' }
let pair, jwk, queue = Promise.resolve()
const providerRequests = []
const section = title => TECH.sections.find(item => item.title.includes(title))

beforeAll(async () => {
  await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;')
  const directory = new URL('../supabase/migrations/', import.meta.url)
  for (const file of readdirSync(directory).filter(name => /^\d+.*\.sql$/.test(name)).sort()) await pg.exec(readFileSync(new URL(file, directory), 'utf8'))
  pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])
  jwk = { ...await crypto.subtle.exportKey('jwk', pair.publicKey), kid: 'about-facts', alg: 'RS256', use: 'sig' }
  vi.stubGlobal('fetch', (url, options) => {
    if (String(url) === issuer + '/cdn-cgi/access/certs') return Promise.resolve(Response.json({ keys: [jwk] }))
    if (String(url) === 'https://api.anthropic.com/v1/messages') {
      providerRequests.push(JSON.parse(options.body))
      return Promise.resolve(Response.json({ content: [{ type: 'text', text: '{"summary":"합성 초안"}' }] }))
    }
    if (!String(url).startsWith(base + '/rest/v1/rpc/')) throw Error('External network prohibited')
    const task = queue.then(async () => {
      try {
        await pg.exec('SET ROLE service_role')
        const name = new URL(url).pathname.split('/').at(-1), values = Object.values(JSON.parse(options.body))
        return Response.json((await pg.query(`SELECT public.${name}(${values.map((_, index) => '$' + (index + 1)).join(',')}) AS data`, values)).rows[0].data)
      } catch (error) { return Response.json({ code: error.code }, { status: 400 }) }
      finally { await pg.exec('RESET ROLE') }
    })
    queue = task.catch(() => {})
    return task
  })
  await pg.query('INSERT INTO override_actor(email,display_name,role,departments_json) VALUES($1,\'합성 담당자\',\'product\',\'["Finance"]\')', [email])
  await DB.workspaceOpen(token, [])
}, 60000)
afterAll(async () => { await queue; vi.unstubAllGlobals(); await pg.close() })

const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url')
async function assertion() {
  const now = Math.floor(Date.now() / 1000)
  const text = encode({ alg: 'RS256', kid: jwk.kid }) + '.' + encode({ iss: issuer, aud: [env.ACCESS_AUD], email, iat: now, exp: now + 600 })
  return text + '.' + Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(text))).toString('base64url')
}
async function invoke({ mode = 'access', path = '/built', handler = built, authenticated = true, body, bindings = {}, key = crypto.randomUUID(), scope } = {}) {
  const selected = { ...env, ...bindings, DEMO_WORKSPACES: String(mode === 'demo') }, headers = {}
  if (mode === 'demo') {
    headers.Cookie = 'ilson_workspace=' + token
    headers['X-Ilson-Scope'] = await demoDB.toolRunScope()
  } else {
    if (authenticated) headers['Cf-Access-Jwt-Assertion'] = await assertion()
    // A self-reported identity must not stand in for the signature.
    headers['Cf-Access-Authenticated-User-Email'] = email
    headers['X-Ilson-Scope'] = scope ?? await DB.forActor(email).toolRunScope()
  }
  if (body) Object.assign(headers, { Origin: 'https://facts.local', 'X-Ilson-Request': '1', 'X-Idempotency-Key': key, 'Content-Type': 'application/json' })
  const request = new Request('https://facts.local/api' + path, { headers, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) })
  let reached = false
  const context = { env: selected, data: {}, request, next: forwarded => {
    reached = true
    return handler({ env: selected, data: context.data, request: forwarded ?? request })
  } }
  const response = await middleware(context)
  expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  return { status: response.status, body: await response.json(), reached, bound: context.data.requestEnv }
}

describe.sequential('displayed introduction agrees with current security and operating boundaries', () => {
  it('requires a signed real identity while accepting an isolated account-free demo', async () => {
    const rejected = await invoke({ authenticated: false })
    expect(rejected).toMatchObject({ status: 401, reached: false })
    const real = await invoke(), demo = await invoke({ mode: 'demo' })
    expect(real.status).toBe(200); expect(real.bound.AUTH_ACTOR.mode).toBe('access'); expect(real.bound.DB.actorEmail).toBe(email)
    expect(demo.status).toBe(200); expect(demo.bound.DEMO_WORKSPACE).toBe(true); expect(demo.bound.DB.workspace).toBe(true)
    expect(real.body.counts.tables).toBeGreaterThan(0); expect(demo.body.counts.tables).toBeGreaterThan(0)
    expect(PLAIN.stages[0].body).toContain('개인 체험은 계정 없이')
    expect(TECH.stack.find(item => item.k === '방문 통계').v).toContain('접수번호 자체가 사내 접근 권한을 대신하지는 않습니다')
    expect(section('체험과 사내 접근').body).toContain('읽기·쓰기를 보호')
  })

  it('denies the same verified account when its current actor is inactive', async () => {
    const scope = await DB.forActor(email).toolRunScope()
    await pg.query('UPDATE override_actor SET active=0 WHERE email=$1', [email])
    try { expect((await invoke({ scope })).status).toBe(401) }
    finally { await pg.query('UPDATE override_actor SET active=1 WHERE email=$1', [email]) }
  })

  it('describes the actual API mode as recorded evidence, not external deployment control', async () => {
    const reply = await invoke({ path: '/override', handler: override })
    expect(reply.status).toBe(200)
    expect(reply.body.execution).toEqual({ mode: 'manual_evidence', external_rollout: false })
    expect(OVERRIDE_LOOP.flow.find(item => item.n === 'A').title).toBe('현장 AI 제안 입력')
    expect(OVERRIDE_LOOP.flow.find(item => item.n === 'C').title).toBe('입력한 판단·근거 저장')
    expect(OVERRIDE_LOOP.flow.find(item => item.n === 'J').body).toContain('외부 시험을 직접 실행하지는 않는다')
    expect(OVERRIDE_LOOP.flow.find(item => item.n === 'M').body).toContain('실제 외부 배포·중단·복귀는 실행하지 않는다')
    expect(OVERRIDE_LOOP.roles.flatMap(item => item.items)).not.toContain('배포·중단·롤백 조건 강제')
    expect(providerRequests).toHaveLength(0)
  })

  it('blocks external AI in demos and requires configured keys in real mode', async () => {
    const body = { kind: 'event', context: { summary: '합성 사건 분석' } }
    expect((await invoke({ mode: 'demo', path: '/override/assist', handler: assist, body, bindings: { CLAUDE_API_KEY: 'synthetic-only' } })).status).toBe(403)
    expect((await invoke({ path: '/override/assist', handler: assist, body })).status).toBe(503)
    expect(providerRequests).toHaveLength(0)
    expect(TECH.llm.inProduct.body).toContain('사내 권한과 서버 키 설정이 충족되면')
    expect(TECH.llm.inProduct.body).toContain('개인 체험에서는 외부 호출을 차단')
    expect(TECH.llm.inProduct.body).toContain('키 설정이나 실제 호출 성공을 확인하지 않습니다')
  })

  it('shows partial pattern masking and stores a retry draft without making it a final decision', async () => {
    const key = crypto.randomUUID(), body = { kind: 'event', context: {
      email: 'person@example.invalid', knownMobile: '010-1234-5678', dottedMobile: '010.1234.5678', internationalMobile: '+82-10-1234-5678',
    } }
    const reply = await invoke({ path: '/override/assist', handler: assist, body, key, bindings: { CLAUDE_API_KEY: 'synthetic-only' } })
    expect(reply.status, JSON.stringify(reply.body)).toBe(200)
    expect(reply.body).toMatchObject({ draft: { summary: '합성 초안' }, requires_human_confirmation: true })
    expect(providerRequests).toHaveLength(1)
    const sent = providerRequests[0].messages[0].content
    expect(sent).not.toContain('person@example.invalid'); expect(sent).not.toContain('010-1234-5678')
    expect(sent).toContain('010.1234.5678'); expect(sent).toContain('+82-10-1234-5678')
    const receipt = (await pg.query('SELECT response FROM ilson_private.mutation_receipts WHERE request_id=$1', [key])).rows[0].response
    expect(receipt.body.draft).toEqual(reply.body.draft)
    expect((await pg.query('SELECT count(*) AS n FROM override_decision_record')).rows[0].n).toBe(0)
    expect(TECH.llm.inProduct.body).toContain('모든 개인정보 탐지를 보장하지 않습니다')
    expect(TECH.llm.inProduct.why).toContain('호출 상태·감사 및 재시도 응답은 별도로 기록')
    expect(TECH.llm.inProduct.why).not.toContain('저장되지 않은 초안')
  })

  it('expires demo access after seven days and removes its records on explicit reset', async () => {
    const registration = (await pg.query('SELECT schema_name,extract(epoch FROM expires_at-created_at) AS seconds FROM ilson_private.workspaces')).rows[0]
    expect(Number(registration.seconds)).toBe(7 * 24 * 60 * 60)
    await demoDB.prepare("INSERT INTO decision_log(id,stage,actor,title,what,why) VALUES('about-proof','성과','human','가상 결정','합성 기록','보관 경계')").run()
    await pg.exec("UPDATE ilson_private.workspaces SET expires_at=now()-interval '1 second'")
    const state = await workspace({ env: { ...env, DEMO_WORKSPACES: 'true' }, request: new Request('https://facts.local/api/demo/workspace', { headers: { Cookie: 'ilson_workspace=' + token } }) })
    expect(await state.json()).toMatchObject({ enabled: true, active: false, expired: true })
    // Expiration is an access deadline; bounded opportunistic cleanup need not
    // physically delete the schema exactly at that instant.
    expect((await pg.query('SELECT to_regclass($1) AS table_name', [registration.schema_name + '.decision_log'])).rows[0].table_name).not.toBeNull()
    await pg.exec("UPDATE ilson_private.workspaces SET expires_at=now()+interval '7 days'")
    await DB.workspaceReset(token, [], 'e'.repeat(64))
    expect((await pg.query('SELECT to_regclass($1) AS table_name', [registration.schema_name + '.decision_log'])).rows[0].table_name).toBeNull()
    const recorded = OVERRIDE_LOOP.outputs[0].items.find(item => item.name === 'Decision Record').desc
    expect(recorded).toContain('7일 후 만료'); expect(recorded).toContain('삭제될 수 있다'); expect(recorded).toContain('영구 보관을 보증하지는 않는다')
  })
})

describe('data and quality claims distinguish production inputs from test fixtures', () => {
  it('projects normalized business rows and provenance, not only runtime metadata or raw cells', () => {
    const secret = 'ARBITRARY_RAW_CELL_SENTINEL', source = { file: 'synthetic.csv', rowNo: 2 }
    const payload = buildRunPayload({ files: [{ name: source.file, buffer: secret }],
      rows: [{ date: '2026-06-01', sku: 'SKU-X', qty: 2, gross_krw: 1000, source, trace: [{ step: '금액', value: 1000 }], raw: [secret] }],
      quarantine: [{ reason: 'unknown_sku', externalCode: 'X', source, raw: [secret] }] })
    expect(JSON.stringify(payload)).not.toContain(secret)
    expect(payload.rows[0]).toMatchObject({ qty: 2, gross_krw: 1000, source, trace: [{ step: '금액', value: 1000 }] })
    expect(payload.quarantine[0]).toMatchObject({ reason: 'unknown_sku', externalCode: 'X', source })
    expect(section('파이프라인').body).toContain('정규화된 계산 행·격리 사유·출처 참조를 저장')
    expect(TECH.stack.find(item => item.k === '파일 저장소').v).toContain('원본 파일 대신 정규화된 계산 결과')
  })

  it('cannot judge amount or quarantine correctness when actual input has no truth table', async () => {
    const criteria = ['amount_exact', 'quarantine_complete', 'quarantine_precise'].map((check_key, index) => ({ id: String(index), ord: index,
      body: check_key, check_key, check_kind: 'rule' }))
    const files = [{ name: 'synthetic.csv', buffer: new TextEncoder().encode('주문일자,상품코드,상품명,수량,판매가,할인액\n2026-06-01,NR-CM-100,합성상품,1,10000,0') }]
    const actual = await gradeAll({ criteria, files, truth: undefined, period: { start: '2026-06-01', end: '2026-06-30' } })
    expect(actual.graded.map(item => item.verdict)).toEqual(['판정불가', '판정불가', '판정불가'])
    expect(actual.graded.every(item => item.evidence.includes('정답표가 없어'))).toBe(true)
    expect(section('합성 정답').body).toContain('실제 베타 화면은 사용자 파일의 정답표를 제공하지 않으므로')
    expect(section('합성 정답').body).not.toContain('매 실행이 정답과 대조')
    expect(PLAIN.stages.find(item => item.n === 5).body).toContain('필요한 근거가 없는 기준은 판정불가')
    expect(PLAIN.stages.find(item => item.n === 4).body).toContain('입력한 측정값만으로 실제 현장 효과가 입증되지는 않습니다')
    expect(PLAIN.points.find(item => item.title === '못 한 것을 따로 모아 둡니다').body).toContain('입력한 기록의 사실성까지 증명되지는 않습니다')
    expect(readFileSync(new URL('../src/pages/BetaPage.jsx', import.meta.url), 'utf8')).toContain('const truth = undefined')
  })

  it('limits CI claims to the configured triggers and repository checks', () => {
    const workflow = readFileSync(new URL('../.github/workflows/check.yml', import.meta.url), 'utf8')
    expect(workflow).toMatch(/push:\s*\r?\n\s*branches: \[main\]/)
    expect(workflow).toMatch(/^\s*pull_request:/m); expect(workflow).toMatch(/^\s*workflow_dispatch:/m)
    for (const command of ['lint', 'typecheck', 'build', 'test']) expect(workflow).toContain('run: npm ' + (command === 'test' ? command : 'run ' + command))
    const claim = TECH.stack.find(item => item.k === 'CI').v
    expect(claim).toContain('main push·PR·수동 실행'); expect(claim).not.toContain('push마다')
    expect(claim).toContain('실제 운영 배포 성공을 보증하는 검사는 아닙니다')
  })
})
