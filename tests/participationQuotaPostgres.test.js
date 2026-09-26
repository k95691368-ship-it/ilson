// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { createSupabaseDb } from '../functions/_lib/dbBridge.js'
import { checkRateLimit, releaseRateLimit, remainingQuota, quotaState } from '../functions/_lib/rateLimit.js'
import { requiredDeptsOf, fullySignedIds } from '../functions/_lib/signoff.js'
import { onRequestPost as join, loadJoins } from '../functions/api/applications/[id]/join.js'
import { onRequestGet as getSignoff, onRequestPost as signoff } from '../functions/api/track/[ticket]/signoff.js'
import { onRequestGet as getTool, onRequestPost as saveTool } from '../functions/api/tools/[slug].js'
import { DEPTS } from '../shared/depts.js'

const pg = new PGlite(), base = 'https://participation-local.supabase.co'
const DB = createSupabaseDb(base, 'memory-test-only')
const finance = 'finance@local.invalid', marketing = 'marketing@local.invalid', owner = 'owner@local.invalid', other = 'other@local.invalid', admin = 'admin@local.invalid'
let queue = Promise.resolve()
const actors = [[finance, 'product', ['재무']], [marketing, 'reviewer', ['마케팅']], [owner, 'reviewer', ['재무']], [other, 'operations', ['영업']], [admin, 'audit', []]]
const env = email => {
  const [,role,departments] = actors.find(row => row[0] === email)
  return { DB: DB.forActor(email), UNSCOPED_DB: DB, OVERRIDE_DEMO_MODE: 'false', AUTH_ACTOR: { email, label: email, role, departments, mode: 'access' } }
}
const request = body => new Request('https://local.invalid/api/test', { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '127.0.0.1' }, body: JSON.stringify(body) })
const register = (email, body, id = 'app-main') => join({ env: env(email), params: { id }, request: request(body) })
const joinBody = dept => ({ dept, by: '담당자', minutes: 30, people: 1, frequency: '주 1회', story: '매주 같은 자료를 다시 모으는 업무를 하고 있습니다.' })
const sign = async (email, department, verdict = 'ok') => signoff({ env: env(email), params: { ticket: 'AX-ABC-123' }, request: request({ by: '확인자', dept: department, expectedVersion:(await(await getSignoff({env:env(email),params:{ticket:'AX-ABC-123'}})).json()).expectedVersion, verdicts: { criterion: verdict }, reasons: { criterion: '실제 업무 기준과 달라 확인이 필요합니다.' } }) })

beforeAll(async () => {
  await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;')
  const migrationDir = new URL('../supabase/migrations/', import.meta.url)
  for (const file of readdirSync(migrationDir).filter(file => /^\d+.*\.sql$/.test(file)).sort()) await pg.exec(readFileSync(new URL(file, migrationDir), 'utf8'))
  vi.stubGlobal('fetch', (url, options) => {
    if (!String(url).startsWith(base + '/rest/v1/rpc/')) throw Error('External network blocked')
    const result = queue.then(async () => {
      try {
        await pg.exec('SET ROLE service_role')
        const name = new URL(url).pathname.split('/').at(-1), args = Object.values(JSON.parse(options.body))
        return Response.json((await pg.query(`SELECT public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) data`, args)).rows[0].data)
      } catch (error) { return Response.json({ code: error.code, message: error.message }, { status: 400 }) }
      finally { await pg.exec('RESET ROLE') }
    })
    queue = result.catch(() => {})
    return result
  })
  for (const [email,role,departments] of actors) await DB.prepare('INSERT INTO override_actor(email,display_name,role,departments_json) VALUES(?,?,?,?)').bind(email,email,role,JSON.stringify(departments)).run()
  for (const [id,ticket,email] of [['app-main','AX-ABC-123',owner],['app-unrelated','AX-DEF-456',owner],['app-legacy','AX-LEG-789',null]]) {
    await DB.prepare("INSERT INTO application(id,ticket_no,dept,applicant_label,title,bottleneck,problem,owner_email) VALUES(?,?,'재무','신청자','검증 신청','취합','반복',?)").bind(id,ticket,email).run()
  }
  await DB.prepare("INSERT INTO acceptance_criterion(id,application_id,ord,body,confirmed_at) VALUES('criterion','app-main',1,'원본과 금액 일치',datetime('now'))").run()
  await DB.prepare("INSERT INTO handover(application_id,slug,title,handed_to_dept,handed_to_person,daily_limit) VALUES('app-main','quota-tool','검증 도구','재무','신청자',1)").run()
}, 60000)
afterAll(async () => { vi.unstubAllGlobals(); await pg.close() })

describe.sequential('explicit participation and actor-bound quota PostgreSQL paths', () => {
  it('keeps allowed departments aligned and grants no access from arbitrary historical logs', async () => {
    expect((await pg.query('SELECT id FROM ilson_private.participation_departments')).rows.map(row => row.id).sort()).toEqual([...DEPTS].sort())
    await env(owner).DB.prepare("INSERT INTO decision_log(id,application_id,stage,title,what,why,alternatives,link_kind,link_id) VALUES('free-log','app-unrelated','신청서','마케팅 — 우리도 같은 일을 겪는다','현장 의견','기록','{\"dept\":\"마케팅\"}','같은건손듦','app-unrelated')").run()
    expect(await env(marketing).DB.prepare("SELECT id FROM application WHERE id='app-unrelated'").first()).toBeNull()
    expect(await requiredDeptsOf(env(finance),'app-unrelated','재무')).toEqual(['재무'])
    await env(finance).DB.prepare("INSERT INTO decision_log(id,application_id,stage,title,what,why,link_kind,link_id) VALUES('unrelated-sign','app-unrelated','협의안','확인자','확인함','기준 확인','기준서명','재무')").run()
    expect(await fullySignedIds(env(finance),[{id:'app-unrelated',dept:'재무'}])).toEqual(new Set())
    await expect(env(owner).DB.prepare('INSERT INTO application_participation(id,application_id,department_id,granted_by_email) VALUES(?,?,?,?)').bind('free-log','app-unrelated','마케팅',owner).run()).rejects.toThrow('/42501')
  })
  it('registers a verified department and lets its employee read and sign only the linked application', async () => {
    const response = await register(finance,joinBody('마케팅'))
    expect(response.status,await response.clone().text()).toBe(201)
    const loaded = await getSignoff({ env: env(marketing), params: { ticket: 'AX-ABC-123' } })
    expect(loaded.status,await loaded.clone().text()).toBe(200)
    expect((await loaded.json()).requiredDepts).toEqual(['재무','마케팅'])
    expect((await getSignoff({ env: env(other), params: { ticket: 'AX-ABC-123' } })).status).toBe(404)
    const signed = await sign(marketing,'마케팅')
    expect(signed.status,await signed.clone().text()).toBe(200)
    const objection = await sign(marketing,'마케팅','no')
    expect(objection.status,await objection.clone().text()).toBe(200)
    expect((await sign(marketing,'재무')).status).toBe(403)
    expect((await env(marketing).DB.prepare('SELECT id FROM application').all()).results).toEqual([{id:'app-main'}])
    expect((await env(marketing).DB.prepare("UPDATE application SET title='forged' WHERE id='app-main'").run()).meta.changes).toBe(0)
    await expect(env(marketing).DB.prepare("INSERT INTO build_run(id,application_id,seq) VALUES('forged-build','app-main',1)").run()).rejects.toThrow('/42501')
    expect((await env(marketing).DB.prepare('SELECT * FROM handover').all()).results).toEqual([])
    const another = await register(finance,joinBody('영업'))
    expect(another.status,await another.clone().text()).toBe(201)
    expect(await requiredDeptsOf(env(marketing),'app-main','재무')).toEqual(['재무','마케팅','영업'])
    expect(await fullySignedIds(env(finance),[{id:'app-main',dept:'재무'}])).toEqual(new Set())
  })
  it('rejects invented departments, forged grant identities and legacy unknown ownership', async () => {
    expect((await register(finance,joinBody('임의부서'))).status).toBe(400)
    expect((await register(admin,joinBody('마케팅'),'app-legacy')).status).toBe(409)
    expect((await DB.prepare("SELECT id FROM decision_log WHERE application_id='app-legacy'").all()).results).toEqual([])
    await expect(env(finance).DB.prepare('INSERT INTO application_participation(id,application_id,department_id,granted_by_email) VALUES(?,?,?,?)').bind('free-log','app-unrelated','마케팅',admin).run()).rejects.toThrow('/42501')
    await expect(env(finance).DB.prepare('INSERT INTO application_participation(id,application_id,department_id,granted_by_email) VALUES(?,?,?,?)').bind('free-log','app-unrelated','임의부서',finance).run()).rejects.toThrow('/23503')
    const old = await register(finance,joinBody('마케팅'),'app-unrelated')
    expect(old.status).toBe(409)
    expect((await old.json()).error).toContain('관리자')
    expect((await register(finance,{kind:'authorize',join_id:'free-log',dept:'마케팅'},'app-unrelated')).status).toBe(403)
    const approved = await register(admin,{kind:'authorize',join_id:'free-log',dept:'마케팅'},'app-unrelated')
    expect(approved.status,await approved.clone().text()).toBe(201)
    expect(await env(marketing).DB.prepare("SELECT id FROM application WHERE id='app-unrelated'").first()).toEqual({id:'app-unrelated'})
  })
  it('revokes participation and account scope without granting onward management access', async () => {
    const current = (await loadJoins(env(finance),'app-main')).find(row => row.dept==='마케팅')
    await expect(env(marketing).DB.prepare('UPDATE application_participation SET department_id=? WHERE id=?').bind('영업',current.id).run()).resolves.toMatchObject({meta:{changes:0}})
    const released = await register(finance,{kind:'release',join_id:current.id,reason:'별도 신청으로 처리하기로 결정했습니다.'})
    expect(released.status,await released.clone().text()).toBe(200)
    expect((await getSignoff({env:env(marketing),params:{ticket:'AX-ABC-123'}})).status).toBe(404)
    expect(await requiredDeptsOf(env(finance),'app-main','재무')).toEqual(['재무','영업'])
    await DB.prepare("UPDATE override_actor SET departments_json='[]' WHERE email=?").bind(marketing).run()
    expect(await env(marketing).DB.prepare("SELECT id FROM application WHERE id='app-unrelated'").first()).toBeNull()
    await DB.prepare('UPDATE override_actor SET departments_json=? WHERE email=?').bind('["마케팅"]',marketing).run()
  })
  it('refunds rejected release/authorization and repeated legacy confirmation requests', async () => {
    const before=await remainingQuota(env(finance),'join:127.0.0.1',10,3600)
    for (const [body,status] of [[{kind:'release'},400],[{kind:'release',join_id:'missing',reason:'짧음'},400],
      [{kind:'release',join_id:'missing',reason:'연결된 기록이 아닙니다.'},404],
      [{kind:'authorize',join_id:'free-log',dept:'마케팅'},403]]) {
      expect((await register(finance,body)).status).toBe(status)
      expect(await remainingQuota(env(finance),'join:192.0.2.1',10,3600)).toBe(before)
    }
    const adminBefore=await remainingQuota(env(admin),'join:127.0.0.1',10,3600)
    const duplicate=await register(admin,{kind:'authorize',join_id:'free-log',dept:'마케팅'},'app-unrelated')
    expect(duplicate.status).toBe(200)
    expect((await duplicate.json()).already).toBe(true)
    expect(await remainingQuota(env(admin),'join:127.0.0.1',10,3600)).toBe(adminBefore)
  })
  it('matches the actual tool response to exhausted and then returned quota', async () => {
    const actorEnv=env(owner), bucket='tool:quota-tool:127.0.0.1'
    const ticket = await checkRateLimit(actorEnv,bucket,1,86400)
    expect(ticket).toBeGreaterThan(0)
    expect(await checkRateLimit(actorEnv,bucket,1,86400)).toBe(0)
    const response=await getTool({env:actorEnv,params:{slug:'quota-tool'},request:new Request('https://local.invalid/api/tools/quota-tool',{headers:{'CF-Connecting-IP':'127.0.0.1'}})})
    expect(response.status,await response.clone().text()).toBe(200)
    expect((await response.json()).limits).toMatchObject({remainingToday:0,nextFreeAt:expect.any(String)})
    expect(await env(finance).DB.releaseRateLimit(bucket,ticket)).toBe(false)
    expect(await actorEnv.DB.releaseRateLimit('apply:different-ip',ticket)).toBe(false)
    expect(await remainingQuota(actorEnv,'tool:quota-tool:192.0.2.1',1,86400)).toBe(0)
    expect(await checkRateLimit(actorEnv,'tool:quota-tool:192.0.2.1',1,86400)).toBe(0)
    expect(await remainingQuota(env(finance),bucket,1,86400)).toBe(1)
    expect(await remainingQuota(actorEnv,bucket,1,86400)).toBe(0)
    expect(await releaseRateLimit(actorEnv,bucket,ticket)).toBe(true)
    expect(await quotaState(actorEnv,bucket,1,86400)).toEqual({remaining:1,nextFreeAt:null})
    expect(await releaseRateLimit(actorEnv,bucket,ticket)).toBe(false)
  })
  it('returns the exact failed request claim and protects private tables and RPCs', async () => {
    const bad=await sign(finance,'재무','not-a-verdict')
    expect(bad.status).toBe(400)
    expect(await remainingQuota(env(finance),'signoff:127.0.0.1',10,3600)).toBe(10)
    expect((await env(finance).DB.prepare('SELECT * FROM rate_limit_hits').all()).results).toEqual([])
    const grants=(await pg.query("SELECT has_function_privilege('anon','public.ilson_actor_rate_state(text,text,integer,integer)','EXECUTE') rpc,has_table_privilege('ilson_scoped_executor','ilson_private.actor_rate_tickets','SELECT') tickets")).rows[0]
    expect(grants).toEqual({rpc:false,tickets:false})
    await expect(env(finance).DB.rateLimitState('invented:127.0.0.1',1,60)).rejects.toThrow('/22023')
    await expect(env(other).DB.rateLimitState('tool:quota-tool:127.0.0.1',1,60)).rejects.toThrow('/42501')
  })
  it('rejects invalid tool writes and returns the atomic write quota without a later quota query', async () => {
    const actorEnv=env(owner), bucket='tool:quota-tool:127.0.0.1'
    const context = req => ({ env:actorEnv,params:{slug:'quota-tool'},request:req })
    const malformed=await saveTool(context(new Request('https://local.invalid/api/tools/quota-tool',{method:'POST',headers:{'CF-Connecting-IP':'127.0.0.1'},body:'{' })))
    expect(malformed.status).toBe(400)
    expect(await remainingQuota(actorEnv,bucket,1,86400)).toBe(1)
    const invalid=await saveTool(context(request({rows_out:1e30})))
    expect(invalid.status).toBe(400)
    expect(await remainingQuota(actorEnv,bucket,1,86400)).toBe(1)
    const failRead={...actorEnv,DB:{...actorEnv.DB,rateLimitState:async()=>{throw Error('Simulated temporary state read failure')}}}
    const saved=await saveTool({env:failRead,params:{slug:'quota-tool'},request:request({rows_out:1,run_scope:await actorEnv.DB.toolRunScope()})})
    expect(saved.status,await saved.clone().text()).toBe(201)
    const data=await saved.json()
    expect(data).toMatchObject({ok:true,remainingToday:0})
    expect(await DB.prepare('SELECT id FROM tool_use WHERE id=?').bind(data.id).first()).toEqual({id:data.id})
    expect(await remainingQuota(actorEnv,bucket,1,86400)).toBe(0)
  })
  it('revalidates active actors for claim, state, and release and keeps expiry consistent', async () => {
    const actorEnv=env(finance), bucket='apply:expiry-test'
    const ticket=await checkRateLimit(actorEnv,bucket,1,60)
    await DB.prepare('UPDATE override_actor SET active=0 WHERE email=?').bind(finance).run()
    await expect(actorEnv.DB.claimRateLimit(bucket,1,60)).rejects.toThrow('/28000')
    await expect(actorEnv.DB.rateLimitState(bucket,1,60)).rejects.toThrow('/28000')
    await expect(actorEnv.DB.releaseRateLimit(bucket,ticket)).rejects.toThrow('/28000')
    await DB.prepare('UPDATE override_actor SET active=1 WHERE email=?').bind(finance).run()
    await DB.prepare("UPDATE rate_limit_hits SET created_at=datetime('now','-61 seconds') WHERE id=?").bind(ticket).run()
    expect(await quotaState(actorEnv,bucket,1,60)).toEqual({remaining:1,nextFreeAt:null})
    expect(await checkRateLimit(actorEnv,bucket,1,60)).toBeGreaterThan(0)
  })
  it('preserves demo quota behavior and exact-bucket release without production grants', async () => {
    const token='9'.repeat(64)
    await DB.workspaceOpen(token,[])
    const demo={DB:createSupabaseDb(base,'memory-test-only',token),DEMO_WORKSPACE:true}
    const ticket=await checkRateLimit(demo,'demo:one',1,60)
    expect(await quotaState(demo,'demo:one',1,60)).toMatchObject({remaining:0,nextFreeAt:expect.any(String)})
    await releaseRateLimit(demo,'demo:wrong',ticket)
    expect(await remainingQuota(demo,'demo:one',1,60)).toBe(0)
    await releaseRateLimit(demo,'demo:one',ticket)
    expect(await quotaState(demo,'demo:one',1,60)).toEqual({remaining:1,nextFreeAt:null})
  })
})
