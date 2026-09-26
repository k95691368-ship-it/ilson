// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { createSupabaseDb } from '../functions/_lib/dbBridge.ts'
import { onRequestGet as outcomeGet, onRequestPost as outcomePost } from '../functions/api/applications/[id]/outcome.js'
import { onRequestPost as confirmPost } from '../functions/api/track/[ticket]/outcome.js'
import { onRequestGet as overviewGet } from '../functions/api/overview.js'
import { onRequestGet as responseGet } from '../functions/api/response.js'
import { onRequestGet as honestyGet } from '../functions/api/honesty.js'
import { onRequestGet as deptGet } from '../functions/api/depts/[dept].js'
import { onRequestGet as toolGet } from '../functions/api/tools/[slug].js'
import { onRequestGet as trackGet } from '../functions/api/track/[ticket].js'
import { onRequestGet as recordGet } from '../functions/api/applications/[id]/record.js'
import { dossierText } from '../shared/dossier.js'

const pg = new PGlite()
const base = 'https://outcome-consumers-local.supabase.co'
const DB = createSupabaseDb(base, 'memory-only')
let queue = Promise.resolve(), sequence = 0, lastError = ''

beforeAll(async () => {
  await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;')
  const directory = new URL('../supabase/migrations/', import.meta.url)
  for (const name of readdirSync(directory).filter(name => /^\d+.*\.sql$/.test(name)).sort()) {
    await pg.exec(readFileSync(new URL(name, directory), 'utf8'))
  }
  vi.stubGlobal('fetch', (url, options) => {
    if (!String(url).startsWith(base + '/rest/v1/rpc/')) throw new Error('External network blocked')
    const pending = queue.then(async () => {
      try {
        await pg.exec('SET ROLE service_role')
        const name = new URL(url).pathname.split('/').at(-1), args = Object.values(JSON.parse(options.body))
        const result = await pg.query(`SELECT public.${name}(${args.map((_, index) => '$' + (index + 1)).join(',')}) AS data`, args)
        return Response.json(result.rows[0].data)
      } catch (error) {
        lastError = `${error.code}: ${error.message}`
        return Response.json({ code: error.code }, { status: 400 })
      } finally { await pg.exec('RESET ROLE') }
    })
    queue = pending.catch(() => {})
    return pending
  })
}, 60000)

afterAll(async () => { vi.unstubAllGlobals(); await pg.close() })

function request(body) {
  return new Request('https://local.invalid/api/outcome', {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': crypto.randomUUID(), 'X-Idempotency-Key': crypto.randomUUID() },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
}
async function data(response, status = 200) {
  expect(response.status, lastError).toBe(status)
  return response.json()
}
const getOutcome = app => outcomeGet({ env: app.env, params: { id: app.id } }).then(data)
async function post(app, body) {
  return outcomePost({ env: app.env, params: { id: app.id }, request: request({ expectedEvidence: (await getOutcome(app)).expectedEvidence, ...body }) })
}

async function fixture() {
  const number = ++sequence, id = `consumer-app-${number}`, ticket = `AX-CNS-${String(number).padStart(3, '0')}`
  const email = `consumer-${number}@local.invalid`, dept = `검증부서 ${number}`, slug = `consumer-tool-${number}`
  await pg.query("INSERT INTO override_actor(email,display_name,role,departments_json) VALUES($1,'현장 검증자','product',$2)", [email, JSON.stringify([dept])])
  await pg.query(`INSERT INTO application(id,ticket_no,dept,applicant_label,title,bottleneck,problem,status,current_frequency,owner_email)
    VALUES($1,$2,$3,'검증자',$4,'수작업','지연','완료','매일',$5)`, [id, ticket, dept, `격리된 성과 ${number}`, email])
  await pg.query(`INSERT INTO baseline(application_id,median_seconds,min_seconds,max_seconds,sample_n,people,frequency,hourly_wage_krw)
    VALUES($1,600,600,600,5,1,'매일',3600)`, [id])
  await pg.query(`INSERT INTO handover(application_id,slug,title,handed_to_dept,handed_to_person,accepted_at,accepted_by)
    VALUES($1,$2,'검증 도구',$3,'현장 담당',datetime('now'),'현장 담당')`, [id, slug, dept])
  // All runs share a second and insertion order is opposite to ID order. The
  // printable record and all live consumers must still fingerprint identically.
  for (const index of [4, 3, 2, 1]) {
    await pg.query(`INSERT INTO tool_use(id,application_id,used_at,ok,duration_ms,human_review_seconds,rework_seconds,rows_out,quarantined)
      VALUES($1,$2,'2026-09-26 01:00:00',1,1000,30,0,10,0)`, [`${id}-run-${index}`, id])
  }
  const env = { DB: DB.forActor(email), AUTH_ACTOR: { mode: 'access', email, label: '현장 검증자', role: 'product', departments: [dept] } }
  return { id, ticket, dept, slug, email, env }
}

async function confirmAndResolve(app, { proxy = false } = {}) {
  if (proxy) await data(await post(app, { kind: 'dept_confirm', by: '현장 검증자', comment: '현재 근거 확인' }))
  else await data(await confirmPost({ env: app.env, params: { ticket: app.ticket }, request: request({
    expectedEvidence: (await getOutcome(app)).expectedEvidence, by: '현장 검증자', agree: true,
  }) }))
  for (const challenge of (await getOutcome(app)).challenges) {
    await data(await post(app, { kind: 'resolve_challenge', rule_code: challenge.code, resolution: `현재 자료에서 ${challenge.code} 확인` }))
  }
}

async function views(app, env = app.env) {
  const replies = await Promise.all([
    outcomeGet({ env, params: { id: app.id } }),
    overviewGet({ env }), responseGet({ env }), honestyGet({ env }),
    deptGet({ env, params: { dept: app.dept } }),
    toolGet({ env, params: { slug: app.slug }, request: request() }),
    trackGet({ env, params: { ticket: app.ticket }, request: request() }),
    recordGet({ env, params: { id: app.id } }),
  ])
  const [outcome, overview, response, honesty, dept, tool, track, record] = await Promise.all(replies.map(reply => data(reply)))
  return { outcome, overview, response, honesty, dept, tool, track, record }
}

function expectConsistent(app, all, current, { proxy = false } = {}) {
  const { outcome, overview, response, honesty, dept, tool, track, record } = all
  expect(outcome.confirmation.current).toBe(current)
  expect(overview.recent.find(row => row.id === app.id).stage).toBe(current ? '성과' : '배포')
  expect(response.per.find(row => row.key === 'outcome')).toMatchObject({
    asked: 1, answered: current && !proxy ? 1 : 0, proxied: current && proxy ? 1 : 0,
  })
  const open = outcome.challenges.filter(row => !row.resolved_at).map(row => row.code).sort()
  expect(honesty.unresolvedChallenges.filter(row => row.ticket_no === app.ticket).map(row => row.rule_code).sort()).toEqual(open)
  expect(dept.returned.confirmed.map(row => row.ticket_no)).toEqual(current ? [app.ticket] : [])
  expect(dept.returned.unconfirmed.map(row => row.ticket_no)).toEqual(current ? [] : [app.ticket])
  expect(dept.pending.some(row => row.code === 'outcome' && row.ticket_no === app.ticket)).toBe(!current || proxy)
  expect(tool.payoff).toMatchObject({ label: outcome.label.label, openChallenges: open.length, savedKrw: outcome.outcome.savedKrw })
  expect(track.timeline.find(row => row.stage === '성과').status).toBe(current ? '완료' : '집계 중')
  expect(track.needs.some(row => row.code === 'outcome_unconfirmed')).toBe(!current)
  expect(record.done.성과).toBe(current)
  expect(Boolean(record.outcome?.dept_confirmed_at)).toBe(current)
  expect(record.moneyLabel.label).toBe(outcome.label.label)
  expect(record.money.netKrw).toBe(outcome.outcome.netKrw)
  expect(record.challenges.filter(row => !row.resolved_at).map(row => row.rule_code).sort()).toEqual(open)
}

describe.sequential('scoped PostgreSQL evidence is consistent across every outcome consumer', () => {
  it('direct confirmation and resolutions are current on all 8 paths, including same-second reverse-ID runs', async () => {
    const app = await fixture()
    await confirmAndResolve(app)
    const all = await views(app)
    expectConsistent(app, all, true)
    expect(all.outcome.label.label).toBe('확인됨')
    expect(all.outcome.outcome.netKrw).toBe(2276)
    expect(all.record.decisions.some(row => row.link_kind === '성과확인')).toBe(true)
  })

  it.each(['cost', 'run', 'baseline'])('%s changes invalidate all live claims, preserve original audit, and permit a new confirmation', async change => {
    const app = await fixture()
    await confirmAndResolve(app)
    const before = await views(app)
    expectConsistent(app, before, true)
    const audit = (await pg.query('SELECT * FROM decision_log WHERE application_id=$1 ORDER BY id', [app.id])).rows
    const stored = (await pg.query('SELECT dept_confirmed_at,dept_confirmed_by,dept_comment FROM outcome WHERE application_id=$1', [app.id])).rows[0]
    if (change === 'cost') await data(await post(app, { kind: 'inputs', dev_hours: 0, ops_cost_krw: 100 }))
    if (change === 'run') await pg.query(`INSERT INTO tool_use(id,application_id,used_at,ok,duration_ms,human_review_seconds,rework_seconds)
      VALUES($1,$2,'2026-09-26 02:00:00',1,1000,30,0)`, [`${app.id}-new`, app.id])
    if (change === 'baseline') await pg.query('UPDATE baseline SET median_seconds=900 WHERE application_id=$1', [app.id])
    const after = await views(app)
    expectConsistent(app, after, false)
    expect(after.outcome.confirmation.previous.by).toBe('현장 검증자')
    expect(after.record.outcome.previous_confirmation.by).toBe('현장 검증자')
    expect(after.track.timeline.find(row => row.stage === '성과').summary).toContain('다시 확인')
    const afterRows = (await pg.query('SELECT * FROM decision_log WHERE application_id=$1 ORDER BY id', [app.id])).rows
    for (const original of audit) expect(afterRows.find(row => row.id === original.id)).toEqual(original)
    expect((await pg.query('SELECT dept_confirmed_at,dept_confirmed_by,dept_comment FROM outcome WHERE application_id=$1', [app.id])).rows[0]).toEqual(stored)
    for (const original of audit) expect(after.record.decisions.find(row => row.id === original.id)).toEqual(original)
    await confirmAndResolve(app)
    expectConsistent(app, await views(app), true)
  })

  it('proxy confirmation is not counted as a direct departmental reply and expires with the same evidence', async () => {
    const app = await fixture()
    await confirmAndResolve(app, { proxy: true })
    expectConsistent(app, await views(app), true, { proxy: true })
    await data(await post(app, { kind: 'inputs', dev_hours: 1 }))
    expectConsistent(app, await views(app), false, { proxy: true })
  })

  it('the printed annual estimate uses the same sealed frequency as the live outcome, not a later application claim', async () => {
    const app = await fixture()
    await pg.query('UPDATE baseline SET frequency=NULL WHERE application_id=$1', [app.id])
    await confirmAndResolve(app)
    const all = await views(app)
    expectConsistent(app, all, true)
    expect(all.outcome.annual).toBeNull()
    expect(all.record.money.annual).toBe(all.outcome.annual)
  })

  it('legacy resolution evidence remains available in the complete record without being treated as current proof', async () => {
    const app = await fixture()
    const legacyProof = '이전 월의 정산 기간과 처리량을 비교한 과거 근거'
    await pg.query("INSERT INTO outcome(application_id,dept_confirmed_at,dept_confirmed_by) VALUES($1,'2026-08-01 00:00:00','이전 담당')", [app.id])
    await pg.query(`INSERT INTO outcome_challenge(id,application_id,rule_code,title,body,resolved_at,resolution)
      VALUES($1,$2,'seasonality','이전 계절성 확인','이전 계산','2026-08-01 00:00:00',$3)`, [`${app.id}-legacy-proof`, app.id, legacyProof])
    const all = await views(app)
    expectConsistent(app, all, false)
    expect(all.outcome.challenges.find(row => row.code === 'seasonality')).toMatchObject({ resolved_at: null, previousResolution: legacyProof })
    expect(all.record.challenges.find(row => row.rule_code === 'seasonality')).toMatchObject({
      resolved_at: null, resolution: null, previousResolution: legacyProof, previousResolvedAt: '2026-08-01 00:00:00',
    })
    expect(JSON.stringify(all.record)).toContain(legacyProof)
    const exported = dossierText(all.record)
    expect(exported).toContain('[미해소] 이번 기간이 평소와 달랐을 수 있습니다')
    expect(exported).toContain('과거 해소')
    expect(exported).toContain(legacyProof)
    expect(exported).toContain('현재 근거로 재확인 필요')
    expect((await pg.query('SELECT resolution FROM outcome_challenge WHERE application_id=$1', [app.id])).rows[0].resolution).toBe(legacyProof)
  })

  it('other actor scopes see neither the confirmation nor the underlying application evidence', async () => {
    const app = await fixture(), other = await fixture()
    await confirmAndResolve(app)
    const replies = await Promise.all([
      outcomeGet({ env: other.env, params: { id: app.id } }),
      toolGet({ env: other.env, params: { slug: app.slug }, request: request() }),
      trackGet({ env: other.env, params: { ticket: app.ticket }, request: request() }),
      recordGet({ env: other.env, params: { id: app.id } }),
    ])
    expect(replies.map(reply => reply.status)).toEqual([404, 404, 404, 404])
    const overview = await overviewGet({ env: other.env }).then(data)
    const response = await responseGet({ env: other.env }).then(data)
    const honesty = await honestyGet({ env: other.env }).then(data)
    const dept = await deptGet({ env: other.env, params: { dept: app.dept } }).then(data)
    expect(overview.recent.map(row => row.id)).toEqual([other.id])
    expect(response.per.find(row => row.key === 'outcome')).toMatchObject({ asked: 1, answered: 0, proxied: 0 })
    expect(honesty.unresolvedChallenges.every(row => row.ticket_no === other.ticket)).toBe(true)
    expect(dept.applications).toEqual([])
    expect(dept.returned.show).toBe(false)
    expect(JSON.stringify([overview, response, honesty, dept])).not.toContain(app.ticket)
    const forbidden = await confirmPost({ env: other.env, params: { ticket: app.ticket }, request: request({
      by: '다른 부서', agree: true, expectedEvidence: (await getOutcome(app)).expectedEvidence,
    }) })
    expect(forbidden.status).toBe(404)
    expect((await getOutcome(app)).confirmation.current).toBe(true)
  })

  it('identical application IDs in separate private demos do not share confirmation, costs, or history', async () => {
    const spaces = []
    for (const token of ['a'.repeat(64), 'b'.repeat(64)]) {
      await DB.workspaceOpen(token, [])
      const scoped = createSupabaseDb(base, 'memory-only', token)
      const app = { id: 'same-private-app', ticket: 'AX-PRV-001', dept: '개인 검증', slug: 'same-private-tool', env: { DB: scoped, DEMO_WORKSPACE: true } }
      await scoped.prepare(`INSERT INTO application(id,ticket_no,dept,applicant_label,title,bottleneck,problem,status,current_frequency)
        VALUES(?,?,?,'검증자','개인 성과','수작업','지연','완료','매일')`).bind(app.id, app.ticket, app.dept).run()
      await scoped.prepare(`INSERT INTO baseline(application_id,median_seconds,min_seconds,max_seconds,sample_n,people,frequency,hourly_wage_krw)
        VALUES(?,600,600,600,5,1,'매일',3600)`).bind(app.id).run()
      await scoped.prepare(`INSERT INTO handover(application_id,slug,title,handed_to_dept,handed_to_person)
        VALUES(?,?,'개인 도구',?,'담당자')`).bind(app.id, app.slug, app.dept).run()
      for (let index = 1; index <= 4; index++) await scoped.prepare(`INSERT INTO tool_use(id,application_id,used_at,ok,duration_ms,human_review_seconds,rework_seconds)
        VALUES(?,?,'2026-09-26 01:00:00',1,1000,30,0)`).bind(`same-run-${index}`, app.id).run()
      spaces.push(app)
    }
    const [first, second] = spaces
    await confirmAndResolve(first)
    expectConsistent(first, await views(first), true)
    expectConsistent(second, await views(second), false)
    await data(await post(second, { kind: 'inputs', ops_cost_krw: 700 }))
    const a = await getOutcome(first), b = await getOutcome(second)
    expect(a.outcome.netKrw).toBe(2276)
    expect(b.outcome.netKrw).toBe(1576)
    expect(a.confirmation.current).toBe(true)
    expect(b.confirmation.current).toBe(false)
    expect((await second.env.DB.prepare("SELECT count(*) AS n FROM decision_log WHERE link_kind='성과확인'").first()).n).toBe(0)
    expect((await DB.prepare('SELECT count(*) AS n FROM application WHERE id=?').bind(first.id).first()).n).toBe(0)
  }, 60000)
})
