// 글 안의 강조와 코드 조각을 조각내 준다.
//
// shared/about.js 의 본문은 `**중요한 말**` 과 `` `decision_log` `` 처럼
// 표시를 달고 쓰여 있다. 화면이 그걸 그냥 문자열로 넣으면 별표와 백틱이
// 그대로 보인다. 읽는 사람 눈에는 그냥 깨진 글이다.
//
// 라이브러리를 붙이지 않는다. 여는 표시와 닫는 표시가 짝지어진 두 종류만
// 다루면 되고, 그건 쪼개기 한 번이면 끝난다. 이 글은 내가 쓰는 것이므로
// 남이 넣은 문자열을 파싱하는 것이 아니다 — 그래서 위험한 것을 만들지
// 않는다. (HTML 을 만들어 내지 않고 조각 배열만 돌려준다.)

// 짝이 맞는 구간만 표시를 벗긴다. 짝이 안 맞으면 원문 그대로 둔다 —
// 임의로 지우면 글쓴이가 표시를 빠뜨린 것을 아무도 모르게 된다.
function splitBy(parts, mark, kind) {
  const out = []
  for (const part of parts) {
    if (typeof part !== 'string') {
      out.push(part)
      continue
    }
    const chunks = part.split(mark)
    // 표시가 홀수 개면 짝이 안 맞는 것이다. 손대지 않는다.
    if (chunks.length % 2 === 0) {
      out.push(part)
      continue
    }
    chunks.forEach((c, i) => {
      if (c === '') return
      out.push(i % 2 === 1 ? { kind, text: c } : c)
    })
  }
  return out
}

// 문자열 하나를 조각 배열로 만든다.
// 문자열 조각은 그대로 두고, 강조는 { kind: 'b' }, 코드는 { kind: 'code' }.
export function inlineParts(text) {
  if (typeof text !== 'string' || text === '') return []
  // 코드 먼저 뗀다. 코드 안에 별표가 있어도 강조로 읽히지 않게.
  return splitBy(splitBy([text], '`', 'code'), '**', 'b')
}

// 표시를 전부 벗긴 맨 글. 검사와 검색에 쓴다.
export function plainText(text) {
  return inlineParts(text)
    .map((p) => (typeof p === 'string' ? p : p.text))
    .join('')
}
