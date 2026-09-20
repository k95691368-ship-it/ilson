// @vitest-environment node
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const issuer = 'https://cache-test.cloudflareaccess.com'
const env = { ACCESS_TEAM_DOMAIN: issuer, ACCESS_AUD: 'test-app' }
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url')
let pair, jwk, verify, now
beforeAll(async () => {
  pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])
  jwk = { ...await crypto.subtle.exportKey('jwk', pair.publicKey), kid: 'old', alg: 'RS256', use: 'sig' }
})
beforeEach(async () => {
  vi.resetModules()
  verify = (await import('../functions/_lib/access.js')).verifiedAccessEmail
  now = Date.now()
  vi.spyOn(Date, 'now').mockImplementation(() => now)
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
async function request(kid = 'old', claims = {}) {
  const data = encode({ alg: 'RS256', kid }) + '.' + encode({ iss: issuer, aud: ['test-app'], email: 'operator@example.test', iat: now / 1000, exp: now / 1000 + 3600, ...claims })
  const signature = Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(data))).toString('base64url')
  return new Request('https://ilson.test/api/feedback', { headers: { 'Cf-Access-Jwt-Assertion': data + '.' + signature } })
}

describe('bounded Access certificate cache', () => {
  it('coalesces concurrent certificate downloads and public-key imports', async () => {
    const fetcher = vi.fn(async () => Response.json({ keys: [jwk] }))
    vi.stubGlobal('fetch', fetcher)
    const importer = vi.spyOn(crypto.subtle, 'importKey')
    const signed = await request()
    expect(await Promise.all(Array.from({ length: 12 }, () => verify(env, signed)))).toEqual(Array(12).fill('operator@example.test'))
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(importer).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0][1].redirect).toBe('manual')
    expect(await verify({ ...env, ACCESS_AUD: 'other-app' }, signed)).toBeNull()
  })
  it('refreshes rotating kids but throttles arbitrary unknown kids', async () => {
    const fetcher = vi.fn(async () => Response.json({ keys: [jwk] }))
    vi.stubGlobal('fetch', fetcher)
    expect(await verify(env, await request())).toBe('operator@example.test')
    const rotated = await request('new')
    expect(await verify(env, rotated)).toBeNull()
    expect(fetcher).toHaveBeenCalledTimes(1)
    now += 31000
    fetcher.mockImplementation(async () => Response.json({ keys: [{ ...jwk, kid: 'new' }] }))
    expect(await verify(env, rotated)).toBe('operator@example.test')
    const unknown = await request('attacker-kid')
    expect(await Promise.all(Array.from({ length: 12 }, () => verify(env, unknown)))).toEqual(Array(12).fill(null))
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(await verify(env, await request())).toBeNull()
  })
  it('never accepts expired cache entries during outages and bounds retries', async () => {
    const fetcher = vi.fn(async () => Response.json({ keys: [jwk] }))
    vi.stubGlobal('fetch', fetcher)
    const signed = await request()
    expect(await verify(env, signed)).toBe('operator@example.test')
    now += 300001
    fetcher.mockRejectedValue(new Error('network unavailable'))
    expect(await verify(env, signed)).toBeNull()
    expect(await verify(env, signed)).toBeNull()
    expect(fetcher).toHaveBeenCalledTimes(2)
    now += 30001
    fetcher.mockImplementation(async () => Response.json({ keys: [jwk] }))
    expect(await verify(env, signed)).toBe('operator@example.test')
    expect(fetcher).toHaveBeenCalledTimes(3)
  })
  it('rejects malformed key sets without retaining them as trusted keys', async () => {
    const fetcher = vi.fn(async () => Response.json({ keys: [null] }))
    vi.stubGlobal('fetch', fetcher)
    expect(await verify(env, await request())).toBeNull()
    expect(await verify(env, await request())).toBeNull()
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
