// @vitest-environment happy-dom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import ResultPage from '../src/pages/ResultPage.jsx'
import TrackPage from '../src/pages/TrackPage.jsx'
import { computeOutcome } from '../shared/outcome.js'

const client=vi.hoisted(()=>({get:vi.fn(),post:vi.fn()}))
const toast=vi.hoisted(()=>({success:vi.fn(),error:vi.fn()}))
vi.mock('../src/api/client.ts',()=>({api:client}))
vi.mock('../src/context/ToastContext.jsx',()=>({useToast:()=>toast}))
const baseline={median_seconds:600,min_seconds:600,max_seconds:600,sample_n:5,people:1,hourly_wage_krw:3600}
const application={id:'a',ticket_no:'AX-111-111',title:'검증 업무',dept:'재무',status:'완료'}
const runs=Array.from({length:4},()=>({ok:1,duration_ms:1000,human_review_seconds:30}))
const result=token=>({application,baseline,uses:runs,outcome:computeOutcome({baseline,runs}),annual:null,label:{label:'보수적 추정',tone:'warn'},challenges:[],unresolvedCount:0,saved:{dev_hours:0,ops_cost_krw:0},expectedEvidence:token,confirmation:{current:false,previous:{by:'이전 확인자'}}})
let currentResult,trackState
beforeEach(()=>{
  client.get.mockReset();client.post.mockReset();toast.success.mockReset();toast.error.mockReset()
  currentResult=result('evidence-v1')
  trackState={canConfirm:true,status:'다시 확인 필요',expectedEvidence:'evidence-v1',measuredMinutes:10,people:1,sampleN:5,runs:4,successCount:4,failedCount:0,netKrw:2276,previous:{by:'이전 담당'}}
  client.get.mockImplementation(async path=>{
    if(path==='/applications') return {items:[application,{...application,id:'b',title:'다른 업무'}]}
    if(path.startsWith('/applications/')) return currentResult
    if(path==='/track/AX-111-111') return {ticket:'AX-111-111',application,timeline:[],decisions:[],currentStage:'성과'}
    if(path.endsWith('/outcome')) return {state:trackState}
    return {state:{},criteria:[],requiredDepts:[]}
  })
})
afterEach(()=>{cleanup();vi.restoreAllMocks()})
async function showResult(){render(<MemoryRouter initialEntries={['/result']}><ResultPage/></MemoryRouter>);await screen.findByRole('button',{name:'저장하고 다시 계산'});await waitFor(()=>expect(screen.getByRole('button',{name:'저장하고 다시 계산'}).disabled).toBe(false))}
async function showTrack(){render(<MemoryRouter initialEntries={['/track?no=AX-111-111']}><TrackPage/></MemoryRouter>);await screen.findByRole('button',{name:'이대로 확인합니다'})}
const conflict=()=>Object.assign(Error('계산 근거가 변경되었습니다.'),{status:409})

describe('성과 근거 확인 UI',()=>{
  it('충돌 뒤 초안을 유지하고 명시적 최신 수치 조회 후 새 근거로 저장한다',async()=>{
    await showResult()
    fireEvent.change(screen.getByLabelText(/운영비/),{target:{value:'2000'}})
    client.post.mockRejectedValueOnce(conflict()).mockResolvedValue({ok:true})
    fireEvent.click(screen.getByRole('button',{name:'저장하고 다시 계산'}))
    await screen.findByRole('button',{name:'최신 수치 확인'})
    expect(screen.getByLabelText(/운영비/).value).toBe('2000')
    expect(screen.getByRole('button',{name:'저장하고 다시 계산'}).disabled).toBe(true)
    currentResult={...result('evidence-v2'),saved:{dev_hours:8,ops_cost_krw:100}}
    fireEvent.click(screen.getByRole('button',{name:'최신 수치 확인'}))
    await waitFor(()=>expect(screen.getByRole('button',{name:'저장하고 다시 계산'}).disabled).toBe(false))
    expect(screen.getByLabelText(/운영비/).value).toBe('2000')
    fireEvent.click(screen.getByRole('button',{name:'저장하고 다시 계산'}))
    await waitFor(()=>expect(client.post).toHaveBeenCalledTimes(2))
    expect(client.post.mock.calls[1][1]).toMatchObject({ops_cost_krw:'2000',expectedEvidence:'evidence-v2'})
  })
  it('통신 오류 재시도는 처음 본 근거와 같은 내용으로 보낸다',async()=>{
    await showResult()
    client.post.mockRejectedValueOnce(Object.assign(Error('응답 유실'),{status:503})).mockResolvedValue({ok:true})
    const button=screen.getByRole('button',{name:'저장하고 다시 계산'})
    fireEvent.click(button)
    await screen.findByText('응답 유실')
    fireEvent.click(button)
    await waitFor(()=>expect(client.post).toHaveBeenCalledTimes(2))
    expect(client.post.mock.calls[0]).toEqual(client.post.mock.calls[1])
  })
  it('다른 신청으로 이동한 뒤 늦은 저장 성공은 새 화면에 알리지 않는다',async()=>{
    let resolve
    client.post.mockReturnValue(new Promise(done=>{resolve=done}))
    await showResult()
    fireEvent.click(screen.getByRole('button',{name:'저장하고 다시 계산'}))
    fireEvent.click(screen.getByRole('button',{name:'재무 · 다른 업무'}))
    await act(async()=>{resolve({ok:true})})
    expect(toast.success).not.toHaveBeenCalled()
  })
  it('부서 확인은 현재 금액과 실행을 보여주고 충돌 뒤 의견을 보존한다',async()=>{
    await showTrack()
    expect(screen.getByText(/현재 순금액/).textContent).toContain('2,276')
    fireEvent.click(screen.getByRole('radio',{name:'대충 맞습니다'}))
    fireEvent.change(screen.getByLabelText('확인하신 분'),{target:{value:'현장 담당'}})
    fireEvent.change(screen.getByLabelText(/덧붙이실 말씀/),{target:{value:'현장 의견'}})
    client.post.mockRejectedValueOnce(conflict()).mockResolvedValue({ok:true,message:'확인 기록'})
    fireEvent.click(screen.getByRole('button',{name:'이대로 확인합니다'}))
    await screen.findByRole('button',{name:'최신 수치 확인'})
    expect(screen.getByText('계산 근거가 변경되었습니다.')).not.toBeNull()
    trackState={...trackState,expectedEvidence:'evidence-v2',netKrw:1000}
    fireEvent.click(screen.getByRole('button',{name:'최신 수치 확인'}))
    await waitFor(()=>expect(screen.getByRole('button',{name:'이대로 확인합니다'}).disabled).toBe(false))
    expect(screen.queryByText('계산 근거가 변경되었습니다.')).toBeNull()
    expect(screen.getByLabelText(/덧붙이실 말씀/).value).toBe('현장 의견')
    fireEvent.click(screen.getByRole('button',{name:'이대로 확인합니다'}))
    await waitFor(()=>expect(client.post).toHaveBeenCalledTimes(2))
    expect(client.post.mock.calls[1][1]).toMatchObject({expectedEvidence:'evidence-v2',comment:'현장 의견'})
  })
  it('체감 시간이 빈칸이면 쓰기를 보내지 않고 명시적인 0은 허용한다',async()=>{
    await showTrack()
    fireEvent.click(screen.getByRole('radio',{name:'그것보다 적게/많이 걸립니다'}))
    fireEvent.change(screen.getByLabelText('확인하신 분'),{target:{value:'현장 담당'}})
    fireEvent.click(screen.getByRole('button',{name:'이대로 확인합니다'}))
    expect(client.post).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText(/^실제로는 한 번에 몇 분쯤 걸리십니까/),{target:{value:'0'}})
    client.post.mockResolvedValue({ok:true,message:'의견 기록'})
    fireEvent.click(screen.getByRole('button',{name:'이대로 확인합니다'}))
    await waitFor(()=>expect(client.post).toHaveBeenCalledOnce())
    expect(client.post.mock.calls[0][1]).toMatchObject({felt:0,expectedEvidence:'evidence-v1'})
  })
})
