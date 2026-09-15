// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import FieldFeedbackView from '../src/components/FieldFeedbackView.jsx'
const state=vi.hoisted(()=>({data:null,error:null,reload:vi.fn(),post:vi.fn()}))
vi.mock('../src/hooks/useApi.js',()=>({useApi:()=>({...state,loading:false})}))
vi.mock('../src/api/client.js',()=>({api:{post:state.post}}))
const fixture=()=>({cases:[],unread:0,manager:false,reviewer:false,batches:[],samples:[],nonuse:[],nonuseSummary:[]})
const show=(mode='feedback')=>render(<FieldFeedbackView mode={mode} role="reviewer" products={[{id:'p1',name:'테스트 AI'}]} onCapture={vi.fn()} />)
beforeEach(()=>{state.data=fixture();state.error=null;state.post.mockReset();state.reload.mockReset()})
afterEach(cleanup)
it('shows an explicit first-record empty state and masks private field contents',()=>{
  const {container}=show()
  expect(screen.getByRole('button',{name:'판단 기록하기'})).toBeTruthy()
  expect(container.querySelector('[data-clarity-mask="true"]')).toBeTruthy()
})
it('does not render manager or sample-review controls for a regular reporter',()=>{
  show('quality')
  expect(screen.queryByRole('button',{name:'표본 추출'})).toBeNull()
  expect(screen.getByRole('button',{name:'사용 의견 남기기'})).toBeTruthy()
  expect(screen.queryByText('자발적 응답 현황')).toBeNull()
})
it('allows only an owner to confirm an applied update, not another managed case',()=>{
  state.data={...fixture(),manager:true,cases:[{id:'c',product_name:'테스트 AI',event_id:'e',reason_detail:'현장 피드백',is_mine:false,updates:[{id:'u',kind:'applied',body:'적용했습니다.'}]}]}
  show()
  expect(screen.queryByRole('button',{name:'재확인 남기기'})).toBeNull()
  expect(screen.getByText('담당자 안내 작성')).toBeTruthy()
})
it('preserves the entered non-use reason on a failed request and shows the error',async()=>{
  state.post.mockRejectedValue(new Error('저장 실패 테스트'))
  show('quality')
  fireEvent.change(screen.getByRole('combobox',{name:'AI 제품'}),{target:{value:'p1'}})
  const note=screen.getByRole('textbox',{name:'설명 · 기타 선택 시 필수'})
  fireEvent.change(note,{target:{value:'다시 입력하지 않아도 됩니다.'}})
  fireEvent.submit(screen.getByRole('button',{name:'사용 의견 남기기'}).closest('form'))
  await waitFor(()=>expect(screen.getByRole('alert').textContent).toBe('저장 실패 테스트'))
  expect(note.value).toBe('다시 입력하지 않아도 됩니다.')
  expect(state.post).toHaveBeenCalledWith('/feedback',expect.objectContaining({action:'record_nonuse',productId:'p1',role:'reviewer'}))
})
it('renders sample eligibility and actual/requested counts rather than a population error rate',()=>{
  state.data={...fixture(),reviewer:true,batches:[{id:'b',product_name:'테스트 AI',eligible_count:3,sample_size:2,requested_size:5}],samples:[{id:'s',batch_id:'b',event_id:'e',snapshot:{ai_decision:'답변',human_decision:'승인'},verdict:'issue',reason:'오류 근거'}]}
  show('quality')
  expect(screen.getByText('3건')).toBeTruthy()
  expect(screen.getByText('2 / 5건')).toBeTruthy()
  expect(screen.getByText('문제 발견')).toBeTruthy()
  expect(screen.queryByRole('button',{name:'점검 확정'})).toBeNull()
})
