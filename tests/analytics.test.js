import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { redactPath, MEASUREMENT_ID } from '../src/lib/analytics.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

// 방문 통계를 켜면 주소가 남의 계정으로 간다.
//
// 이 사이트의 주소에는 열쇠가 들어 있다. 로그인이 없고 접수번호 하나가 그
// 신청서를 여는 유일한 값이다. 손대지 않고 보내면 애널리틱스 보고서에
// 남의 신청서를 여는 열쇠가 목록으로 쌓인다.

describe('주소에서 열쇠를 가린다', () => {
  it('접수번호를 안 보낸다', () => {
    // 이게 이 파일에서 가장 무거운 검사다. 접수번호는 이 사이트의 유일한
    // 열쇠라, 새 나가면 로그인 비밀번호가 새는 것과 같다.
    expect(redactPath('/track/AX-W34-64A')).toBe('/track/:id')
    expect(redactPath('/AX-DEM-001')).toBe('/:id')
  })

  it('넘긴 도구 주소를 안 보낸다', () => {
    // 그 주소를 아는 사람이 곧 그 도구를 쓸 수 있는 사람이다.
    expect(redactPath('/t/settlement-1e1b33')).toBe('/t/:slug')
    expect(redactPath('/t/무엇이든')).toBe('/t/:slug')
  })

  it('신청서 id 를 안 보낸다', () => {
    expect(redactPath('/record/app_9f2c1d3e4a5b6c7d8e9f')).toBe('/record/:id')
    expect(redactPath('/dept/재무')).toBe('/dept/:dept')
  })

  it('화면 이름은 그대로 남긴다', () => {
    // 다 가려 버리면 통계가 아무 말도 안 한다. 알고 싶은 것은 "어느 화면을
    // 몇 번 봤는가"다.
    for (const p of ['/', '/apply', '/review', '/agreement', '/build', '/beta', '/result', '/bug', '/honesty', '/built']) {
      expect(redactPath(p), p).toBe(p)
    }
  })

  it('빈 값에도 터지지 않는다', () => {
    // 통계 때문에 화면이 죽으면 안 된다.
    expect(redactPath()).toBe('/')
    expect(redactPath('')).toBe('/')
    expect(redactPath(null)).toBe('/')
  })
})

describe('태그를 켜 둔 방식', () => {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8')

  it('첫 화면을 태그가 스스로 보내지 않는다', () => {
    // 켜 두면 태그가 주소 표시줄 그대로(접수번호가 든 채로) 한 번 먼저
    // 보내 버린다. 그러면 가리는 코드가 있어도 소용이 없다.
    expect(html).toContain('send_page_view: false')
  })

  it('화면과 태그가 같은 측정 id 를 쓴다', () => {
    // 갈라지면 코드는 보내는데 보고서에는 아무것도 안 쌓인다.
    expect(html).toContain(MEASUREMENT_ID)
    expect(MEASUREMENT_ID).toMatch(/^G-[A-Z0-9]+$/)
  })

  it('화면 이동마다 보내는 자리가 실제로 붙어 있다', () => {
    // 주소가 바뀌어도 새 문서를 안 받아오므로, 안 붙이면 첫 화면 하나만
    // 계속 세게 된다. 서버만 만들고 화면에 안 다는 일이 되풀이됐다.
    const app = readFileSync(join(ROOT, 'src', 'App.jsx'), 'utf8')
    expect(app).toContain('PageViewTracker')
    const tracker = readFileSync(
      join(ROOT, 'src', 'components', 'PageViewTracker.jsx'),
      'utf8'
    )
    expect(tracker).toContain('useLocation')
    expect(tracker).toContain('trackPageView')
  })
})

describe('화면 녹화는 가릴 데를 가리는가', () => {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8')
  const app = readFileSync(join(ROOT, 'src', 'App.jsx'), 'utf8')

  it('태그가 붙어 있다', () => {
    expect(html).toContain('clarity.ms/tag/')
    expect(html).toContain('y28b6n8ub2')
  })

  it('부서가 여는 화면은 녹화에서 가린다', () => {
    // 녹화는 애널리틱스와 다르다. 무엇이 떠 있었는지가 그대로 남는다.
    // 특히 도구 화면 — 이 사이트는 "파일이 서버로 가지 않습니다"를 내세우는데,
    // 넣은 파일의 계산 결과가 뜬 화면을 녹화해 보내면 그 약속이 뒷문으로 깨진다.
    expect(app).toContain('data-clarity-mask')
    // 가리는 조건이 목차 없이 여는 세 화면(bare)과 같아야 한다. 따로 적으면
    // 화면이 하나 늘 때 한쪽만 고쳐진다.
    expect(app).toMatch(/data-clarity-mask=\{bare \? 'true' : undefined\}/)
  })

  it('가리는 화면이 실제로 그 셋이다', () => {
    // bare 판정이 바뀌면 녹화에서 가리는 범위도 조용히 바뀐다.
    expect(app).toMatch(/startsWith\('\/t\/'\)/)
    expect(app).toMatch(/=== '\/track'/)
    expect(app).toMatch(/startsWith\('\/record\/'\)/)
  })
})

describe('없다고 적어 둔 것이 사실인가', () => {
  it('"외부 호출 없음"을 그대로 두지 않았다', () => {
    // 꼬리말이 "외부 서비스 호출 없음"이라고 적고 있었다. 글꼴을 CDN 에서
    // 받아 오고 있었으므로 켜기 전부터 이미 거짓이었고, 통계를 켜면 더
    // 명백해진다. 정직을 파는 사이트에서 이 문장이 틀리면 나머지도 못 믿는다.
    const app = readFileSync(join(ROOT, 'src', 'App.jsx'), 'utf8')
    expect(app).not.toContain('외부 서비스 호출 없음')
  })

  it('기술 구현 화면이 무엇을 보내는지 밝힌다', () => {
    const about = readFileSync(join(ROOT, 'shared', 'about.js'), 'utf8')
    expect(about).toContain('Google Analytics')
    expect(about).toContain('send_page_view')
    // 녹화를 켜 놓고 안 적으면, 보는 사람은 자기 화면이 찍히는 줄 모른다.
    expect(about).toContain('Microsoft Clarity')
    expect(about).toContain('data-clarity-mask')
  })
})
