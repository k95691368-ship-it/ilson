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

// 다시 내보내기만 해 놓고 그 이름을 자기 파일에서 쓴 것.
//
// `export { DEPTS } from './x.js'` 는 **다시 내보내기만** 한다. 그 파일 안에는
// DEPTS 라는 이름이 생기지 않는다. 그런데 눈으로 보면 import 처럼 읽힌다.
//
// 실제로 당했다. functions/_lib/applications.js 를 그렇게 고쳤더니 같은 파일
// 75번째 줄의 DEPTS.includes(...) 가 ReferenceError 를 던졌고, 부서가
// 신청서를 내면 그 자리에서 500이 났다. **접수가 통째로 막혔다.**
//
// 빌드는 통과한다 — 화면 코드가 아니라 서버 코드라 번들러가 안 본다.
// 라우트 스모크도 못 잡았다. 그 검사는 JSON 몸을 보내는데 이 라우트는
// multipart 폼을 받아서, 문제의 줄까지 가기 전에 400 으로 돌아갔다.
describe('다시 내보낸 이름을 자기가 쓰고 있지 않은가', () => {
  // 경로 구분자. 문자열 안에 역슬래시를 직접 쓰면 편집 중에 자주 뭉개진다.
  const SEP = sep

  // 줄 주석과 블록 주석을 지운다. 문자열 안의 // 까지 지우지는 않지만,
  // 여기서 찾는 것은 export 문 하나라 그 정도면 충분하다.
  function stripComments(src) {
    return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, '')
  }
  const files = [
    ...jsFiles(join(ROOT, 'functions')),
    ...jsFiles(join(ROOT, 'shared')),
  ]

  it('re-export 한 이름은 그 파일 안에서 안 쓴다', () => {
    const problems = []
    for (const file of files) {
      // 주석을 뺀다. 이 저장소는 왜 그렇게 했는지를 길게 적어 두는데,
      // 거기에 "이렇게 쓰면 안 된다"는 예시가 그대로 들어 있다. 그것까지
      // 코드로 읽으면 고쳐 놓은 파일이 계속 걸린다.
      const src = stripComments(readFileSync(file, 'utf8'))
      const rel = file.slice(ROOT.length).split(SEP).join('/')
      for (const m of src.matchAll(/export\s*\{([^}]+)\}\s*from\s*['"][^'"]+['"]/g)) {
        const names = m[1]
          .split(',')
          .map((s) => s.trim().split(/\s+as\s+/)[0].trim())
          .filter(Boolean)
        // 그 줄을 뺀 나머지에서 이름이 또 나오면 쓰고 있는 것이다.
        const rest = src.slice(0, m.index) + src.slice(m.index + m[0].length)
        for (const name of names) {
          if (new RegExp(`\\b${name}\\b`).test(rest)) {
            problems.push(`${rel} — ${name} 을 다시 내보내기만 해 놓고 같은 파일에서 씁니다`)
          }
        }
      }
    }
    expect(problems).toEqual([])
  })

  it('이 검사가 헛돌지 않는다', () => {
    // 정규식이 어긋나면 아무것도 안 보면서 통과한다. 실제로 났던 그 모양을
    // 그대로 넣어 잡히는지 본다.
    const bad = `export { DEPTS } from '../../shared/depts.js'\nif (!DEPTS.includes(x)) fail()`
    const m = /export\s*\{([^}]+)\}\s*from\s*['"][^'"]+['"]/.exec(bad)
    expect(m).toBeTruthy()
    const rest = bad.slice(0, m.index) + bad.slice(m.index + m[0].length)
    expect(/\bDEPTS\b/.test(rest)).toBe(true)

    // 고친 모양은 안 걸려야 한다.
    const good = `import { DEPTS } from '../../shared/depts.js'\nexport { DEPTS }\nif (!DEPTS.includes(x)) fail()`
    expect(/export\s*\{([^}]+)\}\s*from\s*['"][^'"]+['"]/.test(good)).toBe(false)

    // 주석에 적어 둔 "이렇게 쓰면 안 된다" 예시까지 코드로 읽으면, 고쳐
    // 놓은 파일이 영영 걸린 채로 남는다. 실제로 그랬다.
    const commented = `// \`export { X } from './a.js'\` 로 썼다가 500이 났다\nimport { X } from './a.js'\nexport { X }`
    expect(/export\s*\{([^}]+)\}\s*from\s*['"][^'"]+['"]/.test(commented)).toBe(true)
    expect(/export\s*\{([^}]+)\}\s*from\s*['"][^'"]+['"]/.test(stripComments(commented))).toBe(false)
  })
})
