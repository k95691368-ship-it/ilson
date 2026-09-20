// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { redactPath } from '../src/lib/analytics.js'

const source = readFileSync(new URL('../public/bootstrap.js', import.meta.url), 'utf8')
function boot(pathname, prefetch = false) {
  const tags = [], calls = []
  const location = { pathname, origin: 'https://ilson.test' }
  const window = { location }
  runInNewContext(source, {
    window, location,
    document: {
      createElement: () => ({}),
      head: { appendChild: element => tags.push(element) },
      documentElement: { dataset: { sharedDemoPrefetch: String(prefetch) } },
    },
    fetch: (...args) => { calls.push(args); return Promise.resolve(null) },
  })
  return { window, tags, calls }
}
describe('external bootstrap with script CSP restrictions', () => {
  it('initializes existing tags without inline scripts or font downloads', () => {
    const { tags, window } = boot('/track?no=PRIVATE')
    expect(tags.map(tag => tag.src)).toEqual(['https://www.googletagmanager.com/gtag/js?id=G-VLP0X6V7TM', 'https://www.clarity.ms/tag/y28b6n8ub2'])
    expect(tags.every(tag => tag.async)).toBe(true)
    expect(window.dataLayer[1][2]).toMatchObject({ send_page_view: false, page_location: 'https://ilson.test/', page_referrer: '' })
    expect(JSON.stringify(window.dataLayer)).not.toContain('PRIVATE')
    window.clarity('event', 'test')
    expect(window.clarity.q).toHaveLength(1)
  })
  it('prefetches only an explicitly enabled shared demo home, not private workspaces', () => {
    expect(boot('/').calls).toHaveLength(0)
    expect(boot('/track', true).calls).toHaveLength(0)
    const { calls, window } = boot('/', true)
    expect(calls).toEqual([['/api/override', { cache: 'no-store', credentials: 'same-origin' }]])
    expect(window.__boot['/override']).toBeDefined()
  })
  it('removes query and fragment secrets even if callers pass more than pathname', () => {
    expect(redactPath('/track?no=PRIVATE#private-note')).toBe('/track')
    expect(redactPath('/record/app_12345678/?key=PRIVATE')).not.toContain('PRIVATE')
    expect(redactPath('/t/private-tool#private-note')).toBe('/t/:slug')
  })
})
