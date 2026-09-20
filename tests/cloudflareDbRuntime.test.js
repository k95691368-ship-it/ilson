import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'

const tables = [
  'application', 'review', 'decision_log', 'acceptance_criterion', 'baseline',
  'build_run', 'beta_round', 'manual', 'handover', 'tool_use', 'outcome', 'rate_limit_hits',
  'field_feedback_case', 'field_feedback_update', 'field_feedback_receipt',
  'quality_sample_batch', 'quality_sample_item', 'tool_nonuse_report',
  'issue_followup', 'quality_sample_review_history', 'application_participation',
]
let runtime, upstreamStatus, outbound

beforeAll(async () => {
  // Run the real source modules in workerd, not Node's more permissive fetch.
  // Every outbound request is intercepted; no account or real key is used.
  const modules = ['functions/_lib/dbBridge.js', 'functions/_lib/http.js', 'functions/api/health.js'].map(path => ({
    type: 'ESModule', path: resolve(path), contents: readFileSync(path, 'utf8'),
  }))
  runtime = new Miniflare(convertV4MiniflareOptions({
    modules: [{
      type: 'ESModule', path: resolve('tests/runtime-entry.mjs'),
      contents: `import { withDbBinding } from '../functions/_lib/dbBridge.js';
        import { onRequestGet } from '../functions/api/health.js';
        export default { async fetch(request, env) {
          const requestEnv = { ...env, DB: await withDbBinding(env) };
          return onRequestGet({ request, env, data: { requestEnv } });
        } };`,
    }, ...modules],
    compatibilityDate: '2025-01-01',
    bindings: { SUPABASE_URL: 'https://mock.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'fake-runtime-test-key', DEMO_WORKSPACES: 'true' },
    outboundService: async request => {
      outbound.push(request.url)
      if (upstreamStatus !== 200) return new Response(null, { status: upstreamStatus, headers: { Location: 'https://unexpected-host.invalid/credentials' } })
      return Response.json(request.url.endsWith('/ilson_readiness')
        ? { schemaReady: true, capacityAvailable: true }
        : { rows: tables.map(name => ({ name })), rowCount: tables.length })
    },
  }))
  await runtime.ready
})
beforeEach(() => { upstreamStatus = 200; outbound = [] })
afterAll(async () => { await runtime?.dispose() })

describe('Cloudflare native database fetch', () => {
  it('reaches both RPCs and reports healthy with the deployed compatibility date', async () => {
    const response = await runtime.dispatchFetch('https://ilson.pages.dev/api/health')
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ready: true, checks: { db: true, schema: true, runtime: true, capacity: true } })
    expect(outbound).toEqual(['https://mock.supabase.co/rest/v1/rpc/ilson_execute', 'https://mock.supabase.co/rest/v1/rpc/ilson_readiness'])
  })

  it.each([301, 302, 303, 307, 308])('rejects HTTP %s without forwarding the service key to another host', async status => {
    upstreamStatus = status
    const response = await runtime.dispatchFetch('https://ilson.pages.dev/api/health')
    expect(response.status).toBe(503)
    const body = await response.json()
    expect(body).toMatchObject({ ready: false, checks: { db: false } })
    expect(JSON.stringify(body)).not.toContain('fake-runtime-test-key')
    expect(outbound).toEqual(['https://mock.supabase.co/rest/v1/rpc/ilson_execute'])
  })
})
