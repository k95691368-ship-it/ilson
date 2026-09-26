// Bound bytes while the existing JSON/multipart parser consumes the request.
// Do not buffer or clone a second copy of uploaded files in middleware.
const MIB = 1024 * 1024
export function requestBodyLimit(request: Request): number {
  const path = new URL(request.url).pathname.replace(/\/$/, '')
  // Application forms contain text only. Local settlement files never upload
  // through this route, so multipart must use the same 1 MiB limit as JSON.
  // Browser-computed settlement rows carry more data than ordinary forms.
  if (request.method === 'POST' && /^\/api\/applications\/[^/]+\/build$/.test(path)) return 16 * MIB
  return MIB
}

export interface BoundedRequestBody {
  exceeded: boolean
  request: Request
}

export function boundRequestBody(request: Request): BoundedRequestBody {
  const limit = requestBodyLimit(request)
  const length = request.headers.get('Content-Length')
  const state: BoundedRequestBody = { exceeded: length !== null && Number(length) > limit, request }
  if (state.exceeded || !request.body) return state
  let received = 0
  const body = request.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
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
  const init: RequestInit & { duplex: 'half' } = { body, duplex: 'half' }
  state.request = new Request(request, init)
  return state
}
