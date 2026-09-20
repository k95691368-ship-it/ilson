import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSupabaseDb } from '../functions/_lib/dbBridge.js'

// Exercise the actual route catches, not merely the common response helper.
// A successful initial application/handover read is important: later failures
// otherwise escape to middleware before reaching the legacy inner catches.
const routes = [
  ['built.js', false, '세지 못했습니다.'],
  ['decisions.js', false, '결정 기록을 불러오지 못했습니다.'],
  ['joins.js', false, '손든 부서를 세지 못했습니다.'],
  ['overview.js', false, '현황을 불러오지 못했습니다.'],
  ['priority.js', false, '우선순위 판을 만들지 못했습니다.'],
  ['response.js', false, '부서 응답을 세지 못했습니다.'],
  ['signoffs.js', false, '부서 이의를 세지 못했습니다.'],
  ['stalls.js', false, '막힌 곳을 세지 못했습니다.'],
  ['applications/index.js', false, '신청서를 불러오지 못했습니다.'],
  ['applications/[id]/index.js', false, '신청서를 불러오지 못했습니다.'],
  ['applications/[id]/agreement.js', true, '협의안을 불러오지 못했습니다.'],
  ['applications/[id]/beta.js', true, '베타 기록을 불러오지 못했습니다.'],
  ['applications/[id]/build.js', true, '제작 기록을 불러오지 못했습니다.'],
  ['applications/[id]/outcome.js', true, '성과를 불러오지 못했습니다.'],
  ['applications/[id]/join.js', true, '손든 부서를 불러오지 못했습니다.'],
  ['applications/[id]/signoff.js', true, '이의를 불러오지 못했습니다.'],
  ['track/[ticket].js', false, '조회하지 못했습니다.'],
  ['track/[ticket]/waitline.js', false, '차례를 계산하지 못했습니다.'],
  ['tools/[slug].js', true, '도구를 불러오지 못했습니다.'],
  ['tools/[slug]/unclear.js', true, '짚힌 곳을 불러오지 못했습니다.'],
  ['demo/visitors.js', false, '세지 못했습니다.'],
]
const app = { id: 'local-app', application_id: 'local-app', ticket_no: 'AX-ABC-DEF', dept: '재무', title: '로컬 자료', status: '수용', slug: 'local-tool' }
const params = { id: app.id, ticket: app.ticket_no, slug: app.slug }
afterEach(() => vi.unstubAllGlobals())
async function databaseError(code, scoped = true) {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ code, message: 'PRIVATE SQL SECRET', details: 'staff@private.invalid' }, { status: 400 })))
  const raw = createSupabaseDb('https://route-error-local.supabase.co', 'local-only-private-key')
  const db = scoped ? raw.forActor('staff@private.invalid') : raw
  return db.prepare('SELECT 1').first().catch(error => error)
}
function failDb(error, initialRead = false) {
  let reads = 0
  return {
    prepare() {
      const success = initialRead && reads++ === 0
      return { bind() { return this }, first: async () => { if (success) return app; throw error },
        all: async () => { throw error }, run: async () => { throw error } }
    },
    batch: async () => { throw error }, claimRateLimit: async () => 1,
    toolRunScope: async () => 'local-scope',
  }
}
async function responseBody(response, status) {
  expect(response.status).toBe(status)
  expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  const text = await response.text()
  expect(text).not.toMatch(/PRIVATE|private-key|private.invalid|Database request|28000|42501|53300/)
  return JSON.parse(text)
}

describe.each(routes)('%s late database error boundary', (file, initialRead, fallback) => {
  it.each([['28000', 401, 'ACCESS_REVOKED'], ['42501', 403, 'ACCESS_DENIED'], ['53300', 503, null]])('%s remains a safe %s response', async (code, status, publicCode) => {
    const error = await databaseError(code)
    const { onRequestGet } = await import(/* @vite-ignore */ `../functions/api/${file}`)
    const response = await onRequestGet({ env: { DB: failDb(error, initialRead), DEMO_WORKSPACE: true }, params,
      request: new Request('https://local.invalid/api/route') })
    const body = await responseBody(response, status)
    if (publicCode) expect(body).toMatchObject({ code: publicCode })
    else expect(body).toEqual({ error: fallback })
  })
})

describe('write boundaries preserve generic status without swallowing scoped access errors', () => {
  it.each(['feedback', 'resolve_feedback'])('beta %s uses safe access errors but keeps ordinary failures at 500', async kind => {
    const { onRequestPost } = await import('../functions/api/applications/[id]/beta.js')
    for (const [code, status] of [['28000', 401], ['42501', 403], ['53300', 500]]) {
      const error = await databaseError(code)
      const response = await onRequestPost({ env: { DB: failDb(error, true) }, params,
        request: new Request('https://local.invalid/api/applications/local-app/beta', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, body: '확인 내용', id: 'local-feedback', resolution: '확인' }) }) })
      const body = await responseBody(response, status)
      expect(body).not.toHaveProperty('notSaved')
      if (status === 500) expect(body).toEqual({ error: '저장하지 못했습니다.' })
    }
  })
  it('an unscoped server configuration failure is not mislabeled as a user access error', async () => {
    const { onRequestGet } = await import('../functions/api/track/[ticket].js')
    for (const code of ['28000', '42501']) {
      const error = await databaseError(code, false)
      const response = await onRequestGet({ env: { DB: failDb(error) }, params, request: new Request('https://local.invalid/api/track/AX-ABC-DEF') })
      expect(await responseBody(response, 503)).toEqual({ error: '조회하지 못했습니다.' })
    }
  })
})
