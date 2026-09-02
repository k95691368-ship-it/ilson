// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useApi } from '../src/hooks/useApi.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let container
let requests

function response(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  requests = new Map()
  globalThis.fetch = vi.fn(
    (url) =>
      new Promise((resolve) => {
        const path = String(url).split('/api')[1] ?? String(url)
        const pending = requests.get(path) ?? []
        pending.push((body) => resolve(response(body)))
        requests.set(path, pending)
      })
  )
})

afterEach(() => {
  container?.remove()
  container = null
  vi.restoreAllMocks()
})

function resolveRequest(path, body, index = 0) {
  requests.get(path)?.[index]?.(body)
}

function Probe({ path }) {
  const { data, error, loading, reload } = useApi(path)
  const value = data?.who ?? error ?? (loading ? '불러오는 중' : '비어 있음')
  return createElement(
    'div',
    null,
    createElement('output', null, value),
    createElement('button', { type: 'button', onClick: reload }, '다시 불러오기')
  )
}

describe('useApi 응답은 요청 URL에 귀속된다', () => {
  it('URL이 바뀌면 새 응답이 오기 전까지 이전 URL 데이터를 노출하지 않는다', async () => {
    const root = createRoot(container)

    await act(async () => {
      root.render(createElement(Probe, { path: '/applications/A' }))
    })
    await act(async () => {
      resolveRequest('/applications/A', { who: '신청서 A' })
    })
    expect(container.querySelector('output').textContent).toBe('신청서 A')

    await act(async () => {
      root.render(createElement(Probe, { path: '/applications/B' }))
    })
    expect(container.querySelector('output').textContent).toBe('불러오는 중')

    await act(async () => {
      resolveRequest('/applications/B', { who: '신청서 B' })
    })
    expect(container.querySelector('output').textContent).toBe('신청서 B')

    await act(async () => {
      root.unmount()
    })
  })

  it('같은 URL을 다시 불러올 때는 새 응답이 올 때까지 현재 데이터를 유지한다', async () => {
    const root = createRoot(container)

    await act(async () => {
      root.render(createElement(Probe, { path: '/applications/A' }))
    })
    await act(async () => {
      resolveRequest('/applications/A', { who: '첫 응답' })
    })
    expect(container.querySelector('output').textContent).toBe('첫 응답')

    await act(async () => {
      container.querySelector('button').click()
    })
    expect(container.querySelector('output').textContent).toBe('첫 응답')

    await act(async () => {
      resolveRequest('/applications/A', { who: '새 응답' }, 1)
    })
    expect(container.querySelector('output').textContent).toBe('새 응답')

    await act(async () => {
      root.unmount()
    })
  })

  it('이전 URL의 늦은 응답이 현재 URL 데이터를 덮어쓰지 않는다', async () => {
    const root = createRoot(container)

    await act(async () => {
      root.render(createElement(Probe, { path: '/applications/A' }))
    })
    await act(async () => {
      root.render(createElement(Probe, { path: '/applications/B' }))
    })
    await act(async () => {
      resolveRequest('/applications/B', { who: '신청서 B' })
    })
    expect(container.querySelector('output').textContent).toBe('신청서 B')

    await act(async () => {
      resolveRequest('/applications/A', { who: '늦은 신청서 A' })
    })
    expect(container.querySelector('output').textContent).toBe('신청서 B')

    await act(async () => {
      root.unmount()
    })
  })
})
