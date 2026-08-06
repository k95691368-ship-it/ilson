import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// 첫 화면 할 일 목록이 읽는 값을 서버가 진짜 주는가.
//
// `shared/todo.js` 는 각 화면이 이미 세어 둔 숫자를 받아 쓴다. 여기서 다시
// 세지 않는다 — 두 군데서 세면 두 숫자가 달라지고 그러면 둘 다 못 믿는다.
//
// 그런데 그 "받아 쓰는" 자리가 전부 이렇게 생겼다:
//
//     const idle = tools?.summary?.idle ?? 0
//
// 서버가 `idle` 을 안 주거나 이름을 바꾸면 **조용히 0이 된다.** 오류도 안
// 나고 화면도 안 깨진다. 그 할 일이 영영 안 뜰 뿐이다. 담당자는 목록이
// 짧으니 할 일이 없는 줄 안다.
//
// 이 저장소에서 가장 조용히 망가지는 자리가 정확히 이런 곳이다. 그래서
// 손으로 확인하지 않고 여기서 본다 — 라우트를 실제로 돌려 응답을 받아,
// todo.js 가 읽는 이름이 그 안에 있는지 맞춰 본다.

const ROOT = fileURLToPath(new URL('..', import.meta.url))

// todo.js 가 받는 이름 → 그 값을 만드는 라우트 파일.
const SOURCES = {
  overview: 'functions/api/overview.js',
  reports: 'functions/api/reports.js',
  codes: 'functions/api/codes.js',
  tools: 'functions/api/tools/index.js',
  stalls: 'functions/api/stalls.js',
  joins: 'functions/api/joins.js',
  signoffs: 'functions/api/signoffs.js',
}

// 줄이 있는 것처럼 구는 D1. 빈 표만 주면 라우트가 일찍 되돌아가서 요약
// 자체를 안 만든다.
const ANY_ROW = new Proxy(
  {},
  {
    get(_, k) {
      if (typeof k !== 'string') return undefined
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

function fakeEnv() {
  const stmt = {
    bind: () => stmt,
    first: async () => ANY_ROW,
    all: async () => ({ results: [ANY_ROW] }),
    run: async () => ({ meta: {} }),
  }
  return {
    DB: {
      prepare: () => stmt,
      batch: async (l) => (l ?? []).map(() => ({ meta: {} })),
      exec: async () => ({}),
    },
    SOURCES: {
      get: async () => null,
      head: async () => null,
      list: async () => ({ objects: [], truncated: false }),
    },
  }
}

// todo.js 에서 `이름?.a?.b` 꼴을 전부 뽑는다.
function readsOf(src) {
  const out = []
  const re = /\b(overview|reports|codes|tools|stalls|joins|signoffs)\?\.([\w?.]+)/g
  let m
  while ((m = re.exec(src))) {
    const path = m[2]
      .split('?.')
      .join('.')
      .split('.')
      .filter(Boolean)
    out.push({ source: m[1], path })
  }
  return out
}

function dig(obj, path) {
  let cur = obj
  for (const key of path) {
    if (cur == null || typeof cur !== 'object' || !(key in cur)) return { found: false }
    cur = cur[key]
  }
  return { found: true, value: cur }
}

describe('첫 화면 할 일이 읽는 값을 서버가 진짜 주는가', () => {
  const src = readFileSync(join(ROOT, 'shared', 'todo.js'), 'utf8')
  const reads = readsOf(src)

  it('읽는 자리를 실제로 찾아 낸다', () => {
    // 정규식이 어긋나면 아래 검사는 통과하지만 아무것도 안 본 것이 된다.
    expect(reads.length).toBeGreaterThan(12)
    expect(reads.some((r) => r.source === 'tools')).toBe(true)
    expect(reads.some((r) => r.source === 'overview')).toBe(true)
  })

  it('읽는 이름이 전부 응답에 있다', async () => {
    const responses = {}
    for (const [name, file] of Object.entries(SOURCES)) {
      const mod = await import(pathToFileURL(join(ROOT, file)).href)
      const res = await mod.onRequestGet({
        env: fakeEnv(),
        params: {},
        request: new Request('https://example.test/api/x'),
      })
      responses[name] = await res.json()
    }

    const missing = []
    for (const { source, path } of reads) {
      const body = responses[source]
      if (!body || body.error) {
        missing.push(`${source} 라우트가 응답을 못 만들었습니다`)
        continue
      }
      if (!dig(body, path).found) {
        // 이게 있으면 그 할 일은 영영 안 뜬다. 오류도 안 나고 화면도 안
        // 깨진다 — 목록이 짧아서 할 일이 없는 줄 알게 될 뿐이다.
        missing.push(`${source}.${path.join('.')} 를 읽는데 응답에 없습니다`)
      }
    }

    expect([...new Set(missing)]).toEqual([])
  }, 60000)
})
