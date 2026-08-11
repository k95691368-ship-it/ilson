// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement, act } from 'react'
import { createRoot } from 'react-dom/client'
import { useApi } from '../src/hooks/useApi.js'

const ROOT = process.cwd()

// 늦게 온 응답이 최신 화면을 덮어썼다.
//
// useApi 는 화면을 떠났는지(alive)만 봤다. 같은 화면에 머문 채 주소만
// 바뀌는 경우 — 부서가 조회 화면에서 "묶인 그 신청서 보기"를 누르거나,
// 담당자가 목록에서 다른 건으로 옮겨 갈 때 — 는 둘 다 alive 다. 그래서
// 먼저 보낸 요청이 나중에 도착하면 그대로 덮어썼다.
//
// 그러면 **주소는 B인데 화면은 A**가 된다. 예외도 안 나고 화면도 안 깨진다.
// 부서는 남의 신청서를 자기 것으로 읽고, 그 화면에서 서명하거나 성과를
// 확인한다. 이 사이트에서 가장 조용하고 가장 나쁜 종류다.

let container = null
let resolvers = {}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  resolvers = {}
  // 주소마다 응답을 손으로 풀어 줄 수 있게 한다. 늦게 온 것을 만들려면
  // 순서를 우리가 잡아야 한다.
  globalThis.fetch = vi.fn(
    (url) =>
      new Promise((resolve) => {
        const key = String(url).split('/api')[1] ?? String(url)
        resolvers[key] = (body) =>
          resolve(
            new Response(JSON.stringify(body), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            })
          )
      })
  )
})

afterEach(() => {
  container?.remove()
  container = null
})

function Probe({ path }) {
  const { data } = useApi(path)
  return createElement('span', null, data?.who ?? '아직')
}

describe('늦게 온 응답이 최신 화면을 덮어쓰지 않는다', () => {
  it('주소가 바뀐 뒤 옛 응답이 와도 무시한다', async () => {
    const root = createRoot(container)

    await act(async () => {
      root.render(createElement(Probe, { path: '/track/A' }))
    })
    // A 가 아직 안 온 채로 B 로 옮겨 간다.
    await act(async () => {
      root.render(createElement(Probe, { path: '/track/B' }))
    })

    // B 가 먼저 도착하고,
    await act(async () => {
      resolvers['/track/B']?.({ who: 'B' })
    })
    expect(container.textContent).toBe('B')

    // 그다음에 A 가 뒤늦게 도착한다. 이때 덮어쓰면 안 된다.
    await act(async () => {
      resolvers['/track/A']?.({ who: 'A' })
    })
    expect(container.textContent).toBe('B')

    root.unmount()
  })

  it('이 검사가 헛돌지 않는다 — 순서대로 오면 최신이 그려진다', async () => {
    // 늘 무시해 버리면 화면이 영영 안 채워진다.
    const root = createRoot(container)
    await act(async () => {
      root.render(createElement(Probe, { path: '/track/C' }))
    })
    await act(async () => {
      resolvers['/track/C']?.({ who: 'C' })
    })
    expect(container.textContent).toBe('C')
    root.unmount()
  })
})

describe('조회 화면이 번호가 바뀌면 다시 찾는다', () => {
  const page = readFileSync(join(ROOT, 'src', 'pages', 'TrackPage.jsx'), 'utf8')

  it('한 번만 찾고 마는 의존성이 아니다', () => {
    // [] 였다. 그래서 화면 안의 다른 접수번호 링크를 눌러도 주소만 바뀌고
    // 앞 신청서가 그대로 남았다.
    expect(page).toMatch(/const askedNo = params\.get\('no'\)/)
    expect(page).toMatch(/\}, \[askedNo\]\)/)
  })

  it('요청 순서를 지키는 훅을 쓴다', () => {
    const hook = readFileSync(join(ROOT, 'src', 'hooks', 'useApi.js'), 'utf8')
    expect(hook).toContain('seq')
    // alive 만으로는 같은 화면에서 주소가 바뀌는 경우를 못 막는다.
    expect(hook).toMatch(/seq\.current === mine/)
  })
})
