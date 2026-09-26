import { jsonError, jsonResponse, failUnexpected } from '../../_lib/http.ts'
import { ensureOverrideSchema, seedOverrideWorkspace, resolveOverrideActor, overrideDemoMode } from '../../_lib/override.js'
import { scopeEnvironment } from '../../_lib/authorization.js'
import { readOverrideEvents } from '../../_lib/overrideEvents.js'

export async function onRequestGet({ env, data: requestData, request }) {
  env = requestData?.requestEnv ?? env
  try {
    await ensureOverrideSchema(env)
    const actor = await resolveOverrideActor(env, request)
    if (!actor) return jsonError('인증된 사내 계정이 필요합니다.', 401)
    if (!overrideDemoMode(env)) env = scopeEnvironment(env, actor)
    await seedOverrideWorkspace(env)
    return jsonResponse(await readOverrideEvents(env.DB, new URL(request.url).searchParams))
  } catch (error) {
    if (error.status) return jsonError(error.message, error.status)
    return failUnexpected(error, '판단 사건 원문을 불러오지 못했습니다.')
  }
}
