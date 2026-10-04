import { jsonError } from '../../../_lib/http.ts'
import { saveToolFeedback } from '../../../_lib/toolFeedback.ts'

// Real accounts keep their existing scope; demonstrations use private workspaces.
export async function onRequestPost({ env, data: requestData, params, request }) {
  env = requestData?.requestEnv ?? env
  let body
  try { body = await request.json() }
  catch { return jsonError('보내주신 내용을 읽지 못했습니다.', 400) }
  return saveToolFeedback(env, params.slug, 'report', body, request.headers.get('X-Idempotency-Key'), request.headers.get('CF-Connecting-IP') || 'unknown')
}
