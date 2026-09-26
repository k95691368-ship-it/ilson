import { jsonError, failUnexpected } from '../../_lib/http.ts'
import { DEMO_APPLICATIONS } from '../../_lib/demoApplications.js'
import { checkRateLimit } from '../../_lib/rateLimit.js'
import { workspaceEnabled, workspaceToken, workspaceDb, workspaceCookie, sameOrigin } from '../../_lib/workspace.js'

const reply = (body, status = 200, headers = {}) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } })
const seeds = () => DEMO_APPLICATIONS.map((row, index) => ({ ...row, id: `demo_application_${index + 1}` }))
const newToken = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('')

export async function onRequestGet({ env, data: requestData, request }) {
  env = requestData?.requestEnv ?? env
  if (!workspaceEnabled(env)) return reply({ enabled: false })
  const token = workspaceToken(request)
  if (!token) return reply({ enabled: true, active: false })
  try {
    await workspaceDb(env, token).prepare('SELECT 1').first()
    return reply({ enabled: true, active: true })
  } catch (error) {
    if (error.message.includes('/28000')) return reply({ enabled: true, active: false, expired: true })
    return failUnexpected(error, '체험 공간을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.')
  }
}

export async function onRequestPost({ env, data: requestData, request }) {
  env = requestData?.requestEnv ?? env
  if (!workspaceEnabled(env)) return jsonError('체험 공간이 활성화되지 않았습니다.', 409)
  if (!sameOrigin(request)) return jsonError('이 사이트에서 직접 요청해 주세요.', 403)
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown'
  if (!await checkRateLimit(env, `workspace-create:${ip}`, 6, 3600)) return jsonError('체험 공간 생성은 시간당 6회까지 가능합니다.', 429)
  try {
    const oldToken = workspaceToken(request)
    if (oldToken) {
      try {
        await workspaceDb(env, oldToken).prepare('SELECT 1').first()
        return reply({ enabled: true, active: true })
      } catch (error) { if (!error.message.includes('/28000')) throw error }
    }
    const token = newToken()
    const result = await env.DB.workspaceOpen(token, seeds())
    return reply({ enabled: true, active: true, expiresAt: result.expiresAt }, 201, { 'Set-Cookie': workspaceCookie(request, token) })
  } catch (error) {
    return failUnexpected(error, '체험 공간을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.')
  }
}

export async function onRequestDelete({ env, data: requestData, request }) {
  env = requestData?.requestEnv ?? env
  if (!workspaceEnabled(env)) return jsonError('체험 공간이 활성화되지 않았습니다.', 409)
  if (!sameOrigin(request)) return jsonError('이 사이트에서 직접 요청해 주세요.', 403)
  const token = workspaceToken(request)
  if (!token) return jsonError('초기화할 체험 공간이 없습니다.', 428)
  if (!await checkRateLimit(env, `workspace-reset:${token.slice(0, 24)}`, 6, 3600)) return jsonError('초기화는 시간당 6회까지 가능합니다.', 429)
  try {
    const body = await request.json()
    if (body.confirm !== 'reset-my-workspace') return jsonError('초기화 확인이 필요합니다.', 400)
    const replacement = newToken()
    const result = await env.DB.workspaceReset(token, seeds(), replacement)
    return reply({ enabled: true, active: true, reset: true, expiresAt: result.expiresAt }, 200, { 'Set-Cookie': workspaceCookie(request, replacement) })
  } catch (error) { return failUnexpected(error, '초기화하지 못했습니다. 기존 체험 공간을 다시 확인해 주세요.') }
}
