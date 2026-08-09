import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const health = readFileSync(join(ROOT, 'functions', 'api', 'health.js'), 'utf8')
const page = readFileSync(join(ROOT, 'src', 'pages', 'HonestyPage.jsx'), 'utf8')

// "준비된 상태입니다"가 무엇을 보고 하는 말인가.
//
// 정직 화면 맨 아래에 이 한 줄이 있다. 그런데 라이브에서 이렇게 떠 있었다 —
//
//   "이 배포는 준비된 상태입니다 — 데이터베이스(D1) 연결 · 표 구조 적용 ·
//    **파일 보관소(R2) 연결** 모두 확인됨."
//
// R2 는 이 프로젝트에 없다. 첨부 기능을 걷어낼 때 서버는 그 확인을 지웠는데
// 화면의 이름표 목록만 남아서, 있지도 않은 것을 확인했다고 말하고 있었다.
//
// 그리고 확인하는 쪽도 딴것을 보고 있었다. 준비 여부를 users·sessions·
// audit_log·notifications 네 표로 판정했는데 **이 사이트에는 로그인이 없다.**
// 계정도 세션도 안 만들고, 그 넷을 읽는 코드가 한 줄도 없다. 앞 저장소에서
// 공용 부품을 가져올 때 딸려 온 표들이다.
//
// 하필 이 화면이라 더 나쁘다. 여기가 "증명 못 한 것"을 적는 자리다.

describe('준비됐다는 말이 무엇을 보고 하는 말인가', () => {
  it('로그인 표로 판정하지 않는다', () => {
    // 이 제품에는 로그인이 없다. 그 표가 있고 없고는 준비와 상관없다.
    for (const legacy of ['users', 'sessions', 'audit_log', 'notifications']) {
      expect(health.includes(`'${legacy}'`), legacy).toBe(false)
    }
  })

  it('여덟 단계에 실제로 쓰는 표를 본다', () => {
    // 한 건이 여덟 단계를 지나려면 이 표들이 있어야 한다. 하나라도 빠지면
    // 그 단계에서 멈춘다 — 그게 "덜 준비됨"이다.
    for (const t of [
      'application',
      'review',
      'baseline',
      'build_run',
      'beta_round',
      'manual',
      'handover',
      'outcome',
    ]) {
      expect(health.includes(`'${t}'`), t).toBe(true)
    }
  })

  it('세는 표가 실제로 만들어지는 표다', () => {
    // 이름을 잘못 적으면 영영 "덜 준비됐습니다"가 뜬다.
    const sql = readdirSync(join(ROOT, 'migrations'))
      .filter((f) => f.endsWith('.sql'))
      .map((f) => readFileSync(join(ROOT, 'migrations', f), 'utf8'))
      .join('\n')
    const listed = [...health.matchAll(/^ {2}'(\w+)',$/gm)].map((m) => m[1])
    expect(listed.length).toBeGreaterThan(8)
    for (const t of listed) {
      expect(sql.includes(`CREATE TABLE ${t} `), t).toBe(true)
    }
  })

  it('없는 것을 확인했다고 말하지 않는다', () => {
    // 화면의 이름표와 서버의 확인 항목이 어긋나면 그 차이가 그대로 거짓말이
    // 된다. 화면은 서버가 안 보는 것을 적어 두지 않는다.
    // 주석에는 왜 지웠는지가 남아 있어야 하므로, 화면에 그려지는 이름표만
    // 본다.
    const labels = page.match(/const labels = \{[^}]*\}/)?.[0] ?? ''
    expect(labels).not.toContain('R2')
    expect(labels).toContain('D1')
    expect(health).not.toContain('env.SOURCES')
  })
})

// 없는 기능의 표.
//
// application_file(첨부)과 application_ai_draft(AI 초안)가 라이브에 남아
// 있었다. 둘 다 걷어낸 기능이고 줄도 0개인데, 정직 화면은 "표 몇 개"를
// 세어 보여 주므로 없는 기능의 표까지 세고 있었다. 스키마를 읽는 사람도
// "여기 AI가 있구나"로 읽는다 — 이 제품이 하지 않는 일의 맨 위에 적어 둔
// 바로 그것이다.
describe('걷어낸 기능의 표를 남겨 두지 않는다', () => {
  const files = readdirSync(join(ROOT, 'migrations')).filter((f) => f.endsWith('.sql')).sort()
  const sql = files.map((f) => readFileSync(join(ROOT, 'migrations', f), 'utf8')).join('\n')

  it('내리는 마이그레이션이 있다', () => {
    expect(sql).toContain('DROP TABLE IF EXISTS application_file')
    expect(sql).toContain('DROP TABLE IF EXISTS application_ai_draft')
  })

  it('내린 뒤에 다시 만들지 않는다', () => {
    // 만들고 내리고 또 만들면 배포마다 달라진다.
    const order = (needle) => files.findIndex((f) => readFileSync(join(ROOT, 'migrations', f), 'utf8').includes(needle))
    for (const t of ['application_file', 'application_ai_draft']) {
      expect(order(`DROP TABLE IF EXISTS ${t}`)).toBeGreaterThan(order(`CREATE TABLE ${t} `))
    }
  })

  it('그 표를 쓰는 코드가 없다', () => {
    const code = []
    const walk = (d) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name)
        if (e.isDirectory()) walk(p)
        else if (p.endsWith('.js') || p.endsWith('.jsx')) code.push(readFileSync(p, 'utf8'))
      }
    }
    walk(join(ROOT, 'functions'))
    walk(join(ROOT, 'src'))
    walk(join(ROOT, 'shared'))
    const all = code.join('\n')
    expect(all).not.toContain('application_file')
    expect(all).not.toContain('application_ai_draft')
  })
})
