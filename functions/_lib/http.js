// 서버가 답할 때 쓰는 모양을 한 곳에 모은다.
//
// 화면 쪽에서는 "성공이면 데이터, 실패면 error 한 줄"만 기대하면 되게 한다.
// 라우트마다 응답 모양이 다르면 화면에서 매번 다르게 풀어야 하고, 그러다
// 어느 한 곳을 빠뜨리면 사용자에게 빈 화면이 뜬다.

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' }

export function ok(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders },
  })
}

// 사용자에게 그대로 보여 줄 한국어 한 문장만 담는다.
// 상태 코드나 내부 오류 문구를 화면에 노출하지 않는다.
export function fail(message, status = 400) {
  return ok({ error: message }, status)
}

// 폼 검증 실패는 따로 둔다. 어느 칸이 왜 틀렸는지를 칸 이름별로 돌려줘야
// 화면이 그 칸 아래에 정확히 표시할 수 있다.
export function failFields(fields, message = '적어 주신 내용을 확인해주세요.') {
  return ok({ error: message, fields }, 400)
}

// 예상 못 한 오류를 사용자 문장으로 바꾼다. 원인은 짧게만 덧붙인다 —
// 아무 단서도 없으면 무엇을 고쳐야 할지 알 수 없고, 전부 노출하면 위험하다.
export function failUnexpected(err, what) {
  const hint = String(err?.message ?? '').slice(0, 160)
  return fail(`${what} (${hint})`, 503)
}

export const jsonResponse = ok
export const jsonError = fail
