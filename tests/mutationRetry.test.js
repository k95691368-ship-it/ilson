import { afterEach, expect, it, vi } from 'vitest'
import { api } from '../src/api/client.js'
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
