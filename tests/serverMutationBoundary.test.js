import { describe, expect, it, vi } from 'vitest'
import { atomicMutation, mutationFingerprint } from '../functions/_lib/atomicMutation.ts'
import { lockReviewRevision, reviewMutation, validReviewRevision } from '../functions/_lib/reviewMutation.ts'
import { failUnexpected, ok, privateResponse } from '../functions/_lib/http.ts'
import { boundRequestBody, requestBodyLimit } from '../functions/_lib/requestBody.ts'

const fingerprint = 'f'.repeat(64)
const requestId = 'typed-mutation-request-0001'
const makeDb = (rows = [{ count: 0, allowed: false, note: '' }]) => {
  const read = vi.fn(async () => ({ success: true, results: rows, meta: { changes: 0, row_count: rows.length } }))
  const write = vi.fn()
  const DB = {
    prepare: vi.fn(() => {
      const statement = { bind: () => statement, all: read, run: write }
      return statement
    }),
    batch: vi.fn(), mutationReceipt: vi.fn(async () => null),
    commitMutation: vi.fn(async (_id, _fingerprint, _reads, _writes, response) => ({ response, replayed: false })),
  }
  return { DB, read, write }
}
const request = (key = requestId) => new Request('https://test.invalid/api/applications/typed/review', { method: 'POST', headers: { 'X-Idempotency-Key': key } })

describe('typed atomic mutation preserves the existing transaction protocol', () => {
  it('fails closed when the atomic database protocol is unavailable', async () => {
    const action = vi.fn()
    await expect(atomicMutation({}, requestId, fingerprint, action)).rejects.toThrow('Atomic mutation migration is required')
    expect(action).not.toHaveBeenCalled()
  })

  it('captures complete query results while preserving first(column) falsy values and staging writes', async () => {
    const { DB, write } = makeDb()
    const response = await atomicMutation(DB, requestId, fingerprint, async tx => {
      const statement = tx.prepare('SELECT count,allowed,note FROM example WHERE id=?').bind('row-1')
      expect(await statement.first()).toEqual({ count: 0, allowed: false, note: '' })
      expect(await statement.first('count')).toBe(0)
      expect(await statement.first('allowed')).toBe(false)
      expect(await statement.first('note')).toBe('')
      expect(await statement.first('missing')).toBeNull()
      expect(await tx.prepare('UPDATE example SET count=? WHERE id=?').bind(1, 'row-1').run()).toEqual({ success: true, results: [], meta: { changes: 1 } })
      await tx.batch([tx.prepare('INSERT INTO audit (body) VALUES (?)').bind('record')])
      expect(write).not.toHaveBeenCalled()
      return Response.json({ saved: true }, { status: 201 })
    })
    const [id, hash, reads, writes, saved] = DB.commitMutation.mock.calls[0]
    expect([id, hash]).toEqual([requestId, fingerprint])
    expect(reads).toHaveLength(5)
    expect(reads.every(read => read.binds[0] === 'row-1' && read.rows[0].count === 0)).toBe(true)
    expect(writes).toEqual([
      { sql: 'UPDATE example SET count=? WHERE id=?', binds: [1, 'row-1'] },
      { sql: 'INSERT INTO audit (body) VALUES (?)', binds: ['record'] },
    ])
    expect(saved).toEqual({ status: 201, body: { saved: true } })
    expect(response.status).toBe(201)
    expect(response.headers.get('X-Idempotency-Replayed')).toBe('0')
  })

  it('replays the stored response without executing the action or a second commit', async () => {
    const { DB } = makeDb()
    DB.mutationReceipt.mockResolvedValue({ status: 202, body: { receipt: 'unchanged' } })
    const action = vi.fn()
    const response = await atomicMutation(DB, requestId, fingerprint, action)
    expect(action).not.toHaveBeenCalled()
    expect(DB.commitMutation).not.toHaveBeenCalled()
    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ receipt: 'unchanged' })
    expect(response.headers.get('X-Idempotency-Replayed')).toBe('1')
  })

  it('keeps a committed receipt reusable after its first network reply is lost', async () => {
    const { DB } = makeDb()
    let receipt = null
    DB.mutationReceipt.mockImplementation(async () => receipt)
    DB.commitMutation.mockImplementation(async (_id, _hash, _reads, _writes, response) => {
      receipt = response
      throw new Error('reply lost after commit')
    })
    const action = vi.fn(async tx => {
      await tx.prepare('INSERT INTO audit(body) VALUES (?)').bind('once').run()
      return Response.json({ saved: true })
    })
    await expect(atomicMutation(DB, requestId, fingerprint, action)).rejects.toThrow('reply lost')
    const replay = await atomicMutation(DB, requestId, fingerprint, action)
    expect(await replay.json()).toEqual({ saved: true })
    expect(replay.headers.get('X-Idempotency-Replayed')).toBe('1')
    expect(action).toHaveBeenCalledTimes(1)
    expect(DB.commitMutation).toHaveBeenCalledTimes(1)
  })

  it('passes original read snapshots to the commit lock and does not report a stale commit as success', async () => {
    const { DB } = makeDb([{ revision: 2 }])
    DB.commitMutation.mockImplementation(async (_id, _hash, reads) => {
      expect(reads[0].rows).toEqual([{ revision: 2 }])
      throw new Error('Supabase/40001')
    })
    await expect(atomicMutation(DB, requestId, fingerprint, async tx => {
      await tx.prepare('SELECT revision FROM application WHERE id=?').bind('app').first()
      await tx.prepare('UPDATE application SET revision=3 WHERE id=?').bind('app').run()
      return Response.json({ saved: true })
    })).rejects.toThrow('/40001')
  })

  it('does not commit unsuccessful or thrown actions unless commitError explicitly applies', async () => {
    const { DB } = makeDb()
    const action = async tx => {
      await tx.prepare('INSERT INTO audit(body) VALUES (?)').bind('failure evidence').run()
      return Response.json({ error: 'blocked' }, { status: 409 })
    }
    expect((await atomicMutation(DB, requestId, fingerprint, action)).status).toBe(409)
    expect(DB.commitMutation).not.toHaveBeenCalled()
    const retained = await atomicMutation(DB, requestId, fingerprint, action, { commitError: true })
    expect(retained.status).toBe(409)
    expect(DB.commitMutation.mock.calls[0][4]).toEqual({ status: 409, body: { error: 'blocked' } })
    DB.commitMutation.mockClear()
    await expect(atomicMutation(DB, requestId, fingerprint, async tx => {
      await tx.prepare('INSERT INTO audit(body) VALUES (?)').bind('not saved').run()
      throw new Error('action failed')
    }, { commitError: true })).rejects.toThrow('action failed')
    expect(DB.commitMutation).not.toHaveBeenCalled()
  })

  it('rejects an invalid response shape and writes attempted through the read path before committing', async () => {
    const { DB, read } = makeDb()
    await expect(atomicMutation(DB, requestId, fingerprint, async () => new Response('not-json'))).rejects.toThrow()
    expect(DB.commitMutation).not.toHaveBeenCalled()
    await expect(atomicMutation(DB, requestId, fingerprint, async tx => {
      await tx.prepare('UPDATE application SET status=?').bind('unsafe read').all()
      return Response.json({ ok: true })
    })).rejects.toThrow('Use run() for atomic writes')
    expect(read).not.toHaveBeenCalled()
    expect(DB.commitMutation).not.toHaveBeenCalled()
  })
})

describe('typed review and HTTP boundaries', () => {
  it('keeps revision validation and the staged revision lock exact', async () => {
    expect([0, 1, Number.MAX_SAFE_INTEGER].every(validReviewRevision)).toBe(true)
    expect([null, undefined, '1', true, -1, 0.5, NaN, Infinity].some(validReviewRevision)).toBe(false)
    const { DB } = makeDb()
    await atomicMutation(DB, requestId, fingerprint, async tx => {
      await lockReviewRevision(tx, { id: 'app', review_revision: '3' })
      return Response.json({ ok: true })
    })
    expect(DB.commitMutation.mock.calls[0][3]).toEqual([{ sql: 'SELECT public.ilson_lock_review_revision(?, ?)', binds: ['app', 3] }])
  })

  it('rejects malformed request identities before receipt lookup', async () => {
    const { DB } = makeDb()
    const response = await reviewMutation(DB, request('bad key'), 'review:app', {}, vi.fn(), '저장 실패')
    expect(response.status).toBe(400)
    expect(DB.mutationReceipt).not.toHaveBeenCalled()
  })

  it.each([new Error('Supabase/40001'), new Error('Supabase/40P01')])('turns transaction conflicts into a local 409 response', async error => {
    const { DB } = makeDb()
    DB.mutationReceipt.mockRejectedValue(error)
    const response = await reviewMutation(DB, request(), 'review:app', {}, vi.fn(), '저장 실패')
    expect(response.status).toBe(409)
    expect(await response.text()).not.toContain('Supabase')
  })

  it.each([null, undefined, 'private-secret', { message: { secret: 'not-displayable' } }])('does not leak or crash on unknown thrown values %j', async error => {
    const { DB } = makeDb()
    DB.mutationReceipt.mockRejectedValue(error)
    const response = await reviewMutation(DB, request(), 'review:app', {}, vi.fn(), '저장 실패')
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: '저장 실패' })
    expect(await failUnexpected(error, '일반 오류').json()).toEqual({ error: '일반 오류' })
  })

  it('preserves cookies and existing vary tokens while enforcing private security headers', async () => {
    const response = privateResponse(ok({ ok: true }, 201, { Vary: 'Accept, cookie', 'Set-Cookie': 'synthetic=test; HttpOnly', 'Cache-Control': 'public' }))
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ ok: true })
    expect(response.headers.get('Set-Cookie')).toBe('synthetic=test; HttpOnly')
    expect(response.headers.get('Vary')).toBe('Accept, cookie, Authorization')
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer')
  })

  it('produces stable content fingerprints without trusting input types', async () => {
    const first = await mutationFingerprint({ input: ['text', 1, null] })
    expect(first).toMatch(/^[a-f0-9]{64}$/)
    expect(await mutationFingerprint({ input: ['text', 1, null] })).toBe(first)
    expect(await mutationFingerprint({ input: ['changed', 1, null] })).not.toBe(first)
  })
})

describe('typed streaming request body limit', () => {
  const make = (path, body, headers = {}, method = 'POST') => new Request('https://test.invalid' + path, { method, body, headers, duplex: 'half' })

  it('retains exact route-specific limits and rejects oversized advertised lengths without consuming the body', () => {
    const input = make('/api/applications', 'tiny', { 'Content-Length': String(1024 * 1024 + 1) })
    const bounded = boundRequestBody(input)
    expect(bounded).toEqual({ exceeded: true, request: input })
    expect(input.bodyUsed).toBe(false)
    expect(requestBodyLimit(make('/api/applications/app/build/', '{}'))).toBe(16 * 1024 * 1024)
    expect(requestBodyLimit(make('/api/applications/app/build', '{}', {}, 'PUT'))).toBe(1024 * 1024)
  })

  it('enforces byte counts when length is absent or falsely small', async () => {
    for (const headers of [{}, { 'Content-Length': '1' }]) {
      const input = make('/api/applications', new ReadableStream({ start(controller) {
        controller.enqueue(new Uint8Array(1024 * 1024))
        controller.enqueue(new Uint8Array(1))
        controller.close()
      } }), headers)
      const bounded = boundRequestBody(input)
      expect(bounded.exceeded).toBe(false)
      await expect(bounded.request.text()).rejects.toThrow('Request body limit exceeded')
      expect(bounded.exceeded).toBe(true)
    }
  })

  it('accepts the exact byte limit and preserves request method and headers', async () => {
    const bounded = boundRequestBody(make('/api/applications', new Uint8Array(1024 * 1024), { 'X-Idempotency-Key': requestId }))
    expect((await bounded.request.arrayBuffer()).byteLength).toBe(1024 * 1024)
    expect(bounded.exceeded).toBe(false)
    expect(bounded.request.method).toBe('POST')
    expect(bounded.request.headers.get('X-Idempotency-Key')).toBe(requestId)
    const empty = new Request('https://test.invalid/api/health')
    expect(boundRequestBody(empty)).toEqual({ exceeded: false, request: empty })
  })
})
