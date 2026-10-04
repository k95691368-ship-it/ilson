// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useApi } from '../src/hooks/useApi.js'
import { beginAccessCheck, completeAccessCheck } from '../src/lib/accessSession.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let container
let requests
let currentResource

function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  completeAccessCheck(beginAccessCheck(), { ok: true, mode: 'access', scope: 'a'.repeat(64) })
  container = document.createElement('div')
  document.body.appendChild(container)
  requests = new Map()
  currentResource = null
  globalThis.fetch = vi.fn(
    (url) =>
      new Promise((resolve) => {
        const path = String(url).split('/api')[1] ?? String(url)
        const pending = requests.get(path) ?? []
        pending.push((body, status) => resolve(response(body, status)))
        requests.set(path, pending)
      })
  )
})

afterEach(() => {
  container?.remove()
  container = null
  vi.restoreAllMocks()
})

function resolveRequest(path, body, index = 0, status = 200) {
  requests.get(path)?.[index]?.(body, status)
}

function Probe({ path }) {
  const resource = useApi(path)
  currentResource = resource
  const { data, error, errorStatus, loading, reload } = resource
  const value = data?.who ?? error ?? (loading ? '불러오는 중' : '비어 있음')
  return createElement(
    'div',
    null,
    createElement('output', { 'data-error-status': errorStatus ?? '' }, value),
    createElement('button', { type: 'button', onClick: reload }, '다시 불러오기')
  )
}

describe('useApi 응답은 요청 URL에 귀속된다', () => {
  it.each([200, 403, 404, 410, 503])('최신 재조회 %s는 수용한 결과만 반환한다', async status => {
    const root = createRoot(container)
    try {
      await act(async () => { root.render(createElement(Probe, { path: '/applications/A' })) })
      await act(async () => { resolveRequest('/applications/A', { who: '기존 A' }) })
      let pending, outcome
      await act(async () => { pending = currentResource.reload() })
      const body = status === 200 ? { who: '최신 A' } : { error: '최신 조회 실패' }
      await act(async () => { resolveRequest('/applications/A', body, 1, status); outcome = await pending })
      expect(outcome).toEqual(status === 200 ? { ok: true, data: body } : { ok: false, status, error: body.error })
      if (status === 503) expect(currentResource.data).toEqual({ who: '기존 A' })
      if ([403, 404, 410].includes(status)) expect(currentResource.data).toBeNull()
    } finally { await act(async () => { root.unmount() }) }
  })

  it.each([200, 403, 503])('뒤처진 재조회 %s는 새 조회 결과를 반환하거나 덮어쓰지 않는다', async status => {
    const root = createRoot(container)
    try {
      await act(async () => { root.render(createElement(Probe, { path: '/applications/A' })) })
      await act(async () => { resolveRequest('/applications/A', { who: '기존 A' }) })
      let older, latest, olderOutcome, latestOutcome
      await act(async () => { older = currentResource.reload(); latest = currentResource.reload() })
      await act(async () => { resolveRequest('/applications/A', { who: '최신 A' }, 2); latestOutcome = await latest })
      await act(async () => { resolveRequest('/applications/A', status === 200 ? { who: '과거 A' } : { error: '과거 실패' }, 1, status); olderOutcome = await older })
      expect(latestOutcome).toEqual({ ok: true, data: { who: '최신 A' } })
      expect(olderOutcome).toBeUndefined()
      expect(currentResource.data).toEqual({ who: '최신 A' })
    } finally { await act(async () => { root.unmount() }) }
  })

  it.each(['path', 'account', 'unmount', 'denial'])('%s로 폐기한 재조회는 결과를 반환하지 않는다', async change => {
    const root = createRoot(container)
    let unmounted = false
    try {
      await act(async () => { root.render(createElement(Probe, { path: '/applications/A' })) })
      await act(async () => { resolveRequest('/applications/A', { who: '기존 A' }) })
      let pending, outcome
      await act(async () => { pending = currentResource.reload() })
      if (change === 'path') await act(async () => { root.render(createElement(Probe, { path: '/applications/B' })) })
      if (change === 'account') await act(async () => { completeAccessCheck(beginAccessCheck(), { ok: true, mode: 'access', scope: 'b'.repeat(64) }) })
      if (change === 'unmount') { await act(async () => { root.unmount() }); unmounted = true }
      await act(async () => {
        resolveRequest('/applications/A', change === 'denial' ? { error: '계정 접근 거절' } : { who: '폐기된 원문' }, 1, change === 'denial' ? 401 : 200)
        outcome = await pending
      })
      expect(outcome).toBeUndefined()
      expect(container.textContent).not.toContain('폐기된 원문')
    } finally { if (!unmounted) await act(async () => { root.unmount() }) }
  })

  it('조회할 주소가 없거나 계정 확인 중이면 결과를 반환하지 않는다', async () => {
    const root = createRoot(container)
    try {
      await act(async () => { root.render(createElement(Probe, { path: null })) })
      let outcome
      await act(async () => { outcome = await currentResource.reload() })
      expect(outcome).toBeUndefined(); expect(fetch).not.toHaveBeenCalled()
      await act(async () => { beginAccessCheck(); root.render(createElement(Probe, { path: '/applications/A' })) })
      await act(async () => { outcome = await currentResource.reload() })
      expect(outcome).toBeUndefined(); expect(fetch).not.toHaveBeenCalled()
    } finally { await act(async () => { root.unmount() }) }
  })

  it.each([403, 404, 410, 429, 500, 503])('현재 리소스의 HTTP %s만 노출하고 성공·URL 교체 때 지운다', async status => {
    const root = createRoot(container)
    try {
      await act(async () => { root.render(createElement(Probe, { path: '/applications/A' })) })
      expect(container.querySelector('output').dataset.errorStatus).toBe('')
      await act(async () => { resolveRequest('/applications/A', { who: '현재 A' }) })
      await act(async () => { container.querySelector('button').click() })
      await act(async () => { resolveRequest('/applications/A', { error: '현재 요청 실패' }, 1, status) })
      expect(container.querySelector('output').dataset.errorStatus).toBe(String(status))
      await act(async () => { container.querySelector('button').click() })
      await act(async () => { resolveRequest('/applications/A', { who: '복구 A' }, 2) })
      expect(container.querySelector('output').dataset.errorStatus).toBe('')
      await act(async () => { container.querySelector('button').click() })
      await act(async () => { resolveRequest('/applications/A', { error: '다시 실패' }, 3, status) })
      await act(async () => { root.render(createElement(Probe, { path: '/applications/B' })) })
      expect(container.querySelector('output').dataset.errorStatus).toBe('')
      await act(async () => { resolveRequest('/applications/B', { who: '현재 B' }) })
      expect(container.querySelector('output').dataset.errorStatus).toBe('')
    } finally {
      await act(async () => { root.unmount() })
    }
  })

  it.each([401, 403, 404, 410])('재조회 %s 이후 접근할 수 없는 이전 원문을 숨긴다', async status => {
    const root = createRoot(container)
    await act(async () => { root.render(createElement(Probe, { path: '/applications/A' })) })
    await act(async () => { resolveRequest('/applications/A', { who: '이전 비공개 원문' }) })
    expect(container.querySelector('output').textContent).toBe('이전 비공개 원문')
    await act(async () => { container.querySelector('button').click() })
    await act(async () => { resolveRequest('/applications/A', { error: '현재 접근할 수 없습니다.' }, 1, status) })
    expect(container.querySelector('output').textContent).toBe('현재 접근할 수 없습니다.')
    await act(async () => {
      if (status === 401) completeAccessCheck(beginAccessCheck(), { ok: true, mode: 'access', scope: 'a'.repeat(64) })
      else container.querySelector('button').click()
    })
    expect(container.textContent).not.toContain('이전 비공개 원문')
    await act(async () => { resolveRequest('/applications/A', { who: '새 권한의 원문' }, 2) })
    expect(container.querySelector('output').textContent).toBe('새 권한의 원문')
    await act(async () => { root.unmount() })
  })

  it.each([429, 500, 503])('일시적인 %s 실패에는 같은 URL의 원문을 유지한다', async status => {
    const root = createRoot(container)
    await act(async () => { root.render(createElement(Probe, { path: '/applications/A' })) })
    await act(async () => { resolveRequest('/applications/A', { who: '현재 원문' }) })
    await act(async () => { container.querySelector('button').click() })
    await act(async () => { resolveRequest('/applications/A', { error: '잠시 후 다시 시도해 주세요.' }, 1, status) })
    expect(container.querySelector('output').textContent).toBe('현재 원문')
    await act(async () => { root.unmount() })
  })

  it('과거 요청의 늦은 403이 새로운 리소스의 정상 응답을 지우지 않는다', async () => {
    const root = createRoot(container)
    await act(async () => { root.render(createElement(Probe, { path: '/applications/A' })) })
    await act(async () => { root.render(createElement(Probe, { path: '/applications/B' })) })
    await act(async () => { resolveRequest('/applications/B', { who: '새 원문 B' }) })
    await act(async () => { resolveRequest('/applications/A', { error: '과거 범위 거절' }, 0, 403) })
    expect(container.querySelector('output').textContent).toBe('새 원문 B')
    expect(container.querySelector('output').dataset.errorStatus).toBe('')
    await act(async () => { root.unmount() })
  })

  it('재조회·주소 변경·화면 이탈 시 이전 GET 요청을 취소한다', async () => {
    const root = createRoot(container)
    await act(async () => { root.render(createElement(Probe, { path: '/applications/A' })) })
    const first = fetch.mock.calls.at(-1)[1].signal
    expect(first.aborted).toBe(false)
    await act(async () => { container.querySelector('button').click() })
    expect(first.aborted).toBe(true)
    const reload = fetch.mock.calls.at(-1)[1].signal
    expect(reload.aborted).toBe(false)
    await act(async () => { root.render(createElement(Probe, { path: '/applications/B' })) })
    expect(reload.aborted).toBe(true)
    const second = fetch.mock.calls.at(-1)[1].signal
    expect(second.aborted).toBe(false)
    await act(async () => { root.unmount() })
    expect(second.aborted).toBe(true)
  })
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
