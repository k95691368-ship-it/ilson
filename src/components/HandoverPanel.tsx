import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client.ts'
import type { FieldErrors } from '../api/client.ts'
import { useActionLifetime } from '../hooks/useActionLifetime.js'
import { validateHandover } from '../../shared/handover.ts'
import { readHandoverEvidence } from '../../shared/contracts/handover.ts'
import type { HandoverAction, HandoverDraft, HandoverEvidenceResponse, HandoverRequest } from '../../shared/contracts/handover.ts'
import Field from './Field.jsx'

type Props = { id: string; refreshKey?: number | string }
type TextField = 'title' | 'person' | 'whenToRun' | 'afterRun' | 'contact' | 'reason'

// Catch values are unknown. Only use individually narrowed error properties.
function readFailure(error: unknown): { message: string; status: number | null; fields: FieldErrors } {
  const value = typeof error === 'object' && error !== null ? error : {}
  const message = 'message' in value && typeof value.message === 'string' ? value.message : '요청에 실패했습니다.'
  const status = 'status' in value && typeof value.status === 'number' ? value.status : null
  const errors = 'fields' in value ? value.fields : null
  const fields = typeof errors === 'object' && errors !== null && !Array.isArray(errors)
    ? Object.fromEntries(Object.entries(errors).filter((entry): entry is [string, string] => typeof entry[1] === 'string')) : {}
  return { message, status, fields }
}

export default function HandoverPanel({ id, refreshKey }: Props) {
  const [open,setOpen]=useState(false), [data,setData]=useState<HandoverEvidenceResponse | null>(null), [error,setError]=useState('')
  const [loading,setLoading]=useState(false), [saving,setSaving]=useState(false), [conflict,setConflict]=useState(false)
  const [pending,setPending]=useState<HandoverRequest | null>(null), [message,setMessage]=useState(''), [fields,setFields]=useState<FieldErrors>({})
  const [draft,setDraft]=useState<HandoverDraft>({title:'',person:'',whenToRun:'',afterRun:'',contact:'',dailyLimit:'20',maxFileMb:'10',reason:'',scopeAccepted:false,humanChecks:{}})
  const current=useActionLifetime(id), busy=useRef(false), initialized=useRef(false), requestSeq=useRef(0), viewedEvidence=useRef<string | null>(null)
  const path=`/applications/${id}/handover`
  const refresh=useCallback(async()=>{
    const alive=current(), seq=++requestSeq.current
    setLoading(true)
    try {
      const result=readHandoverEvidence(await api.get(path))
      if(!alive()||seq!==requestSeq.current) return
      setData(result);setError('');setConflict(false)
      if(!initialized.current) {
        initialized.current=true
        setDraft(d=>({...d,title:result.handover?.title??result.application.title,person:result.handover?.handed_to_person??'',
          whenToRun:result.manual?.when_to_run??'',afterRun:result.manual?.what_to_do_after??'',contact:result.manual?.contact??'',
          dailyLimit:String(result.handover?.daily_limit??20),maxFileMb:String(result.handover?.max_file_mb??10)}))
      } else if(viewedEvidence.current!==result.expectedEvidence) {
        // Keep the written explanation, not its confirmation against old evidence.
        setDraft(d=>({...d,scopeAccepted:false,humanChecks:Object.fromEntries(Object.entries(d.humanChecks).map(([key,value])=>[key,{...value,confirmed:false}]))}))
      }
      viewedEvidence.current=result.expectedEvidence
    } catch(err) {if(alive()&&seq===requestSeq.current)setError(readFailure(err).message)}
    finally {if(alive()&&seq===requestSeq.current)setLoading(false)}
  },[current,path])
  useEffect(()=>{if(open)void refresh()},[open,refreshKey,refresh])
  const change=<K extends keyof HandoverDraft,>(key: K,value: HandoverDraft[K])=>setDraft(d=>({...d,[key]:value}))

  async function save(action: HandoverAction,retry: HandoverRequest | null=null) {
    if(busy.current||(!retry&&(loading||conflict||error||!data))) return
    const body: HandoverRequest | null=retry??(data?{...draft,action,dailyLimit:Number(draft.dailyLimit),maxFileMb:Number(draft.maxFileMb),expectedEvidence:data.expectedEvidence}:null)
    if(!body) return
    const errors=validateHandover(body,data?.humanCriteria)
    if(Object.keys(errors).length){setFields(errors);return}
    busy.current=true;setSaving(true);setFields({});setError('');setMessage('')
    const alive=current()
    try {
      await api.post(path,body)
      if(!alive()) return
      setDraft(d=>({...d,reason:'',scopeAccepted:false,humanChecks:Object.fromEntries(Object.entries(d.humanChecks).map(([key,value])=>[key,{...value,confirmed:false}]))}))
      setPending(null);setMessage(action==='stop'?'현장 실행을 중단했습니다.':action==='restore'?'같은 정산 도구의 실행을 재개했습니다. 이전 수령 기록은 유지되며 이번 재개의 새 수령 확인을 뜻하지 않습니다.':'도구와 사용법을 인계했습니다. 부서 수령 확인은 도구 화면에서 별도로 받습니다.')
      await refresh()
    } catch(err) {
      if(!alive()) return
      const failure=readFailure(err)
      setError(failure.message)
      if(failure.status===0||(failure.status!==null&&failure.status>=500)) setPending(body)
      else {setPending(null);setFields(failure.fields);if(failure.status===409)setConflict(true)}
    } finally {if(alive())setSaving(false);busy.current=false}
  }
  const h=data?.handover, action=h?.rolled_back_at?'restore':'create'
  const locked=loading||saving||!!pending
  const input=(key: TextField,label: string,max=2000)=><Field key={key} label={label} error={fields[key]}><input value={draft[key]} maxLength={max} disabled={locked} onChange={e=>change(key,e.target.value)}/></Field>
  return <details className="card" onToggle={event=>setOpen(event.currentTarget.open)}>
    <summary>현장 정산 도구 인계</summary>
    {open&&<div className="stack" style={{marginTop:16}}>
      {loading&&<p role="status">인계 근거 확인 중…</p>}
      {error&&<div className="notice notice-warn" role="alert">{error}</div>}
      {message&&<p role="status">{message}</p>}
      {pending?<div className="notice notice-warn"><p>저장 여부가 확인되지 않았습니다. 초안을 바꾸지 않고 같은 요청을 다시 확인합니다.</p><button type="button" disabled={saving} className="btn-primary" onClick={()=>save(pending.action,pending)}>같은 인계 기록 다시 저장</button></div>
        :<button type="button" className="btn-ghost" disabled={loading||saving} onClick={refresh}>{conflict?'최신 근거 확인':'근거 새로 확인'}</button>}
      {data&&<>
        <p className="muted">{data.scope}</p>
        {h&&<div className="row"><span>{h.rolled_back_at?'중단됨':'인계됨'} · {h.handed_to_dept} · {h.handed_to_person}</span><Link to={`/t/${h.slug}`}>도구와 사용법 열기</Link><Link to={`/result?id=${encodeURIComponent(id)}`}>성과 확인</Link></div>}
        {(!h||h.rolled_back_at)&&<>
          {data.blockers.length>0&&<div className="notice notice-warn"><ul>{data.blockers.map(text=><li key={text}>{text}</li>)}</ul><Link to={`/agreement?id=${encodeURIComponent(id)}`}>협의 근거 확인</Link></div>}
          <div className="form-grid">{input('title','도구 이름',120)}{input('person',`${data.application.dept} 받는 담당자`,120)}{input('whenToRun','실행 시점')}{input('afterRun','결과 확인 방법')}{input('contact','문의 담당자',200)}
            <Field label="하루 성공 실행 제한" error={fields.dailyLimit}><input type="number" min="1" max="100" value={draft.dailyLimit} disabled={locked} onChange={e=>change('dailyLimit',e.target.value)}/></Field>
            <Field label="파일 제한(MB)" error={fields.maxFileMb}><input type="number" min="1" max="10" value={draft.maxFileMb} disabled={locked} onChange={e=>change('maxFileMb',e.target.value)}/></Field>
          </div>
          {data.humanCriteria.map(c=><fieldset key={c.id} disabled={locked}><legend>{c.body}</legend>
            <Field label="직접 확인했습니다" error={fields.humanChecks&&!draft.humanChecks[c.id]?.confirmed?'이 기준을 직접 확인해주세요.':null}><input type="checkbox" checked={draft.humanChecks[c.id]?.confirmed??false} onChange={e=>change('humanChecks',{...draft.humanChecks,[c.id]:{evidence:draft.humanChecks[c.id]?.evidence??'',confirmed:e.target.checked}})}/></Field>
            <Field label="확인 근거" error={fields.humanChecks&&String(draft.humanChecks[c.id]?.evidence??'').trim().length<5?fields.humanChecks:null}><textarea maxLength={2000} value={draft.humanChecks[c.id]?.evidence??''} onChange={e=>change('humanChecks',{...draft.humanChecks,[c.id]:{confirmed:draft.humanChecks[c.id]?.confirmed??false,evidence:e.target.value}})}/></Field>
          </fieldset>)}
          <Field label="지원 기간·상품·고정 환율의 제한을 확인했습니다." error={fields.scopeAccepted}><input type="checkbox" checked={draft.scopeAccepted} disabled={locked} onChange={e=>change('scopeAccepted',e.target.checked)}/></Field>
        </>}
        {input('reason',h&&!h.rolled_back_at?'중단 근거':'인계 판단 근거')}
        {h&&!h.rolled_back_at?<button type="button" className="btn-ghost" disabled={locked||conflict||!!error} onClick={()=>save('stop')}>현장 실행 중단</button>
          :<button type="button" className="btn-primary" disabled={locked||conflict||!!error||data.blockers.length>0} onClick={()=>save(action)}>{saving?'기록 중…':action==='restore'?'다시 인계':'정산 도구 인계'}</button>}
      </>}
    </div>}
  </details>
}
