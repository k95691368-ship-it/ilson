import { describe, it, expect } from 'vitest'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// 서버 코드를 한 번은 돌려 본다.
//
// 이 저장소에는 856개 시험이 있었는데 **전부 shared/의 순수 함수만 봤다.**
// functions/ 아래 코드는 단 한 줄도 실행되지 않았다. 그래서 이런 것이
// 그대로 배포됐다 —
//
//   const waitingToStart = items.filter(...)   // items 는 이 아래에서 선언
//
// 선언 전에 쓴 변수 하나로 /api/overview 가 통째로 503이 됐고, **첫 화면이
// 안 열렸다.** 시험도 린트도 빌드도 전부 통과했다. 문법이 틀린 것이 아니라
// 실행해야만 드러나는 것이라 읽어서는 못 잡는다.
//
// 그래서 여기서 돌린다. D1을 흉내 낸 껍데기를 주고 각 GET 핸들러를 한 번씩
// 부른다. 데이터가 없으니 대부분 "없습니다"를 돌려줄 텐데, 그건 상관없다.
// 잡으려는 것은 답의 내용이 아니라 **실행하다 터지는 것**이다.

const ROOT = fileURLToPath(new URL('..', import.meta.url))

// 실행해 봐야만 나오는 오류들. 이 문구가 응답에 섞여 있으면 터진 것이다.
const RUNTIME_ERROR = [
  'before initialization',
  'is not a function',
  'is not defined',
  'Cannot read properties',
  'Cannot convert undefined',
  'undefined is not',
  'null is not',
  'Assignment to constant',
]

// D1 흉내. 아무것도 없는 데이터베이스처럼 군다.
//
// 값을 지어내지 않는다. 빈 표에서 잘 도는지를 보는 것이라, 오히려 여기서
// 값을 넣으면 "값이 없을 때" 경로가 안 밟힌다 — 실제 사고는 대개 그쪽에서
// 난다.
function fakeDB() {
  const stmt = {
    bind: () => stmt,
    first: async () => null,
    all: async () => ({ results: [] }),
    run: async () => ({ meta: {} }),
  }
  return {
    prepare: () => stmt,
    batch: async (list) => (list ?? []).map(() => ({ meta: {} })),
    exec: async () => ({}),
  }
}

function apiFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) apiFiles(p, out)
    else if (name.endsWith('.js')) out.push(p)
  }
  return out
}

describe('서버 라우트를 한 번씩 돌려 본다', () => {
  const files = apiFiles(join(ROOT, 'functions', 'api'))

  it('라우트를 찾아 낸다', () => {
    // 이 시험이 헛돌지 않는지 먼저 본다. 경로가 어긋나 파일을 하나도 못
    // 읽으면 아래는 전부 통과하지만 아무것도 안 본 것이 된다.
    expect(files.length).toBeGreaterThan(20)
  })

  it('GET 라우트가 빈 데이터베이스에서 터지지 않는다', async () => {
    const problems = []

    for (const file of files) {
      const rel = file.slice(ROOT.length).replace(/\\/g, '/')
      let mod
      try {
        mod = await import(pathToFileURL(file).href)
      } catch (err) {
        problems.push(`${rel} — 파일을 읽지도 못했습니다: ${err.message}`)
        continue
      }
      if (typeof mod.onRequestGet !== 'function') continue

      // 경로 조각은 아무 값이나 준다. 없는 접수번호로 읽히면 404가 나올
      // 텐데 그것도 정상 동작이다.
      const ctx = {
        env: { DB: fakeDB() },
        params: { ticket: 'AX-XXX-000', id: 'app_x', slug: 'demo', dept: '재무' },
        request: new Request('https://example.test/api/x'),
      }

      let res
      try {
        res = await mod.onRequestGet(ctx)
      } catch (err) {
        // 핸들러가 스스로 못 잡은 예외. 이건 500이 되어 화면이 안 열린다.
        problems.push(`${rel} — 예외가 새어 나왔습니다: ${err.message}`)
        continue
      }

      if (!(res instanceof Response)) {
        problems.push(`${rel} — Response를 안 돌려줬습니다`)
        continue
      }

      const body = await res.text()
      const hit = RUNTIME_ERROR.find((sig) => body.includes(sig))
      if (hit) {
        // try/catch에 잡혀 503으로 나오는 경우. 화면에서는 그냥 안 열린다.
        problems.push(`${rel} — 실행하다 터졌습니다: ${body.slice(0, 160)}`)
      }
    }

    expect(problems).toEqual([])
    // 라우트 마흔 개를 하나씩 불러온다. 혼자 돌면 2초쯤인데 전체 시험과
    // 같이 돌면 5초 기본값을 넘긴다 — 느린 것이 아니라 붐비는 것이라
    // 제한만 늘린다.
  }, 60000)

  it('그 검사가 헛돌지 않는다', async () => {
    // 일부러 터지는 핸들러를 만들어 잡히는지 본다. 안 잡히면 위 검사는
    // 아무것도 안 보면서 통과하고 있는 것이다.
    const broken = async () => {
      const n = later.length // eslint-disable-line no-use-before-define
      const later = [1]
      return new Response(String(n))
    }
    let caught = null
    try {
      await broken()
    } catch (err) {
      caught = err.message
    }
    expect(caught).toContain('before initialization')
    expect(RUNTIME_ERROR.some((s) => caught.includes(s))).toBe(true)
  })
})
