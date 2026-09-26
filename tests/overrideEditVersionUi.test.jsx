// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import OverridePage from '../src/pages/OverridePage.jsx'

const mock = vi.hoisted(() => ({get:vi.fn(),post:vi.fn(),reload:vi.fn(),success:vi.fn(),error:vi.fn(),data:null}))
vi.mock('../src/api/client.js',()=>({api:{get:mock.get,post:mock.post}}))
vi.mock('../src/hooks/useApi.js',()=>({useApi:()=>({data:mock.data,loading:false,error:null,reload:mock.reload})}))
vi.mock('../src/hooks/useOverrideEvents.js',()=>({useOverrideEvents:()=>({events:[],loading:false,error:null,page:{total:0},reload:vi.fn(),next:vi.fn(),previous:vi.fn()})}))
vi.mock('../src/context/ToastContext.jsx',()=>({useToast:()=>({success:mock.success,error:mock.error})}))
const versionA='a'.repeat(64), versionB='b'.repeat(64)
const conflict=()=>Object.assign(new Error('열어 둔 자료가 변경되었습니다.'),{status:409,code:'OVERRIDE_EDIT_CONFLICT'})
beforeEach(()=>{
  vi.clearAllMocks(); localStorage.clear(); window.scrollTo=vi.fn()
  mock.data={demo_mode:false,current_actor:{role:'product',email:'manager@local.invalid',is_admin:false},products:[],events:[],
    clusters:[{id:'c',title:'원래 문제',summary:'원래 설명',cause_code:'model',cause_status:'candidate',status:'open',owner_team:'운영',recurrence_count:1,priority_score:10,cause_candidates:[],edit_version:versionA}],
    experiments:[],volumes:[],actors:[],integrations:[],audit:[],ai_calls:[],assignment_candidates:[]}
  mock.post.mockResolvedValue({ok:true}); mock.reload.mockResolvedValue(undefined)
})
afterEach(cleanup)
function show(view='clusters') { render(<MemoryRouter initialEntries={['/override#'+view]}><OverridePage /></MemoryRouter>) }
function fill(dialog,name,value) { fireEvent.change(dialog.querySelector(`[name="${name}"]`),{target:{value}}) }
function openCluster() {
  show();fireEvent.click(screen.getByRole('button',{name:'원인·담당 확정'}))
  const dialog=screen.getByRole('dialog');fill(dialog,'summary','유지할 초안');fill(dialog,'reason','현장 근거');return dialog
}
const save=dialog=>fireEvent.submit(dialog.querySelector('form'))
const acknowledge=dialog=>fireEvent.click(within(dialog).getByRole('button',{name:'최신 내용을 확인했습니다. 초안으로 다시 저장 준비'}))

it('submits the displayed snapshot and blocks stale retries while preserving the draft',async()=>{
  mock.post.mockRejectedValueOnce(conflict())
  const dialog=openCluster();save(dialog)
  await waitFor(()=>expect(mock.post).toHaveBeenCalledWith('/override',expect.objectContaining({action:'update_cluster',expectedVersion:versionA,summary:'유지할 초안'})))
  await within(dialog).findByRole('alert')
  expect(within(dialog).getByRole('button',{name:'원인과 담당 확정'}).disabled).toBe(true)
  expect(dialog.querySelector('[name="summary"]').value).toBe('유지할 초안')
  save(dialog);expect(mock.post).toHaveBeenCalledTimes(1)
  expect(within(dialog).queryByRole('button',{name:/최신 내용을 확인했습니다/})).toBeNull()
})

it('loads and compares the latest state, then requires explicit confirmation before retry',async()=>{
  mock.post.mockRejectedValueOnce(conflict())
  mock.get.mockResolvedValue({entity:{...mock.data.clusters[0],title:'최신 다른 담당자의 문제',status:'resolved',summary:'다른 담당자의 최신 설명',edit_version:versionB}})
  const dialog=openCluster();save(dialog);await within(dialog).findByRole('alert')
  fireEvent.click(within(dialog).getByRole('button',{name:'최신 저장 내용 조회'}))
  expect(await within(dialog).findByText('다른 담당자의 최신 설명')).toBeTruthy()
  expect(mock.get).toHaveBeenCalledWith('/override?editKind=cluster&editId=c')
  save(dialog);expect(mock.post).toHaveBeenCalledTimes(1)
  expect(dialog.querySelector('[name="summary"]').value).toBe('유지할 초안')
  acknowledge(dialog)
  expect(within(dialog).getByRole('button',{name:'원인과 담당 확정'}).disabled).toBe(false)
  save(dialog)
  await waitFor(()=>expect(mock.post).toHaveBeenLastCalledWith('/override',expect.objectContaining({expectedVersion:versionB,summary:'유지할 초안',reason:'현장 근거'})))
  await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull())
})

it('keeps the draft and save lock when reload fails or access is refused',async()=>{
  mock.post.mockRejectedValueOnce(conflict());mock.get.mockRejectedValueOnce(Object.assign(new Error('다시 조회할 권한이 없습니다.'),{status:403}))
  const dialog=openCluster();save(dialog);await within(dialog).findByRole('alert')
  fireEvent.click(within(dialog).getByRole('button',{name:'최신 저장 내용 조회'}))
  expect(await within(dialog).findByText('다시 조회할 권한이 없습니다.')).toBeTruthy()
  expect(within(dialog).queryByRole('button',{name:/최신 내용을 확인했습니다/})).toBeNull()
  expect(within(dialog).getByRole('button',{name:'원인과 담당 확정'}).disabled).toBe(true)
  expect(dialog.querySelector('[name="summary"]').value).toBe('유지할 초안')
  save(dialog);expect(mock.post).toHaveBeenCalledTimes(1)
})

it('does not automatically refresh a viewed token after an unrelated workspace update',async()=>{
  const dialog=openCluster()
  mock.data.clusters=[{...mock.data.clusters[0],edit_version:versionB}]
  fill(dialog,'reason','새 초안 근거');save(dialog)
  await waitFor(()=>expect(mock.post).toHaveBeenCalledWith('/override',expect.objectContaining({expectedVersion:versionA})))
})

it('requires a new comparison if another edit occurs after explicit confirmation',async()=>{
  mock.post.mockRejectedValueOnce(conflict()).mockRejectedValueOnce(conflict())
  mock.get.mockResolvedValue({entity:{...mock.data.clusters[0],edit_version:versionB}})
  const dialog=openCluster();save(dialog);await within(dialog).findByRole('alert')
  fireEvent.click(within(dialog).getByRole('button',{name:'최신 저장 내용 조회'}))
  await within(dialog).findByRole('button',{name:/최신 내용을 확인했습니다/});acknowledge(dialog);save(dialog)
  await within(dialog).findByRole('alert')
  expect(mock.post).toHaveBeenCalledTimes(2)
  expect(within(dialog).queryByRole('button',{name:/최신 내용을 확인했습니다/})).toBeNull()
  save(dialog);expect(mock.post).toHaveBeenCalledTimes(2)
})

it('uses an account snapshot when changing access and exposes the current revoked state for comparison',async()=>{
  mock.data.current_actor={role:'audit',email:'admin@local.invalid',is_admin:true}
  mock.data.actors=[{email:'worker@local.invalid',display_name:'직원',role:'product',active:true,departments:[],product_ids:[],edit_version:versionA}]
  mock.post.mockRejectedValueOnce(conflict())
  mock.get.mockResolvedValue({entity:{...mock.data.actors[0],active:false,edit_version:versionB}})
  show('audit');fireEvent.click(screen.getByRole('button',{name:'직원 접근 권한 변경'}))
  const dialog=screen.getByRole('dialog');save(dialog)
  await waitFor(()=>expect(mock.post).toHaveBeenCalledWith('/override',expect.objectContaining({action:'save_actor',expectedVersion:versionA})))
  await within(dialog).findByRole('alert');fireEvent.click(within(dialog).getByRole('button',{name:'최신 저장 내용 조회'}))
  expect(await within(dialog).findByText('비활성')).toBeTruthy()
  expect(dialog.querySelector('[name="displayName"]').value).toBe('직원')
})

it('includes the original approval cycle token on experiment decisions',async()=>{
  mock.data.experiments=[{id:'e',cluster_id:'c',title:'실험',status:'expanded',guardrails:[],stop_conditions:[],runs:[],decisions:[],edit_version:versionA}]
  show('experiments');fireEvent.click(screen.getByRole('button',{name:'롤백 결정 기록'}))
  const dialog=screen.getByRole('dialog');fill(dialog,'basis','현장에 다시 발생');save(dialog)
  await waitFor(()=>expect(mock.post).toHaveBeenCalledWith('/override',expect.objectContaining({action:'decide_experiment',expectedVersion:versionA,decision:'rollback'})))
})

it('does not silently borrow an existing account token from a blank registration form',async()=>{
  mock.data.current_actor={role:'audit',email:'admin@local.invalid',is_admin:true}
  mock.data.actors=[{email:'worker@local.invalid',display_name:'직원',role:'product',active:true,departments:[],product_ids:[],edit_version:versionA}]
  show('audit');fireEvent.click(screen.getByRole('button',{name:'접근 역할 등록'}))
  const dialog=screen.getByRole('dialog');fill(dialog,'email','worker@local.invalid');fill(dialog,'displayName','다른 등록');save(dialog)
  await waitFor(()=>expect(mock.post).toHaveBeenCalled())
  expect(mock.post.mock.calls[0][1]).not.toHaveProperty('expectedVersion')
})

it('shows changed experiment measurements, not only the approval metadata, before confirmation',async()=>{
  mock.data.experiments=[{id:'e',cluster_id:'c',title:'실험',status:'expanded',guardrails:[],stop_conditions:[],runs:[],decisions:[],edit_version:versionA}]
  mock.post.mockRejectedValueOnce(conflict())
  mock.get.mockResolvedValue({entity:{...mock.data.experiments[0],edit_version:versionB,approval_id:'current',runs:[{id:'r',approval_id:'current',phase:'limited',status:'blocked',control_value:10,variant_value:9,sample_size:20,guardrail_breaches:1,evidence_refs_json:'["새 원본 근거"]'}]}})
  show('experiments');fireEvent.click(screen.getByRole('button',{name:'롤백 결정 기록'}))
  const dialog=screen.getByRole('dialog');fill(dialog,'basis','현장 재확인');save(dialog)
  await within(dialog).findByRole('alert');fireEvent.click(within(dialog).getByRole('button',{name:'최신 저장 내용 조회'}))
  expect(await within(dialog).findByText('새 원본 근거')).toBeTruthy()
  expect(within(dialog).getByText(/대조군 10 → 변경군 9 · 표본 20 · 위반 1/)).toBeTruthy()
  expect(within(dialog).getByRole('button',{name:'결정 기록'}).disabled).toBe(true)
})
