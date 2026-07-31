// 서버에 말을 거는 통로. 화면 코드가 fetch를 직접 쓰지 않게 한다.
//
// 여기 한 곳에서 두 가지를 처리한다.
//   1) 실패했을 때 사용자에게 보여 줄 한국어 문장을 만든다
//   2) 폼 검증 실패는 다른 오류와 구분해서 넘긴다 (칸마다 다른 문구를 붙여야 하므로)

const BASE = '/api'

// 서버는 실패할 때 { error, fields? } 를 준다. fields가 있으면 폼 검증 실패다.
class ApiError extends Error {
  constructor(message, { status, fields }) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.fields = fields ?? null
  }
}

export { ApiError }

async function send(path, options = {}) {
  let res
  try {
    res = await fetch(`${BASE}${path}`, options)
  } catch {
    // 인터넷이 끊겼거나 서버가 아예 안 뜬 경우. 상태 코드조차 없다.
    throw new ApiError('서버에 닿지 못했습니다. 인터넷 연결을 확인해주세요.', { status: 0 })
  }

  // 본문이 비어 있거나 JSON이 아닐 수 있다(예: 배포 중 정적 페이지가 대신 응답).
  const body = await res.json().catch(() => null)

  if (!res.ok) {
    throw new ApiError(body?.error ?? '요청에 실패했습니다.', {
      status: res.status,
      fields: body?.fields,
    })
  }
  return body
}

function withJson(method, body) {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  }
}

export const api = {
  get: (path) => send(path),
  post: (path, body) => send(path, withJson('POST', body)),
  patch: (path, body) => send(path, withJson('PATCH', body)),
  remove: (path, body) => send(path, withJson('DELETE', body)),
  // 파일이 섞인 폼은 Content-Type을 우리가 정하면 안 된다.
  // 브라우저가 경계 문자열을 붙여 직접 정해야 서버가 나눠 읽을 수 있다.
  form: (path, formData) => send(path, { method: 'POST', body: formData }),
}
