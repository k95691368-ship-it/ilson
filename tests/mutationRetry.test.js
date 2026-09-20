import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { api } from '../src/api/client.js'
import { beginAccessCheck, completeAccessCheck } from '../src/lib/accessSession.js'
beforeEach(() => completeAccessCheck(beginAccessCheck(), { ok: true, mode: 'access', scope: 'a'.repeat(64) }))
afterEach(()=>vi.unstubAllGlobals())
it('keeps the same request key after a truncated success and starts a new key after confirmation',async()=>{
  const keys=[]
  vi.stubGlobal('fetch',vi.fn(async(_url,options)=>{
    keys.push(options.headers.get('X-Idempotency-Key'))
    return keys.length===1 ? new Response('{broken',{status:200}) : Response.json({ok:true})
  }))
  const payload={action:'create_product',name:'retry-test'}
  await expect(api.post('/override',payload)).rejects.toMatchObject({status:502})
  await api.post('/override',payload)
  await api.post('/override',payload)
  expect(keys[0]).toBe(keys[1]);expect(keys[2]).not.toBe(keys[1])
})

it('exposes explicit unsaved criteria conflicts without inventing that assurance for other failures',async()=>{
  const responses=[
    {error:'기준이 변경됐습니다',code:'BETA_CRITERIA_CHANGED',notSaved:true},
    {error:'계정이 변경됐습니다'},
  ]
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json(responses.shift(),{status:409})))
  await expect(api.post('/applications/local/beta',{kind:'round',run_id:'first'})).rejects.toMatchObject({status:409,code:'BETA_CRITERIA_CHANGED',notSaved:true})
  await expect(api.post('/applications/local/beta',{kind:'round',run_id:'second'})).rejects.toMatchObject({status:409,code:null,notSaved:false})
})
