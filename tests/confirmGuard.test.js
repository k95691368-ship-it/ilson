import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { onRequestPost } from '../functions/api/applications/[id]/outcome.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

// 한 번도 안 돌린 도구가 "부서가 성과를 확인함"이 됐다.
//
// 투어를 여덟 칸까지 따라가 보다가 나왔다. 배포까지 마친 신청서에 성과
// 확인을 넣었더니 200이 떴고, 첫 화면의 단계가 성과로 넘어가 안내가 끝났다.
// 그런데 성과 화면을 열어 보면 이렇게 적혀 있었다 —
//
//   "아직 성과를 말할 수 없습니다 — 아직 한 번도 돌지 않았습니다."
//
// 성과 화면은 산정불가면 확인 자리를 안 그리고, 부서 쪽 화면도
// canConfirm = runs > 0 && baseline 로 막는다. 서버만 안 막았다. 두 화면이
// 다 막는 것을 서버가 받아 주면, 막는 것은 화면 그리는 방식이지 규칙이 아니다.

const APP = { id: 'app_1', ticket_no: 'AX-001-001', dept: '재무', title: 'x', status: '완료' }

// runs·baseline 이 있는지 없는지만 바꿔 가며 부른다.
function db({ runs = 0, baseline = false } = {}) {
  const written = []
  const stmt = (sql) => ({
    bind: (...args) => {
      written.push({ sql, args })
      return stmt(sql)
    },
    first: async () => {
      if (sql.includes('FROM application')) return APP
      if (sql.includes('FROM tool_use')) return { n: runs }
      if (sql.includes('FROM baseline')) return baseline ? { application_id: 'app_1' } : null
      return null
    },
    all: async () => ({ results: [] }),
    run: async () => ({ meta: {} }),
  })
  return { written, prepare: stmt, batch: async (l) => (l ?? []).map(() => ({})), exec: async () => ({}) }
}

const confirm = async (state) => {
  const d = db(state)
  const res = await onRequestPost({
    env: { DB: d },
    params: { id: 'app_1' },
    request: new Request('https://x/api/applications/app_1/outcome', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'dept_confirm', by: '재무 정산 담당', comment: '줄었습니다.' }),
    }),
  })
  return { res, body: await res.json(), d }
}

describe('확인할 숫자가 있어야 확인이다', () => {
  it('한 번도 안 돌았으면 못 누른다', async () => {
    const { res, body } = await confirm({ runs: 0, baseline: true })
    expect(res.status).toBe(400)
    expect(body.blockers.join(' ')).toContain('한 번도 안 돌았습니다')
  })

  it('기준선이 없으면 못 누른다', async () => {
    // 견줄 값이 없으면 "얼마나 줄었다"가 성립하지 않는다.
    const { res, body } = await confirm({ runs: 5, baseline: false })
    expect(res.status).toBe(400)
    expect(body.blockers.join(' ')).toContain('기준선')
  })

  it('막혔으면 아무것도 안 적는다', async () => {
    // 400 을 돌려주면서 표에는 적어 두면 단계는 그대로 넘어간다.
    const { d } = await confirm({ runs: 0, baseline: false })
    expect(d.written.some((w) => w.sql.includes('INSERT INTO outcome'))).toBe(false)
    expect(d.written.some((w) => w.sql.includes('INSERT INTO decision_log'))).toBe(false)
  })

  it('둘 다 있으면 받는다', async () => {
    // 이 검사가 헛돌지 않는지 본다. 늘 막으면 성과를 영영 못 적는다.
    const { res, d } = await confirm({ runs: 5, baseline: true })
    expect(res.status).toBe(200)
    expect(d.written.some((w) => w.sql.includes('INSERT INTO outcome'))).toBe(true)
  })

  it('부서 쪽 화면과 같은 조건이다', () => {
    // 한쪽에서는 누를 수 있고 다른 쪽에서는 못 누르면 둘 다 못 믿는다.
    const track = readFileSync(join(ROOT, 'functions', 'api', 'track', '[ticket]', 'outcome.js'), 'utf8')
    expect(track).toContain('canConfirm: runs > 0 && Boolean(baseline)')
    const mine = readFileSync(join(ROOT, 'functions', 'api', 'applications', '[id]', 'outcome.js'), 'utf8')
    expect(mine).toContain('SELECT COUNT(*) AS n FROM tool_use WHERE application_id = ?')
  })
})
