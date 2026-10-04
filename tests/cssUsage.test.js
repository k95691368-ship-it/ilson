import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'

// 화면에서 사라진 기능의 스타일이 전역 CSS 에 남아 모든 방문자가 받지 않게 한다.
// 이름의 문자열 참조와 알려진 동적 접두사를 보는 후보 탐지 휴리스틱이다.
// 주석도 참조로 세고 동적 접두사는 면제하므로 실제 DOM 사용이나 삭제 안전성을
// 보증하지 않는다. 후보를 삭제하기 전 동적 생성 경로와 실제 화면을 따로 확인한다.
const ROOT = process.cwd()
const walk = (dir) => readdirSync(dir, { withFileTypes: true })
  .flatMap((entry) => entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)])

// 코드가 `접두사-${값}`으로 조립하거나 서버 값이 그대로 클래스가 되는 이름들.
const DYNAMIC = [/^action-/, /^toast-/, /^tone-/, /^signoff-/, /^waitline-/, /^unclear-/, /^thread-/, /^badge-/, /^healthy$/]

it('정적 소스 참조나 알려진 동적 접두사가 없는 CSS 클래스 후보가 없다', () => {
  const files = [...walk(join(ROOT, 'src')), ...walk(join(ROOT, 'shared'))]
  const code = [
    ...files.filter((file) => /\.(jsx?|tsx?|mjs)$/.test(file)),
    join(ROOT, 'index.html'), join(ROOT, 'public', 'bootstrap.js'),
  ].map((file) => readFileSync(file, 'utf8')).join('\n')
  const words = new Set(code.match(/[A-Za-z0-9_-]+/g))
  const unused = files.filter((file) => file.endsWith('.css')).flatMap((file) => {
    const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/url\([^)]*\)/g, '')
    const classes = new Set([...css.matchAll(/\.([A-Za-z_][A-Za-z0-9_-]*)/g)].map((match) => match[1]))
    return [...classes].filter((name) => !words.has(name) && !DYNAMIC.some((pattern) => pattern.test(name)))
  })
  expect(unused).toEqual([])
})
