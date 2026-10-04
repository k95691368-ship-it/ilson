// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { spawnSync } from 'node:child_process'
import { readTogether, one } from '../functions/_lib/readTogether.js'
import { atomicMutation } from '../functions/_lib/atomicMutation.ts'
import { createSupabaseDb, databaseAccessFailure } from '../functions/_lib/dbBridge.ts'
import { allScopedReads } from '../functions/_lib/allScopedReads.ts'
import { loadOutcomeEvidenceMany } from '../functions/_lib/outcomeEvidence.js'

const result = rows => ({ success: true, results: rows, meta: { changes: rows.length } })
const statement = rows => ({ all: vi.fn(async () => result(rows)), first: vi.fn(async () => rows[0] ?? null) })
afterEach(() => vi.unstubAllGlobals())

describe('explicit read batching', () => {
  it('returns complete results in input order without resolving a thenable twice', async () => {
    const then = vi.fn(resolve => resolve('once'))
    expect(await allScopedReads([Promise.resolve(1), { then }, null])).toEqual([1, 'once', null])
    expect(then).toHaveBeenCalledOnce()
    expect(await allScopedReads([])).toEqual([])
  })

  it('prioritizes a verified denial over an ordinary failure but never trusts unscoped RPC codes', async () => {
    const scoped = createSupabaseDb('https://read-batch.supabase.co', 'local-only', null, 'staff@local.invalid')
    const raw = createSupabaseDb('https://read-batch.supabase.co', 'local-only')
    vi.stubGlobal('fetch', async url => {
      if (String(url).includes('ilson_actor_')) {
        await new Promise(resolve => setTimeout(resolve, 5))
        return Response.json({ code: '42501' }, { status: 400 })
      }
      return Response.json({ code: '28000' }, { status: 400 })
    })
    const error = await allScopedReads([raw.prepare('SELECT 1').all(), scoped.prepare('SELECT 1').all()]).catch(failure => failure)
    expect(databaseAccessFailure(error)).toMatchObject({ status: 403, code: 'ACCESS_DENIED' })
  })

  it('still observes every fallback read if one statement throws synchronously', async () => {
    const first = new Error('first query'), last = vi.fn(async () => result([]))
    await expect(readTogether({}, [{ all: () => { throw first } }, { all: last }])).rejects.toBe(first)
    expect(last).toHaveBeenCalledOnce()
  })

  it('does not lose a scoped failure inside the outcome evidence reader used by batched routes', async () => {
    const settled = [], DB = createSupabaseDb('https://read-batch.supabase.co', 'local-only', null, 'staff@local.invalid')
    vi.stubGlobal('fetch', async (_url, options) => {
      const sql = JSON.parse(options.body).p_sql
      if (sql.startsWith('SELECT * FROM baseline')) {
        settled.push('temporary'); return Response.json({ code: 'XX000' }, { status: 500 })
      }
      await new Promise(resolve => setTimeout(resolve, 5))
      settled.push('revoked'); return Response.json({ code: '28000' }, { status: 400 })
    })
    const error = await loadOutcomeEvidenceMany(DB, ['application-a'], { detail: true }).catch(failure => failure)
    expect(databaseAccessFailure(error)).toMatchObject({ status: 401, code: 'ACCESS_REVOKED' })
    expect(settled).toHaveLength(6)
  })

  it.each(['fallback', 'staged'])('%s reads observe late scoped revocation after an earlier ordinary failure', async mode => {
    const settled = [], DB = createSupabaseDb('https://read-batch.supabase.co', 'local-only', null, 'staff@local.invalid')
    vi.stubGlobal('fetch', async (_url, options) => {
      const sql = JSON.parse(options.body).p_sql
      if (sql === 'SELECT 1') { settled.push('temporary'); return Response.json({ code: 'XX000' }, { status: 500 }) }
      await new Promise(resolve => setTimeout(resolve, sql === 'SELECT 2' ? 2 : 6))
      settled.push(sql === 'SELECT 2' ? 'denied' : 'revoked')
      return Response.json({ code: sql === 'SELECT 2' ? '42501' : '28000' }, { status: 400 })
    })
    const run = db => readTogether(db, [1, 2, 3].map(n => db.prepare(`SELECT ${n}`)))
    const commitMutation = vi.fn()
    const task = mode === 'fallback' ? run({ prepare: DB.prepare }) : atomicMutation({ ...DB,
      mutationReceipt: async () => null, commitMutation,
    }, 'mixed-read-errors', 'f'.repeat(64), async tx => { await run(tx); return Response.json({ ok: true }) })
    const error = await task.then(() => null, failure => failure)
    expect(databaseAccessFailure(error)).toMatchObject({ status: 401, code: 'ACCESS_REVOKED' })
    expect(settled).toEqual(['temporary', 'denied', 'revoked'])
    expect(commitMutation).not.toHaveBeenCalled()
  })

  it('selects ordinary fallback failures in query order, not settlement order or untrusted status', async () => {
    const first = new Error('first query'), forged = Object.assign(new Error('untrusted'), { status: 401, code: 'ACCESS_REVOKED' })
    const reads = [
      { all: async () => { await new Promise(resolve => setTimeout(resolve, 5)); throw first } },
      { all: async () => { throw forged } },
    ]
    await expect(readTogether({}, reads)).rejects.toBe(first)
  })

  it('does not call a write-only batch when the connection has no readBatch capability', async () => {
    const DB = { batch: vi.fn(async () => [result([])]) }
    const row = statement([{ id: 'present' }])
    expect(await readTogether(DB, [one(row)])).toEqual([{ id: 'present' }])
    expect(DB.batch).not.toHaveBeenCalled()
    expect(row.first).toHaveBeenCalledOnce()
  })

  it('preserves first/all projections, order, null, and an empty plan', async () => {
    const rows = [statement([{ id: 1 }]), statement([]), statement([{ id: 3 }])]
    const DB = { readBatch: vi.fn(async () => [result([{ id: 1 }]), result([]), result([{ id: 3 }])]) }
    expect(await readTogether(DB, [one(rows[0]), one(rows[1]), rows[2]])).toEqual([{ id: 1 }, null, result([{ id: 3 }])])
    expect(DB.readBatch).toHaveBeenCalledWith(rows)
    expect(await readTogether(DB, [])).toEqual([])
    expect(DB.readBatch).toHaveBeenCalledOnce()
    expect(rows.every(row => row.all.mock.calls.length === 0 && row.first.mock.calls.length === 0)).toBe(true)
  })

  it.each([undefined, [], [null], [{ results: null }], [result([]), result([])]].map(output => [output]))('fails closed on malformed read batch %j without rereading', async output => {
    const row = statement([{ id: 'should-not-be-read' }])
    await expect(readTogether({ readBatch: async () => output }, [row])).rejects.toThrow('Invalid read batch response')
    expect(row.all).not.toHaveBeenCalled()
  })

  it('propagates a failed read batch unchanged without fallback', async () => {
    const error = new Error('access revoked'), row = statement([])
    await expect(readTogether({ readBatch: async () => { throw error } }, [row])).rejects.toBe(error)
    expect(row.all).not.toHaveBeenCalled()
  })

  it('records atomic batch reads for conflict checking, never as staged writes', async () => {
    const DB = { prepare: () => ({ bind() { return this }, all: async () => result([{ revision: 2 }]) }),
      readBatch: vi.fn(async () => { throw Error('Do not forward staged statements') }),
      mutationReceipt: async () => null,
      commitMutation: vi.fn(async (_id, _fingerprint, reads, writes, response) => {
        expect(reads).toEqual([{ sql: 'SELECT revision FROM application WHERE id=?', binds: ['a'], rows: [{ revision: 2 }] }])
        expect(writes).toEqual([{ sql: 'UPDATE application SET revision=3 WHERE id=?', binds: ['a'] }])
        return { response, replayed: false }
      }) }
    const response = await atomicMutation(DB, 'read-batch-request', 'f'.repeat(64), async tx => {
      const [row] = await readTogether(tx, [one(tx.prepare('SELECT revision FROM application WHERE id=?').bind('a'))])
      expect(row).toEqual({ revision: 2 })
      await tx.prepare('UPDATE application SET revision=3 WHERE id=?').bind('a').run()
      return Response.json({ saved: true })
    })
    expect(response.status).toBe(200)
    expect(DB.readBatch).not.toHaveBeenCalled()
    expect(DB.commitMutation).toHaveBeenCalledOnce()
  })

  it('does not commit when an atomic read batch snapshot becomes stale', async () => {
    const stale = new Error('40001'), DB = { prepare: () => ({ bind() { return this }, all: async () => result([{ revision: 2 }]) }),
      mutationReceipt: async () => null,
      commitMutation: vi.fn(async (_id, _fingerprint, reads) => {
        expect(reads[0].rows).toEqual([{ revision: 2 }]); throw stale
      }) }
    await expect(atomicMutation(DB, 'read-batch-request', 'f'.repeat(64), async tx => {
      await readTogether(tx, [tx.prepare('SELECT revision FROM application')])
      return Response.json({ saved: true })
    })).rejects.toBe(stale)
  })

  it('rejects foreign statements in the staged read capability before any read', async () => {
    const foreign = statement([{ id: 'foreign' }]), DB = { mutationReceipt: async () => null, commitMutation: vi.fn() }
    await expect(atomicMutation(DB, 'read-batch-request', 'f'.repeat(64), async tx => {
      await tx.readBatch([foreign]); return Response.json({ saved: true })
    })).rejects.toThrow('Invalid read batch statement')
    expect(foreign.all).not.toHaveBeenCalled()
    expect(DB.commitMutation).not.toHaveBeenCalled()
  })

  it.each([['root', null, null, 'ilson_batch'], ['workspace', 'a'.repeat(64), null, 'ilson_workspace_batch'], ['actor', null, 'staff@local.invalid', 'ilson_actor_batch']])('%s reads retain the bridge scope and use one RPC', async (_scope, token, actor, rpcName) => {
    const fetch = vi.fn(async () => Response.json([{ rows: [{ id: 'a' }], rowCount: 1 }, { rows: [], rowCount: 0 }]))
    vi.stubGlobal('fetch', fetch)
    const DB = createSupabaseDb('https://read-batch.supabase.co', 'local-only', token, actor)
    expect(await readTogether(DB, [one(DB.prepare('SELECT id FROM application WHERE id=?').bind('a')), DB.prepare('SELECT id FROM application WHERE false')])).toEqual([{ id: 'a' }, { success: true, results: [], meta: { changes: 0, row_count: 0 } }])
    expect(fetch).toHaveBeenCalledOnce()
    const [url, options] = fetch.mock.calls[0]
    expect(url).toBe('https://read-batch.supabase.co/rest/v1/rpc/' + rpcName)
    const payload = JSON.parse(options.body)
    expect(payload.p_statements).toEqual(["SELECT id FROM application WHERE id=E'a'", 'SELECT id FROM application WHERE false'])
    if (token) expect(payload.p_token).toBe(token)
    if (actor) expect(payload.p_actor).toBe(actor)
  })

  it('rejects writes and foreign ownership before executing a bridge read batch', async () => {
    const fetch = vi.fn(), DB = createSupabaseDb('https://read-batch.supabase.co', 'local-only')
    vi.stubGlobal('fetch', fetch)
    await expect(DB.readBatch([DB.prepare('UPDATE application SET status=?').bind('unsafe')])).rejects.toThrow('Expected a read statement')
    await expect(DB.readBatch([createSupabaseDb('https://read-batch.supabase.co', 'local-only').prepare('SELECT 1')])).rejects.toThrow('Invalid batch statement')
    expect(await DB.readBatch([])).toEqual([])
    expect(fetch).not.toHaveBeenCalled()
  })
})

it('a rejected workspace and metrics request produces a safe access response without an unhandled promise', () => {
  // Use a child process so an unhandled rejection is observable without destabilizing the test runner.
  const script = `
    import { createSupabaseDb } from './functions/_lib/dbBridge.ts';
    import { onRequestGet } from './functions/api/override.js';
    const unhandled=[];
    process.on('unhandledRejection', error => unhandled.push(error.message));
    globalThis.fetch = async url => String(url).includes('ilson_actor_')
      ? Response.json({code:'28000'}, {status:400}) : Response.json({rows:[],rowCount:0});
    const raw=createSupabaseDb('https://read-batch.supabase.co','local-only');
    const response=await onRequestGet({env:{DB:raw.forActor('staff@local.invalid'),UNSCOPED_DB:raw,
      OVERRIDE_DEMO_MODE:'false',AUTH_ACTOR:{email:'staff@local.invalid',label:'staff',role:'product',mode:'access',departments:[],product_ids:[]}},
      request:new Request('https://local.invalid/api/override')});
    await new Promise(resolve=>setTimeout(resolve,30));
    console.log(JSON.stringify({status:response.status,body:await response.json(),unhandled}));
  `
  const child = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '--eval', script], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 10000,
  })
  expect(child.status, child.stderr).toBe(0)
  expect(JSON.parse(child.stdout)).toMatchObject({ status: 401, body: { code: 'ACCESS_REVOKED' }, unhandled: [] })
})

it.each(['workspace', 'metrics', 'capture'])('observes late scoped revocation when %s has already failed temporarily', source => {
  const script = `
    import { createSupabaseDb } from './functions/_lib/dbBridge.ts';
    import { onRequestGet } from './functions/api/override.js';
    const source=${JSON.stringify(source)}, settled=[], unhandled=[];
    process.on('unhandledRejection', error => unhandled.push(error.message));
    globalThis.fetch = async (url, options) => {
      const payload=JSON.parse(options.body), scoped=String(url).includes('ilson_actor_');
      const kind=scoped ? (payload.p_statements[0].includes('total_decisions') ? 'metrics' : 'workspace')
        : payload.p_sql.includes('SELECT id, name') ? 'capture' : 'directory';
      if(kind===source) { settled.push(kind+':temporary'); return Response.json({code:'XX000'}, {status:500}); }
      if(scoped) {
        await new Promise(resolve=>setTimeout(resolve,10));
        settled.push(kind+':revoked'); return Response.json({code:'28000'}, {status:400});
      }
      return Response.json({rows:[],rowCount:0});
    };
    const raw=createSupabaseDb('https://read-batch.supabase.co','local-only');
    const response=await onRequestGet({env:{DB:raw.forActor('staff@local.invalid'),UNSCOPED_DB:raw,
      OVERRIDE_DEMO_MODE:'false',AUTH_ACTOR:{email:'staff@local.invalid',label:'staff',role:'product',mode:'access',departments:[],product_ids:[]}},
      request:new Request('https://local.invalid/api/override')});
    const settledBeforeResponse=[...settled];
    await new Promise(resolve=>setTimeout(resolve,30));
    console.log(JSON.stringify({status:response.status,body:await response.json(),settledBeforeResponse,settled,unhandled}));
  `
  const child = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '--eval', script], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 10000,
  })
  expect(child.status, child.stderr).toBe(0)
  const output = JSON.parse(child.stdout)
  expect(output).toMatchObject({ status: 401, body: { code: 'ACCESS_REVOKED' }, unhandled: [] })
  expect(output.settledBeforeResponse).toEqual(output.settled)
  expect(output.settled).toContain(source + ':temporary')
})
