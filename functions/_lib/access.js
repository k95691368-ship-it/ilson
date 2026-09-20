// Only signed Cloudflare Access assertions identify a real operator.
const keyCache = new Map()
const decode = value => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0))

async function signingKeys(issuer, kid) {
  let cached = keyCache.get(issuer)
  if (!cached) {
    if (keyCache.size >= 4) keyCache.delete(keyCache.keys().next().value)
    cached = { keys: [], imported: new Map(), until: 0, retryAt: 0, pending: null }
    keyCache.set(issuer, cached)
  }
  const now = Date.now()
  // Unknown kids may indicate rotation, but random attacker-supplied kids must
  // not turn every authentication attempt into an outbound certificate request.
  if (cached.until > now && cached.keys.some(key => key.kid === kid)) return cached
  if (!cached.pending && now >= cached.retryAt) {
    cached.retryAt = now + 30000
    cached.pending = (async () => {
      const response = await fetch(`${issuer}/cdn-cgi/access/certs`, { redirect: 'manual', signal: AbortSignal.timeout(5000) })
      if (!response.ok) throw new Error('Access certificates unavailable')
      const { keys } = await response.json()
      if (!Array.isArray(keys) || keys.length > 20 || keys.some(key => !key || typeof key !== 'object')) throw new Error('Invalid Access certificates')
      cached.keys = keys
      cached.imported.clear()
      cached.until = Date.now() + 300000
    })().finally(() => { cached.pending = null })
  }
  if (cached.pending) await cached.pending
  return cached.until > Date.now() ? cached : null
}

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
    const cached = await signingKeys(issuer, header.kid)
    if (!cached) return null
    const jwk = cached.keys.find(key => key.kid === header.kid && key.kty === 'RSA' && (!key.alg || key.alg === 'RS256') && (!key.use || key.use === 'sig'))
    if (!jwk) return null
    if (!cached.imported.has(jwk)) {
      cached.imported.set(jwk, crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']))
    }
    const key = await cached.imported.get(jwk)
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
