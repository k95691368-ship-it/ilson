// @vitest-environment node
import { describe,expect,it,vi } from 'vitest'
import { decodeReportFeedPayload,loadReportFeed,parseReportFeedQuery } from '../functions/_lib/reportFeed.ts'
import { onRequestGet } from '../functions/api/reports.js'
const url=query=>new Request('https://local.invalid/api/reports'+query)
const count=(extra={})=>({application_id:'a',total:1,open:1,urgent:1,fixed:0,digest:'a'.repeat(32),...extra})
const row=(extra={})=>({id:'r',application_id:'a',title:'직원',what:'다른 숫자입니다.',why:'확인한 제보',link_kind:'신고',link_id:'wrong_number',created_at:'2026-10-01 00:00:00',
  ticket_no:'IL-1',dept:'Finance',slug:null,tool_title:null,handed_to_dept:null,fix_id:null,fix_application_id:null,fix_how:null,fix_why:null,fix_at:null,open_rank:1,urgent_rank:1,...extra})
const payload=()=>({counts:[count()],rows:[row()]})
const adapter=value=>{const all=vi.fn(async()=>({success:true,results:[value],meta:{changes:1,row_count:1}})),DB={provider:'supabase',toolRunScope:async()=>'1'.repeat(64),prepare:vi.fn(()=>({bind:vi.fn(()=>({all}))}))};return{DB,all}}

describe('bounded report feed request contract',()=>{
  it('defaults to page one and accepts exact canonical page/basis only',()=>{
    expect(parseReportFeedQuery(url(''))).toEqual({ok:true,value:{number:1,basis:null}})
    expect(parseReportFeedQuery(url('?page=10000&basis='+'a'.repeat(64)))).toEqual({ok:true,value:{number:10000,basis:'a'.repeat(64)}})
  })
  it.each(['?page=0','?page=01','?page=-1','?page=+1','?page=1.0','?page=1e2','?page=','?page=10001','?page=9007199254740992',
    '?page=%201','?page=1%20','?page=1&page=1','?basis=','?basis='+'A'.repeat(64),'?basis='+'a'.repeat(63),
    '?basis='+'a'.repeat(65),'?basis='+('a'.repeat(63)+'z'),'?basis='+'a'.repeat(64)+'&basis='+'a'.repeat(64),
    '?size=100','?anything=1'])('rejects %s before querying the handler DB',async query=>{
    const DB={prepare:vi.fn()}
    const response=await onRequestGet({env:{DB},request:url(query)})
    expect(response.status).toBe(400);expect(DB.prepare).not.toHaveBeenCalled()
  })
})

describe('typed PG report result boundary',()=>{
  it('accepts explicit zero and actual known row shapes',()=>{
    expect(decodeReportFeedPayload({counts:[],rows:[]})).toEqual({counts:[],rows:[]})
    expect(decodeReportFeedPayload(payload())).toEqual(payload())
  })
  it.each([null,undefined,{}, {counts:null,rows:[]},{counts:[],rows:null},{counts:[],rows:[row()]},
    {counts:[count()],rows:Array.from({length:101},(_,i)=>row({id:'r'+i}))}])('rejects missing or unbounded payload %#',value=>{
    expect(()=>decodeReportFeedPayload(value)).toThrow()
  })
  it.each([null,'1',-1,1.5,Infinity,NaN,true,Number.MAX_SAFE_INTEGER+1])('rejects an unknown/invalid count %#',total=>{
    expect(()=>decodeReportFeedPayload({counts:[count({total})],rows:[row()]})).toThrow()
  })
  it.each([{total:0},{open:2},{urgent:2},{fixed:1},{digest:'wrong'},{application_id:''}])('rejects inconsistent count %j',changes=>{
    expect(()=>decodeReportFeedPayload({counts:[count(changes)],rows:[row()]})).toThrow()
  })
  it.each([{id:0},{application_id:'different'},{what:null},{link_kind:'신고처리'},{open_rank:2},{urgent_rank:0},
    {slug:undefined},{fix_id:'f'},{fix_id:'f',fix_application_id:'other',fix_how:'처리',fix_why:'근거',fix_at:'2026',open_rank:0},
    {fix_how:'있지만ID없음'}])('rejects malformed or cross-app row %j',changes=>{
    expect(()=>decodeReportFeedPayload({counts:[count()],rows:[row(changes)]})).toThrow()
  })
  it('rejects duplicate application counts and original IDs',()=>{
    expect(()=>decodeReportFeedPayload({counts:[count(),count()],rows:[row()]})).toThrow()
    expect(()=>decodeReportFeedPayload({counts:[count({total:2,open:2,urgent:2})],rows:[row(),row()]})).toThrow()
  })
  it('rejects per-page status that exceeds the complete application counts',()=>{
    expect(()=>decodeReportFeedPayload({counts:[count({open:0,urgent:0,fixed:1})],rows:[row()]})).toThrow()
    const fixed=row({fix_id:'f',fix_application_id:'a',fix_how:'처리',fix_why:'근거',fix_at:'2026',open_rank:0})
    expect(()=>decodeReportFeedPayload({counts:[count()],rows:[fixed]})).toThrow()
    expect(()=>decodeReportFeedPayload({counts:[count({urgent:0})],rows:[row()]})).toThrow()
  })
  it('rejects incomplete pages, unknown scopes and overflow instead of successful zero',async()=>{
    for(const value of [null,{}, {payload:{counts:[count()],rows:[]}}, {payload:{counts:[count({total:Number.MAX_SAFE_INTEGER,open:Number.MAX_SAFE_INTEGER,urgent:0}),
      count({application_id:'b',total:2,open:2,urgent:0})],rows:Array.from({length:100},(_,i)=>row({id:'r'+i}))}}]){
      const {DB}=adapter(value)
      expect((await onRequestGet({env:{DB},request:url('')})).status).toBe(503)
    }
    const {DB}=adapter({payload:payload()});DB.toolRunScope=async()=>null
    await expect(loadReportFeed(DB,{number:1,basis:null})).rejects.toThrow()
  })
  it('fails closed before SQL for unsupported adapters',async()=>{
    for(const provider of [undefined,'d1']){
      const {DB}=adapter({payload:payload()});DB.provider=provider
      expect((await onRequestGet({env:{DB},request:url('')})).status).toBe(503)
      expect(DB.prepare).not.toHaveBeenCalled()
    }
  })
  it.each([
    {success:true,results:[],meta:{changes:0,row_count:0}},
    {success:true,results:[{payload:{counts:[],rows:[]}},{payload:{counts:[],rows:[]}}],meta:{changes:2,row_count:2}},
    {success:true,results:[{payload:{counts:[],rows:[]}}],meta:{changes:0,row_count:0}},
    {success:true,results:[{payload:{counts:[],rows:[]}}],meta:{changes:1}},
    {success:true,results:[{payload:{counts:[],rows:[]}}],meta:{changes:2,row_count:1}},
  ])('rejects damaged wrapper count metadata %#',async result=>{
    const {DB,all}=adapter(null);all.mockResolvedValue(result)
    const response=await onRequestGet({env:{DB},request:url('')})
    expect(response.status).toBe(503);expect(await response.json()).not.toHaveProperty('summary')
  })
  it('returns only error/code on stale evidence without disclosing old/new data',async()=>{
    const {DB}=adapter({payload:payload()})
    const response=await onRequestGet({env:{DB},request:url('?basis='+'0'.repeat(64))})
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({error:'신고 기록이 바뀌었습니다. 첫 페이지에서 다시 확인해주세요.',code:'REPORTS_CHANGED'})
  })
  it('keeps empty and out-of-range page contracts without clamping',async()=>{
    const {DB}=adapter({payload:{counts:[],rows:[]}})
    expect(await loadReportFeed(DB,{number:1,basis:null})).toMatchObject({summary:{total:0},page:{number:1,size:100,totalPages:1,hasPrevious:false,hasMore:false}})
    expect(await loadReportFeed(DB,{number:10000,basis:null})).toMatchObject({rows:[],page:{number:10000,totalPages:1,hasPrevious:true,hasMore:false}})
  })
})
