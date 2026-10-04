// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isSafeIntegrationUrl } from '../functions/_lib/override.js'
import { integrationConfig } from '../functions/_lib/integrationConfig.js'

let fetcher
beforeEach(() => {
  fetcher = vi.fn(() => { throw Error('Address classification must not contact any network') })
  vi.stubGlobal('fetch', fetcher)
})
afterEach(() => { expect(fetcher).not.toHaveBeenCalled(); vi.unstubAllGlobals() })

const privateHosts = [
  'localhost', 'LOCALHOST.', 'localhost..', 'api.localhost', 'deep.api.localhost.', '%6cocalhost.',
  'local', 'service.local', 'service.local.', 'internal', 'service.internal', 'service.internal.',
  '0.0.0.0', '0.1.2.3', '10.0.0.1', '127.0.0.1', '127.1', '2130706433', '0x7f000001', '0177.0.0.1',
  '169.254.169.254', '172.16.0.1', '172.31.255.255', '192.168.0.1', '192.168.1.1.',
  '[::]', '[0:0:0:0:0:0:0:0]', '[::1]', '[0:0:0:0:0:0:0:1]', '[0000:0:0:0:0:0:0:0001]',
  '[fc00::]', '[fc00::1]', '[FD00:1234::1]', '[fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff]',
  '[fe80::]', '[fe80::1]', '[fe9a:1234::1]', '[fea0::1]', '[febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff]',
  '[::ffff:0.0.0.0]', '[::ffff:10.0.0.1]', '[::ffff:127.0.0.1]', '[::ffff:169.254.1.1]',
  '[::ffff:172.16.0.1]', '[::ffff:172.31.255.255]', '[::ffff:192.168.1.1]',
  '[0:0:0:0:0:ffff:7f00:1]', '[::ffff:ac10:1]', '[::ffff:c0a8:101]',
]
// Accepted examples outside the targeted ranges. This does not certify DNS or
// global routability, or introduce a policy for other special-use addresses.
const allowedHosts = [
  'tickets.example.test', 'tickets.example.test.', 'localhost.example.test', 'local.example.test',
  'internal.example.test', 'notlocalhost', 'notinternal', 'notlocal',
  '10.api.example.test', '127.api.example.test', '192.168.public.example.test',
  '8.8.8.8', '1.1.1.1', '169.253.255.255', '169.255.0.1', '172.15.255.255', '172.32.0.1', '192.169.0.1',
  '[2606:4700:4700::1111]', '[2001:4860:4860::8888]', '[2001:db8:fc00::1]', '[2001:db8:fe80::1]',
  '[2001:db8::127.0.0.1]', '[fbff:ffff::1]', '[fe00::1]', '[fe7f:ffff::1]', '[fec0::1]',
  '[::ffff:8.8.8.8]', '[::ffff:172.15.255.255]', '[::ffff:172.32.0.1]', '[::ffff:192.169.0.1]',
]

function configured(endpointUrl, changes = {}) {
  const config = { endpointUrl, secretBinding: 'OVERRIDE_INTEGRATION_TEST_TOKEN', supportsIdempotency: true, ...changes }
  const env = { OVERRIDE_INTEGRATIONS: JSON.stringify({ webhook: config }),
    OVERRIDE_INTEGRATION_TEST_TOKEN: 'synthetic-only', SUPABASE_SERVICE_ROLE_KEY: 'not-an-integration-key' }
  return { config, env, integration: { kind: 'webhook', endpoint_url: endpointUrl, secret_binding: config.secretBinding } }
}

describe('integration destination classification without DNS or new allowlist semantics', () => {
  it.each(privateHosts)('rejects private host %s even when explicitly misconfigured in the server allowlist', host => {
    const endpoint = 'https://' + host + '/hook', { env, integration } = configured(endpoint)
    expect(isSafeIntegrationUrl(endpoint)).toBe(false)
    expect(integrationConfig(env, integration)).toBeNull()
  })

  it.each(allowedHosts)('does not add a new denial or substring false positive for host %s', host => {
    const endpoint = 'https://' + host + ':8443/hook?version=1', { config, env, integration } = configured(endpoint)
    expect(isSafeIntegrationUrl(endpoint)).toBe(true)
    expect(integrationConfig(env, integration)).toEqual(config)
  })

  it.each(['http://example.test', 'file:///tmp/local', 'ftp://example.test', 'not a URL', 'https://[::1',
    'https://[fe80::1%25eth0]', 'https://[:::1]', 'https://[::ffff:999.1.1.1]'])('keeps malformed or non-HTTPS input rejected: %s', endpoint => {
    expect(isSafeIntegrationUrl(endpoint)).toBe(false)
  })

  it('does not make endpoint equality looser when URL forms resolve to the same host', () => {
    const endpoint = 'https://tickets.example.test/hooks', { env, integration } = configured(endpoint)
    for (const changed of ['https://tickets.example.test./hooks', 'https://TICKETS.example.test/hooks',
      'https://tickets.example.test:443/hooks', 'https://tickets.example.test/hooks/', 'https://tickets.example.test/hooks?q=1']) {
      expect(integrationConfig(env, { ...integration, endpoint_url: changed })).toBeNull()
    }
    const ipv6 = configured('https://[2001:4860:4860::8888]/hook')
    expect(integrationConfig(ipv6.env, { ...ipv6.integration, endpoint_url: 'https://[2001:4860:4860:0:0:0:0:8888]/hook' })).toBeNull()
  })

  it('retains dedicated credentials, fragment/userinfo rejection and idempotency requirements', () => {
    for (const endpoint of ['https://user:pass@tickets.example.test/hook', 'https://tickets.example.test/hook#private']) {
      const { env, integration } = configured(endpoint)
      expect(integrationConfig(env, integration)).toBeNull()
    }
    for (const changes of [{ secretBinding: 'SUPABASE_SERVICE_ROLE_KEY' }, { supportsIdempotency: false }]) {
      const { env, integration } = configured('https://tickets.example.test/hook', changes)
      expect(integrationConfig(env, integration)).toBeNull()
    }
    const { env, integration } = configured('https://tickets.example.test/hook')
    expect(integrationConfig({ ...env, OVERRIDE_INTEGRATION_TEST_TOKEN: '' }, integration)).toBeNull()
    expect(integrationConfig(env, { ...integration, secret_binding: 'OVERRIDE_INTEGRATION_OTHER_TOKEN' })).toBeNull()
    expect(integrationConfig(env, { ...integration, endpoint_url: 'https://other.example.test/hook' })).toBeNull()
  })
})
