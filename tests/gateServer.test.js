import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tally } from '../shared/grade.js'
import { onRequestPost } from '../functions/api/applications/[id]/beta.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

// 게이트가 브라우저에만 있었다.
//
// 투어의 베타테스트 칸에 이렇게 적혀 있다 — "통과하지 못하면 다음 단계로
// 넘어가지 않습니다. **그게 게이트입니다.**"
//
// 그런데 서버는 채점 결과를 한 줄씩 다 받아 놓고도 합격 여부만은 보내온
// summary.overall 을 그대로 적었다. 라이브에 이렇게 보내 봤다 —
//
//   graded: [필수안전 실패, 필수안전 실패]
//   summary: { overall: '통과' }
//
// 201 로 저장됐고, overview 는 beta_round.overall='통과' 를 보고 단계를
// 넘겼고, 첫 화면 안내가 다음 칸으로 갔다. 필수 안전 기준이 둘 다 깨진
// 채였다. 게이트라고 적어 둔 자리에 게이트가 없었다.

const row = (over = {}) => ({
  ord: 1,
  body: '금액 오차 0원',
  kind: 'rule',
  is_required_safety: 1,
  verdict: '실패',
  ...over,
})

function fakeDB() {
  const written = []
  const stmt = (sql) => ({
    bind: (...args) => {
      written.push({ sql, args })
      return stmt(sql)
    },
    first: async () => (sql.includes('FROM application') ? APP : null),
    all: async () => ({ results: [] }),
    run: async () => ({ meta: {} }),
  })
  return { written, prepare: stmt, batch: async (l) => (l ?? []).map(() => ({})), exec: async () => ({}) }
}
const APP = { id: 'app_1', ticket_no: 'AX-001-001', dept: '재무', title: 'x', status: '수용' }

async function send(graded, summary) {
  const db = fakeDB()
  const res = await onRequestPost({
    env: { DB: db },
    params: { id: 'app_1' },
    request: new Request('https://x/api/applications/app_1/beta', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'round', graded, summary }),
    }),
  })
  return { res, body: await res.json(), db }
}

describe('합격 판정은 서버가 한다', () => {
  it('통과라고 우겨도 실패면 안 통과다', async () => {
    const { body } = await send([row(), row({ ord: 2 })], { overall: '통과', passed: 2, failed: 0 })
    expect(body.overall).toBe('차단')
  })

  it('표에 적히는 값도 다시 센 쪽이다', async () => {
    // 응답만 고치고 저장은 보내온 값으로 하면 화면과 기록이 갈라진다.
    const { db } = await send([row(), row({ ord: 2 })], { overall: '통과', passed: 2, failed: 0 })
    const insert = db.written.find((w) => w.sql.includes('INSERT INTO beta_round'))
    expect(insert.args).toContain('차단')
    expect(insert.args).not.toContain('통과')
  })

  it('뒤집었다는 사실을 기록에 남긴다', async () => {
    // 조용히 덮으면 보낸 쪽 화면에는 통과가 떠 있고 기록에는 차단이 남는다.
    const { body, db } = await send([row()], { overall: '통과' })
    expect(body.overruled).toBe('통과')
    // 막은 기록과 뒤집은 기록이 둘 다 남는다. 앞엣것만 보면 안 된다.
    const logs = db.written.filter((w) => w.sql.includes('INSERT INTO decision_log'))
    expect(logs.map((l) => l.args.join(' ')).join(' | ')).toContain('다시 셌다')
  })

  it('맞게 보내면 뒤집지 않는다', async () => {
    // 이 시험이 헛돌지 않는지 본다. 늘 차단이면 아무것도 통과 못 한다.
    const { body } = await send([row({ verdict: '통과' })], { overall: '통과' })
    expect(body.overall).toBe('통과')
    expect(body.overruled).toBeNull()
  })

  it('보낸 쪽이 판정을 아예 안 붙여도 센다', async () => {
    const { body } = await send([row({ verdict: '통과' })], {})
    expect(body.overall).toBe('통과')
  })

  it('통과했을 때만 신청서를 진행중으로 바꾼다', async () => {
    const blocked = await send([row()], { overall: '통과' })
    expect(blocked.db.written.some((w) => w.sql.includes("status = '진행중'"))).toBe(false)
    const ok = await send([row({ verdict: '통과' })], { overall: '통과' })
    expect(ok.db.written.some((w) => w.sql.includes("status = '진행중'"))).toBe(true)
  })
})

describe('세는 함수는 한 벌만', () => {
  it('필수 안전이 깨지면 차단, 아니면 조건부', () => {
    expect(tally([row()]).overall).toBe('차단')
    expect(tally([row({ is_required_safety: 0 })]).overall).toBe('조건부')
    expect(tally([row({ verdict: '통과' })]).overall).toBe('통과')
  })

  it('사람이 볼 항목은 합격 여부를 좌우하지 않는다', () => {
    // "쓰기 불편하다"는 기계가 채점하지 못한다. 그것 때문에 막으면 안 된다.
    const t = tally([row({ verdict: '통과' }), { kind: 'human', verdict: '실패' }])
    expect(t.overall).toBe('통과')
    expect(t.humanNeeded).toBe(1)
  })

  it('빈 입력에도 터지지 않는다', () => {
    expect(tally().overall).toBe('통과')
    expect(tally(null).total).toBe(0)
  })

  it('서버가 그 함수를 실제로 부른다', () => {
    // 규칙을 복사해 두면 언젠가 갈라진다.
    const src = readFileSync(join(ROOT, 'functions', 'api', 'applications', '[id]', 'beta.js'), 'utf8')
    expect(src).toContain("from '../../../../shared/grade.js'")
    expect(src).toContain('tally(graded)')
    // 보내온 판정을 그대로 쓰던 자리가 남아 있으면 안 된다.
    expect(src).not.toMatch(/const s = body\.summary \?\? \{\}/)
  })
})
