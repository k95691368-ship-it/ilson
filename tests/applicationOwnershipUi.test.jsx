// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import ApplicationOwnership from '../src/components/ApplicationOwnership.jsx'

const state=vi.hoisted(()=>({data:null,error:null,post:vi.fn(),reload:vi.fn(),success:vi.fn()}))
vi.mock('../src/hooks/useApi.js',()=>({useApi:()=>({data:state.data,error:state.error,loading:false,reload:state.reload})}))
vi.mock('../src/api/client.js',()=>({api:{post:state.post}}))
vi.mock('../src/context/ToastContext.jsx',()=>({useToast:()=>({success:state.success})}))
beforeEach(()=>{
  vi.clearAllMocks();state.error=null
  state.data={canManage:true,application:{id:'legacy',dept:'재무',owner_email:null},departmentValid:true,owner:null,candidates:[{email:'next@local.invalid',label:'후임 담당자',role:'reviewer'}],history:[]}
  state.post.mockResolvedValue({ok:true});state.reload.mockResolvedValue(undefined)
})
afterEach(cleanup)
function fill(){
  fireEvent.change(screen.getByLabelText('확인한 소유계정'),{target:{value:'next@local.invalid'}})
  fireEvent.change(screen.getByLabelText('확인 근거와 이관 사유'),{target:{value:'본인과 부서에 해당 신청의 관계를 확인했습니다.'}})
  fireEvent.click(screen.getByRole('checkbox'))
}

describe('explicit application ownership confirmation UI',()=>{
  it('requires an account, reason and explicit confirmation and sends the nullable CAS value',async()=>{
    const changed=vi.fn().mockResolvedValue(undefined)
    render(<ApplicationOwnership applicationId="legacy" onChanged={changed} />)
    expect(screen.getByText('소유계정 미확인')).toBeTruthy()
    fireEvent.click(screen.getByRole('button',{name:'소유계정 확인'}))
    const form=screen.getByRole('button',{name:'확인한 계정으로 지정'}).closest('form')
    fireEvent.submit(form)
    expect(state.post).not.toHaveBeenCalled()
    fill();fireEvent.submit(form)
    await waitFor(()=>expect(state.post).toHaveBeenCalledWith('/applications/legacy/owner',{newOwnerEmail:'next@local.invalid',expectedOwnerEmail:null,reason:'본인과 부서에 해당 신청의 관계를 확인했습니다.',confirmed:true}))
    await waitFor(()=>expect(changed).toHaveBeenCalledOnce())
    expect(state.success).toHaveBeenCalledOnce()
  })
  it('shows an inactive previous owner and keeps stale-CAS errors and entered evidence visible',async()=>{
    state.data.application.owner_email='old@local.invalid';state.data.owner={email:'old@local.invalid',label:'이전 담당자',active:false,registered:true}
    state.post.mockRejectedValue({status:409,message:'소유계정이 변경되었습니다. 최신 정보를 확인해주세요.'})
    render(<ApplicationOwnership applicationId="legacy" />)
    expect(screen.getByText(/old@local.invalid · 비활성/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button',{name:'소유계정 이관'}));fill()
    fireEvent.submit(screen.getByRole('button',{name:'확인한 계정으로 지정'}).closest('form'))
    await screen.findByText(/소유계정이 변경되었습니다/)
    expect(state.post).toHaveBeenCalledWith('/applications/legacy/owner',expect.objectContaining({expectedOwnerEmail:'old@local.invalid'}))
    expect(screen.getByLabelText('확인 근거와 이관 사유').value).toContain('본인과 부서')
    expect(state.success).not.toHaveBeenCalled();expect(state.reload).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button',{name:'최신 소유계정 다시 확인'}))
    await waitFor(()=>expect(state.reload).toHaveBeenCalledOnce())
  })
  it('does not expose an owner action to non-admin or demo viewers',()=>{
    state.data={canManage:false}
    const view=render(<ApplicationOwnership applicationId="legacy" />)
    expect(view.container.textContent).toBe('')
  })
  it('does not fabricate candidates for an unregistered department or an empty active directory',()=>{
    state.data.candidates=[]
    const view=render(<ApplicationOwnership applicationId="legacy" />)
    expect(screen.getByText(/배정된 다른 활성 계정이 없습니다/)).toBeTruthy()
    expect(screen.queryByRole('button',{name:'소유계정 확인'})).toBeNull()
    state.data={...state.data,departmentValid:false}
    view.rerender(<ApplicationOwnership applicationId="legacy" />)
    expect(screen.getByText(/등록되지 않은 신청 부서/)).toBeTruthy()
  })
})
