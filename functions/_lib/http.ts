// 서버가 답할 때 쓰는 모양을 한 곳에 모은다.
//
// 화면 쪽에서는 "성공이면 데이터, 실패면 error 한 줄"만 기대하면 되게 한다.
// 라우트마다 응답 모양이 다르면 화면에서 매번 다르게 풀어야 하고, 그러다
// 어느 한 곳을 빠뜨리면 사용자에게 빈 화면이 뜬다.

import { databaseAccessFailure } from './dbBridge.ts'

const JSON_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
}

// Static _headers rules do not cover Pages Function responses.
export function privateResponse(response: Response): Response {
  const result = new Response(response.body, response)
  for (const name of ['Cache-Control', 'X-Content-Type-Options', 'Referrer-Policy']) {
    result.headers.set(name, JSON_HEADERS[name])
  }
  const vary = new Set((result.headers.get('Vary') || '').split(',').map(value => value.trim()).filter(Boolean))
  for (const name of ['Cookie', 'Authorization']) {
    if (![...vary].some(value => value.toLowerCase() === name.toLowerCase())) vary.add(name)
  }
  result.headers.set('Vary', [...vary].join(', '))
  return result
}

export function ok(data: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders },
  })
}

// 사용자에게 그대로 보여 줄 한국어 한 문장만 담는다.
// 상태 코드나 내부 오류 문구를 화면에 노출하지 않는다.
export function fail(message: string, status = 400): Response {
  return ok({ error: message }, status)
}

// 폼 검증 실패는 따로 둔다. 어느 칸이 왜 틀렸는지를 칸 이름별로 돌려줘야
// 화면이 그 칸 아래에 정확히 표시할 수 있다.
export function failFields(fields: Record<string, string | undefined>, message = '적어 주신 내용을 확인해주세요.'): Response {
  return ok({ error: message, fields }, 400)
}

// Exception messages can contain SQL, credentials, or user data even when truncated.
export function failUnexpected(err: unknown, what: string, fallbackStatus = 503): Response {
  const access = databaseAccessFailure(err)
  if (access) return ok({ error: access.error, code: access.code }, access.status)
  return fail(what, fallbackStatus)
}

export const jsonResponse = ok
export const jsonError = fail
