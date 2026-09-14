// Bound bytes while the existing JSON/multipart parser consumes the request.
// Do not buffer or clone a second copy of uploaded files in middleware.
const MIB = 1024 * 1024
export function requestBodyLimit(request) {
  const path = new URL(request.url).pathname.replace(/\/$/, '')
  // Preserve the existing five 10 MiB attachment allowance plus form overhead.
  if (request.method === 'POST' && path === '/api/applications' &&
      /^multipart\/form-data\s*;/i.test(request.headers.get('Content-Type') || '')) return 51 * MIB
  // Browser-computed settlement rows carry more data than ordinary forms.
  if (request.method === 'POST' && /^\/api\/applications\/[^/]+\/build$/.test(path)) return 16 * MIB
  return MIB
}

export function boundRequestBody(request) {
  const limit = requestBodyLimit(request)
  const length = request.headers.get('Content-Length')
  const state = { exceeded: length !== null && Number(length) > limit, request }
  if (state.exceeded || !request.body) return state
  let received = 0
  const body = request.body.pipeThrough(new TransformStream({
    transform(chunk, controller) {
      received += chunk.byteLength
      if (received > limit) {
        state.exceeded = true
        // An errored stream cancels its upstream source, including chunked requests.
        throw new Error('Request body limit exceeded')
      }
      controller.enqueue(chunk)
    },
  }))
  state.request = new Request(request, { body, duplex: 'half' })
  return state
}
