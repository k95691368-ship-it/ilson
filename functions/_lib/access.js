// Only signed Cloudflare Access assertions identify a real operator.
const keyCache = new Map()
const decode = value => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0))
export async function verifiedAccessEmail(env, request) {
  try {
    const domain = String(env.ACCESS_TEAM_DOMAIN || '').replace(/^https:\/\//, '').replace(/\/$/, '')
    const audience = env.ACCESS_AUD
    if (!/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(domain) || !audience) return null
    const token = request?.headers?.get('Cf-Access-Jwt-Assertion')
    if (!token || token.length > 16000) return null
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const header = JSON.parse(new TextDecoder().decode(decode(parts[0])))
    if (header.alg !== 'RS256' || typeof header.kid !== 'string' || header.crit) return null
    const issuer = `https://${domain}`
    let cached = keyCache.get(issuer)
    if (!cached || cached.until < Date.now()) {
      const response = await fetch(`${issuer}/cdn-cgi/access/certs`, { redirect: 'error', signal: AbortSignal.timeout(5000) })
      if (!response.ok) return null
      const { keys } = await response.json()
      if (!Array.isArray(keys) || keys.length > 20) return null
      cached = { keys, until: Date.now() + 300000 }
      if (keyCache.size >= 4) keyCache.clear()
      keyCache.set(issuer, cached)
    }
    const jwk = cached.keys.find(key => key.kid === header.kid && key.kty === 'RSA' && (!key.alg || key.alg === 'RS256') && (!key.use || key.use === 'sig'))
    if (!jwk) return null
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])
    if (!await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, decode(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`))) return null
    const claims = JSON.parse(new TextDecoder().decode(decode(parts[1])))
    const now = Date.now() / 1000
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
    if (claims.iss !== issuer || !audiences.includes(audience) || !Number.isFinite(claims.exp) || claims.exp <= now
        || !Number.isFinite(claims.iat) || claims.iat > now + 30
        || (claims.nbf !== undefined && (!Number.isFinite(claims.nbf) || claims.nbf > now + 30))) return null
    return typeof claims.email === 'string' && /^\S+@\S+\.\S+$/.test(claims.email) ? claims.email.trim().toLowerCase() : null
  } catch { return null }
}
