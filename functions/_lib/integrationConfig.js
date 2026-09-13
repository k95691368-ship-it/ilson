import { isSafeIntegrationUrl } from './override.js'

export function integrationConfig(env, integration) {
  try {
    const configs = JSON.parse(env.OVERRIDE_INTEGRATIONS || '{}')
    const config = configs[integration.kind]
    if (!config || config.endpointUrl !== integration.endpoint_url || !isSafeIntegrationUrl(config.endpointUrl)) return null
    const url = new URL(config.endpointUrl)
    if (url.username || url.password || url.hash) return null
    if (config.secretBinding !== integration.secret_binding || !/^OVERRIDE_INTEGRATION_[A-Z0-9_]+_TOKEN$/.test(config.secretBinding)) return null
    // A retry after an uncertain network result must not create a second external action.
    if (config.supportsIdempotency !== true || !env[config.secretBinding]) return null
    return config
  } catch { return null }
}
