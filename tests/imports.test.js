import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

// 없는 이름을 가져오는 import를 잡는다.
//
// 실제로 당했다. /compare 를 만들면서 `recordDecision`을 가져왔는데 실제
// 이름은 `logDecision`이었다. 시험도 린트도 빌드도 전부 통과했다 — 화면
// 빌드(vite)는 functions/ 를 쳐다보지 않고, 시험은 그 파일을 부른 적이
// 없었기 때문이다.
//
// 배포는 조용히 그 라우트만 빼고 끝났다. /api/compare 를 부르면 404도
// 500도 아니고 화면 HTML이 돌아왔다. 오류처럼 보이지도 않아서 배포가
// 늦어지는 줄 알고 칠 분을 기다렸다.
//
// 실제로 불러 보는 대신 글자로 맞춰 본다. 서버 파일은 Cloudflare 환경에서
// 도는 것이라 여기서 그냥 부르면 엉뚱한 데서 터진다. 이름이 있나 없나만
// 보면 되고, 그게 실제로 나는 사고의 거의 전부다.

const ROOT = fileURLToPath(new URL('..', import.meta.url))

function jsFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) jsFiles(p, out)
    else if (name.endsWith('.js')) out.push(p)
  }
  return out
}

// 그 파일이 밖으로 내주는 이름 전부.
function exportsOf(src) {
  const names = new Set()
  const decl = /^export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/gm
  for (const m of src.matchAll(decl)) names.add(m[1])
  for (const m of src.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const part of m[1].split(',')) {
      const bits = part.trim().split(/\s+as\s+/)
      const name = (bits[1] ?? bits[0]).trim()
      if (name) names.add(name)
    }
  }
  if (/^export\s+default\b/m.test(src)) names.add('default')
  return names
}

// import { a, b } from './x.js' 에서 가져오는 이름과 경로.
function importsOf(src) {
  const out = []
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    const names = m[1]
      .split(',')
      .map((p) => p.trim().split(/\s+as\s+/)[0].trim())
      .filter(Boolean)
    out.push({ names, from: m[2] })
  }
  return out
}

describe('없는 이름을 가져오는 import가 없는지', () => {
  // 서버 코드와 서버가 쓰는 공용 코드 둘 다 본다. 화면 코드는 빌드가
  // 이미 잡아 주므로 여기서 또 볼 필요가 없다.
  const files = [...jsFiles(join(ROOT, 'functions')), ...jsFiles(join(ROOT, 'shared'))]

  it('볼 파일을 실제로 찾았다', () => {
    // 이 시험이 헛돌지 않는지 먼저 본다. 한 개도 못 찾으면 아래가 전부
    // 통과하지만 아무것도 안 본 것이 된다.
    expect(files.length).toBeGreaterThan(20)
  })

  it('가져오는 이름이 전부 그쪽에 있다', () => {
    const problems = []

    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      const rel = file.slice(ROOT.length).split(sep).join('/')

      for (const imp of importsOf(src)) {
        // 우리 파일만 본다. 남의 꾸러미는 여기서 확인할 것이 없다.
        if (!imp.from.startsWith('.')) continue
        const target = resolve(dirname(file), imp.from)
        if (!existsSync(target)) {
          problems.push(`${rel} — ${imp.from} 파일이 없습니다`)
          continue
        }
        const has = exportsOf(readFileSync(target, 'utf8'))
        for (const name of imp.names) {
          if (!has.has(name)) {
            const where = imp.from.split('/').pop()
            problems.push(`${rel} — ${where} 에 ${name} 이(가) 없습니다`)
          }
        }
      }
    }

    expect(problems).toEqual([])
  })
})
