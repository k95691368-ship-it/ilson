import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

// 세어 놓고 아무도 안 읽는 값.
//
// 한 번 훑어보니 열일곱 개가 있었다. 첫 화면을 열 때마다 기준선 표를 통째로
// 읽어 개수만 세고 버리는 쿼리가 돌았고, 도구 목록은 '뜸해짐'과 '실패 있음'을
// 각각 세어 응답에 실었는데 화면은 그 둘을 한 번도 안 읽었다.
//
// 이게 왜 나쁜가. 느려서가 아니다. **응답을 읽는 사람이 무엇이 진짜 쓰이는
// 값인지 알 수 없게 되기 때문이다.** 화면을 고치려고 응답을 열어 보면 스무
// 개가 넘는 이름이 나오는데 그중 절반은 아무 데도 안 닿는다. 그러면 다음
// 사람은 새 값을 더할 때도 "어차피 안 읽히겠지"로 더한다.
//
// 늘어나는 것을 사람이 눈으로 막을 수는 없다. 그래서 여기서 센다.

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (p.endsWith('.js') || p.endsWith('.jsx')) out.push(p)
  }
  return out
}

const apiFiles = walk(join(ROOT, 'functions', 'api'))
const readerText = [...walk(join(ROOT, 'src')), ...walk(join(ROOT, 'shared'))]
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n')

// 응답 объекта 안의 키처럼 보이는 것만 본다. 들여쓰기가 있는 `이름:` 줄.
function responseKeys(src) {
  return [...src.matchAll(/^\s{4,10}(\w{4,}):/gm)].map((m) => m[1])
}

// 서버끼리만 주고받는 이름들. 응답 키가 아니라 함수에 넘기는 값이다.
const NOT_RESPONSE = new Set([
  'linkKind',
  'linkId',
  'applicationId',
  'stage',
  'actor',
  'title',
  'what',
  'why',
  'alternatives',
  'unrequested',
])

describe('아무도 안 읽는 값을 응답에 싣지 않는다', () => {
  it('서버가 만든 이름은 화면이나 shared 에 닿는다', () => {
    const dead = []
    for (const f of apiFiles) {
      for (const key of responseKeys(readFileSync(f, 'utf8'))) {
        if (NOT_RESPONSE.has(key)) continue
        if (!readerText.includes(key)) {
          dead.push(`${f.slice(ROOT.length)} — ${key}`)
        }
      }
    }
    expect([...new Set(dead)]).toEqual([])
  })

  it('이 검사가 헛돌지 않는다', () => {
    // 실제로 쓰이는 이름은 걸러 낸다. 늘 빈 배열이면 아무것도 안 지킨다.
    expect(readerText).toContain('awaitingAccept')
    expect(readerText).toContain('remainingToday')
    // 그리고 지운 이름은 정말로 안 닿아야 한다.
    for (const gone of ['rowsProcessed', 'quarantineLiveTools', 'toolsAffected']) {
      expect(readerText.includes(gone), gone).toBe(false)
    }
  })
})
