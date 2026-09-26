// 서버에 말을 거는 통로. 화면 코드가 fetch를 직접 쓰지 않게 한다.
//
// 여기 한 곳에서 두 가지를 처리한다.
//   1) 실패했을 때 사용자에게 보여 줄 한국어 문장을 만든다
//   2) 폼 검증 실패는 다른 오류와 구분해서 넘긴다 (칸마다 다른 문구를 붙여야 하므로)

import { accessBlocked, getAccessSession, revokeAccess, subscribeAccessSession } from '../lib/accessSession.js'

const BASE = '/api'
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue | undefined }
export type FieldErrors = Record<string, string>
export type ReadOptions = { signal?: AbortSignal }
type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
type RequestOptions = Omit<RequestInit, 'method'> & {
  method?: HttpMethod
  sessionProbe?: boolean
  sessionGeneration?: number
}
type WorkspaceState = { enabled: boolean; active?: boolean; expired?: boolean; expiresAt?: string; reset?: boolean }
type AccessSnapshot = { generation: number; status: string; scope: string | null; error: string }
type ApiErrorOptions = { status: number; fields?: unknown; code?: unknown; notSaved?: unknown }

declare global {
  interface Window {
    __boot?: Record<string, Promise<Response | null>>
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function fieldErrors(value: unknown): FieldErrors | null {
  if (!isRecord(value)) return null
  const entries = Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  return Object.fromEntries(entries)
}

function readWorkspaceState(value: unknown): WorkspaceState {
  if (!isRecord(value) || typeof value.enabled !== 'boolean'
    || (value.active !== undefined && typeof value.active !== 'boolean')
    || (value.expired !== undefined && typeof value.expired !== 'boolean')
    || (value.expiresAt !== undefined && typeof value.expiresAt !== 'string')
    || (value.reset !== undefined && typeof value.reset !== 'boolean')) {
    throw new Error('체험 공간을 확인하지 못했습니다. 소개는 계속 보실 수 있습니다.')
  }
  return { enabled: value.enabled, active: value.active, expired: value.expired, expiresAt: value.expiresAt, reset: value.reset }
}

let workspaceReady: Promise<WorkspaceState> | null = null
subscribeAccessSession(() => { workspaceReady = null })

export async function readWorkspace({ signal }: ReadOptions = {}): Promise<WorkspaceState> {
  const response = await fetch(`${BASE}/demo/workspace`, { cache: 'no-store', credentials: 'same-origin', signal })
  if (!response.ok) throw new Error('체험 공간을 확인하지 못했습니다. 소개는 계속 보실 수 있습니다.')
  const body: unknown = await response.json()
  return readWorkspaceState(body)
}

export function ensureWorkspace({ fresh = false }: { fresh?: boolean } = {}): Promise<WorkspaceState> {
  if (fresh) workspaceReady = null
  if (!workspaceReady) {
    const open = async () => {
      const state = await readWorkspace()
      if (!state.enabled || state.active) return state
      const opened = await fetch(`${BASE}/demo/workspace`, {
        method: 'POST', headers: { 'X-Ilson-Request': '1' }, credentials: 'same-origin',
      })
      const body: unknown = await opened.json()
      if (!opened.ok) throw new Error(isRecord(body) && typeof body.error === 'string' ? body.error : '체험 공간을 열지 못했습니다.')
      return readWorkspaceState(body)
    }
    // Coordinate first visits across tabs of the same browser profile.
    workspaceReady = (typeof navigator !== 'undefined' && navigator.locks
      ? navigator.locks.request('ilson-workspace-open', open)
      : open()).catch(error => { workspaceReady = null; throw error })
  }
  return workspaceReady
}

export async function resetWorkspace() {
  // Reset must target the space shown by this tab, not a replacement cookie
  // from another tab. Use the same session precondition as business writes.
  const body = await send('/demo/workspace', withJson('DELETE', { confirm: 'reset-my-workspace' }))
  workspaceReady = null
  return body
}

// 서버는 실패할 때 { error, fields? } 를 준다. fields가 있으면 폼 검증 실패다.
class ApiError extends Error {
  status: number
  fields: FieldErrors | null
  code: string | null
  notSaved: boolean

  constructor(message: string, { status, fields, code, notSaved }: ApiErrorOptions) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.fields = fieldErrors(fields)
    this.code = typeof code === 'string' ? code : null
    this.notSaved = notSaved === true
  }
}

export { ApiError }

// 첫 화면이 부를 것을 index.html 이 미리 띄워 둔다.
//
// 여태 순서는 이랬다 — index.js 를 받고, 실행하고, 그제서야 화면이 뜨면서
// /overview 를 부른다. 그때까지 서버는 놀고 있다.
//
// index.html 은 맨 먼저 도착하므로 거기서 fetch 만 걸어 두면, 자바스크립트를
// 받는 동안 서버가 같이 일한다. 화면이 뜰 때쯤 답이 이미 와 있다.
//
// 규칙 둘.
//   · **한 번만 쓴다.** 다시 부르는 것은 값이 바뀌었을 수 있어서 부르는
//     것이라, 미리 받아 둔 옛 답을 주면 새로고침이 안 되는 화면이 된다.
//   · GET 만. 미리 띄우는 것이라 무언가를 바꾸는 요청이면 안 된다.
function takeBooted(path: string, options: RequestOptions): Promise<Response | null> | null {
  const booted = typeof window !== 'undefined' && window.__boot
  if (!booted || (options.method && options.method !== 'GET')) return null
  const hit = booted[path]
  if (!hit) return null
  delete booted[path]
  return hit
}

const pendingMutations = new Map<string, { key: string; until: number }>()
const changedSession = () => new ApiError('접근 상태가 바뀌었습니다. 권한을 다시 확인한 뒤 저장 기록을 확인해주세요.', { status: 409, code: 'ACCESS_CHANGED' })
async function send(path: string, options: RequestOptions = {}): Promise<unknown> {
  const access: AccessSnapshot = getAccessSession()
  const generation = options.sessionGeneration ?? access.generation
  const sessionProbe = options.sessionProbe === true && path === '/session' && !options.method
  if (generation !== access.generation) throw changedSession()
  if ((accessBlocked(access) || access.status !== 'active') && !sessionProbe) {
    throw new ApiError(access.error || '접근 권한을 다시 확인해 주세요.', { status: 401, code: 'ACCESS_REVOKED' })
  }
  const current = () => generation === getAccessSession().generation && !options.signal?.aborted
  let res: Response
  const identity = options.method && options.method !== 'GET' && typeof options.body === 'string' ? `${access.scope ?? 'unverified'}:${options.method}:${path}:${options.body}` : null
  let key: string | undefined
  if (identity) {
    const prior = pendingMutations.get(identity)
    key = prior && prior.until > Date.now() ? prior.key : crypto.randomUUID()
    const oldest = pendingMutations.keys().next().value
    if (pendingMutations.size >= 100 && oldest !== undefined) pendingMutations.delete(oldest)
    pendingMutations.set(identity, { key, until: Date.now() + 30 * 60000 })
  }
  try {
    const headers = new Headers(options.headers)
    headers.set('X-Ilson-Request', '1')
    if (!sessionProbe) headers.set('X-Ilson-Scope', String(access.scope))
    else headers.delete('X-Ilson-Scope')
    if (key) headers.set('X-Idempotency-Key', key)
    const { sessionProbe: _probe, sessionGeneration: _generation, ...requestOptions } = options
    options = { ...requestOptions, headers, credentials: 'same-origin', cache: 'no-store' }
    // 미리 띄워 둔 것이 있으면 그것을 쓴다. 그것이 실패했으면 null 이 오고,
    // 그때는 아무 일 없었던 것처럼 지금 부른다.
    const booted = takeBooted(path, options)
    res = (booted && (await booted)) || (await fetch(`${BASE}${path}`, options))
  } catch (error) {
    if (options.signal?.aborted) throw error
    if (!current()) throw changedSession()
    // 인터넷이 끊겼거나 서버가 아예 안 뜬 경우. 상태 코드조차 없다.
    throw new ApiError('서버에 닿지 못했습니다. 인터넷 연결을 확인해주세요.', { status: 0 })
  }

  // 본문이 비어 있거나 JSON이 아닐 수 있다(예: 배포 중 정적 페이지가 대신 응답).
  const body: unknown = await res.json().catch(() => null)
  // JSON parsing itself is asynchronous. Never return an earlier session's
  // body or let its late denial invalidate a subsequently verified session.
  if (!current()) throw changedSession()
  if (res.ok && (!body || typeof body !== 'object')) {
    // The server may have committed even when its response was lost or truncated.
    // Preserve the mutation key so a manual retry cannot duplicate that write.
    throw new ApiError('서버 응답을 확인하지 못했습니다. 같은 내용으로 다시 시도해주세요.', { status:502 })
  }

  if (!res.ok) {
    if (identity && res.status < 500 && pendingMutations.get(identity)?.key === key) pendingMutations.delete(identity)
    const failure = isRecord(body) ? body : {}
    const errorMessage = typeof failure.error === 'string' ? failure.error : null
    const scopeChanged = (res.status === 409 && failure.code === 'SESSION_SCOPE_CHANGED')
      || (res.status === 400 && failure.code === 'SESSION_SCOPE_INVALID')
    if (!sessionProbe && ([401, 428].includes(res.status) || scopeChanged)) {
      revokeAccess(generation, errorMessage || '접근 권한을 다시 확인해 주세요.')
    }
    throw new ApiError(errorMessage ?? '요청에 실패했습니다.', {
      status: res.status,
      fields: failure.fields,
      code: failure.code,
      notSaved: failure.notSaved,
    })
  }
  if (identity && pendingMutations.get(identity)?.key === key) pendingMutations.delete(identity)
  return body
}

// Only this protected, read-only probe may run while the business UI is locked.
// Its response still has to pass the gate's schema and generation checks.
export function readAccessSession(generation: number, { signal }: ReadOptions = {}): Promise<unknown> {
  return send('/session', { signal, sessionProbe: true, sessionGeneration: generation })
}

function withJson(method: HttpMethod, body?: JsonValue): RequestOptions {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  }
}

export const api = {
  // Success JSON deliberately remains unknown until a consuming boundary validates it.
  get: (path: string, { signal }: ReadOptions = {}): Promise<unknown> => send(path, { signal }),
  post: (path: string, body?: JsonValue): Promise<unknown> => send(path, withJson('POST', body)),
  put: (path: string, body?: JsonValue): Promise<unknown> => send(path, withJson('PUT', body)),
  patch: (path: string, body?: JsonValue): Promise<unknown> => send(path, withJson('PATCH', body)),
  remove: (path: string, body?: JsonValue): Promise<unknown> => send(path, withJson('DELETE', body)),
  // 파일이 섞인 폼은 Content-Type을 우리가 정하면 안 된다.
  // 브라우저가 경계 문자열을 붙여 직접 정해야 서버가 나눠 읽을 수 있다.
  form: (path: string, formData: FormData): Promise<unknown> => send(path, { method: 'POST', body: formData }),
}
