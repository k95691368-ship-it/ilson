// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

// Run npm run build first: fail rather than silently skip a missing API artifact.
const worker = (await import(pathToFileURL(resolve('dist/_worker.js/index.js')).href)).default
const context = { waitUntil() {}, passThroughOnException() {} }
const assets = { fetch: async () => new Response('static-asset') }

describe('deployable Pages Worker', () => {
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
})
