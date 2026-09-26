// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import HandoverPanel from '../src/components/HandoverPanel.tsx'

const client=vi.hoisted(()=>({get:vi.fn(),post:vi.fn()}))
vi.mock('../src/api/client.ts',()=>({api:client}))
const state=()=>({application:{id:'a',title:'정산',dept:'재무'},expectedEvidence:'a'.repeat(64),blockers:[],humanCriteria:[],handover:null,manual:null,scope:'고정 기간·환율의 기존 정산 도구입니다.'})
let latest
beforeEach(()=>{vi.clearAllMocks();latest=state();client.get.mockImplementation(async()=>latest);client.post.mockResolvedValue({ok:true})})
afterEach(cleanup)
const show=(id='a')=>render(<MemoryRouter><HandoverPanel key={id} id={id}/></MemoryRouter>)
async function open() {fireEvent.click(screen.getByText('현장 정산 도구 인계'));await screen.findByLabelText('도구 이름')}
function fill(){for(const [name,value] of [['재무 받는 담당자','담당자'],['실행 시점','시연 파일 확인 시'],['결과 확인 방법','원본과 결과 대조'],['문의 담당자','AX 담당자'],['인계 판단 근거','기준과 사용법을 확인했습니다.']])fireEvent.change(screen.getByLabelText(name),{target:{value}});fireEvent.click(screen.getByLabelText('지원 기간·상품·고정 환율의 제한을 확인했습니다.'))}
it('loads no release evidence while collapsed and shows the existing-screen form on demand',async()=>{
  show();expect(client.get).not.toHaveBeenCalled();await open();expect(client.get).toHaveBeenCalledTimes(1)
  expect(screen.getByText(latest.scope)).toBeTruthy()
})
it('keeps draft values on stale 409 and requires explicitly refreshing evidence before retry',async()=>{
  client.post.mockRejectedValueOnce(Object.assign(Error('근거가 바뀌었습니다.'),{status:409,code:'HANDOVER_CONFLICT'}))
  show();await open();fill();fireEvent.click(screen.getByRole('button',{name:'정산 도구 인계'}))
  await screen.findByText('근거가 바뀌었습니다.')
  expect(screen.getByLabelText('인계 판단 근거').value).toBe('기준과 사용법을 확인했습니다.')
  expect(screen.getByRole('button',{name:'정산 도구 인계'}).disabled).toBe(true)
  latest={...latest,expectedEvidence:'b'.repeat(64)}
  fireEvent.click(screen.getByRole('button',{name:'최신 근거 확인'}))
  await waitFor(()=>expect(screen.getByRole('button',{name:'정산 도구 인계'}).disabled).toBe(false))
  expect(screen.getByLabelText('지원 기간·상품·고정 환율의 제한을 확인했습니다.').checked).toBe(false)
  fireEvent.click(screen.getByLabelText('지원 기간·상품·고정 환율의 제한을 확인했습니다.'))
  fireEvent.click(screen.getByRole('button',{name:'정산 도구 인계'}))
  await waitFor(()=>expect(client.post).toHaveBeenCalledTimes(2))
  expect(client.post.mock.calls[1][1]).toMatchObject({expectedEvidence:'b'.repeat(64),reason:'기준과 사용법을 확인했습니다.'})
})
it('retries the identical request after a lost response without permitting changed instructions',async()=>{
  client.post.mockRejectedValueOnce(Object.assign(Error('응답 유실'),{status:0}))
  show();await open();fill();fireEvent.click(screen.getByRole('button',{name:'정산 도구 인계'}))
  const retry=await screen.findByRole('button',{name:'같은 인계 기록 다시 저장'})
  expect(screen.getByLabelText('도구 이름').disabled).toBe(true)
  const first=client.post.mock.calls[0]
  fireEvent.click(retry);await waitFor(()=>expect(client.post).toHaveBeenCalledTimes(2))
  expect(client.post.mock.calls[1]).toEqual(first)
})
it('does not claim success or refresh a different application after leaving the old form',async()=>{
  let resolve;client.post.mockImplementationOnce(()=>new Promise(r=>{resolve=r}))
  const view=show();await open();fill();fireEvent.click(screen.getByRole('button',{name:'정산 도구 인계'}));await waitFor(()=>expect(client.post).toHaveBeenCalledTimes(1))
  view.rerender(<MemoryRouter><HandoverPanel key="b" id="b"/></MemoryRouter>)
  await act(async()=>resolve({ok:true}))
  expect(screen.queryByText(/도구와 사용법을 인계했습니다/)).toBeNull()
  expect(client.get).toHaveBeenCalledTimes(1)
})
it('blocks known gate failures and requires explicit evidence for every human criterion',async()=>{
  latest={...latest,humanCriteria:[{id:'human',body:'업무 담당자가 사용할 수 있음'}]}
  show();await open();fill();fireEvent.click(screen.getByRole('button',{name:'정산 도구 인계'}))
  expect(client.post).not.toHaveBeenCalled();expect((await screen.findAllByRole('alert')).length).toBeGreaterThan(0)
  fireEvent.click(screen.getByLabelText('직접 확인했습니다'))
  fireEvent.change(screen.getByLabelText('확인 근거'),{target:{value:'담당자가 직접 실행해 사용성을 확인했습니다.'}})
  fireEvent.click(screen.getByRole('button',{name:'정산 도구 인계'}));await waitFor(()=>expect(client.post).toHaveBeenCalledTimes(1))
  expect(client.post.mock.calls[0][1].humanChecks.human.confirmed).toBe(true)
})
it('associates text, number and checkbox validation errors with their own controls',async()=>{
  latest={...latest,humanCriteria:[{id:'human',body:'사용성 확인'}]}
  show();await open()
  fireEvent.change(screen.getByLabelText('하루 성공 실행 제한'),{target:{value:'0'}})
  fireEvent.change(screen.getByLabelText('파일 제한(MB)'),{target:{value:'11'}})
  fireEvent.click(screen.getByRole('button',{name:'정산 도구 인계'}))
  for(const label of ['재무 받는 담당자','하루 성공 실행 제한','파일 제한(MB)','직접 확인했습니다','확인 근거','지원 기간·상품·고정 환율의 제한을 확인했습니다.','인계 판단 근거']) {
    const control=screen.getByLabelText(label)
    expect(control.getAttribute('aria-invalid')).toBe('true')
    const alert=document.getElementById(control.getAttribute('aria-describedby'))
    expect(alert?.getAttribute('role')).toBe('alert')
    expect(alert?.textContent.length).toBeGreaterThan(0)
  }
  expect(client.post).not.toHaveBeenCalled()
})
it('clears one-time approval only after a confirmed success, even if the following state read fails',async()=>{
  latest={...latest,humanCriteria:[{id:'human',body:'사용성 확인'}]}
  show();await open();fill()
  fireEvent.click(screen.getByLabelText('직접 확인했습니다'))
  fireEvent.change(screen.getByLabelText('확인 근거'),{target:{value:'담당자가 직접 실행했습니다.'}})
  client.get.mockRejectedValueOnce(Error('조회 실패'))
  fireEvent.click(screen.getByRole('button',{name:'정산 도구 인계'}))
  await screen.findByText('조회 실패')
  expect(screen.getByLabelText('인계 판단 근거').value).toBe('')
  expect(screen.getByLabelText('지원 기간·상품·고정 환율의 제한을 확인했습니다.').checked).toBe(false)
  expect(screen.getByLabelText('직접 확인했습니다').checked).toBe(false)
  expect(screen.getByLabelText('확인 근거').value).toBe('담당자가 직접 실행했습니다.')
  expect(screen.queryByRole('button',{name:'같은 인계 기록 다시 저장'})).toBeNull()
  expect(client.post).toHaveBeenCalledTimes(1)
})
