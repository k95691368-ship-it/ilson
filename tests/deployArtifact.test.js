// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

// Run npm run build first: fail rather than silently skip a missing API artifact.
const worker = (await import(pathToFileURL(resolve('dist/_worker.js/index.js')).href)).default
const context = { waitUntil() {}, passThroughOnException() {} }
const assets = { fetch: async () => new Response('static-asset') }

describe('deployable Pages Worker', () => {
  it('invokes the Worker only for API routes, not every static asset', () => {
    expect(JSON.parse(readFileSync(resolve('dist/_routes.json'), 'utf8'))).toMatchObject({ version: 1, include: ['/api/*'], exclude: [] })
  })
  it('routes health to the API and reports an absent database as JSON', async () => {
    const response = await worker.fetch(new Request('https://ilson.test/api/health'), { ASSETS: assets }, context)
    expect(response.status).toBe(503)
    expect(response.headers.get('Content-Type')).toContain('application/json')
    expect(await response.json()).toMatchObject({ ready: false })
  })
  it('preserves the private-workspace boundary in the compiled middleware', async () => {
    const response = await worker.fetch(new Request('https://ilson.test/api/override'), { ASSETS: assets, DEMO_WORKSPACES: 'true' }, context)
    expect(response.status).toBe(428)
    expect(response.headers.get('Content-Type')).toContain('application/json')
  })
  it('serves ordinary pages through the asset binding', async () => {
    const response = await worker.fetch(new Request('https://ilson.test/'), { ASSETS: assets }, context)
    expect(await response.text()).toBe('static-asset')
  })

  it('protects early responses and enforces streamed body limits in the actual compiled Worker', async () => {
    const DB = { claimRateLimit: async () => 1, prepare: vi.fn() }
    const env = { ASSETS: assets, DB, DBBridgeApplied: true, OVERRIDE_DEMO_MODE: 'true' }
    const request = new Request('https://ilson.test/api/override', {
      method: 'POST', body: ' '.repeat(1024 * 1024) + '{}', headers: { 'Content-Type': 'application/json' },
    })
    const response = await worker.fetch(request, env, context)
    expect(response.status).toBe(413)
    expect(DB.prepare).not.toHaveBeenCalled()
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    const denied = await worker.fetch(new Request('https://ilson.test/api/override'), { ASSETS: assets, DEMO_WORKSPACES: 'true' }, context)
    expect(denied.status).toBe(428)
    expect(denied.headers.get('Cache-Control')).toBe('private, no-store')
  })

  it('runs isolated workspace, approval, evidence, replay and reset through the built Worker', async () => {
    const pg = new PGlite()
    const env = { ASSETS: assets, DEMO_WORKSPACES: 'true', SUPABASE_URL: 'https://artifact-test.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'local-only' }
    let queue = Promise.resolve()
    try {
      await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;')
      for (const file of ['0000_schema.sql', '0001_execute_sql.sql', '0002_override_loop.sql', '0003_journey_workspaces.sql', '0004_audit_hardening.sql']) {
        await pg.exec(readFileSync(new URL('../supabase/migrations/' + file, import.meta.url), 'utf8'))
      }
      vi.stubGlobal('fetch', (url, options) => {
        if (!String(url).startsWith(env.SUPABASE_URL + '/rest/v1/rpc/')) throw Error('External network forbidden')
        const name = new URL(url).pathname.split('/').at(-1)
        if (!/^ilson_(execute|batch|workspace_(query|batch|open|reset)|mutation_receipt|commit_mutation|claim_rate_limit|readiness)$/.test(name)) throw Error('Unknown RPC')
        const result = queue.then(async () => {
          try {
            await pg.exec('SET ROLE service_role')
            const args = Object.values(JSON.parse(options.body))
            return Response.json((await pg.query(`SELECT public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) AS data`, args)).rows[0].data)
          } catch (error) { return Response.json({ code: error.code }, { status: 400 }) }
          finally { await pg.exec('RESET ROLE') }
        })
        queue = result.catch(() => {})
        return result
      })
      const request = (path, cookie = '', body, method = body ? 'POST' : 'GET', key = crypto.randomUUID()) => worker.fetch(new Request('https://ilson.test' + path, {
        method, headers: { Origin: 'https://ilson.test', 'X-Ilson-Request': '1', Cookie: cookie, 'X-Idempotency-Key': key },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }), env, context)
      const openedA = await request('/api/demo/workspace', '', {})
      const openedB = await request('/api/demo/workspace', '', {})
      expect(openedA.status).toBe(201)
      expect(openedB.status).toBe(201)
      const a = openedA.headers.get('Set-Cookie').split(';')[0]
      const b = openedB.headers.get('Set-Cookie').split(';')[0]
      expect((await request('/api/override', a)).status).toBe(200)
      expect((await request('/api/override', b)).status).toBe(200)
      const created = await request('/api/override', a, { role: 'product', action: 'create_experiment', clusterId: 'olc_policy', title: 'Built-worker verification', changeTarget: '검색', hypothesis: '오류 감소', scope: '검증', comparator: 'v1', successMetric: '수정률', approver: '검토자', rollbackPlan: 'v1 복귀', guardrails: ['위반 0건'], stopConditions: ['위반 1건'], metricDirection: 'lower', targetImprovement: 20,
        evaluationPlan: { metricType: 'rate', minimumWindowSeconds: 60, minimumSamples: { historical: 10, shadow: 10, limited: 10 }, rationale: '배포 묶음 검증용 사전 계획', datasetVersion: 'data-v1', modelVersion: 'model-v1', policyVersion: 'policy-v1' },
      })
      expect(created.status).toBe(201)
      const id = (await created.json()).id
      expect((await request('/api/override', a, { role: 'product', action: 'approve_experiment', experimentId: id, basis: '계획 확인' })).status).toBe(200)
      const body = { role: 'product', action: 'record_run', experimentId: id, phase: 'historical', controlValue: 10, variantValue: 7, sampleSize: 20, guardrailBreaches: 0, evidenceRefs: ['artifact-test/run-1'], measurementStart: new Date(Date.now() - 3600000).toISOString(), measurementEnd: new Date(Date.now() - 1800000).toISOString() }
      const key = crypto.randomUUID()
      const first = await request('/api/override', a, body, 'POST', key)
      const replay = await request('/api/override', a, body, 'POST', key)
      expect(first.status).toBe(201)
      expect(replay.headers.get('X-Idempotency-Replayed')).toBe('1')
      expect((await first.json()).id).toBe((await replay.json()).id)
      const other = await (await request('/api/override', b)).json()
      expect(other.experiments.some(item => item.id === id)).toBe(false)
      expect((await request('/api/demo/workspace', a, { confirm: 'reset-my-workspace' }, 'DELETE')).status).toBe(200)
      expect((await request('/api/override', a)).status).toBe(428)
      expect((await request('/api/override', b)).status).toBe(200)
      expect((await pg.query('SELECT count(*)::int AS n FROM public.change_experiment')).rows[0].n).toBe(0)
    } finally {
      vi.unstubAllGlobals()
      await pg.close()
    }
  }, 60000)
})
