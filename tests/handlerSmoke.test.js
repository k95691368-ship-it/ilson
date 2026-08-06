import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
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

// 줄이 **있는** 것처럼 구는 D1.
//
// 빈 데이터베이스만 주면 대부분의 라우트가 "그런 것이 없습니다"로 일찍
// 되돌아간다. 그러면 정작 일하는 코드는 한 줄도 안 밟힌다. 어느 컬럼을
// 물어도 그럴듯한 값을 내주는 줄을 하나 쥐여 주고 끝까지 가게 한다.
const ANY_ROW = new Proxy(
  {},
  {
    get(_, k) {
      if (typeof k !== 'string') return undefined
      // await 가 이 객체를 thenable 로 오해하면 영원히 안 끝난다.
      if (k === 'then' || k === 'toJSON') return undefined
      if (k === 'results') return []
      if (/_at$|^created|^updated|^decided|^published|^handed/.test(k)) return '2026-08-01 00:00:00'
      if (/^n$|count|score|minutes|seconds|people|krw|hours|days|seq|rank|total|size|bytes|ms$/i.test(k)) return 1
      if (k === 'id' || k.endsWith('_id')) return 'app_x'
      if (k === 'status' || k === 'verdict') return '수용'
      if (k === 'ticket_no') return 'AX-XXX-000'
      return '값'
    },
    has: () => true,
  }
)

function fakeDBWithRows() {
  const stmt = {
    bind: () => stmt,
    first: async () => ANY_ROW,
    all: async () => ({ results: [ANY_ROW] }),
    run: async () => ({ meta: {} }),
  }
  return {
    prepare: () => stmt,
    batch: async (list) => (list ?? []).map(() => ({ meta: {} })),
    exec: async () => ({}),
  }
}

// R2 흉내. 원본 파일 보관함이다.
//
// 이걸 안 주면 파일 내려받기 라우트가 `env.SOURCES.get`에서 터지는데,
// 그건 코드가 틀린 것이 아니라 껍데기가 모자란 것이다. 실제로 한 번
// 그렇게 잘못 짚었다.
function fakeR2() {
  const object = {
    body: null,
    arrayBuffer: async () => new ArrayBuffer(0),
    httpMetadata: {},
    size: 0,
  }
  return {
    get: async () => object,
    // 배포 상태 화면(/api/health)이 R2를 head로 두드린다. 이게 없으면
    // "env.SOURCES.head is not a function"이 나오는데, 그건 코드가 틀린
    // 것이 아니라 껍데기가 모자란 것이다.
    head: async () => object,
    list: async () => ({ objects: [], truncated: false }),
    put: async () => ({}),
    delete: async () => ({}),
  }
}

function fakeEnv(withRows = false) {
  return { DB: withRows ? fakeDBWithRows() : fakeDB(), SOURCES: fakeR2() }
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

  it('GET 라우트가 빈 데이터베이스에서도, 줄이 있을 때도 터지지 않는다', async () => {
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
      // 빈 데이터베이스 한 번, 줄이 있는 데이터베이스 한 번.
      // 빈 것만 보면 "없습니다"로 되돌아가는 길만 밟힌다.
      for (const [label, withRows] of [['빈 표', false], ['줄이 있을 때', true]]) {
        const ctx = {
          env: fakeEnv(withRows),
          params: { ticket: 'AX-XXX-000', id: 'app_x', slug: 'demo', dept: '재무' },
          request: new Request('https://example.test/api/x'),
        }

        let res
        try {
          res = await mod.onRequestGet(ctx)
        } catch (err) {
          // 핸들러가 스스로 못 잡은 예외. 이건 500이 되어 화면이 안 열린다.
          problems.push(`${rel} (${label}) — 예외가 새어 나왔습니다: ${err.message}`)
          continue
        }

        if (!(res instanceof Response)) {
          problems.push(`${rel} (${label}) — Response를 안 돌려줬습니다`)
          continue
        }

        const body = await res.text()
        const hit = RUNTIME_ERROR.find((sig) => body.includes(sig))
        if (hit) {
          // try/catch에 잡혀 503으로 나오는 경우. 화면에서는 그냥 안 열린다.
          problems.push(`${rel} (${label}) — 실행하다 터졌습니다: ${body.slice(0, 160)}`)
        }
      }
    }

    expect(problems).toEqual([])
    // 라우트 마흔 개를 하나씩 불러온다. 혼자 돌면 2초쯤인데 전체 시험과
    // 같이 돌면 5초 기본값을 넘긴다 — 느린 것이 아니라 붐비는 것이라
    // 제한만 늘린다.
  }, 60000)

  // POST는 GET보다 잡기 어렵다. 대개 입력 검증에서 먼저 되돌아가기 때문에
  // 그 뒤 코드는 안 밟힌다. 그래서 두 번 부른다 — 빈 몸으로 한 번(검증
  // 앞쪽과 되돌아가는 길), 그럴듯한 값으로 한 번(검증을 지나가는 길).
  //
  // 값의 이름은 이 저장소에서 실제로 쓰는 것들을 모아 뒀다. 전부 맞을 리는
  // 없고 그럴 필요도 없다. 한 칸이라도 더 들어가면 그만큼 더 밟힌다.
  const PLAUSIBLE = {
    by: '김대리',
    why: '이것을 먼저 하는 것이 맞다고 판단했습니다',
    body: '광고비 칸이 비어서 옵니다',
    reason: '광고비 칸이 비어서 옵니다',
    kind: '막힌곳',
    agree: true,
    felt: 40,
    comment: '월말에만 오래 걸립니다',
    dept: '재무',
    application_id: 'app_x',
    verdict: '수용',
    impact_score: 3,
    difficulty_score: 3,
    impact_reason: '매주 반복되고 여러 부서가 결과를 씁니다',
    difficulty_reason: '원천이 한 곳이고 규칙으로 풀립니다',
    verdict_reason: '범위 안이고 재료가 다 있습니다',
    alternatives_considered: '사람이 계속 하는 안을 견줬습니다',
    title: '매주 정산서를 손으로 붙입니다',
    minutes: 90,
    people: 1,
    frequency: '주 1회',
    text: '적어 주신 내용을 확인했습니다',
    answer: '그 칸은 채널에서 안 내려옵니다',
    ids: [],
    verdicts: {},
    reasons: {},
    criterionIds: [],
  }

  it('POST 라우트가 빈 몸과 그럴듯한 몸에서 터지지 않는다', async () => {
    const problems = []

    for (const file of files) {
      const rel = file.slice(ROOT.length).replace(/\\/g, '/')
      let mod
      try {
        mod = await import(pathToFileURL(file).href)
      } catch {
        continue // 위 검사가 이미 짚었다.
      }
      if (typeof mod.onRequestPost !== 'function') continue

      for (const [label, payload, withRows] of [
        ['빈 몸', {}, false],
        ['그럴듯한 몸', PLAUSIBLE, false],
        ['그럴듯한 몸 + 줄이 있을 때', PLAUSIBLE, true],
      ]) {
        const ctx = {
          env: fakeEnv(withRows),
          params: { ticket: 'AX-XXX-000', id: 'app_x', slug: 'demo', dept: '재무' },
          request: new Request('https://example.test/api/x', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          }),
        }

        let res
        try {
          res = await mod.onRequestPost(ctx)
        } catch (err) {
          problems.push(`${rel} (${label}) — 예외가 새어 나왔습니다: ${err.message}`)
          continue
        }
        if (!(res instanceof Response)) {
          problems.push(`${rel} (${label}) — Response를 안 돌려줬습니다`)
          continue
        }
        const text = await res.text()
        const hit = RUNTIME_ERROR.find((sig) => text.includes(sig))
        if (hit) problems.push(`${rel} (${label}) — 실행하다 터졌습니다: ${text.slice(0, 160)}`)
      }
    }

    expect(problems).toEqual([])
  }, 60000)

  // 지우는 라우트는 이 저장소에서 가장 파괴적인 자리인데 가장 안 밟힌다.
  //
  // GET·POST만 돌려 보고 있었다. 지우기가 실행 중에 터지면 누가 "지우기"를
  // 실제로 눌러 봐야만 안다 — 그리고 그때는 이미 반쯤 지워져 있을 수도 있다.
  // 이 저장소의 지우기는 여러 표를 한 묶음으로 건드리기 때문이다.
  it('지우는 라우트가 터지지 않는다', async () => {
    const problems = []

    for (const file of files) {
      const rel = file.slice(ROOT.length).split('\\').join('/')
      let mod
      try {
        mod = await import(pathToFileURL(file).href)
      } catch {
        continue
      }
      if (typeof mod.onRequestDelete !== 'function') continue

      for (const [label, withRows] of [['빈 표', false], ['줄이 있을 때', true]]) {
        const ctx = {
          env: fakeEnv(withRows),
          params: { ticket: 'AX-XXX-000', id: 'app_x', slug: 'demo', dept: '재무' },
          request: new Request('https://example.test/api/x', { method: 'DELETE' }),
        }

        let res
        try {
          res = await mod.onRequestDelete(ctx)
        } catch (err) {
          problems.push(`${rel} (${label}) — 예외가 새어 나왔습니다: ${err.message}`)
          continue
        }
        if (!(res instanceof Response)) {
          problems.push(`${rel} (${label}) — Response를 안 돌려줬습니다`)
          continue
        }
        const text = await res.text()
        const hit = RUNTIME_ERROR.find((sig) => text.includes(sig))
        if (hit) problems.push(`${rel} (${label}) — 실행하다 터졌습니다: ${text.slice(0, 160)}`)
      }
    }

    expect(problems).toEqual([])
  }, 60000)

  // 고치는 라우트(PATCH·PUT)도 돌려 본다.
  //
  // GET만 보다가 POST를 더했고, 그때 DELETE를 빠뜨렸다. DELETE를 더하면서
  // "세어 두지 않으면 또 빠진다"고 적어 놓고 **바로 그다음 회차에 PATCH를
  // 빠뜨렸다.** 협의안의 요구 기각이 PATCH인데, 거기 검증을 새로 넣고도
  // 검사가 그 라우트를 한 번도 안 불러 봤다.
  it('고치는 라우트가 터지지 않는다', async () => {
    const problems = []

    for (const file of files) {
      const rel = file.slice(ROOT.length).split('\\').join('/')
      let mod
      try {
        mod = await import(pathToFileURL(file).href)
      } catch {
        continue
      }

      for (const method of ['PATCH', 'PUT']) {
        const fn = method === 'PATCH' ? mod.onRequestPatch : mod.onRequestPut
        if (typeof fn !== 'function') continue

        for (const [label, payload, withRows] of [
          ['빈 몸', {}, false],
          ['그럴듯한 몸', PLAUSIBLE, false],
          ['그럴듯한 몸 + 줄이 있을 때', PLAUSIBLE, true],
        ]) {
          const ctx = {
            env: fakeEnv(withRows),
            params: { ticket: 'AX-XXX-000', id: 'app_x', slug: 'demo', dept: '재무' },
            request: new Request('https://example.test/api/x', {
              method,
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(payload),
            }),
          }

          let res
          try {
            res = await fn(ctx)
          } catch (err) {
            problems.push(`${rel} ${method} (${label}) — 예외가 새어 나왔습니다: ${err.message}`)
            continue
          }
          if (!(res instanceof Response)) {
            problems.push(`${rel} ${method} (${label}) — Response를 안 돌려줬습니다`)
            continue
          }
          const text = await res.text()
          const hit = RUNTIME_ERROR.find((sig) => text.includes(sig))
          if (hit) problems.push(`${rel} ${method} (${label}) — 실행하다 터졌습니다: ${text.slice(0, 160)}`)
        }
      }
    }

    expect(problems).toEqual([])
  }, 60000)

  it('내보내는 방식을 하나도 안 빠뜨렸다', () => {
    // 무엇을 보고 있는지 세어 두지 않으면 또 빠진다. 실제로 두 번 빠뜨렸다.
    //
    // 라우트 파일이 내보내는 onRequest* 를 전부 모아, 이 검사가 아는
    // 목록에 없는 것이 있으면 여기서 깨진다. 새 방식을 쓰기 시작하면
    // 그날 바로 알게 된다.
    const known = new Set(['onRequestGet', 'onRequestPost', 'onRequestDelete', 'onRequestPatch', 'onRequestPut'])
    const unseen = new Set()
    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      for (const m of src.matchAll(/export async function (onRequest\w*)/g)) {
        if (!known.has(m[1])) unseen.add(m[1])
      }
    }
    expect([...unseen]).toEqual([])
    expect(files.length).toBeGreaterThan(20)
  })

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
