// id는 전부 TEXT PRIMARY KEY다. 접두사를 붙이는 이유는 로그와 감사 기록에서
// 그 값만 보고도 무엇의 id인지 알 수 있게 하기 위해서다 — 디버깅할 때
// "app_..." 하나면 어느 표를 볼지 정해진다.
export function newId(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`
}

// 접수번호. 부서 담당자에게 전화로 불러 줄 수 있어야 한다.
//
// 헷갈리는 글자를 뺀다 — 0과 O, 1과 I와 L. 전화로 "영이에요 오예요?"를
// 묻게 되는 순간 접수번호의 쓸모가 없어진다.
const SAFE_CHARS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'

export function newTicketNo() {
  const bytes = crypto.getRandomValues(new Uint8Array(6))
  const body = [...bytes].map((b) => SAFE_CHARS[b % SAFE_CHARS.length]).join('')
  return `AX-${body.slice(0, 3)}-${body.slice(3)}`
}

// 공개 도구 주소에 쓰는 슬러그. 주소에 그대로 노출되므로 영숫자와 하이픈만
// 남긴다. 한글만으로 이루어진 제목이면 남는 글자가 없으므로 그때는 fallback.
export function slugify(title, fallback = 'tool') {
  const base = String(title ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return `${base || fallback}-${crypto.randomUUID().slice(0, 6)}`
}

export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// 신청자를 식별하지 않으면서 같은 사람의 반복 제출만 걸러 내기 위한 값.
// IP를 그대로 저장하면 개인정보가 되므로 해시만 남긴다.
export async function hashIp(ip) {
  if (!ip) return null
  return (await sha256Hex(`ilson:${ip}`)).slice(0, 32)
}
