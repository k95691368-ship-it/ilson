// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createElement, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { act } from 'react'

// happy-dom 안에서는 import.meta.url 이 file: 이 아니라서 fileURLToPath 가
// 거절한다. 시험은 저장소 뿌리에서 도니 cwd 를 쓴다.
const ROOT = process.cwd()

// 화면을 한 번은 그려 본다.
//
// 이 저장소에는 서버 라우트를 실제로 돌려 보는 층이 있는데(handlerSmoke),
// **화면 쪽에는 그런 층이 없었다.** 그래서 이것이 라이브에 그대로 나갔다 —
//
//   useEffect(() => { ... data?.handedTo?.person ... }, [slug, data, whoRan])
//   const { data, error, loading, reload } = useApi(`/tools/${slug}`)
//
// 의존성 배열은 **렌더 도중에** 평가된다. 그 시점에 data 는 아직 선언 전이라
// ReferenceError 가 나고 /t/:slug 화면 전체가 안 열렸다. 부서가 이 사이트에서
// 받는 주소가 딱 그것 하나인데.
//
// 린트도 시험도 빌드도 전부 통과했다. oxlint 는 이 형태를 안 잡고(직접
// 확인했다), 나머지 시험은 순수 함수와 서버 라우트만 본다. 읽어서는 안
// 잡히고 그려 봐야만 잡힌다.
//
// 그래서 여기서 그린다. 서버는 흉내만 내므로 대부분의 화면은 "불러오는 중"
// 이나 빈 상태에서 멈출 텐데, 그건 상관없다. 잡으려는 것은 그림의 내용이
// 아니라 **그리다가 터지는 것**이다.

const PAGES = readdirSync(join(ROOT, 'src', 'pages')).filter((f) => f.endsWith('.jsx'))

// 데이터 모양과 **무관하게** 나는 오류만 결함으로 센다.
//
// 아래 가짜 서버는 어느 주소에나 빈 {} 를 준다. 그래서 화면이 자기 응답
// 모양을 믿고 쓰는 자리에서는 "Cannot read properties of undefined" 가 늘
// 난다 — 실제 서버는 늘 모양을 갖춰 주므로 그건 결함이 아니다. 그것까지
// 결함으로 세면 이 시험은 첫날부터 빨간 불이고, 빨간 불을 안 믿게 되는
// 것이 진짜 손해다.
//
// 반대로 아래 문구들은 데이터가 무엇이든 난다. 선언 전 참조, 없는 이름,
// 훅 순서가 바뀌는 것 — 전부 읽어서는 안 잡히고 그려 봐야 잡히는 것들이다.
const FATAL =
  /before initialization|is not defined|is not a function|Assignment to constant|Rendered more hooks|Rendered fewer hooks|change in the order of Hooks|Invalid hook call/i

// 화면을 실제 앱과 같은 껍데기 안에서 그린다. src/main.jsx 가 씌우는 것과
// 같은 순서다 — 껍데기가 다르면 여기서만 나는 오류를 쫓게 된다.
const { ThemeProvider } = await import(pathToFileURL(join(ROOT, 'src/context/ThemeContext.jsx')).href)
const { ToastProvider } = await import(pathToFileURL(join(ROOT, 'src/context/ToastContext.jsx')).href)

function wrap(node) {
  return createElement(
    StrictMode,
    null,
    createElement(
      ThemeProvider,
      null,
      createElement(
        ToastProvider,
        null,
        createElement(MemoryRouter, { initialEntries: ['/'] }, node)
      )
    )
  )
}

// 어떤 주소든 그럴듯한 빈 응답을 주는 fetch. 값을 지어내지 않는다 —
// 빈 상태 경로가 오히려 사고가 잦은 쪽이라 그쪽을 밟게 둔다.
function fakeFetch() {
  return vi.fn(async () =>
    new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } })
  )
}

let errors = []
let container = null
let restore = []

beforeEach(() => {
  errors = []
  globalThis.fetch = fakeFetch()
  container = document.createElement('div')
  document.body.appendChild(container)
  // 리액트는 렌더 중 오류를 console.error 로도 흘린다. 삼키지 않고 모은다.
  const origError = console.error
  console.error = (...a) => {
    errors.push(a.map(String).join(' '))
  }
  restore = [() => { console.error = origError }]
})

afterEach(() => {
  for (const f of restore) f()
  container?.remove()
  container = null
})

describe('모든 화면이 한 번은 그려진다', () => {
  for (const file of PAGES) {
    it(`${file} 이 터지지 않는다`, async () => {
      const mod = await import(pathToFileURL(join(ROOT, 'src', 'pages', file)).href)
      const Page = mod.default
      expect(typeof Page, `${file} 에 기본 내보내기가 없다`).toBe('function')

      const root = createRoot(container)
      let thrown = null
      try {
        await act(async () => {
          root.render(wrap(createElement(Page)))
        })
        // 효과가 한 바퀴 더 도는 것까지 본다.
        await act(async () => {})
      } catch (err) {
        thrown = err
      }

      try {
        root.unmount()
      } catch {
        // 이미 터진 뒤라 정리가 안 될 수 있다. 여기서 또 터뜨리면 원인이 가린다.
      }

      if (thrown && FATAL.test(thrown.message)) {
        throw new Error(`${file}: ${thrown.message}`)
      }

      // 실행해야만 나오는 오류들. 문구가 섞여 있으면 터진 것이다.
      const fatal = errors.filter((e) => FATAL.test(e))
      expect(fatal, `${file} 에서 그리다 터졌다:\n${fatal.join('\n---\n')}`).toEqual([])
    })
  }
})

describe('이 검사가 헛돌지 않는다', () => {
  it('선언 전에 쓰는 화면은 잡아낸다', async () => {
    // 실제로 났던 것과 같은 모양을 일부러 만들어 본다. 이걸 안 잡으면
    // 위의 검사들이 전부 헛돈 것이다.
    const { useEffect } = await import('react')
    function Broken() {
      useEffect(() => {}, [late])
      const late = 1
      return createElement('div', null, String(late))
    }
    const root = createRoot(container)
    let thrown = null
    try {
      await act(async () => {
        root.render(createElement(Broken))
      })
    } catch (err) {
      thrown = err
    }
    try {
      root.unmount()
    } catch {
      // 터진 뒤 정리는 실패해도 상관없다.
    }
    const caught =
      thrown?.message ??
      errors.find((e) => /before initialization/i.test(e)) ??
      ''
    expect(String(caught)).toMatch(/before initialization/i)
  })
})
