// 이름 뒤에 붙는 조사를 규칙으로 고른다.
//
// 부서 이름이나 사람 이름을 문장에 끼워 넣는 자리가 많아졌다. 그런데
// 조사를 문장에 박아 두면 "영업가 붙였던 것", "재무을 기다립니다" 같은
// 말이 나온다. 라이브에서 실제로 "영업가"가 찍혔다.
//
// 이 사이트는 부서 사람이 읽는 화면이다. 틀린 조사 하나가 "이거 대충
// 만들었구나"로 읽히고, 그러면 그 옆의 숫자도 같이 못 믿게 된다.
//
// 규칙은 하나다. 마지막 글자에 받침이 있으면 은/이/을/과/으로,
// 없으면 는/가/를/와/로.

const HANGUL_START = 0xac00
const HANGUL_END = 0xd7a3

// 받침이 있는가.
//
// 한글 음절은 (초성 × 21 + 중성) × 28 + 종성 으로 만들어진다.
// 그래서 28로 나눈 나머지가 0이 아니면 받침이 있다.
export function hasFinalConsonant(word) {
  const s = String(word ?? '').trim()
  if (!s) return false
  const code = s.charCodeAt(s.length - 1)

  if (code >= HANGUL_START && code <= HANGUL_END) {
    return (code - HANGUL_START) % 28 !== 0
  }

  // 숫자로 끝나면 읽는 소리로 판단한다. "3개"가 아니라 "3"으로 끝나는
  // 자리가 실제로 있다 — 접수번호나 개수 뒤에 조사가 붙을 때다.
  if (code >= 0x30 && code <= 0x39) {
    // 0(영) 1(일) 3(삼) 6(육) 7(칠) 8(팔)은 받침이 있다.
    return '0136780'.includes(s[s.length - 1])
  }

  // 영문·기호로 끝나는 것은 판단하지 않는다. 여기서 찍으면 틀린 조사가
  // 나오는데, 틀린 조사는 아예 없는 것보다 나쁘다.
  return null
}

// 조사 짝. 앞이 받침 있을 때, 뒤가 받침 없을 때.
const PAIRS = {
  이: ['이', '가'],
  가: ['이', '가'],
  은: ['은', '는'],
  는: ['은', '는'],
  을: ['을', '를'],
  를: ['을', '를'],
  과: ['과', '와'],
  와: ['과', '와'],
  으로: ['으로', '로'],
  로: ['으로', '로'],
}

// 이름에 조사를 붙인다.
//
// 판단할 수 없는 이름(영문·기호로 끝나는 것)에는 짝을 모두 적는다.
// 찍어서 틀리는 것보다 "영업(이)가"처럼 두 개를 다 보여 주는 편이 낫다.
export function withJosa(word, josa) {
  const w = String(word ?? '').trim()
  const pair = PAIRS[josa]
  if (!w) return ''
  if (!pair) return `${w}${josa}`

  const has = hasFinalConsonant(w)
  if (has === null) return `${w}${pair[0]}(${pair[1]})`
  return `${w}${has ? pair[0] : pair[1]}`
}

// 여러 이름을 가운뎃점으로 잇고 마지막 이름에 맞춰 조사를 붙인다.
//
// "재무·마케팅·영업이 아직입니다" — 조사는 맨 끝 이름을 따른다.
export function listWithJosa(words, josa, sep = '·') {
  const list = (words ?? []).map((w) => String(w ?? '').trim()).filter(Boolean)
  if (list.length === 0) return ''
  const head = list.slice(0, -1)
  const last = list[list.length - 1]
  return head.length > 0 ? `${head.join(sep)}${sep}${withJosa(last, josa)}` : withJosa(last, josa)
}
