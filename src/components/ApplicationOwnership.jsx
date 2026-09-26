import { useState } from 'react'
import { useApi } from '../hooks/useApi.js'
import { api } from '../api/client.ts'
import { useToast } from '../context/ToastContext.jsx'

export default function ApplicationOwnership({ applicationId, onChanged }) {
  const { data, error, loading, reload } = useApi(`/applications/${applicationId}/owner`)
  const toast = useToast()
  const [open,setOpen] = useState(false)
  const [busy,setBusy] = useState(false)
  const [saveError,setSaveError] = useState('')
  const [conflict,setConflict] = useState(false)
  if (error) return <section className="notice notice-danger" role="alert">소유계정 확인 정보를 불러오지 못했습니다. <button type="button" className="btn-ghost btn-sm" onClick={reload}>다시 불러오기</button></section>
  if (!data?.canManage) return null

  async function save(event) {
    event.preventDefault()
    if (busy) return
    const values=new FormData(event.currentTarget)
    const newOwnerEmail=String(values.get('owner') ?? '')
    const reason=String(values.get('reason') ?? '').trim()
    if (!data.candidates.some(candidate=>candidate.email===newOwnerEmail) || reason.length<5 || reason.length>1000 || values.get('confirmed')!=='yes') {
      setSaveError('활성 계정·확인 사유·직접 확인 여부를 모두 입력해주세요.')
      return
    }
    setBusy(true);setSaveError('');setConflict(false)
    try {
      await api.post(`/applications/${applicationId}/owner`,{newOwnerEmail,expectedOwnerEmail:data.application.owner_email ?? null,reason,confirmed:true})
    } catch (failure) {
      setSaveError(failure.message)
      setConflict(failure.status===409)
      setBusy(false)
      return
    }
    toast.success('신청 소유계정과 확인 기록을 저장했습니다.')
    setOpen(false)
    const refreshed=await Promise.allSettled([reload(),onChanged?.()])
    if (refreshed.some(result=>result.status==='rejected')) setSaveError('소유계정은 저장되었습니다. 최신 화면을 다시 불러와주세요.')
    setBusy(false)
  }
  async function refresh() { setOpen(false);setConflict(false);setSaveError('');await reload() }

  return <section className="card stack" aria-label="신청 소유계정 관리">
    <div className="card-head"><h3 className="card-title">신청 소유계정</h3><span className="badge badge-neutral">관리자 확인</span></div>
    <p>{data.owner ? <>{data.owner.label} <span className="card-note">{data.owner.email} · {data.owner.active ? '활성' : data.owner.registered ? '비활성' : '등록되지 않은 계정'}</span></> : <strong>소유계정 미확인</strong>}</p>
    <p className="card-note">신청자 이름이나 부서로 계정을 추정하지 않습니다. 확인한 계정에 이 신청서의 접근 권한을 지정하고, 기존 작성자·접수번호·업무 기록은 유지합니다.</p>
    {!data.departmentValid ? <p className="notice notice-warning">등록되지 않은 신청 부서입니다. 먼저 관리자가 부서 기록을 확인해야 합니다.</p>
      : !data.candidates.length ? <p className="notice notice-warning">{data.application.dept}에 배정된 다른 활성 계정이 없습니다. 계정 관리에서 담당 부서를 먼저 확인해주세요.</p>
      : open ? <form className="stack" onSubmit={save}>
        <label>확인한 소유계정<select name="owner" required defaultValue="" disabled={busy}><option value="">활성 계정을 직접 선택해주세요</option>{data.candidates.map(candidate=><option key={candidate.email} value={candidate.email}>{candidate.label} · {candidate.email}</option>)}</select></label>
        <label>확인 근거와 이관 사유<textarea name="reason" required minLength={5} maxLength={1000} rows={3} disabled={busy} /></label>
        <label><input type="checkbox" name="confirmed" value="yes" required disabled={busy} /> 대상 계정과 이 신청서의 관계를 직접 확인했습니다.</label>
        <p className="card-note">현재 소유계정이 다른 관리자의 작업으로 바뀌면 저장하지 않습니다. 기존 부서·참여 권한은 이 작업으로 변경되지 않습니다.</p>
        <div className="row"><button className="btn-primary btn-sm" type="submit" disabled={busy || loading}>{busy ? '저장 중…' : '확인한 계정으로 지정'}</button><button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={()=>{setOpen(false);setSaveError('');setConflict(false)}}>취소</button></div>
      </form> : <button className="btn-ghost btn-sm" type="button" disabled={busy || loading} onClick={()=>setOpen(true)}>{data.owner ? '소유계정 이관' : '소유계정 확인'}</button>}
    {saveError && <p className="notice notice-danger" role="alert">{saveError} {conflict && <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={refresh}>최신 소유계정 다시 확인</button>}</p>}
    {data.history?.length>0 && <details><summary>소유계정 확인 기록 {data.history.length}건</summary><ul>{data.history.map(row=><li key={row.id}><p>{row.previousOwnerEmail ?? '미확인'} → {row.newOwnerEmail}</p><p>{row.reason}</p><p className="card-note">{row.by} · {row.at}</p></li>)}</ul></details>}
  </section>
}
