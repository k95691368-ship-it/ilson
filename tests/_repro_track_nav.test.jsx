// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { act } from 'react'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'

const ROOT = process.cwd()
function Probe() {
  const loc = useLocation()
  return createElement('div', { id: 'probe' }, loc.pathname + loc.search)
}
const { default: TrackPage } = await import(
  pathToFileURL(join(ROOT, 'src/pages/TrackPage.jsx')).href
)
const { ThemeProvider } = await import(
  pathToFileURL(join(ROOT, 'src/context/ThemeContext.jsx')).href
)
const { ToastProvider } = await import(
  pathToFileURL(join(ROOT, 'src/context/ToastContext.jsx')).href
)

function body(ticket, title) {
  return {
    ticket,
    application: {
      ticket_no: ticket,
      dept: '물류',
      title,
      applicant: '김',
      status: '접수',
      created_at: '2026-08-01T00:00:00Z',
      annual_hours: null,
    },
    timeline: [{ stage: '신청서', status: '완료', at: '2026-08-01T00:00:00Z' }],
    currentStage: '신청서',
    stageProgress: { done: 1, total: 8 },
    decisions: [],
    diary: [],
    mergedInto:
      ticket === 'AX-EFD-E58'
        ? {
            ticket_no: 'AX-EFD-K21',
            dept: '영업',
            title: '저쪽 제목',
            status: '검토',
            at: '2026-08-02T00:00:00Z',
            why: '같은 병목',
          }
        : null,
  }
}

let container
let calls = []

beforeEach(() => {
  calls = []
  container = document.createElement('div')
  document.body.appendChild(container)
  globalThis.fetch = vi.fn(async (url) => {
    const u = String(url)
    calls.push(u)
    const m = u.match(/\/track\/(AX-[A-Z0-9-]+)$/)
    if (m) {
      return new Response(JSON.stringify(body(m[1], m[1] === 'AX-EFD-E58' ? '이쪽 제목' : '저쪽 제목')), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    return new Response(
      JSON.stringify({
        criteria: [],
        state: {},
        eligible: false,
        says: [],
        holds: [],
        ahead: [],
        rows: [],
        items: [],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    )
  })
})

afterEach(() => {
  container.remove()
})

describe('track 화면 안 링크', () => {
  it('다른 접수번호 링크를 누르면 화면이 바뀌는가', async () => {
    const root = createRoot(container)
    await act(async () => {
      root.render(
        createElement(
          ThemeProvider,
          null,
          createElement(
            ToastProvider,
            null,
            createElement(
              MemoryRouter,
              { initialEntries: ['/track?no=AX-EFD-E58'] },
              createElement(TrackPage),
              createElement(Probe)
            )
          )
        )
      )
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30))
    })

    expect(container.textContent).toContain('AX-EFD-E58')
    expect(container.textContent).toContain('이쪽 제목')

    const link = [...container.querySelectorAll('a')].find((a) =>
      a.textContent.includes('그 신청서가 어디까지 왔는지 보기')
    )
    expect(link, '병합 링크가 있어야 함').toBeTruthy()
    expect(link.getAttribute('href')).toBe('/track?no=AX-EFD-K21')

    await act(async () => {
      link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50))
    })

    console.log('FETCHES:', JSON.stringify(calls))
    console.log('SHOWS K21?', container.textContent.includes('AX-EFD-K21 와 같은 건입니다'))
    console.log('TITLE NOW:', container.querySelector('h2')?.textContent)
    console.log('URL NOW:', container.querySelector('#probe')?.textContent)
  })
})
