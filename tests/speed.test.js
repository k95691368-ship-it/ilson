import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

// 빠르게 만든 것은 조용히 되돌아간다.
//
// 캐시 규칙 파일 하나를 안 올리면 그날부터 모든 방문이 파일마다 왕복을 한 번씩
// 더 한다. 화면은 똑같이 보이고 시험도 다 통과한다. 그래서 여기서 지킨다.

describe('두 번째 방문에 다시 안 받게 해 뒀는가', () => {
  const path = join(ROOT, 'public', '_headers')

  it('규칙 파일이 있다', () => {
    // public/ 에 있어야 빌드 결과 맨 위로 따라간다. 다른 데 두면 안 실린다.
    expect(existsSync(path)).toBe(true)
  })

  const rules = readFileSync(path, 'utf8')

  it('이름에 해시가 박힌 파일은 오래 들고 있게 한다', () => {
    expect(rules).toMatch(/\/assets\/\*/)
    expect(rules).toMatch(/max-age=31536000/)
    expect(rules).toMatch(/immutable/)
  })

  it('문서는 매번 확인하게 둔다', () => {
    // 문서까지 오래 들고 있으면 새로 올려도 옛 화면이 뜬다.
    const doc = rules.split('/index.html')[1] ?? ''
    expect(doc).toMatch(/max-age=0/)
  })

  it('신청서 데이터는 중간에서 들고 있지 못하게 한다', () => {
    // 주소에 접수번호가 들어간다. 사람마다 다른 값이라 남이 들고 있으면 안 된다.
    const api = rules.split('/api/*')[1] ?? ''
    expect(api).toMatch(/no-store/)
  })

  it('파일 이름이 실제로 해시를 달고 나온다', () => {
    // 해시가 없는데 영원히 들고 있으라고 하면, 고쳐 올려도 옛 파일이 남는다.
    // 이 검사가 헛돌지 않게 실제 빌드 결과를 본다.
    const dist = join(ROOT, 'dist', 'assets')
    if (!existsSync(dist)) return
    const js = readdirSync(dist).filter((f) => f.endsWith('.js'))
    expect(js.length).toBeGreaterThan(3)
    for (const f of js) expect(f, f).toMatch(/-[A-Za-z0-9_-]{8,}\.js$/)
  })
})

describe('첫 화면 코드를 기다렸다 받지 않는가', () => {
  const config = readFileSync(join(ROOT, 'vite.config.js'), 'utf8')

  it('빌드가 첫 화면 조각을 미리 받으라고 적어 준다', () => {
    expect(config).toContain('modulepreload')
    expect(config).toContain('FlowPage.jsx')
  })

  it('이름을 손으로 적어 두지 않는다', () => {
    // 파일 이름에는 해시가 박혀 매 빌드마다 달라진다. 손으로 적으면 다음
    // 빌드에서 조용히 없는 파일을 가리킨다.
    expect(config).not.toMatch(/FlowPage-[A-Za-z0-9_-]{6,}\.js/)
    expect(config).toContain('generateBundle')
  })

  it('빌드 결과가 실제로 있는 파일을 가리킨다', () => {
    const html = join(ROOT, 'dist', 'index.html')
    if (!existsSync(html)) return
    const src = readFileSync(html, 'utf8')
    const m = src.match(/rel="modulepreload"[^>]*href="\/([^"]+)"/)
    expect(m, '미리 받으라는 줄이 index.html 에 없다').toBeTruthy()
    expect(existsSync(join(ROOT, 'dist', m[1])), m[1]).toBe(true)
  })
})
