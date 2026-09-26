// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { compileSql } from '../functions/_lib/dbBridge.ts'
import { onRequestGet as outcomeGet } from '../functions/api/applications/[id]/outcome.js'
import { onRequestGet as toolGet } from '../functions/api/tools/[slug].js'
import { onRequestGet as deptGet } from '../functions/api/depts/[dept].js'
import { onRequestGet as honestyGet } from '../functions/api/honesty.js'

const pg = new PGlite()
const DB = {
  prepare(sql) {
    const statement = (binds = []) => ({
      bind: (...values) => statement(values),
      all: async () => ({ results: (await pg.query(compileSql(sql, binds))).rows }),
      first: async () => (await pg.query(compileSql(sql, binds))).rows[0] ?? null,
    })
    return statement()
  },
  rateLimitState: async () => ({ remaining: 20, nextFreeAt: null }),
}
const env = { DB }
beforeAll(async () => {
  await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;')
  const directory = new URL('../supabase/migrations/', import.meta.url)
  for (const name of readdirSync(directory).filter(name => /^\d+.*\.sql$/.test(name)).sort()) {
    await pg.exec(readFileSync(new URL(name, directory), 'utf8'))
  }
  await pg.exec(`INSERT INTO application(id,ticket_no,dept,applicant_label,title,bottleneck,problem,current_frequency)
    VALUES('outcome-test','AX-OUTCOME','검증부서','검증자','실패 비용 검증','수작업','지연','매일');
    INSERT INTO baseline(application_id,median_seconds,min_seconds,max_seconds,sample_n,people,frequency,hourly_wage_krw)
    VALUES('outcome-test',600,600,600,5,1,'매일',3600);
    INSERT INTO handover(application_id,slug,title,handed_to_dept,handed_to_person)
    VALUES('outcome-test','outcome-test-tool','시험 도구','검증부서','담당자');`)
}, 60000)
beforeEach(async () => { await pg.exec("DELETE FROM tool_use WHERE application_id='outcome-test'") })
afterAll(async () => { await pg.close() })

async function addRun(id, ok, rework) {
  await pg.query('INSERT INTO tool_use(id,application_id,ok,duration_ms,human_review_seconds,rework_seconds) VALUES($1,$2,$3,1000,30,$4)', [id, 'outcome-test', ok, rework])
}
async function allViews() {
  const responses = await Promise.all([
    outcomeGet({ env, params: { id: 'outcome-test' } }),
    toolGet({ env, params: { slug: 'outcome-test-tool' }, request: new Request('https://test.invalid/api/tools/outcome-test-tool') }),
    deptGet({ env, params: { dept: '검증부서' } }),
    honestyGet({ env }),
  ])
  expect(responses.map(response => response.status)).toEqual([200, 200, 200, 200])
  const [outcome, tool, dept, honesty] = await Promise.all(responses.map(response => response.json()))
  return { outcome, tool, dept, honesty }
}

describe.sequential('실제 PostgreSQL 성과·도구·부서·정직 API 실패 비용 회귀', () => {
  it('실패 1회만 있으면 모든 화면이 비용을 남기고 절감이나 연 환산을 인정하지 않는다', async () => {
    await addRun('failed', 0, 60)
    const { outcome, tool, dept, honesty } = await allViews()
    expect(outcome.outcome).toMatchObject({ runCount: 1, successCount: 0, failedCount: 1, manualSeconds: 0, afterSeconds: 91, savedSeconds: -91 })
    expect(outcome.annual).toBeNull()
    expect(outcome.label.label).toBe('성공 확인 없음')
    expect(tool.payoff).toMatchObject({ successCount: 0, failedCount: 1, savedKrw: -91, perRunMinutes: null })
    expect(dept.returned).toMatchObject({ show: true, unconfirmedSeconds: -91 })
    expect(dept.returned.unconfirmed[0]).toMatchObject({ seconds: -91, successCount: 0, failedCount: 1 })
    expect(honesty.unresolvedChallenges.map(item => item.rule_code)).toEqual(expect.arrayContaining(['slower_than_before', 'unsuccessful_runs']))
    expect((await pg.query("SELECT count(*) AS n FROM tool_use WHERE ok=0 AND application_id='outcome-test'")).rows[0].n).toBe(1)
  })
  it('성공 1회와 실패 1회의 비용을 모두 빼서 같은 478초를 보고한다', async () => {
    await addRun('success', 1, 0)
    await addRun('failed', 0, 60)
    const { outcome, tool, dept, honesty } = await allViews()
    expect(outcome.outcome).toMatchObject({ attemptCount: 2, successCount: 1, failedCount: 1, manualSeconds: 600, autoSeconds: 2, reviewSeconds: 60, reworkSeconds: 60, savedSeconds: 478 })
    expect(tool.payoff).toMatchObject({ successCount: 1, failedCount: 1, savedKrw: 478 })
    expect(dept.returned.unconfirmedSeconds).toBe(478)
    expect(outcome.annual.seconds).toBe(478 * 250)
    const expected = outcome.challenges.filter(item => !item.resolved_at).map(item => item.code).sort()
    expect(honesty.unresolvedChallenges.map(item => item.rule_code).sort()).toEqual(expected)
    expect(tool.payoff.openChallenges).toBe(expected.length)
  })
  it('성공한 실행만 있는 기존 성과는 유지한다', async () => {
    await addRun('success1', 1, 0)
    await addRun('success2', 1, 0)
    const { outcome, tool, dept, honesty } = await allViews()
    expect(outcome.outcome).toMatchObject({ attemptCount: 2, successCount: 2, failedCount: 0, manualSeconds: 1200, afterSeconds: 62, savedSeconds: 1138 })
    expect(tool.payoff.savedKrw).toBe(1138)
    expect(dept.returned.unconfirmedSeconds).toBe(1138)
    expect(honesty.unresolvedChallenges.some(item => item.rule_code === 'unsuccessful_runs')).toBe(false)
  })
})
