// @vitest-environment node
// Independent signed-middleware / real bridge / disposable PostgreSQL checks.
// Hooks interleave requests on one queued connection; they are not a claim of
// multi-session production concurrency coverage. No external fetch is allowed.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { createSupabaseDb } from '../functions/_lib/dbBridge.ts'
import { onRequest } from '../functions/api/_middleware.js'
import { onRequestGet as getCodes, onRequestPost as postCodes } from '../functions/api/codes.js'
import { CODE_REVIEW_PREFIX } from '../shared/codeReviewEvidence.ts'
import { SKU_BY_CODE } from '../shared/master.js'

const pg = new PGlite(), base = 'https://code-access-memory.supabase.co'
const issuer = 'https://code-access-memory.cloudflareaccess.com'
const DB = createSupabaseDb(base, 'synthetic-only')
const operator = 'code-access@local.invalid', admin = 'code-admin-access@local.invalid', other = 'code-hidden@local.invalid'
const label = '현재 검토 담당자', canonical = 'NR-CM-100', target = 'NR-PA-030'
const updatedAt = '2026-10-04 00:00:01'
const env = { DB, DBBridgeApplied: true, SUPABASE_URL: base, SUPABASE_SERVICE_ROLE_KEY: 'synthetic-only',
  ACCESS_TEAM_DOMAIN: issuer, ACCESS_AUD: 'code-access-memory', DEMO_WORKSPACES: 'false', OVERRIDE_DEMO_MODE: 'false' }
let pair, jwk, queue = Promise.resolve(), sequence = 0
let beforeReceipt = null, afterAuthority = null, beforeCommit = null

beforeAll(async () => {
  await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;')
  const directory = new URL('../supabase/migrations/', import.meta.url)
  for (const file of readdirSync(directory).filter(name => /^\d+.*\.sql$/.test(name)).sort()) {
    await pg.exec(readFileSync(new URL(file, directory), 'utf8'))
  }
  pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])
  jwk = { ...await crypto.subtle.exportKey('jwk', pair.publicKey), kid: env.ACCESS_AUD, alg: 'RS256', use: 'sig' }
  await pg.query(`INSERT INTO override_actor(email,display_name,role,departments_json,updated_at)
    VALUES($1,$2,'product','["Finance"]',$3),($4,'검토 관리자','audit','[]',$3),($5,'다른 부서','product','["Other"]',$3)`,
  [operator, label, updatedAt, admin, other])
  vi.stubGlobal('fetch', (url, options) => {
    if (String(url) === issuer + '/cdn-cgi/access/certs') return Promise.resolve(Response.json({ keys: [jwk] }))
    if (!String(url).startsWith(base + '/rest/v1/rpc/')) throw Error('External network prohibited')
    const name = new URL(url).pathname.split('/').at(-1), args = JSON.parse(options.body)
    const task = queue.then(async () => {
      let response
      try {
        if (name === 'ilson_actor_receipt' && beforeReceipt) { const hook = beforeReceipt; beforeReceipt = null; await hook() }
        if (name === 'ilson_actor_commit' && beforeCommit) { const hook = beforeCommit; beforeCommit = null; await hook() }
        await pg.exec('SET ROLE service_role')
        const values = Object.values(args)
        const result = (await pg.query(`SELECT public.${name}(${values.map((_, index) => '$' + (index + 1)).join(',')}) AS data`, values)).rows[0].data
        response = Response.json(result)
      } catch (error) { response = Response.json({ code: error.code }, { status: 400 }) }
      finally { await pg.exec('RESET ROLE') }
      if (response.ok && name === 'ilson_actor_query' && /^SELECT email,display_name,role,active/.test(args.p_sql ?? '') && afterAuthority) {
        const hook = afterAuthority; afterAuthority = null; await hook()
      }
      return response
    })
    queue = task.catch(() => {})
    return task
  })
}, 60000)

afterEach(async () => {
  beforeReceipt = null; afterAuthority = null; beforeCommit = null
  await queue
  await pg.query(`UPDATE override_actor SET active=1,display_name=$2,role='product',departments_json='["Finance"]',
    product_ids_json='[]',updated_at=$3 WHERE email=$1`, [operator, label, updatedAt])
  await pg.exec('DELETE FROM public.rate_limit_hits; DELETE FROM ilson_private.actor_rate_tickets;')
})
afterAll(async () => { await queue; vi.unstubAllGlobals(); await pg.close() })

async function jwt(identity) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url'), now = Math.floor(Date.now() / 1000)
  const value = encode({ alg: 'RS256', kid: jwk.kid }) + '.' + encode({ iss: issuer, aud: [jwk.kid], email: identity, iat: now, exp: now + 600 })
  return value + '.' + Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(value))).toString('base64url')
}
async function invoke(body, options = {}) {
  const identity = options.email ?? operator, key = options.key ?? crypto.randomUUID(), method = options.method ?? 'POST'
  const headers = { 'Content-Type': 'application/json', Origin: 'https://local.invalid', 'X-Ilson-Request': '1',
    'X-Idempotency-Key': key, 'X-Ilson-Scope': await DB.forActor(identity).toolRunScope(), 'CF-Connecting-IP': key,
    'Cf-Access-Jwt-Assertion': await jwt(identity) }
  const context = { env, data: {}, request: new Request('https://local.invalid/api/codes',
    { method, headers, ...(method === 'GET' ? {} : { body: JSON.stringify(body) }) }) }
  context.next = forwarded => {
    if (options.adapter) context.data.requestEnv = { ...context.data.requestEnv, DB: options.adapter }
    return (method === 'GET' ? getCodes : postCodes)({ env: context.env, data: context.data, request: forwarded ?? context.request })
  }
  const response = await onRequest(context)
  return { status: response.status, body: await response.json(), replayed: response.headers.get('X-Idempotency-Replayed') }
}
async function application({ owner = operator, dept = owner === other ? 'Other' : 'Finance' } = {}) {
  const id = 'access-app-' + (++sequence)
  await pg.query(`INSERT INTO application(id,ticket_no,dept,applicant_label,title,bottleneck,problem,status,owner_email)
    VALUES($1,$1,$2,'가상 신청자','가상 업무','취합','반복 업무','수용',$3)`, [id, dept, owner])
  return id
}
async function teachingOrigin(code, appId) {
  await pg.query(`INSERT INTO decision_log(id,application_id,stage,actor,title,what,why,link_kind,link_id)
    VALUES($1,$2,'배포','human',$3,'가상 원본 연결','가상 원본 연결 근거','코드알림',$4)`,
  ['access-origin-' + (++sequence), appId, label, code])
}
async function fixture({ owner = operator, origin = 'visible', code, mapped = canonical } = {}) {
  const record = { code: code ?? 'access-code-' + (++sequence), app: null }
  await pg.query(`INSERT INTO sku_alias(external_code,canonical_code,product_name,taught_by,owner_email,created_at)
    VALUES($1,$2,$3,'AX 담당자',$4,'2026-10-04 00:00:00')`,
  [record.code, mapped, Object.hasOwn(SKU_BY_CODE, mapped) ? SKU_BY_CODE[mapped].name_ko : '알 수 없는 과거 상품', owner])
  if (origin !== 'none') {
    record.app = await application({ owner: origin === 'hidden' ? other : owner })
    await teachingOrigin(record.code, record.app)
    if (origin === 'multiple' || origin === 'mixed') await teachingOrigin(record.code, await application({ owner: origin === 'mixed' ? other : owner }))
  }
  return record
}
async function observed(record, options = {}) {
  const response = await invoke(null, { ...options, method: 'GET' })
  expect(response.status).toBe(200)
  return response.body.codes.find(row => row.external_code === record.code)
}
const command = (record, view, action = 'confirm', changes = {}) => ({ externalCode: record.code, action,
  expectedVersion: view.edit_version, ...(action === 'correct' ? { canonicalCode: target, why: '원본 상품과 현재 연결을 비교하여 정정합니다.' } : {}), ...changes })
async function state(record, key) {
  return { alias: (await pg.query('SELECT * FROM sku_alias WHERE external_code=$1', [record.code])).rows[0],
    logs: (await pg.query("SELECT * FROM decision_log WHERE link_id=$1 AND link_kind IN ('코드확인','코드정정') ORDER BY id", [record.code])).rows,
    receipts: Number((await pg.query('SELECT count(*) AS n FROM ilson_private.mutation_receipts WHERE request_id=$1', [key])).rows[0].n) }
}
function noReceiptDisclosure(response) {
  for (const field of ['id', 'author', 'canonicalCode', 'productName', 'externalCode']) expect(response.body).not.toHaveProperty(field)
  expect(JSON.stringify(response.body)).not.toContain(label)
}

describe.sequential('independent code-review access and evidence boundaries', () => {
  it.each([
    ['display_name', '변경된 담당자', 409], ['role', 'engineer', 409], ['product_ids_json', '["new-product"]', 409],
    ['departments_json', '["Finance","New"]', 409], ['updated_at', '2026-10-04 00:00:02', 409], ['active', 0, 401],
  ])('rejects %s changed after first authoritative read without partial writes', async (field, value, status) => {
    const record = await fixture(), view = await observed(record), key = crypto.randomUUID(), before = await state(record, key)
    afterAuthority = () => pg.query(`UPDATE override_actor SET ${field}=$2 WHERE email=$1`, [operator, value])
    const response = await invoke(command(record, view, 'correct'), { key })
    expect(afterAuthority).toBeNull(); expect(response.status).toBe(status); noReceiptDisclosure(response)
    expect(await state(record, key)).toEqual(before)
  })

  it.each([
    ['role', 'engineer', 409], ['product_ids_json', '["new-product"]', 409],
    ['updated_at', '2026-10-04 00:00:02', 409], ['active', 0, 401],
  ])('does not decode a previous success after %s changes between signed middleware and receipt lookup', async (field, value, status) => {
    const record = await fixture(), view = await observed(record), key = crypto.randomUUID(), body = command(record, view)
    expect((await invoke(body, { key })).status).toBe(200)
    const before = await state(record, key)
    beforeReceipt = () => pg.query(`UPDATE override_actor SET ${field}=$2 WHERE email=$1`, [operator, value])
    const response = await invoke(body, { key })
    expect(beforeReceipt).toBeNull(); expect(response.status).toBe(status); noReceiptDisclosure(response)
    expect(await state(record, key)).toEqual(before)
  })

  it('replays historical attribution after a name-only change, but fresh intent uses current authoritative name', async () => {
    const record = await fixture(), view = await observed(record), key = crypto.randomUUID()
    const body = command(record, view, 'confirm', { author: { forged: true } })
    const first = await invoke(body, { key }); expect(first.body.author).toBe(label)
    await pg.query('UPDATE override_actor SET display_name=$2 WHERE email=$1', [operator, '현재 새 이름'])
    const replay = await invoke({ ...body, author: ['another', 'forgery'] }, { key })
    expect(replay).toEqual({ ...first, replayed: '1' })
    const fresh = await invoke(command(record, await observed(record), 'confirm', { author: 'AX 담당자' }))
    expect(fresh.status).toBe(200); expect(fresh.body.author).toBe('현재 새 이름')
    expect((await state(record, key)).logs.map(log => log.title).sort()).toEqual([label, '현재 새 이름'].sort())
  })

  it.each(['none', 'hidden', 'multiple'])('preserves an owned alias when its actual scoped origin is %s', async origin => {
    const record = await fixture({ origin }), view = await observed(record), key = crypto.randomUUID(), before = await state(record, key)
    expect(view.review_available).toBe(false)
    expect(view.review_reason).toBe(origin === 'multiple' ? 'origin_ambiguous' : 'origin_unavailable')
    for (const action of ['confirm', 'correct']) {
      const response = await invoke(command(record, view, action, { applicationId: await application() }), { key })
      expect(response.status).toBe(409); expect(response.body.code).toBe('CODE_REVIEW_UNAVAILABLE')
      expect(await state(record, key)).toEqual(before)
    }
  })

  it('uses only the real visible origin and prevents admin fallback for mixed visible/hidden multiple origins', async () => {
    const record = await fixture({ origin: 'mixed' }), view = await observed(record), adminView = await observed(record, { email: admin })
    expect(view.provenance).toEqual({ state: 'linked', applicationId: record.app })
    expect(view.review_available).toBe(true)
    expect(adminView.review_reason).toBe('origin_ambiguous')
    const key = crypto.randomUUID(), before = await state(record, key)
    expect((await invoke(command(record, adminView, 'correct'), { key, email: admin })).status).toBe(409)
    expect(await state(record, key)).toEqual(before)
    expect((await invoke(command(record, view), { key })).status).toBe(200)
    const saved = await state(record, key); expect(saved.logs).toHaveLength(1); expect(saved.logs[0].application_id).toBe(record.app)
  })

  it('keeps origin-free legacy data unverified and blocked for ordinary actors but supports existing admin null-app authority', async () => {
    const record = await fixture({ origin: 'none' }), ordinary = await observed(record), view = await observed(record, { email: admin })
    expect(ordinary.needsCheck).toBe(true); expect(ordinary.review_available).toBe(false)
    expect(view.review_reason).toBe('origin_unknown_admin'); expect(view.review_available).toBe(true)
    const key = crypto.randomUUID(), response = await invoke(command(record, view, 'correct'), { key, email: admin })
    expect(response.status).toBe(200)
    const saved = await state(record, key)
    expect(saved.alias.canonical_code).toBe(target); expect(saved.logs).toHaveLength(1)
    expect(saved.logs[0].application_id).toBeNull(); expect(saved.receipts).toBe(1)
    expect((await observed(record)).review_available).toBe(false)
  })

  it('does not expose or change another owner alias even with its valid admin-observed version', async () => {
    const record = await fixture({ owner: other }), view = await observed(record, { email: admin }), key = crypto.randomUUID(), before = await state(record, key)
    expect(await observed(record)).toBeUndefined()
    const response = await invoke(command(record, view, 'correct'), { key })
    expect(response.status).toBe(404); noReceiptDisclosure(response)
    expect(await state(record, key)).toEqual(before)
  })

  it('aborts when the origin application becomes hidden between its scoped read and commit', async () => {
    const record = await fixture(), view = await observed(record), key = crypto.randomUUID(), before = await state(record, key)
    beforeCommit = () => pg.query("UPDATE application SET owner_email=$2,dept='Other' WHERE id=$1", [record.app, other])
    const response = await invoke(command(record, view, 'correct'), { key })
    expect(beforeCommit).toBeNull(); expect(response.status).toBe(409)
    expect(await state(record, key)).toEqual(before)
  })

  it('rolls back when participation grants origin read access but not audit write permission', async () => {
    const record = await fixture({ origin: 'hidden' }), participation = 'access-participation-' + (++sequence)
    await pg.query('UPDATE override_actor SET departments_json=$2 WHERE email=$1', [operator, '["Finance","재무"]'])
    // Set the real grant author's identity for the existing participation guard.
    // Only synthetic rows are added; neither the guard nor any policy is changed.
    await pg.exec('BEGIN')
    try {
      await pg.query("SELECT set_config('ilson.actor_email',$1,true)", [admin])
      await pg.query(`INSERT INTO decision_log(id,application_id,stage,actor,title,what,why,link_kind,link_id)
        VALUES($1,$2,'협의안','human','검토 관리자','협의 참여','가상 참여 근거','같은건손듦','재무')`, [participation, record.app])
      await pg.query(`INSERT INTO application_participation(id,application_id,department_id,granted_by_email)
        VALUES($1,$2,'재무',$3)`, [participation, record.app, admin])
      await pg.exec('COMMIT')
    } catch (error) { await pg.exec('ROLLBACK'); throw error }
    const view = await observed(record), key = crypto.randomUUID(), before = await state(record, key)
    expect(view.provenance).toEqual({ state: 'linked', applicationId: record.app })
    const response = await invoke(command(record, view, 'correct'), { key })
    expect(response.status).toBe(403); expect(response.body.code).toBe('ACCESS_DENIED')
    expect(await state(record, key)).toEqual(before)
  })

  it.each(['wrong-code', 'wrong-app', 'wrong-kind', 'future-schema', 'broken'])('does not turn %s metadata into current confirmation proof', async fault => {
    const record = await fixture(), view = await observed(record)
    const evidence = { version: 1, action: 'confirm', externalCode: record.code, reviewedMappingRevision: view.mapping_revision,
      beforeCanonicalCode: canonical, afterCanonicalCode: canonical, provenance: { state: 'linked', applicationId: record.app } }
    if (fault === 'wrong-code') evidence.externalCode += '-other'
    if (fault === 'wrong-app') evidence.provenance.applicationId = await application()
    if (fault === 'wrong-kind') { evidence.action = 'correct'; evidence.afterCanonicalCode = target }
    if (fault === 'future-schema') evidence.version = 99
    await pg.query(`INSERT INTO decision_log(id,application_id,stage,actor,title,what,why,alternatives,link_kind,link_id)
      VALUES($1,$2,'제작','human','AX 담당자','과거 확인 내용','과거 근거',$3,'코드확인',$4)`,
    ['access-review-' + (++sequence), record.app, CODE_REVIEW_PREFIX + (fault === 'broken' ? '{' : JSON.stringify(evidence)), record.code])
    const current = await observed(record)
    expect(current.mapping_revision).toBe(view.mapping_revision)
    expect(current.needsCheck).toBe(true); expect(current.confirmed.verified).toBe(false)
    expect(current.edit_version).not.toBe(view.edit_version)
  })

  it.each(['__proto__', 'constructor', 'UNKNOWN-CATALOG-CODE'])('does not confirm a legacy mapping outside catalogue own keys: %s', async mapped => {
    const record = await fixture({ mapped }), view = await observed(record), key = crypto.randomUUID(), before = await state(record, key)
    expect(view.review_available).toBe(false); expect(view.review_reason).toBe('invalid_mapping')
    const response = await invoke(command(record, view), { key })
    expect(response.status).toBe(409); expect(await state(record, key)).toEqual(before)
  })

  it('advances a valid future writer timestamp without interpreting it as an event date', async () => {
    const record = await fixture()
    await pg.query('UPDATE sku_alias SET created_at=$2 WHERE external_code=$1', [record.code, '2100-01-01T00:00:00.123Z'])
    const view = await observed(record), key = crypto.randomUUID()
    expect((await invoke(command(record, view, 'correct'), { key })).status).toBe(200)
    const saved = await state(record, key)
    expect(saved.alias.created_at).toBe('2100-01-01T00:00:00.124Z')
    expect(saved.logs[0].created_at).not.toContain('2100-01-01')
  })

  it('fails closed before SQL/receipt access on unsupported or misbound adapters after signed middleware', async () => {
    const record = await fixture(), view = await observed(record), key = crypto.randomUUID(), before = await state(record, key)
    for (const adapter of [
      { actorEmail: operator, workspace: false, prepare: vi.fn(() => { throw Error('No SQL expected') }) },
      { actorEmail: other, workspace: false, prepare: vi.fn(), mutationReceipt: vi.fn(), commitMutation: vi.fn() },
      { actorEmail: operator, workspace: true, prepare: vi.fn(), mutationReceipt: vi.fn(), commitMutation: vi.fn() },
    ]) {
      expect((await invoke(command(record, view, 'correct'), { key, adapter })).status).toBe(503)
      expect(adapter.prepare).not.toHaveBeenCalled()
      if (adapter.mutationReceipt) expect(adapter.mutationReceipt).not.toHaveBeenCalled()
      if (adapter.commitMutation) expect(adapter.commitMutation).not.toHaveBeenCalled()
      expect(await state(record, key)).toEqual(before)
    }
  })
})
