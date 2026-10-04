// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { createSupabaseDb } from '../functions/_lib/dbBridge.ts'
import { loadCriteriaEvidence } from '../functions/_lib/agreementEvidence.js'
import { onRequestGet as getAgreement, onRequestPost as agreement } from '../functions/api/applications/[id]/agreement.js'
import { onRequestGet as getOutcome, onRequestPost as outcome } from '../functions/api/applications/[id]/outcome.js'
import { onRequestPost as outcomeDirect } from '../functions/api/track/[ticket]/outcome.js'
import { onRequestPost as signoff } from '../functions/api/track/[ticket]/signoff.js'
import { onRequestPost as accept } from '../functions/api/tools/[slug]/accept.js'
import { onRequestPost as hold } from '../functions/api/track/[ticket]/hold.js'
import { onRequestPost as beta } from '../functions/api/track/[ticket]/beta.js'
import { onRequestGet as getHandover, onRequestPost as handover } from '../functions/api/applications/[id]/handover.ts'

const pg = new PGlite(), base = 'https://mutation-access.supabase.co'
const DB = createSupabaseDb(base, 'memory-only'), email = 'author@local.invalid'
const env = { DB: DB.forActor(email), AUTH_ACTOR: { email, mode: 'access', role: 'product', departments: ['Finance'] } }
let queue = Promise.resolve(), beforeCommit = null, seq = 0
const failures = []
const cases = [
  ['agreement', agreement, async app => ({ kind: 'criterion', body: 'New criterion', expectedVersion: (await read(getAgreement, app)).criteria_source_version }), 201],
  ['signoff', signoff, async app => ({ by: 'Author', dept: 'Finance', verdicts: { [app.criterion]: 'no' }, reasons: { [app.criterion]: '실제 처리 기준과 맞지 않습니다.' }, expectedVersion: (await loadCriteriaEvidence(env.DB, app.id)).sourceVersion }), 200],
  ['accept', accept, async () => ({ by: 'Author' }), 200],
  ['reject', accept, async () => ({ by: 'Author', kind: 'reject', reason: '실제 업무에서 사용할 수 없습니다.' }), 200],
  ['hold', hold, async () => ({ by: 'Author', kind: 'met', body: '보류 조건이 실제로 해소되었습니다.' }), 200],
  ['cancel', hold, async () => ({ by: 'Author', kind: 'cancel' }), 200],
  ['beta', beta, async app => ({ by: 'Author', kind: '의견', body: '실제 업무에 적용해 확인했습니다.', expectedRoundId: app.round }), 200],
  ['outcome', outcome, async app => ({ kind: 'dept_confirm', by: 'Author', comment: '현재 수치 확인', expectedEvidence: (await read(getOutcome, app)).expectedEvidence }), 200],
  ['outcome-direct', outcomeDirect, async app => ({ by: 'Author', agree: true, expectedEvidence: (await read(getOutcome, app)).expectedEvidence }), 200],
  ['handover', handover, async app => ({ action: 'stop', reason: '현장 검증을 위해 실행을 중단합니다.', expectedEvidence: (await read(getHandover, app)).expectedEvidence }), 200],
]

beforeAll(async () => {
  await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;')
  const directory = new URL('../supabase/migrations/', import.meta.url)
  for (const file of readdirSync(directory).filter(name => /^\d+.*\.sql$/.test(name)).sort()) {
    await pg.exec(readFileSync(new URL(file, directory), 'utf8'))
  }
  vi.stubGlobal('fetch', (url, options) => {
    if (!String(url).startsWith(base + '/rest/v1/rpc/')) throw Error('External network forbidden')
    const task = queue.then(async () => {
      const name = new URL(url).pathname.split('/').at(-1)
      try {
        if (name === 'ilson_actor_commit' && beforeCommit) {
          const hook = beforeCommit
          beforeCommit = null
          await hook()
        }
        await pg.exec('SET ROLE service_role')
        const args = Object.values(JSON.parse(options.body))
        return Response.json((await pg.query(`SELECT public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) data`, args)).rows[0].data)
      } catch (error) {
        failures.push({ name, code: error.code })
        return Response.json({ code: error.code }, { status: 400 })
      } finally { await pg.exec('RESET ROLE') }
    })
    queue = task.catch(() => {})
    return task
  })
  await pg.query("INSERT INTO override_actor(email,display_name,role,departments_json) VALUES($1,'Author','product','[\"Finance\"]')", [email])
}, 60000)

afterEach(async () => {
  beforeCommit = null
  failures.length = 0
  await pg.query("UPDATE override_actor SET active=1,display_name='Author',role='product',departments_json='[\"Finance\"]' WHERE email=$1", [email])
})
afterAll(async () => { vi.unstubAllGlobals(); await pg.close() })

async function fixture() {
  const id = 'ACCESS-' + (++seq), app = { id, ticket: id, slug: 'tool-' + seq, criterion: 'criterion-' + seq, round: 'round-' + seq }
  await pg.query("INSERT INTO application(id,ticket_no,dept,applicant_label,title,bottleneck,problem,status,current_frequency,owner_email) VALUES($1,$1,'Finance','Author','Before','Task','Task','보류','매일',$2)", [id, email])
  await pg.query("INSERT INTO acceptance_criterion(id,application_id,ord,body,confirmed_at) VALUES($1,$2,1,'서류 확인',now())", [app.criterion, id])
  await pg.query("INSERT INTO handover(application_id,slug,title,handed_to_dept,handed_to_person) VALUES($1,$2,'Tool','Finance','Author')", [id, app.slug])
  await pg.query("INSERT INTO beta_round(id,application_id,seq,overall) VALUES($1,$2,1,'통과')", ['round-' + seq, id])
  await pg.query("INSERT INTO baseline(application_id,median_seconds,min_seconds,max_seconds,sample_n,people,frequency,hourly_wage_krw) VALUES($1,600,600,600,5,1,'매일',3600)", [id])
  await pg.query('INSERT INTO tool_use(id,application_id,ok,duration_ms,human_review_seconds,rework_seconds) VALUES($1,$2,1,1000,30,0)', ['use-' + seq, id])
  return app
}
const read = async (handler, app) => (await handler({ env, params: app })).json()
function invoke(handler, app, body, key = crypto.randomUUID()) {
  const request = new Request('https://local.invalid/api/mutation-access', { method: 'POST', headers: {
    'Content-Type': 'application/json', 'X-Idempotency-Key': key, 'CF-Connecting-IP': key,
  }, body: JSON.stringify(body) })
  return handler({ env, params: app, request })
}
async function snapshot(app) {
  const result = {}
  for (const table of ['acceptance_criterion', 'handover', 'outcome', 'decision_log', 'beta_feedback']) {
    result[table] = (await pg.query(`SELECT to_jsonb(t) AS value FROM ${table} t WHERE application_id=$1 ORDER BY to_jsonb(t)::text`, [app.id])).rows
  }
  result.status = (await pg.query('SELECT status FROM application WHERE id=$1', [app.id])).rows
  return result
}
const receiptCount = async key => Number((await pg.query('SELECT count(*) n FROM ilson_private.mutation_receipts WHERE request_id=$1', [key])).rows[0].n)

describe.sequential.each(cases)('%s actual scoped mutation access at PostgreSQL commit', (_name, handler, bodyFor, successStatus) => {
  it('returns 401/ACCESS_REVOKED when the actor is disabled at commit, without persisting domain, audit, or receipt writes', async () => {
    const app = await fixture(), body = await bodyFor(app), key = crypto.randomUUID(), before = await snapshot(app)
    beforeCommit = () => pg.query('UPDATE override_actor SET active=0 WHERE email=$1', [email])
    const response = await invoke(handler, app, body, key)
    expect(beforeCommit).toBeNull()
    expect(failures).toContainEqual({ name: 'ilson_actor_commit', code: '28000' })
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ code: 'ACCESS_REVOKED' })
    expect(await snapshot(app)).toEqual(before)
    expect(await receiptCount(key)).toBe(0)
  })

  it('keeps a real read-set conflict at 409 with no partial writes or receipt', async () => {
    const app = await fixture(), body = await bodyFor(app), key = crypto.randomUUID(), before = await snapshot(app)
    beforeCommit = async () => {
      // At least one of these is in every handler read set. Authority remains
      // valid: this is concurrent evidence editing, not account expiration.
      await pg.query("UPDATE application SET title='New evidence' WHERE id=$1", [app.id])
      await pg.query("UPDATE override_actor SET display_name='New display name' WHERE email=$1", [email])
    }
    const response = await invoke(handler, app, body, key)
    expect(beforeCommit).toBeNull()
    expect(failures).toContainEqual({ name: 'ilson_actor_commit', code: '40001' })
    expect(response.status).toBe(409)
    expect(JSON.stringify(await response.json())).not.toMatch(/ACCESS_REVOKED|ACCESS_DENIED/)
    expect(await snapshot(app)).toEqual(before)
    expect(await receiptCount(key)).toBe(0)
  })

  it('preserves successful saves and idempotent retries with exactly one domain/audit result', async () => {
    const app = await fixture(), body = await bodyFor(app), key = crypto.randomUUID()
    const first = await invoke(handler, app, body, key)
    expect(first.status, await first.clone().text()).toBe(successStatus)
    const saved = await snapshot(app), replay = await invoke(handler, app, body, key)
    expect(replay.status, await replay.clone().text()).toBe(successStatus)
    expect(replay.headers.get('X-Idempotency-Replayed')).toBe('1')
    expect(await replay.json()).toEqual(await first.json())
    expect(await snapshot(app)).toEqual(saved)
    expect(saved.decision_log.length).toBeGreaterThan(0)
    expect(await receiptCount(key)).toBe(1)
  })
})

describe.sequential.each(cases.filter(([name]) => name !== 'outcome'))('%s resource-local authority denial', (_name, handler, bodyFor) => {
  it('keeps an active owner with insufficient role/department authority at 403, not an expired session', async () => {
    const app = await fixture(), body = await bodyFor(app), key = crypto.randomUUID(), before = await snapshot(app)
    await pg.query("UPDATE override_actor SET role='reviewer',departments_json='[]' WHERE email=$1", [email])
    // Application ownership still permits reads; only this action is denied.
    expect(await env.DB.prepare('SELECT id FROM application WHERE id=?').bind(app.id).first()).toEqual({ id: app.id })
    const response = await invoke(handler, app, body, key)
    expect(response.status, await response.clone().text()).toBe(403)
    expect(await response.json()).not.toHaveProperty('code', 'ACCESS_REVOKED')
    expect(await snapshot(app)).toEqual(before)
    expect(await receiptCount(key)).toBe(0)
    expect(failures).toEqual([])
  })
})
