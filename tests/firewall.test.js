import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

// 앞단에 세워 둔 보호막.
//
// 이 사이트에는 로그인이 없다. "누가 들어왔나"로 막을 수가 없으니 막을 수
// 있는 것은 무엇을 하게 둘 것인가뿐이다. 그 규칙은 파일 한 줄이라서 조용히
// 사라지기 쉽고, 사라져도 화면은 똑같이 보인다.

const rules = readFileSync(join(ROOT, 'public', '_headers'), 'utf8')

describe('모든 응답에 보호막이 붙는가', () => {
  it('남의 사이트가 이 화면을 틀에 넣지 못한다', () => {
    // 투명한 창을 덮어 두고 판정이나 신고 버튼을 대신 누르게 하는 수법을 막는다.
    expect(rules).toMatch(/X-Frame-Options:\s*DENY/i)
    expect(rules).toContain("frame-ancestors 'none'")
  })

  it('안 쓰는 장치는 잠가 둔다', () => {
    expect(rules).toMatch(/Permissions-Policy:.*camera=\(\)/i)
  })

  it('한 번 https 로 온 브라우저는 http 로 안 돌아간다', () => {
    expect(rules).toMatch(/Strict-Transport-Security:\s*max-age=\d{7,}/i)
  })

  it('주소를 통째로 남에게 넘기지 않는다', () => {
    // 이 사이트 주소에는 접수번호가 들어간다.
    expect(rules).toMatch(/Referrer-Policy:\s*strict-origin-when-cross-origin/i)
  })
})

describe('모르는 주소에서 온 스크립트를 막는가', () => {
  const csp = (rules.match(/Content-Security-Policy:(.*)/) ?? [])[1] ?? ''

  it('규칙이 있다', () => {
    expect(csp.length).toBeGreaterThan(80)
  })

  it('기본은 우리 자신만 허용한다', () => {
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain("base-uri 'self'")
    expect(csp).toContain("form-action 'self'")
  })

  it('실제로 부르는 곳만 열려 있다', () => {
    // 화면이 부르는 바깥은 넷뿐이다. 여기 없는 주소를 코드가 부르기 시작하면
    // 조용히 막히므로, 두 목록이 어긋나지 않게 같이 본다.
    const html = readFileSync(join(ROOT, 'index.html'), 'utf8')
    for (const host of ['googletagmanager.com', 'clarity.ms', 'cdn.jsdelivr.net']) {
      if (html.includes(host)) expect(csp, host).toContain(host)
    }
  })

  it('아무 데나 열어 두지 않았다', () => {
    // script-src 에 * 가 들어가면 이 규칙은 아무것도 안 막는다.
    const script = (csp.match(/script-src([^;]*)/) ?? [])[1] ?? ''
    expect(script).not.toContain(' *')
    expect(script).not.toContain('http:')
  })
})

describe('쓰는 요청에 한도가 걸려 있는가', () => {
  // 로그인이 없으므로 계정으로는 못 센다. 지나가는 길목에서 센다.
  const gate = readFileSync(join(ROOT, 'functions', 'api', '_middleware.js'), 'utf8')

  it('길목이 서 있다', () => {
    expect(gate).toContain('export async function onRequest')
    expect(gate).toContain('checkRateLimit')
  })

  it('읽기는 안 막고 쓰기만 막는다', () => {
    // 보러 온 사람을 막을 이유가 없고, 읽기는 아무것도 안 남긴다.
    expect(gate).toContain("request.method === 'GET'")
    expect(gate).toContain('429')
  })

  it('한도를 넘기면 돌려보낸다', () => {
    expect(gate).toMatch(/WRITES_PER_WINDOW\s*=\s*\d+/)
    expect(gate).toMatch(/WINDOW_SECONDS\s*=\s*\d+/)
  })

  it('길목 하나로 모든 쓰기 창구를 덮는다', () => {
    // 라우트마다 한 줄씩 붙이던 때에 열다섯 곳이 빠져 있었다. 그래서
    // 길목으로 옮겼다. 이 검사는 그 길목이 api 아래 맨 위에 있는지를 본다.
    const files = readdirSync(join(ROOT, 'functions', 'api'))
    expect(files).toContain('_middleware.js')
  })
})
