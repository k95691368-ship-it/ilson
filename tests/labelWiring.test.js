import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

// 라벨과 입력칸이 연결돼 있지 않았다.
//
// <label> 이 글자만 감싸고 입력칸은 그 옆에 형제로 있었다. htmlFor 도 id 도
// 없다. 그러면 화면 낭독기에서 이름 없는 칸이 되고, 라벨을 눌러도 입력칸에
// 초점이 안 간다. 이 사이트는 부서 담당자에게 긴 글을 적어 달라고 하는
// 화면이 여럿이라, 그 자리에서 걸리면 아예 안 적는다.
//
// 바깥을 label 로 바꿔 입력칸을 품게 했다(암묵적 연결). 버튼 묶음은 감싸지
// 않는다 — 라벨은 컨트롤 하나에만 붙고, 감싸면 아무 데나 눌러도 첫 버튼이
// 눌린다. 그쪽은 role="group" 과 이름을 준다.

const files = []
const walk = (d) => {
  for (const n of readdirSync(d)) {
    const p = join(d, n)
    if (statSync(p).isDirectory()) walk(p)
    else if (p.endsWith('.jsx')) files.push(p)
  }
}
walk(join(ROOT, 'src'))

const rel = (f) => f.slice(ROOT.length).split('\\').join('/')
const read = (f) =>
  readFileSync(f, 'utf8')
    .split('\n')
    .map((l) => l.replace(/\r$/, ''))

describe('라벨이 입력칸과 연결돼 있다', () => {
  it('입력칸을 품은 field 는 label 이다', () => {
    // div.field 안에 입력칸이 하나 있으면 그 라벨은 아무것도 안 가리킨다.
    const orphans = []
    for (const f of files) {
      const lines = read(f)
      for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(/^(\s*)<div className="field"(?: style=\{\{[^}]*\}\})?>$/)
        if (!m) continue
        const close = `${m[1]}</div>`
        let j = i + 1
        while (j < lines.length && lines[j] !== close) j++
        const block = lines.slice(i, j + 1).join('\n')
        const controls = (block.match(/<(input|select|textarea)\b/g) ?? []).length
        // 버튼 묶음은 감싸면 안 되므로 세지 않는다.
        if (controls === 1) orphans.push(`${rel(f)}:${i + 1}`)
      }
    }
    expect(orphans).toEqual([])
  })

  it('라벨 안에 라벨을 넣지 않는다', () => {
    // 감싸면서 안쪽 글자를 span 으로 안 내리면 라벨이 겹친다. 겹친 라벨은
    // 브라우저가 임의로 하나를 버린다.
    const nested = []
    for (const f of files) {
      let depth = 0
      read(f).forEach((line, i) => {
        // 주석 줄에 <label> 이라고 적어 둔 것이 있어서 코드 줄만 본다.
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return
        const opens = (line.match(/<label\b/g) ?? []).length
        const closes = (line.match(/<\/label>/g) ?? []).length
        if (opens > 0 && depth > 0) nested.push(`${rel(f)}:${i + 1}`)
        depth = Math.max(0, depth + opens - closes)
      })
    }
    expect(nested).toEqual([])
  })

  it('버튼 묶음에는 묶음 이름을 준다', () => {
    // 라벨로 감쌀 수 없는 자리다. 그렇다고 이름을 안 주면 낭독기에서는
    // 이름 없는 버튼 다섯 개가 된다.
    const groups = ['verdict-row', 'score-row']
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      for (const g of groups) {
        const re = new RegExp(`className="${g}"([^>]*)>`, 'g')
        for (const m of src.matchAll(re)) {
          expect(m[1], `${rel(f)} 의 ${g}`).toMatch(/role="group"/)
          expect(m[1], `${rel(f)} 의 ${g}`).toMatch(/aria-label/)
        }
      }
    }
  })

  it('이 검사가 헛돌지 않는다', () => {
    // 실제로 label.field 가 있어야 한다. 없으면 위 검사들이 공회전이다.
    const wrapped = files.filter((f) => readFileSync(f, 'utf8').includes('<label className="field'))
    expect(wrapped.length).toBeGreaterThan(5)
  })
})
