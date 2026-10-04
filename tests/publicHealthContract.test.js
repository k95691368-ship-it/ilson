// @vitest-environment node
// Public status checks retain the real middleware boundary. All DB responses
// are synthetic metadata; no external request or business-row query is used.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { onRequest } from '../functions/api/_middleware.js'
import { onRequestGet as health } from '../functions/api/health.js'

const core = ['application', 'review', 'decision_log', 'acceptance_criterion', 'baseline', 'build_run',
  'beta_round', 'manual', 'handover', 'tool_use', 'outcome', 'rate_limit_hits']
const feedback = ['field_feedback_case', 'field_feedback_update', 'field_feedback_receipt', 'quality_sample_batch',
  'quality_sample_item', 'tool_nonuse_report', 'issue_followup', 'quality_sample_review_history', 'application_participation']
const sentinel = 'private_health_schema_sentinel_7753'
const rawError = `SELECT application, field_feedback_case FROM ${sentinel}; credential-sentinel; migration 0006~0014`
const supabaseSql = "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name"
const d1Sql = "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name"

afterEach(() => vi.unstubAllGlobals())

function fixture(provider = 'supabase', options = {}) {
  const names = options.names ?? [...core, ...(provider === 'supabase' ? feedback : []), sentinel]
  const all = vi.fn(async () => {
    if (options.queryError) throw Error(rawError)
    return { results: names.map(name => ({ name })) }
  })
  const readiness = vi.fn(async () => {
    if (options.readinessError) throw Error(rawError)
    return options.readiness ?? { schemaReady: true, capacityAvailable: true }
  })
  const prepare = vi.fn(() => ({ all }))
  const env = { DBBridgeApplied: true, DB: { prepare, readiness }, DEMO_WORKSPACES: String(options.demo ?? false),
    ...(provider === 'supabase' ? { SUPABASE_URL: 'https://health-synthetic.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'never-real-credential' } : {}) }
  return { env, prepare, all, readiness }
}

async function publicGet(env, cookie) {
  const network = vi.fn(() => { throw Error('External network prohibited') })
  vi.stubGlobal('fetch', network)
  // Pages constructs a new downstream context. The original binding below is
  // deliberately unusable, so only data.requestEnv can supply the correct DB.
  const stale = { DB: { prepare() { throw Error(rawError) } } }
  const context = { env, data: {}, request: new Request('https://health.local.invalid/api/health', { headers: cookie ? { Cookie: cookie } : {} }) }
  context.next = request => health({ env: stale, data: context.data, request })
  const response = await onRequest(context)
  expect(network).not.toHaveBeenCalled()
  expect(context.data.requestEnv).not.toBe(env)
  return { response, selected: context.data.requestEnv }
}

async function contract(response) {
  const body = await response.json(), raw = JSON.stringify(body)
  expect(Object.keys(body).sort()).toEqual(['checks', 'notes', 'ready'])
  expect(body).not.toHaveProperty('tables'); expect(body).not.toHaveProperty('missing')
  expect(body.notes.every(note => typeof note === 'string')).toBe(true)
  for (const name of [...core, ...feedback, sentinel, 'credential-sentinel', 'never-real-credential']) expect(raw).not.toContain(name)
  expect(raw).not.toMatch(/0006|0013|0014|SELECT |sqlite_master|information_schema/)
  expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
  expect(response.headers.get('Referrer-Policy')).toBe('no-referrer')
  return body
}

describe('minimal public health disclosure without weakening readiness', () => {
  it.each(['supabase', 'd1'])('keeps %s metadata queries and ready status, without publishing any discovered table', async provider => {
    const setup = fixture(provider), original = { ...setup.env }, { response, selected } = await publicGet(setup.env)
    expect(response.status).toBe(200)
    expect(await contract(response)).toMatchObject({ ready: true, checks: { db: true, schema: true, provider,
      ...(provider === 'supabase' ? { runtime: true, capacity: true } : {}) } })
    expect(setup.prepare).toHaveBeenCalledOnce(); expect(setup.all).toHaveBeenCalledOnce()
    expect(setup.prepare.mock.calls[0][0].replace(/\s+/g, ' ').trim()).toBe(provider === 'supabase' ? supabaseSql : d1Sql)
    expect(setup.readiness).toHaveBeenCalledTimes(provider === 'supabase' ? 1 : 0)
    expect(setup.env).toEqual(original); expect(selected.DB).toBe(setup.env.DB)
  })

  it.each([...core, ...feedback])('still rejects a missing required Supabase table %s without naming it', async missing => {
    const setup = fixture('supabase', { names: [...core, ...feedback, sentinel].filter(name => name !== missing) })
    const { response } = await publicGet(setup.env)
    expect(response.status).toBe(503)
    expect(await contract(response)).toMatchObject({ ready: false, checks: { db: true, schema: false, provider: 'supabase', runtime: true, capacity: true } })
    expect(setup.readiness).toHaveBeenCalledOnce()
  })

  it.each(core)('still rejects a missing legacy D1 core table %s with the same coarse readiness', async missing => {
    const setup = fixture('d1', { names: [...core, sentinel].filter(name => name !== missing) })
    const { response } = await publicGet(setup.env)
    expect(response.status).toBe(503)
    expect(await contract(response)).toMatchObject({ ready: false, checks: { db: true, schema: false, provider: 'd1' } })
    expect(setup.readiness).not.toHaveBeenCalled()
  })

  it('keeps D1 feedback tables optional rather than silently extending its schema requirement', async () => {
    const { response } = await publicGet(fixture('d1', { names: core }).env)
    expect(response.status).toBe(200)
    expect(await contract(response)).toMatchObject({ ready: true, checks: { db: true, schema: true, provider: 'd1' } })
  })

  it('keeps an absent DB binding unavailable with no table list', async () => {
    const { response } = await publicGet({ DBBridgeApplied: true })
    expect(response.status).toBe(503)
    expect(await contract(response)).toMatchObject({ ready: false, checks: { db: false, schema: false, provider: false } })
  })

  it.each(['supabase', 'd1'])('preserves %s query failure status without raw SQL, credentials or table names', async provider => {
    const setup = fixture(provider, { queryError: true }), { response } = await publicGet(setup.env)
    expect(response.status).toBe(503)
    expect(await contract(response)).toMatchObject({ ready: false, checks: { db: false, schema: false, provider } })
    expect(setup.readiness).not.toHaveBeenCalled()
  })

  it('preserves a failed readiness RPC after metadata succeeds without revealing its exception', async () => {
    const { response } = await publicGet(fixture('supabase', { readinessError: true }).env)
    expect(response.status).toBe(503)
    expect(await contract(response)).toMatchObject({ ready: false, checks: { db: true, schema: true, provider: 'supabase' } })
  })

  it.each([false, 'true', 1, undefined])('requires literal schemaReady true, not %j, and returns a nontechnical runtime note', async schemaReady => {
    const { response } = await publicGet(fixture('supabase', { readiness: { schemaReady, capacityAvailable: true } }).env)
    expect(response.status).toBe(503)
    const body = await contract(response)
    expect(body.checks).toMatchObject({ db: true, schema: true, runtime: false, capacity: true })
    expect(body.notes).toContain('운영 데이터 접근 기능이 준비되지 않았습니다.')
  })

  it.each([true, false])('keeps capacity gating tied to demo-workspace enablement %s', async demo => {
    const setup = fixture('supabase', { demo, readiness: { schemaReady: true, capacityAvailable: false } })
    const { response } = await publicGet(setup.env)
    expect(response.status).toBe(demo ? 503 : 200)
    expect(await contract(response)).toMatchObject({ ready: !demo, checks: { db: true, schema: true, runtime: true, capacity: !demo } })
    expect(setup.readiness).toHaveBeenCalledOnce()
  })

  it.each([undefined, 'ilson_workspace=' + 'a'.repeat(64)])('keeps health public during demos, independent of a visitor cookie %s', async cookie => {
    const setup = fixture('supabase', { demo: true }), { response, selected } = await publicGet(setup.env, cookie)
    expect(response.status).toBe(200); expect((await contract(response)).ready).toBe(true)
    expect(selected.DB).toBe(setup.env.DB)
    expect(selected).not.toHaveProperty('DEMO_WORKSPACE')
    expect(setup.prepare).toHaveBeenCalledOnce()
    // A health GET neither opens a workspace nor queries visitor business data.
    expect(setup.prepare.mock.calls[0][0]).toContain('information_schema.tables')
  })

  it('uses an explicitly supplied request-local DB rather than a reusable platform binding', async () => {
    const chosen = fixture('supabase'), reusable = fixture('d1', { queryError: true })
    const response = await health({ env: reusable.env, data: { requestEnv: { ...chosen.env, DEMO_WORKSPACE: true } } })
    expect(response.status).toBe(200)
    expect((await contract(response)).checks.provider).toBe('supabase')
    expect(chosen.prepare).toHaveBeenCalledOnce(); expect(chosen.readiness).toHaveBeenCalledOnce()
    expect(reusable.prepare).not.toHaveBeenCalled()
  })
})
