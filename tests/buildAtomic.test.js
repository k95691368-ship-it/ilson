import { describe, it, expect } from 'vitest'
import { onRequestPost } from '../functions/api/applications/[id]/build.js'

// 반만 저장된 실행.
//
// 라이브에서 제작 결과를 넣어 봤더니 500이 났는데, 확인해 보니 이렇게 남아
// 있었다 —
//
//   build_run 1건, rows_out = 2, build_row 0건
//
// 머리글은 들어갔고 줄에서 엎어진 것이다. 그런데 화면은 머리글을 읽어서
// 처리 건수를 말하므로 "2줄 처리함"이 멀쩡하게 떴다. 숫자를 눌러 원본
// 몇 번째 줄에서 왔는지 되짚으려 하면 그때 비어 있다. 이 앱이 처음부터
// 끝까지 하는 약속이 그 되짚기라서, 이건 빈 표가 아니라 거짓말이다.
//
// 게다가 단계는 넘어갔다. overview 는 build_run 이 있으면 제작을 지난 것으로
// 세기 때문에, 저장에 실패한 사람의 화면에서 다음 단계 안내가 떴다.

// 어느 문장을 받았는지 적어 두는 D1 흉내.
function spyDB({ failOn } = {}) {
  const seen = []
  const stmt = (sql) => ({
    bind: (...args) => {
      seen.push({ sql, args })
      return stmt(sql)
    },
    first: async () => null,
    all: async () => ({ results: [] }),
    run: async () => {
      if (failOn && sql.includes(failOn)) throw new Error('D1_TYPE_ERROR')
      return { meta: {} }
    },
  })
  return {
    seen,
    prepare: (sql) => stmt(sql),
    batch: async (list) => {
      // batch 안의 문장은 bind 단계에서 이미 seen 에 들어가 있다.
      if (failOn && seen.some((s) => s.sql.includes(failOn))) throw new Error('D1_TYPE_ERROR')
      return (list ?? []).map(() => ({ meta: {} }))
    },
    exec: async () => ({}),
  }
}

const APP = { id: 'app_1', ticket_no: 'AX-001-001', dept: '재무', title: 'x', status: '수용' }

function dbWithApp(opts) {
  const db = spyDB(opts)
  const prepare = db.prepare
  db.prepare = (sql) => {
    const s = prepare(sql)
    if (sql.includes('FROM application')) return { ...s, bind: () => ({ ...s, first: async () => APP }) }
    return s
  }
  return db
}

const post = (db, body) =>
  onRequestPost({
    env: { DB: db },
    params: { id: 'app_1' },
    request: new Request('https://x/api/applications/app_1/build', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  })

const ROW = {
  date: '2026-08-01',
  iso_week: '2026-W31',
  sku: 'SKU-1',
  channel: 'A',
  gross_krw: 1000,
}

describe('줄을 못 넣으면 머리글도 안 남는다', () => {
  it('빠진 칸이 있으면 아무것도 안 쓴다', async () => {
    const db = dbWithApp()
    const res = await post(db, { kind: 'run', rows: [{ sku: 'SKU-1', channel: 'A' }] })

    expect(res.status).toBe(400)
    const body = await res.json()
    // 무엇이 비었는지 사람 말로 짚는다. "D1_TYPE_ERROR" 는 답이 아니다.
    expect(body.fields.join(' ')).toContain('날짜')
    expect(body.fields.join(' ')).toContain('주차')

    // 머리글이 한 줄도 안 들어갔어야 한다.
    expect(db.seen.some((s) => s.sql.includes('INSERT INTO build_run'))).toBe(false)
  })

  it('밀린 줄에 사유가 없어도 막는다', async () => {
    const db = dbWithApp()
    const res = await post(db, { kind: 'run', quarantine: [{ source: { file: 'a.csv' } }] })
    expect(res.status).toBe(400)
    expect((await res.json()).fields.join(' ')).toContain('사유')
  })

  it('줄에서 엎어지면 머리글을 거둔다', async () => {
    const db = dbWithApp({ failOn: 'INSERT INTO build_row' })
    const res = await post(db, { kind: 'run', rows: [ROW] })

    expect(res.status).toBe(500)
    // 머리글은 이미 들어갔다. 그러니 지우는 문장이 뒤따라야 한다.
    expect(db.seen.some((s) => s.sql.includes('INSERT INTO build_run'))).toBe(true)
    expect(db.seen.some((s) => s.sql.includes('DELETE FROM build_run'))).toBe(true)
    // 앞서 들어간 줄도 함께 거둔다.
    expect(db.seen.some((s) => s.sql.includes('DELETE FROM build_row'))).toBe(true)
    expect(db.seen.some((s) => s.sql.includes('DELETE FROM build_quarantine'))).toBe(true)
  })

  it('멀쩡하면 지우지 않는다', async () => {
    // 위 시험이 헛돌지 않는지 본다. 늘 지우면 아무것도 안 남는다.
    const db = dbWithApp()
    const res = await post(db, { kind: 'run', rows: [ROW] })
    expect(res.status).toBe(201)
    expect(db.seen.some((s) => s.sql.includes('DELETE FROM build_run'))).toBe(false)
  })

  it('지우는 대상이 그 실행 하나다', async () => {
    // run_id 조건이 빠지면 남의 실행까지 지운다.
    const db = dbWithApp({ failOn: 'INSERT INTO build_row' })
    await post(db, { kind: 'run', rows: [ROW] })
    for (const s of db.seen.filter((x) => x.sql.startsWith('DELETE FROM build'))) {
      expect(s.sql).toMatch(/WHERE (id|run_id) = \?/)
      expect(s.args).toHaveLength(1)
      expect(String(s.args[0])).toMatch(/^run_/)
    }
  })
})
