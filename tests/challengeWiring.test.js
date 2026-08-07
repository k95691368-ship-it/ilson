import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// 살아 있는 반박은 저장되지 않는다.
//
// `outcome_challenge` 표에는 **해소한 것만** 들어간다. 살아 있는 반박은
// 읽을 때 `buildChallenges` 가 규칙으로 만든다. 이 사실을 모르고 그 표를
// 세면 **영원히 0이 나온다.** 오류도 안 나고 화면도 안 깨진다.
//
// 같은 원인이 네 곳에 있었다.
//   /result   — 원래부터 계산해서 씀 (정상)
//   /dept/:d  — 부서별 성과를 만들며 넣은 구멍
//   /record/:id — 인쇄 기록. "이 숫자를 의심해보세요" 칸이 통째로 비었다
//   /honesty  — **자기 한계를 보여주는 화면이 자기 반박을 0건이라고 했다**
//
// 하나를 고칠 때마다 다음 것이 나왔다. 그래서 손으로 찾지 않고 여기서
// 막는다 — `outcome_challenge` 를 읽으면서 `resolved_at IS NULL` 로 거르는
// 코드가 있으면 시험이 깨진다.

const ROOT = fileURLToPath(new URL('..', import.meta.url))

function jsFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) jsFiles(p, out)
    else if (name.endsWith('.js')) out.push(p)
  }
  return out
}

describe('살아 있는 반박을 저장된 표에서 세지 않는가', () => {
  const files = jsFiles(join(ROOT, 'functions'))

  it('볼 파일을 실제로 찾아 낸다', () => {
    expect(files.length).toBeGreaterThan(20)
  })

  it('미해소 반박을 표에서 세는 코드가 없다', () => {
    // 그 표에는 해소한 것만 있으므로, 미해소를 거기서 세면 늘 0이다.
    const problems = []
    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      if (!src.includes('outcome_challenge')) continue
      const rel = file.slice(ROOT.length).split('\\').join('/')

      // 같은 SQL 안에서 outcome_challenge 와 resolved_at IS NULL 이 함께
      // 나오면 미해소를 세고 있는 것이다.
      for (const raw of src.match(/`[^`]*`/g) ?? []) {
        if (!raw.includes('outcome_challenge')) continue
        if (/resolved_at\s+IS\s+NULL/i.test(raw)) {
          problems.push(`${rel} — outcome_challenge 에서 미해소를 세고 있습니다`)
        }
      }
    }
    expect(problems).toEqual([])
  })

  it('반박을 보여주는 라우트는 계산 함수를 쓴다', () => {
    // 표만 읽고 buildChallenges 를 안 부르면, 해소한 것만 보여주게 된다.
    const shows = ['functions/api/honesty.js', 'functions/api/applications/[id]/record.js']
    for (const rel of shows) {
      const src = readFileSync(join(ROOT, rel), 'utf8')
      expect(src.includes('buildChallenges')).toBe(true)
    }
  })

  it('성과 화면과 같은 함수를 쓴다', () => {
    // 네 곳이 각자 다른 셈법을 쓰면 한 사이트가 같은 숫자를 두고 다른
    // 말을 한다. 실제로 그랬다.
    const users = []
    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      if (src.includes('buildChallenges')) {
        users.push(file.slice(ROOT.length).split('\\').join('/'))
      }
    }
    // 성과·부서·인쇄·정직 넷 다 같은 함수를 부른다.
    expect(users.length).toBeGreaterThanOrEqual(4)
  })
})
