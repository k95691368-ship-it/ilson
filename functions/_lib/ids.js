// id는 전부 TEXT PRIMARY KEY다. 접두사를 붙이는 이유는 로그와 감사 기록에서
// 그 값만 보고도 무엇의 id인지 알 수 있게 하기 위해서다 — 디버깅할 때
// "req_..." 하나면 어느 표를 볼지 정해진다.
export function newId(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`
}

// 공개 도구 주소에 쓰는 슬러그. 한글 제목에서 만들되, 주소에 그대로 노출되므로
// 영숫자와 하이픈만 남긴다. 한글만으로 이루어진 제목이면 남는 글자가 없으므로
// 그때는 무작위 꼬리만 쓴다.
export function slugify(title, fallback = 'tool') {
  const base = String(title ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9가-힣\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[가-힣]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  const head = base || fallback
  return `${head}-${crypto.randomUUID().slice(0, 6)}`
}

// 요청 본문의 지문. 같은 파일을 두 번 올렸는지 판정할 때 쓴다.
export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
