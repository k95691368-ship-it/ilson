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

describe('글꼴이 첫 그림을 막지 않는가', () => {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8')

  it('스타일시트로 곧장 걸어 두지 않는다', () => {
    // 그냥 걸면 남의 도메인에서 그 파일이 올 때까지 아무것도 안 그린다.
    // preload 로 받아 두었다가 다 받은 뒤에 바꿔 단다.
    expect(html).toMatch(/rel="preload"\s+as="style"/)
    expect(html).toContain("this.rel='stylesheet'")
  })

  it('자바스크립트를 끈 브라우저에도 글꼴이 간다', () => {
    expect(html).toContain('<noscript>')
  })

  it('글꼴이 안 와도 한글이 깨지지 않는다', () => {
    // 바꿔 다는 방식은 대체 글꼴로 먼저 그린다는 뜻이다. 그 대체가 없으면
    // 첫 그림이 엉뚱한 글꼴이 된다.
    const css = readFileSync(join(ROOT, 'src', 'index.css'), 'utf8')
    const stack = css.match(/--sans:([^;]+);/)?.[1] ?? ''
    expect(stack).toContain('system-ui')
    expect(stack).toContain('sans-serif')
  })
})

describe('서버를 놀리지 않는가', () => {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8')
  const client = readFileSync(join(ROOT, 'src', 'api', 'client.js'), 'utf8')

  it('첫 화면이 부를 것을 미리 띄운다', () => {
    expect(html).toContain('__boot')
    expect(html).toContain('/overview')
  })

  it('미리 띄운 것이 실패해도 거절을 남기지 않는다', () => {
    // 아무도 안 받는 거절은 콘솔에 오류로 찍힌다. null 로 받아 넘긴다.
    expect(html).toMatch(/catch\(\(\) => null\)/)
  })

  it('미리 받은 답을 두 번 쓰지 않는다', () => {
    // 다시 부르는 것은 값이 바뀌었을까 봐 부르는 것이다. 옛 답을 또 주면
    // 새로고침이 안 되는 화면이 된다.
    expect(client).toContain('delete booted[path]')
  })

  it('무언가 바꾸는 요청에는 안 쓴다', () => {
    // 미리 띄워 두는 것이라 GET 이 아니면 안 된다.
    expect(client).toMatch(/options\.method && options\.method !== 'GET'/)
  })

  it('미리 띄운 것이 없으면 그냥 부른다', () => {
    expect(client).toMatch(/await fetch\(`\$\{BASE\}\$\{path\}`, options\)/)
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

describe('서버가 브라우저 몫까지 지고 뜨지 않는가', () => {
  // Workers 는 잠들었다 깰 때마다 실려 있는 코드를 다시 편다. 그래서 서버
  // 묶음에 무엇이 들어가 있는지가 첫 요청 시간에 그대로 붙는다.
  //
  // 실제로 그랬다. 베타 회차를 저장하는 라우트가 세는 함수 하나(tally, 1.4KB)를
  // 쓰려고 grade.js 를 가져왔는데, grade.js 는 맨 위에서 pipeline.js 를 끌고
  // 오고 그 pipeline 은 다시 xlsx.js·csv.js·master.js 를 끌고 온다. 파일을
  // 합치는 일은 전부 브라우저에서 도는데도 서버가 그 엔진을 통째로 안고
  // 시작하고 있었다.
  const serverFiles = []
  const walkServer = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (e.isDirectory()) walkServer(p)
      else if (p.endsWith('.js')) serverFiles.push(p)
    }
  }
  walkServer(join(ROOT, 'functions'))
  const serverSrc = serverFiles.map((f) => readFileSync(f, 'utf8')).join('\n')

  it('파일 합치는 엔진을 서버가 안 가져온다', () => {
    for (const mod of ['pipeline.js', 'xlsx.js', 'csv.js', 'grade.js']) {
      expect(serverSrc.includes(`shared/${mod}'`), `서버가 ${mod} 를 import 한다`).toBe(false)
    }
  })

  it('세는 함수는 따로 떼어 둔 것을 쓴다', () => {
    // 떼어 놓고 안 쓰면 아무 의미가 없다.
    expect(serverSrc).toContain("shared/tally.js'")
    expect(existsSync(join(ROOT, 'shared', 'tally.js'))).toBe(true)
  })

  it('떼어 낸 파일이 아무것도 안 끌고 온다', () => {
    // 여기에 import 가 하나라도 생기면 그 순간 다시 딸려 오기 시작한다.
    const tally = readFileSync(join(ROOT, 'shared', 'tally.js'), 'utf8')
    expect(tally).not.toMatch(/^import /m)
  })
})

describe('서버로 나가는 것이 압축되는가', () => {
  // 여기서 한 번 크게 틀렸다.
  //
  // "주석은 빌드할 때 사라지니 가독성과 실행 속도는 무관하다"고 두 번
  // 말했는데, 브라우저 쪽만 그랬다. Cloudflare Pages 는 functions/ 를
  // 묶기만 하고 **압축하지 않는다.** 재 보니 473KB 짜리 파일에 한글 주석
  // 682줄이 그대로 들어가 배포되고 있었다. Workers 는 잠들었다 깰 때마다
  // 그것을 다시 편다.
  //
  // 압축하면 473KB → 311KB 다. 원본은 그대로 두고 나가는 것만 줄인다.
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))

  it('빌드가 서버 묶음을 압축해서 내놓는다', () => {
    expect(pkg.scripts.build).toContain('pages functions build')
    expect(pkg.scripts.build).toContain('--minify')
    expect(pkg.scripts.build).toContain('_worker.js')
  })

  it('나온 파일에 주석이 한 줄도 없다', () => {
    const worker = join(ROOT, 'dist', '_worker.js')
    if (!existsSync(worker)) return
    const src = readFileSync(worker, 'utf8')
    const lines = src.split(String.fromCharCode(10))
    const comments = lines.filter((l) => l.trim().startsWith('//')).length
    expect(comments, '서버 묶음에 주석이 남았다').toBe(0)
    // 압축되면 줄이 확 준다. 안 되면 만 줄이 넘는다.
    expect(lines.length).toBeLessThan(2000)
  })

  it('캐시 규칙 파일이 빌드 결과에 같이 실린다', () => {
    // _worker.js 를 쓰면 Pages 가 고급 모드로 도는데, 그때 _headers 가
    // 안 실리면 자산 캐시가 조용히 사라진다. 미리보기에 올려 살아 있는
    // 것을 확인했고, 여기서는 파일이 딸려 나오는지를 지킨다.
    const out = join(ROOT, 'dist', '_headers')
    if (!existsSync(join(ROOT, 'dist'))) return
    expect(existsSync(out), 'dist/_headers 가 없다').toBe(true)
  })
})
