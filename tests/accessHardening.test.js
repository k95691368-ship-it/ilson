// @vitest-environment node
import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest'
import { verifiedAccessEmail } from '../functions/_lib/access.js'
import { resolveOverrideActor } from '../functions/_lib/override.js'
import { integrationConfig } from '../functions/_lib/integrationConfig.js'
import { onRequest } from '../functions/api/_middleware.js'
import { buildJourney } from '../shared/journey.js'

let pair,jwk
const issuer='https://audit-hardening.cloudflareaccess.com'
const env={ACCESS_TEAM_DOMAIN:issuer,ACCESS_AUD:'application-a',OVERRIDE_DEMO_MODE:'false'}
const enc = value => Buffer.from(typeof value==='string'?value:JSON.stringify(value)).toString('base64url')
beforeAll(async()=>{
  pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify'])
  jwk={...await crypto.subtle.exportKey('jwk',pair.publicKey),kid:'test-key',alg:'RS256',use:'sig'}
})
afterEach(()=>vi.unstubAllGlobals())
async function assertion(overrides={}) {
  const now=Math.floor(Date.now()/1000)
  const data=enc({alg:'RS256',kid:'test-key'})+'.'+enc({iss:issuer,aud:['application-a'],iat:now,exp:now+300,email:'operator@example.test',...overrides})
  return data+'.'+Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,new TextEncoder().encode(data))).toString('base64url')
}
const request=token=>new Request('https://ilson.test/api/override',{headers:{'Cf-Access-Jwt-Assertion':token}})
describe('real-mode authentication and credential confinement',()=>{
  it('accepts only the configured issuer, audience, lifetime and signature',async()=>{
    const fetcher=vi.fn(async()=>Response.json({keys:[jwk]}));vi.stubGlobal('fetch',fetcher)
    expect(await verifiedAccessEmail(env,request(await assertion()))).toBe('operator@example.test')
    expect(fetcher.mock.calls[0][0]).toBe(issuer+'/cdn-cgi/access/certs')
    for (const override of [{iss:'https://wrong.cloudflareaccess.com'},{aud:['other-app']},{exp:0},{nbf:9999999999},{iat:9999999999}])
      expect(await verifiedAccessEmail(env,request(await assertion(override)))).toBeNull()
    const token=await assertion()
    const parts=token.split('.');parts[1]=enc({email:'forged@example.test'})
    expect(await verifiedAccessEmail(env,request(parts.join('.')))).toBeNull()
    expect(await verifiedAccessEmail(env,request(enc({alg:'none'})+'.'+parts[1]+'.'))).toBeNull()
  })
  it('does not trust a standalone email header or expose business GETs by default',async()=>{
    const DB={prepare:vi.fn()},next=vi.fn()
    const forged=new Request('https://ilson.test/api/override',{headers:{'CF-Access-Authenticated-User-Email':'admin@example.test'}})
    expect(await resolveOverrideActor({...env,DB},forged)).toBeNull()
    expect(DB.prepare).not.toHaveBeenCalled()
    const response=await onRequest({env:{DB,DBBridgeApplied:true},request:forged,next})
    expect(response.status).toBe(401);expect(next).not.toHaveBeenCalled()
  })
  it('ignores real account headers in a public demonstration',async()=>{
    const DB={prepare:vi.fn()}
    const actor=await resolveOverrideActor({DB,DEMO_WORKSPACE:true},request(await assertion()),{role:'reviewer'})
    expect(actor.mode).toBe('demo');expect(DB.prepare).not.toHaveBeenCalled()
  })
  it('requires exact endpoint, dedicated binding and remote idempotency',()=>{
    const integration={kind:'ticket',endpoint_url:'https://tickets.example.test/hooks',secret_binding:'OVERRIDE_INTEGRATION_JIRA_TOKEN'}
    const config={endpointUrl:integration.endpoint_url,secretBinding:integration.secret_binding,supportsIdempotency:true}
    const setup={OVERRIDE_INTEGRATIONS:JSON.stringify({ticket:config}),OVERRIDE_INTEGRATION_JIRA_TOKEN:'fake-test-value',SUPABASE_SERVICE_ROLE_KEY:'fake-not-a-real-key'}
    expect(integrationConfig(setup,integration)).toEqual(config)
    expect(integrationConfig(setup,{...integration,endpoint_url:'https://collector.example.test'})).toBeNull()
    expect(integrationConfig(setup,{...integration,secret_binding:'SUPABASE_SERVICE_ROLE_KEY'})).toBeNull()
    expect(integrationConfig({...setup,OVERRIDE_INTEGRATIONS:JSON.stringify({ticket:{...config,secretBinding:'SUPABASE_SERVICE_ROLE_KEY'}})},
      {...integration,secret_binding:'SUPABASE_SERVICE_ROLE_KEY'})).toBeNull()
    expect(integrationConfig({...setup,OVERRIDE_INTEGRATIONS:JSON.stringify({ticket:{...config,supportsIdempotency:false}})},integration)).toBeNull()
  })
  it('retains each review decision and link/unlink event in chronological order',()=>{
    const entries=buildJourney({application:{id:'a',created_at:'2026-09-01 00:00:00'},
      review:{verdict:'반려',decided_at:'2026-09-02 00:00:00'},
      decisions:[{id:'first',stage:'검토',created_at:'2026-09-02 00:00:00',title:'접수',what:'접수',why:'가능'},
        {id:'second',stage:'검토',created_at:'2026-09-13T00:00:00Z',title:'반려',what:'변경',why:'불가능'}]},
    {linkHistory:[{id:'linked',action:'link_product',created_at:'2026-09-03 00:00:00',detail:{product_name:'제품'}},
      {id:'unlinked',action:'unlink_product',created_at:'2026-09-12 00:00:00',detail:{product_name:'제품'}}]})
    expect(entries.filter(row=>row.kind==='검토').map(row=>[row.title,row.at])).toEqual([['접수','2026-09-02 00:00:00'],['반려','2026-09-13T00:00:00Z']])
    expect(entries.map(row=>row.key)).toEqual(['신청:a','검토:first','연결 이력:linked','연결 이력:unlinked','검토:second'])
  })
})
