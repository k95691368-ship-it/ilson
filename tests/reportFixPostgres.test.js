// @vitest-environment node
// Actual signed middleware and current migrations/RPCs in disposable memory PG.
// Controlled interleavings use ONE queued connection, not multi-session
// PostgreSQL concurrency, production data, or a production load benchmark.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { createSupabaseDb } from '../functions/_lib/dbBridge.ts'
import { onRequest } from '../functions/api/_middleware.js'
import { onRequestGet, onRequestPost } from '../functions/api/reports.js'

const pg = new PGlite(), base = 'https://report-fix-memory.supabase.co'
const issuer = 'https://report-fix-memory.cloudflareaccess.com'
const email = 'fix-operator@local.invalid', other = 'fix-other@local.invalid', label = '현재 처리 담당자'
const DB = createSupabaseDb(base, 'synthetic-only')
const env = { DB, DBBridgeApplied: true, SUPABASE_URL: base, SUPABASE_SERVICE_ROLE_KEY: 'synthetic-only',
  ACCESS_TEAM_DOMAIN: issuer, ACCESS_AUD: 'report-fix-memory', DEMO_WORKSPACES: 'false', OVERRIDE_DEMO_MODE: 'false' }
let pair, jwk, queue = Promise.resolve(), sequence = 0
let beforeReceipt = null, afterReceipt = null, beforeCommit = null, beforeActorRead = null, dropCommitResponse = false, barrier = null
const commitCalls = [], directWrites = []

beforeAll(async () => {
  await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;')
  const directory = new URL('../supabase/migrations/', import.meta.url)
  for (const file of readdirSync(directory).filter(name => /^\d+.*\.sql$/.test(name)).sort()) await pg.exec(readFileSync(new URL(file, directory), 'utf8'))
  await pg.query(`INSERT INTO override_actor(email,display_name,role,departments_json) VALUES
    ($1,$2,'product','["Finance"]'),($3,'다른 부서 담당자','product','["Other"]'),
    ('fix-reviewer@local.invalid','일반 사원','reviewer','["Finance"]')`, [email,label,other])
  pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1,0,1]), hash: 'SHA-256' }, true, ['sign','verify'])
  jwk = { ...await crypto.subtle.exportKey('jwk', pair.publicKey), kid: env.ACCESS_AUD, alg: 'RS256', use: 'sig' }
  vi.stubGlobal('fetch', (url, options) => {
    if (String(url) === issuer + '/cdn-cgi/access/certs') return Promise.resolve(Response.json({ keys: [jwk] }))
    if (!String(url).startsWith(base + '/rest/v1/rpc/')) throw Error('External network prohibited')
    const name = new URL(url).pathname.split('/').at(-1), args = JSON.parse(options.body), sql = args.p_sql ?? ''
    const isCommit = name === 'ilson_actor_commit' || name === 'ilson_commit_mutation'
    const isReceipt = name === 'ilson_actor_receipt' || name === 'ilson_mutation_receipt'
    if (isCommit) commitCalls.push(args)
    if (/^(INSERT|UPDATE|DELETE)/.test(sql)) directWrites.push(sql)
    const execute = () => {
      const task = queue.then(async () => {
        let response
        try {
          if (isReceipt && beforeReceipt) { const hook = beforeReceipt; beforeReceipt = null; await hook() }
          if (isCommit && beforeCommit) { const hook = beforeCommit; beforeCommit = null; await hook() }
          if (name === 'ilson_actor_query' && /^SELECT email,display_name,role,active/.test(sql) && beforeActorRead) {
            const hook = beforeActorRead; beforeActorRead = null; await hook()
          }
          await pg.exec('SET ROLE service_role')
          const values = Object.values(args)
          response = Response.json((await pg.query(`SELECT public.${name}(${values.map((_,i) => '$' + (i+1)).join(',')}) AS data`, values)).rows[0].data)
        } catch (error) { response = Response.json({ code: error.code }, { status: 400 }) }
        finally { await pg.exec('RESET ROLE') }
        if (isReceipt && afterReceipt) { const hook = afterReceipt; afterReceipt = null; await hook() }
        if (isCommit && dropCommitResponse && response.ok) {
          dropCommitResponse = false
          throw new TypeError('Synthetic response lost after commit')
        }
        return response
      })
      queue = task.catch(() => {})
      return task
    }
    // Let both handlers finish all staged reads before allowing either commit.
    // This is outside the SQL queue, so the second request's reads cannot deadlock.
    if (isCommit && barrier) {
      const current = barrier
      if (++current.arrivals === 2) { barrier = null; current.release() }
      return current.ready.then(execute)
    }
    return execute()
  })
}, 60000)

afterEach(async () => {
  await queue
  beforeReceipt = null; afterReceipt = null; beforeCommit = null; beforeActorRead = null; dropCommitResponse = false; barrier = null
  commitCalls.length = 0; directWrites.length = 0
  await pg.exec('TRUNCATE public.decision_log,public.application CASCADE; DELETE FROM public.rate_limit_hits; DELETE FROM ilson_private.actor_rate_tickets;')
  await pg.query(`UPDATE override_actor SET active=1,display_name=$2,role='product',departments_json='["Finance"]',product_ids_json='[]',updated_at='2026-01-01 00:00:00' WHERE email=$1`, [email,label])
})
afterAll(async () => { await queue; vi.unstubAllGlobals(); await pg.close() })

async function jwt(identity) {
  const enc = value => Buffer.from(JSON.stringify(value)).toString('base64url'), now = Math.floor(Date.now()/1000)
  const text = enc({ alg:'RS256',kid:jwk.kid }) + '.' + enc({ iss:issuer,aud:[jwk.kid],email:identity,iat:now,exp:now+600 })
  return text + '.' + Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,new TextEncoder().encode(text))).toString('base64url')
}
async function invoke(body, options = {}) {
  const method = options.method ?? 'POST', key = options.key === undefined ? crypto.randomUUID() : options.key
  const identity = options.identity ?? email, database = options.token ? createSupabaseDb(base,'synthetic-only',options.token) : DB.forActor(identity)
  const headers = { 'Content-Type':'application/json',Origin:options.origin ?? 'https://local.invalid','X-Ilson-Request':'1',
    'X-Ilson-Scope':await database.toolRunScope(),'CF-Connecting-IP':'synthetic-report-fix' }
  if (key !== null) headers['X-Idempotency-Key'] = key
  if (options.token) headers.Cookie = 'ilson_workspace=' + options.token
  else headers['Cf-Access-Jwt-Assertion'] = await jwt(identity)
  const bindings = options.token ? { ...env,DEMO_WORKSPACES:'true',OVERRIDE_DEMO_MODE:'true' } : env
  const request = new Request('https://local.invalid/api/reports',{ method,headers,...(method === 'GET' ? {} : {body:options.raw ?? JSON.stringify(body)}) })
  const context = { env:bindings,request,data:{} }
  context.next = forwarded => {
    if (options.adapter) context.data.requestEnv = { ...context.data.requestEnv,DB:options.adapter }
    return (method === 'GET' ? onRequestGet : onRequestPost)({ env:bindings,data:context.data,request:forwarded ?? request })
  }
  const response = await onRequest(context)
  return { status:response.status,body:await response.json(),replayed:response.headers.get('X-Idempotency-Replayed') }
}
async function fixture({ database = DB, owner = email, dept = 'Finance', handed = false, stopped = false } = {}) {
  const app = { id:'fix-app-' + (++sequence), reportId:'fix-source-' + sequence, slug:'fix-tool-' + sequence,database }
  await database.prepare(`INSERT INTO application(id,ticket_no,dept,applicant_label,title,bottleneck,problem,status,owner_email)
    VALUES(?,?,?,'합성 신청자','신고 처리 검사','취합','반복 업무','수용',?)`).bind(app.id,app.id,dept,owner).run()
  if (handed) await database.prepare(`INSERT INTO handover(application_id,slug,title,handed_to_dept,handed_to_person,rolled_back_at)
    VALUES(?,?,?,'Finance','합성',?)`).bind(app.id,app.slug,app.slug,stopped?'2026-10-04 00:00:00':null).run()
  await database.prepare(`INSERT INTO decision_log(id,application_id,stage,actor,title,what,why,alternatives,unrequested,link_kind,link_id,created_at)
    VALUES(?,?,'배포','human','원신고자','수량이 원본과 달라 확인이 필요합니다.','금액 비교',NULL,0,'신고','wrong_number','2026-10-04 00:00:00')`).bind(app.reportId,app.id).run()
  return app
}
async function command(app, options = {}) {
  const feed = await invoke(null,{...options,method:'GET'})
  expect(feed.status).toBe(200)
  const report = feed.body.tools.flatMap(tool => tool.reports).find(item => item.id === app.reportId)
  expect(report?.version).toMatch(/^[a-f0-9]{64}$/)
  return {reportId:app.reportId,expectedVersion:report.version,how:'필수 입력 열을 확인하도록 고쳤습니다.',why:'누락된 입력 열을 확인하지 못했습니다.',author:'위조한 담당자'}
}
const fixes = async app => (await pg.query("SELECT * FROM decision_log WHERE application_id=$1 AND link_kind='신고처리' ORDER BY id",[app.id])).rows
const receipts = async key => Number((await pg.query('SELECT count(*) AS n FROM ilson_private.mutation_receipts WHERE request_id=$1',[key])).rows[0].n)
async function noWrites(app,key) { expect(await fixes(app)).toEqual([]); expect(await receipts(key)).toBe(0) }
function noReceipt(reply) { for (const field of ['id','author','reportId','what','body']) expect(reply.body).not.toHaveProperty(field) }
function rendezvous() { let release; const ready = new Promise(resolve => {release=resolve}); barrier = {arrivals:0,ready,release} }

describe.sequential('report fix atomicity, exact original revision and scoped receipts', () => {
  it('writes one same-app fix and receipt, using current server-owned attribution only', async () => {
    const app = await fixture(), body = await command(app), key = crypto.randomUUID()
    directWrites.length = 0
    const response = await invoke({...body,raw:'PRIVATE_UNNEEDED_ORIGINAL'},{key})
    expect(response).toMatchObject({status:200,replayed:'0',body:{ok:true,reportId:app.reportId,author:label}})
    expect(response.body.id).toMatch(/^dec_[a-f0-9]{20}$/)
    expect(await fixes(app)).toEqual([expect.objectContaining({id:response.body.id,application_id:app.id,title:label,what:body.how,why:body.why,link_id:app.reportId,stage:'배포',actor:'human'})])
    expect(await receipts(key)).toBe(1)
    expect(JSON.stringify(commitCalls)).not.toContain('PRIVATE_UNNEEDED_ORIGINAL')
    expect(directWrites).toEqual([])
  })

  it('recovers a lost commit response with the original receipt and no duplicate fix', async () => {
    const app=await fixture(),body=await command(app),key=crypto.randomUUID()
    dropCommitResponse=true
    expect((await invoke(body,{key})).status).toBe(503)
    const saved=await fixes(app)
    expect(saved).toHaveLength(1);expect(await receipts(key)).toBe(1)
    const replay=await invoke(body,{key})
    expect(replay).toMatchObject({status:200,replayed:'1',body:{ok:true,id:saved[0].id,reportId:app.reportId}})
    expect(await fixes(app)).toEqual(saved);expect(await receipts(key)).toBe(1)
  })

  it('replays equal same-key concurrent requests once; changed content with that key conflicts', async () => {
    const app=await fixture(),body=await command(app),key=crypto.randomUUID()
    rendezvous()
    const replies=await Promise.all([invoke(body,{key}),invoke(body,{key})])
    expect(replies.map(r=>r.status)).toEqual([200,200])
    expect(replies[0].body).toEqual(replies[1].body)
    expect(replies.map(r=>r.replayed).sort()).toEqual(['0','1'])
    expect(await fixes(app)).toHaveLength(1);expect(await receipts(key)).toBe(1)
    const changed=await invoke({...body,how:'서로 다른 처리 방법을 새로 보냅니다.'},{key})
    expect(changed).toMatchObject({status:409,body:{code:'REPORT_FIX_CONFLICT'}})
    noReceipt(changed);expect(await fixes(app)).toHaveLength(1)
  })

  it.each(['same key changed body','different keys'])('allows only one fix for interleaved %s', async mode => {
    const app=await fixture(),body=await command(app),keys=[crypto.randomUUID(),crypto.randomUUID()]
    if(mode==='same key changed body')keys[1]=keys[0]
    rendezvous()
    const replies=await Promise.all([invoke(body,{key:keys[0]}),invoke({...body,how:'다른 담당자가 확인한 처리 방법입니다.'},{key:keys[1]})])
    expect(replies.map(r=>r.status).sort()).toEqual([200,409])
    expect(await fixes(app)).toHaveLength(1)
    expect(await receipts(keys[0]) + (keys[0]===keys[1]?0:await receipts(keys[1]))).toBe(1)
  })

  it('ignores a foreign-app fix but rejects a new intention after the same-app fix exists', async () => {
    const app=await fixture(),foreign=await fixture(),body=await command(app)
    await pg.query(`INSERT INTO decision_log(id,application_id,stage,actor,title,what,why,link_kind,link_id)
      VALUES('foreign-fix',$1,'배포','human','다른 담당','다른 업무 처리','다른 업무 근거','신고처리',$2)`,[foreign.id,app.reportId])
    expect((await invoke(body)).status).toBe(200)
    expect(await fixes(app)).toHaveLength(1);expect(await fixes(foreign)).toHaveLength(1)
    const key=crypto.randomUUID(),again=await invoke(body,{key})
    expect(again.status).toBe(409);expect(await receipts(key)).toBe(0);expect(await fixes(app)).toHaveLength(1)
  })

  it.each([
    ['what',"what='변경된 신고 원문'"],['title',"title='변경된 신고자'"],['why',"why='변경된 이유'"],
    ['alternatives',"alternatives='추가 원문 근거'"],['unrequested','unrequested=1'],['type',"link_id='other'"],
    ['stage',"stage='제작'"],['actor',"actor='ai'"],
    ['time',"created_at='2026-10-04 01:00:00'"],
  ])('rejects the reviewed original after its %s changes between GET and POST', async (_field,update) => {
    const app=await fixture(),body=await command(app),key=crypto.randomUUID()
    await pg.query('UPDATE decision_log SET '+update+' WHERE id=$1',[app.reportId])
    expect(await invoke(body,{key})).toMatchObject({status:409,body:{code:'REPORT_SOURCE_CHANGED'}})
    await noWrites(app,key)
  })

  it.each([
    ['source',app=>pg.query("UPDATE decision_log SET what='저장 직전 바뀐 신고' WHERE id=$1",[app.reportId])],
    ['application revision',app=>pg.query("UPDATE application SET updated_at='2099-01-01 00:00:00' WHERE id=$1",[app.id])],
    ['application department',app=>pg.query("UPDATE application SET dept='Other' WHERE id=$1",[app.id])],
    ['owner',app=>pg.query('UPDATE application SET owner_email=$2 WHERE id=$1',[app.id,other])],
    ['display name',()=>pg.query("UPDATE override_actor SET display_name='저장 직전 다른 이름' WHERE email=$1",[email])],
    ['allowed role',()=>pg.query("UPDATE override_actor SET role='engineer' WHERE email=$1",[email])],
    ['assignment',()=>pg.query("UPDATE override_actor SET product_ids_json='[\"changed\"]' WHERE email=$1",[email])],
  ])('rejects %s changes between staging and commit with no partial fix/receipt', async (_name,change) => {
    const app=await fixture(),body=await command(app),key=crypto.randomUUID()
    beforeCommit=()=>change(app)
    expect((await invoke(body,{key})).status).toBe(409)
    expect(beforeCommit).toBeNull();await noWrites(app,key)
  })

  it('uses a current display name before staged authority and rejects revocation at commit', async () => {
    const app=await fixture(),body=await command(app)
    beforeActorRead=()=>pg.query("UPDATE override_actor SET display_name='지금 이름' WHERE email=$1",[email])
    expect((await invoke(body)).body.author).toBe('지금 이름')
    expect((await fixes(app))[0].title).toBe('지금 이름')
    const second=await fixture(),next=await command(second),key=crypto.randomUUID()
    beforeCommit=()=>pg.query('UPDATE override_actor SET active=0 WHERE email=$1',[email])
    expect((await invoke(next,{key})).status).toBe(401)
    await noWrites(second,key)
  })

  it.each([['hidden',404],['binding',409],['version',409],['role',409],['revoked',401]])('hides an old receipt when %s changes immediately before lookup', async (change,status) => {
    const app=await fixture(),next=await fixture(),body=await command(app),key=crypto.randomUUID()
    expect((await invoke(body,{key})).status).toBe(200)
    beforeReceipt=async()=>{
      if(change==='hidden')await pg.query('UPDATE application SET owner_email=$2,dept=$3 WHERE id=$1',[app.id,other,'Other'])
      if(change==='binding')await pg.query('UPDATE decision_log SET application_id=$2 WHERE id=$1',[app.reportId,next.id])
      if(change==='version')await pg.query("UPDATE decision_log SET what='새 판본' WHERE id=$1",[app.reportId])
      if(change==='role')await pg.query("UPDATE override_actor SET role='reviewer' WHERE email=$1",[email])
      if(change==='revoked')await pg.query('UPDATE override_actor SET active=0 WHERE email=$1',[email])
    }
    const replay=await invoke(body,{key})
    expect(beforeReceipt).toBeNull();expect(replay.status).toBe(status);noReceipt(replay)
    expect(await fixes(app)).toHaveLength(1);expect(await fixes(next)).toEqual([]);expect(await receipts(key)).toBe(1)
  })

  it('rechecks POST authority after a receipt was found even if the original is still readable', async () => {
    const app=await fixture(),body=await command(app),key=crypto.randomUUID()
    expect((await invoke(body,{key})).status).toBe(200)
    afterReceipt=()=>pg.query("UPDATE override_actor SET role='reviewer' WHERE email=$1",[email])
    const replay=await invoke(body,{key})
    expect(afterReceipt).toBeNull();expect(replay.status).toBe(403);noReceipt(replay)
    expect(await fixes(app)).toHaveLength(1);expect(await receipts(key)).toBe(1)
  })

  it.each([['unchanged',200],['hidden',404],['binding',409],['version',409],['role',409],['revoked',401]])('revalidates %s on the commit replay path', async (change,status) => {
    const app=await fixture(),next=await fixture(),body=await command(app),key=crypto.randomUUID()
    rendezvous()
    beforeCommit=async()=>{beforeCommit=async()=>{
      if(change==='hidden')await pg.query('UPDATE application SET owner_email=$2,dept=$3 WHERE id=$1',[app.id,other,'Other'])
      if(change==='binding')await pg.query('UPDATE decision_log SET application_id=$2 WHERE id=$1',[app.reportId,next.id])
      if(change==='version')await pg.query("UPDATE decision_log SET what='다른 현재 판본' WHERE id=$1",[app.reportId])
      if(change==='role')await pg.query("UPDATE override_actor SET role='reviewer' WHERE email=$1",[email])
      if(change==='revoked')await pg.query('UPDATE override_actor SET active=0 WHERE email=$1',[email])
    }}
    const results=await Promise.all([invoke(body,{key}),invoke(body,{key})])
    expect(commitCalls.filter(call=>call.p_request_id===key)).toHaveLength(2)
    const first=results.find(reply=>reply.replayed==='0'),second=results.find(reply=>reply!==first)
    expect(first).toMatchObject({status:200,body:{ok:true}})
    expect(second.status).toBe(status)
    if(change==='unchanged')expect(second).toEqual({...first,replayed:'1'})
    else noReceipt(second)
    expect(await fixes(app)).toHaveLength(1);expect(await fixes(next)).toEqual([]);expect(await receipts(key)).toBe(1)
  })

  it.each(['unhanded','stopped'])('continues to allow handling a valid %s application report', async kind => {
    const app=await fixture({handed:kind==='stopped',stopped:true}),body=await command(app)
    expect((await invoke(body)).status).toBe(200)
    expect(await fixes(app)).toHaveLength(1)
  })

  it('keeps exact 2000-character Unicode handling text without silent truncation', async () => {
    const app=await fixture(),body=await command(app),text='😀한'.repeat(666)+'가나'
    expect(text.length).toBe(2000)
    expect((await invoke({...body,how:text,why:text})).status).toBe(200)
    expect((await fixes(app))[0]).toMatchObject({what:text,why:text})
  })

  it.each([
    {how:'가'.repeat(2001)},{why:'가'.repeat(2001)},{how:{bad:true}},{why:['잘못된 원인']},
    {how:'NUL\0문자 포함'},{why:'깨진\ud800문자 포함'},{expectedVersion:null},{expectedVersion:'bad'},
  ])('rejects malformed handling fields without a partial write: %j', async patch => {
    const app=await fixture(),body=await command(app),key=crypto.randomUUID()
    expect((await invoke({...body,...patch},{key})).status).toBe(400)
    expect(commitCalls).toEqual([]);await noWrites(app,key)
  })

  it.each(['null','[]','{','true'])('rejects malformed top-level JSON %s before mutation', async raw => {
    const app=await fixture(),key=crypto.randomUUID()
    expect((await invoke(null,{raw,key})).status).toBe(400)
    expect(commitCalls).toEqual([]);await noWrites(app,key)
  })

  it('fails closed on missing key, commit/receipt capability, and unscoped storage', async () => {
    const app=await fixture(),body=await command(app),scoped=DB.forActor(email),key=crypto.randomUUID()
    expect((await invoke(body,{key:null})).status).toBe(400)
    expect((await invoke(body,{key,adapter:{...scoped,commitMutation:undefined}})).status).toBe(503)
    expect((await invoke(body,{key,adapter:{...scoped,mutationReceipt:undefined}})).status).toBe(503)
    expect((await invoke(body,{key,adapter:DB})).status).toBe(401)
    expect((await invoke(body,{key,adapter:{...scoped,workspace:undefined}})).status).toBe(401)
    expect(commitCalls).toEqual([]);await noWrites(app,key)
  })

  it.each(['decision','receipt'])('rolls back %s insert failure with no partial audit or receipt', async target => {
    const app=await fixture(),body=await command(app),key=crypto.randomUUID()
    const table=target==='decision'?'public.decision_log':'ilson_private.mutation_receipts'
    await pg.exec(`CREATE FUNCTION public.c24_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic failure' USING ERRCODE='23514'; END $$;
      CREATE TRIGGER c24_fail BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION public.c24_fail()`)
    try { expect((await invoke(body,{key})).status).toBe(503);await noWrites(app,key) }
    finally { await pg.exec(`DROP TRIGGER c24_fail ON ${table};DROP FUNCTION public.c24_fail()`) }
  })

  it('does not grant another department or a reviewer report-handling authority', async () => {
    const app=await fixture(),body=await command(app),key=crypto.randomUUID()
    expect((await invoke(body,{key,identity:other})).status).toBe(404)
    expect((await invoke(body,{key,identity:'fix-reviewer@local.invalid'})).status).toBe(403)
    await noWrites(app,key)
  })

  it('never returns one operator receipt to a different visible operator using the same key', async () => {
    const app=await fixture(),body=await command(app),key=crypto.randomUUID()
    expect((await invoke(body,{key})).status).toBe(200)
    await pg.query("UPDATE override_actor SET departments_json='[\"Finance\",\"Other\"]' WHERE email=$1",[other])
    try {
      const reply=await invoke(body,{key,identity:other})
      expect(reply.status).toBe(409);noReceipt(reply)
      expect(await fixes(app)).toHaveLength(1);expect(await receipts(key)).toBe(1)
    } finally { await pg.query("UPDATE override_actor SET departments_json='[\"Other\"]' WHERE email=$1",[other]) }
  })

  it('does not turn receipt expiry into a new fix when the same-app handling record remains', async () => {
    const app=await fixture(),body=await command(app),key=crypto.randomUUID()
    expect((await invoke(body,{key})).status).toBe(200)
    const saved=await fixes(app)
    await pg.query("UPDATE ilson_private.mutation_receipts SET created_at=now()-interval '8 days' WHERE request_id=$1",[key])
    // Existing generic commit performs the established seven-day receipt GC.
    await DB.commitMutation(crypto.randomUUID(),'f'.repeat(64),[],[],{status:200,body:{ok:true}})
    expect(await receipts(key)).toBe(0)
    const reply=await invoke(body,{key})
    expect(reply.status).toBe(409);noReceipt(reply)
    expect(await fixes(app)).toEqual(saved);expect(await receipts(key)).toBe(0)
  })

  it('isolates demo fixes and includes the demo attribution in the frozen command', async () => {
    const token='c'.repeat(64)
    await DB.workspaceOpen(token,[])
    const database=createSupabaseDb(base,'synthetic-only',token),app=await fixture({database,owner:null})
    const body={...await command(app,{token}),author:'가상 담당자'},key=crypto.randomUUID()
    const first=await invoke(body,{token,key})
    expect(first).toMatchObject({status:200,body:{author:'가상 담당자'}})
    expect(await invoke(body,{token,key})).toEqual({...first,replayed:'1'})
    expect((await invoke({...body,author:'다른 가상 담당자'},{token,key})).status).toBe(409)
    expect((await database.prepare("SELECT title FROM decision_log WHERE application_id=? AND link_kind='신고처리'").bind(app.id).all()).results).toEqual([{title:'가상 담당자'}])
    expect(await fixes(app)).toEqual([])
  })
})
