import { createSupabaseDb } from './dbBridge.js'

export const WORKSPACE_COOKIE = 'ilson_workspace'
export const workspaceEnabled = env => env?.DEMO_WORKSPACES === 'true'

export function workspaceToken(request) {
  const matches = (request.headers.get('Cookie') || '').split(';')
    .map(part => part.trim()).filter(part => part.startsWith(`${WORKSPACE_COOKIE}=`))
  if (matches.length !== 1) return null
  const token = matches[0].slice(WORKSPACE_COOKIE.length + 1)
  return /^[a-f0-9]{64}$/.test(token) ? token : null
}

export function workspaceDb(env, token) {
  if (!token || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('체험 공간 연결 설정이 필요합니다.')
  return createSupabaseDb(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, token)
}

export function sameOrigin(request) {
  const origin = request.headers.get('Origin')
  return origin === new URL(request.url).origin && request.headers.get('X-Ilson-Request') === '1'
}

export function workspaceCookie(request, token) {
  return `${WORKSPACE_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`
}
