import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { api } from '../api/client.js'
import { useApi } from '../hooks/useApi.js'
import { useOverrideEvents } from '../hooks/useOverrideEvents.js'
import { useToast } from '../context/ToastContext.jsx'
import FieldFeedbackView from '../components/FieldFeedbackView.jsx'
import OverrideEventPager from '../components/OverrideEventPager.jsx'
import {
  CAUSES,
  DECISION_ACTIONS,
  EXPERIMENT_PHASES,
  OVERRIDE_ROLES,
  canExpandExperiment,
  causeByKey,
  priorityBand,
  roleCan,
  safeJson,
} from '../../shared/override.js'

const NAV = [
  { key: 'overview', label: '운영판' },
  { key: 'events', label: '판단 사건' },
  { key: 'clusters', label: '반복 문제' },
  { key: 'experiments', label: '개선 실험' },
  { key: 'feedback', label: '내 피드백' },
  { key: 'quality', label: '현장 점검' },
  { key: 'intelligence', label: '조직 인사이트' },
  { key: 'integrations', label: '연동' },
  { key: 'audit', label: '감사 기록' },
]

const MODAL_TITLES = {
  event: '새 판단 기록',
  eventDetail: '판단 사건 원문',
  validate: '사람의 수정 검토',
  cluster: '원인과 책임 조직 확정',
  experiment: '개선 실험 만들기',
  approve: '실험 승인',
  run: '실험 결과 기록',
  decision: '확대·보류·중단 결정',
  volume: '처리량 기록',
  integration: '외부 시스템 연결',
  product: 'AI 제품 등록',
  actor: '접근 역할 등록',
  ai: 'Claude Opus 5 분석 초안',
}

function fmtDate(value, withTime = false) {
  if (!value) return '—'
  const normalized = String(value).includes('T') ? String(value) : `${String(value).replace(' ', 'T')}Z`
  const date = new Date(normalized)
  if (Number.isNaN(date.getTime())) return String(value)
  return new Intl.DateTimeFormat('ko-KR', {
    month: 'short',
    day: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(date)
}

function won(value) {
  if (value == null || value === '') return '—'
  const number = Number(value) || 0
  if (number >= 100000000) return `${Math.round(number / 10000000) / 10}억원`
  if (number >= 10000) return `${Math.round(number / 1000) / 10}만원`
  return `${number.toLocaleString('ko-KR')}원`
}

function valueOrDash(value, suffix = '') {
  return value == null ? '—' : `${value}${suffix}`
}

function actionLabel(key) {
  return DECISION_ACTIONS.find((item) => item.key === key)?.label ?? key
}

function roleLabel(key) {
  return OVERRIDE_ROLES.find((item) => item.key === key)?.label ?? key
}

function runLabel(status) {
  return {
    passed: '입력 기준 충족',
    failed: '미달',
    blocked: '중단 판정',
    insufficient: '근거 부족',
  }[status] ?? status
}

function statusLabel(value) {
  return {
    open: '원인 검토',
    experiment: '실험 설계',
    monitoring: '재발 측정',
    resolved: '해결',
    accepted_exception: '정당한 예외',
    draft: '초안',
    approved: '승인',
    running: '실험 중',
    expanded: '확대',
    held: '보류',
    stopped: '중단',
    rolled_back: '롤백 결정 기록',
    expand: '적용 범위 확대',
    hold: '보류',
    stop: '중단',
    rollback: '롤백 결정',
  }[value] ?? value
}

function toneForPriority(score) {
  const band = priorityBand(score)
  if (band === 'P0') return 'danger'
  if (band === 'P1') return 'warning'
  if (band === 'P2') return 'accent'
  return 'neutral'
}

function formObject(form) {
  return Object.fromEntries(new FormData(form).entries())
}

export default function OverridePage() {
  const { data, error, loading, reload } = useApi('/override')
  const toast = useToast()
  const location = useLocation()
  const navigate = useNavigate()
  const hashView = location.hash.slice(1)
  const view = NAV.some(item => item.key === hashView) ? hashView : 'overview'
  const [demoRole, setRole] = useState(() => localStorage.getItem('override-role') || 'product')
  const role = data?.demo_mode === false ? data.current_actor?.role || 'reviewer' : demoRole
  const [modal, setModal] = useState(null)
  const [mutationProblem, setMutationProblem] = useState(null)
  const [busy, setBusy] = useState(false)
  const [aiDraft, setAiDraft] = useState(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [focusedClusterId, setFocusedClusterId] = useState(null)
  const menuToggleRef = useRef(null)

  function closeMenu() {
    setMenuOpen(false)
    menuToggleRef.current?.focus()
  }

  function navigateView(next) {
    if (menuOpen) closeMenu()
    if (location.hash !== `#${next}`) navigate({ pathname: location.pathname, search: location.search, hash: `#${next}` }, { state: location.state })
    window.scrollTo({ top: 0, behavior: 'instant' })
  }

  useEffect(() => {
    localStorage.setItem('override-role', demoRole)
  }, [demoRole])

  async function mutate(action, payload = {}, success = '저장했습니다.') {
    setBusy(true)
    setMutationProblem(null)
    try {
      const result = await api.post('/override', {
        ...payload,
        action,
        role,
        actorLabel: `${roleLabel(role)} 시연`,
      })
      toast.success(success)
      setModal(null)
      await reload()
      return result
    } catch (mutationError) {
      const fields = [...new Set(Object.values(mutationError.fields ?? {}).filter(value => typeof value === 'string' && value.trim()))]
      setMutationProblem({ message: mutationError.message, fields })
      toast.error(fields.length ? fields.join(' ') : mutationError.message)
      return null
    } finally {
      setBusy(false)
    }
  }

  async function askAi(kind, context, entityKind, entityId) {
    setBusy(true)
    setMutationProblem(null)
    setAiDraft(null)
    setModal({ type: 'ai' })
    try {
      const result = await api.post('/override/assist', {
        kind,
        context,
        entityKind,
        entityId,
        role,
        actorLabel: `${roleLabel(role)} 시연`,
      })
      setAiDraft(result)
      await reload()
    } catch (assistError) {
      setAiDraft({ error: assistError.message })
    } finally {
      setBusy(false)
    }
  }

  function open(type, entity = null) {
    setMenuOpen(false)
    setMutationProblem(null)
    setModal({ type, entity })
  }

  return (
    <div className="ol-shell">
      <header className="ol-globalbar">
        <button className="ol-wordmark" type="button" onClick={() => navigateView('overview')}>
          <span>AI 운영</span>
        </button>
        <nav className="ol-globalnav" aria-label="OverrideLoop 주요 메뉴">
          {NAV.map((item) => (
            <button
              key={item.key}
              type="button"
              className={view === item.key ? 'active' : ''}
              aria-current={view === item.key ? 'page' : undefined}
              onClick={() => navigateView(item.key)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="ol-global-actions">
          <button ref={menuToggleRef} className="ol-menu-toggle" type="button" aria-label="OverrideLoop 메뉴" aria-expanded={menuOpen} aria-controls="override-navigation" onKeyDown={(event) => { if (event.key === 'Escape' && menuOpen) closeMenu() }} onClick={() => setMenuOpen(!menuOpen)}>메뉴 <span aria-hidden="true">{menuOpen ? '−' : '+'}</span></button>
          <button className="ol-primary ol-compact" type="button" onClick={() => open('event')}>
            판단 기록
          </button>
        </div>
      </header>
      {menuOpen && (
        <nav className="ol-menu-tray" id="override-navigation" aria-label="OverrideLoop 전체 메뉴" onKeyDown={(event) => { if (event.key === 'Escape') closeMenu() }}>
          {NAV.map((item) => <button key={item.key} type="button" aria-current={view === item.key ? 'page' : undefined} onClick={() => navigateView(item.key)}>{item.label}<span aria-hidden="true">›</span></button>)}
        </nav>
      )}

      <div className="ol-context-bar">
        <span>{data?.demo_mode ? '시연 데이터' : '운영 데이터'}</span>
        {data?.execution && <span>{data.execution.mode === 'simulation' ? '가상 자료' : '수동 근거 기록'} · {data.execution.external_rollout ? '외부 실행 연결' : '외부 배포 제어 미연결'}</span>}
        {data?.current_actor && <span>{data.current_actor.label} · {roleLabel(data.current_actor.role)}</span>}
        {data?.demo_mode && <label className="ol-role-select">
          <span>현재 역할</span>
          <select aria-label="시연 역할" value={role} onChange={(event) => setRole(event.target.value)}>
            {OVERRIDE_ROLES.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
          </select>
        </label>}
      </div>

      <div className="ol-layout">
        <div className={`ol-workspace${view === 'overview' ? ' ol-workspace-home' : ''}`} aria-live="polite">
          {loading && !data && <WorkspaceSkeleton />}
          {error && !data && (
            <ErrorState message={error} onRetry={reload} />
          )}
          {data && (
            <>
              {view === 'overview' && <OverviewView data={data} open={open} go={navigateView} />}
              {view === 'events' && <EventsView data={data} open={open} askAi={askAi} />}
              {view === 'clusters' && <ClustersView data={data} open={open} askAi={askAi} mutate={mutate} busy={busy} role={role} initialSelectedId={focusedClusterId} />}
              {view === 'experiments' && <ExperimentsView data={data} open={open} />}
              {view === 'intelligence' && <IntelligenceView data={data} />}
              {['feedback','quality'].includes(view) && <FieldFeedbackView key={`${role}:${view}`} mode={view} role={role} products={data.capture_products ?? data.products ?? []} onCapture={() => open('event')} onOpenEvent={eventId => open('eventDetail', eventId)} onOpenCluster={async clusterId => { await reload(); setFocusedClusterId(clusterId); navigateView('clusters') }} />}
              {view === 'integrations' && (
                <IntegrationsView data={data} open={open} mutate={mutate} role={role} busy={busy} />
              )}
              {view === 'audit' && <AuditView data={data} open={open} role={role} />}
            </>
          )}
        </div>
      </div>

      {modal && (
        <Modal title={MODAL_TITLES[modal.type]} onClose={() => !busy && setModal(null)}>
          {mutationProblem && <div className="notice notice-danger" role="alert">
            <p>{mutationProblem.message}</p>
            {mutationProblem.fields.length > 0 && <ul>{mutationProblem.fields.map(message => <li key={message}>{message}</li>)}</ul>}
          </div>}
          {modal.type === 'event' && (
            <EventForm data={data} busy={busy} onSubmit={(payload) => mutate('capture_event', payload, '판단과 근거를 저장했습니다.')} />
          )}
          {modal.type === 'eventDetail' && <EventDetail eventId={modal.entity} open={open} askAi={askAi} refresh={data?.generated_at} />}
          {modal.type === 'validate' && (
            <ValidateForm event={modal.entity} busy={busy} onSubmit={(payload) => mutate('validate_event', payload, '사람의 수정 타당성을 기록했습니다.')} />
          )}
          {modal.type === 'cluster' && (
            <ClusterForm cluster={modal.entity} candidates={data.assignment_candidates ?? []} busy={busy} onSubmit={(payload) => mutate('update_cluster', payload, '원인과 담당을 확정했습니다.')} />
          )}
          {modal.type === 'experiment' && (
            <ExperimentForm cluster={modal.entity} busy={busy} onSubmit={(payload) => mutate('create_experiment', payload, '개선 실험 카드를 만들었습니다.')} onAssist={() => askAi('experiment', modal.entity, 'issue_cluster', modal.entity?.id)} />
          )}
          {modal.type === 'approve' && (
            <ApproveForm experiment={modal.entity} busy={busy} onSubmit={(payload) => mutate('approve_experiment', payload, '실험을 승인했습니다.')} />
          )}
          {modal.type === 'run' && (
            <RunForm experiment={modal.entity} busy={busy} onSubmit={(payload) => mutate('record_run', payload, '실험 결과를 판정했습니다.')} />
          )}
          {modal.type === 'decision' && (
            <DecisionForm experiment={modal.entity} busy={busy} onSubmit={(payload) => mutate('decide_experiment', payload, '최종 결정과 근거를 남겼습니다.')} />
          )}
          {modal.type === 'volume' && (
            <VolumeForm data={data} busy={busy} onSubmit={(payload) => mutate('record_volume', payload, '처리량을 반영했습니다.')} />
          )}
          {modal.type === 'integration' && (
            <IntegrationForm busy={busy} onSubmit={(payload) => mutate('save_integration', payload, '연동 설정을 저장했습니다.')} />
          )}
          {modal.type === 'product' && (
            <ProductForm busy={busy} onSubmit={(payload) => mutate('create_product', payload, 'AI 제품을 등록했습니다.')} />
          )}
          {modal.type === 'actor' && (
            <ActorForm actor={modal.entity} products={data.products ?? []} busy={busy} onSubmit={(payload) => mutate('save_actor', payload, '접근 권한을 저장했습니다.')} />
          )}
          {modal.type === 'ai' && <AiDraft result={aiDraft} busy={busy} />}
        </Modal>
      )}
    </div>
  )
}

function WorkspaceSkeleton() {
  return (
    <div className="ol-skeleton" aria-label="운영판 불러오는 중">
      <span />
      <span />
      <div><span /><span /><span /><span /></div>
    </div>
  )
}

function ErrorState({ message, onRetry }) {
  return (
    <section className="ol-error-state">
      <span className="ol-orb" aria-hidden="true">!</span>
      <h1>운영 자료에 닿지 못했습니다.</h1>
      <p>{message}</p>
      <button className="ol-primary" type="button" onClick={onRetry}>다시 불러오기</button>
    </section>
  )
}

function PageIntro({ title, copy, actions }) {
  return (
    <header className="ol-page-intro">
      <div>
        <h1>{title}</h1>
        {copy && <p>{copy}</p>}
      </div>
      {actions && <div className="ol-page-actions">{actions}</div>}
    </header>
  )
}

function OverviewView({ data, open, go }) {
  const featured = data.events.find((event) => Number(event.is_override)) ?? data.events[0]
  return (
    <div className="ol-page ol-overview">
      <PageIntro title="운영판" actions={<>
          <button className="ol-primary" type="button" onClick={() => go('events')}>판단 사건 살펴보기</button>
          <button className="ol-secondary" type="button" onClick={() => open('event')}>새 판단 기록</button>
          <button className="ol-text-button" type="button" onClick={() => go('experiments')}>개선 실험 보기</button>
        </>} />
        {featured && <section className="decision-preview" aria-label="최근 판단 사건 미리보기">
          <div className="decision-preview-bar"><span>{data.demo_mode ? '최근 판단 · 시연 사건' : '최근 판단'}</span></div>
          <div className="decision-preview-heading"><span>{featured.product_name}</span><span>{featured.external_ref || featured.id}</span></div>
          <div className="decision-preview-grid">
            <div><span className="decision-preview-label">AI의 원안</span><p>{featured.ai_decision}</p></div>
            <span className="decision-preview-arrow" aria-hidden="true">→</span>
            <div className="decision-preview-human"><span className="decision-preview-label">사람의 최종 판단</span><p>{featured.human_decision}</p></div>
          </div>
          <div className="decision-preview-evidence"><span>판단의 근거</span><p>{featured.reason_detail}</p><Validity value={featured.validity} /></div>
        </section>}
    </div>
  )
}

function Metric({ label, value, note, tone }) {
  return (
    <article className={`ol-metric ${tone ?? ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  )
}

function PriorityPill({ score, band }) {
  return <span className={`ol-priority-pill ${toneForPriority(score)}`}>{band ?? priorityBand(score)}</span>
}

function EventsView({ data, open, askAi }) {
  const [query, setQuery] = useState('')
  const [product, setProduct] = useState('all')
  const [validity, setValidity] = useState('all')
  const [action, setAction] = useState('all')
  const listing = useOverrideEvents({ q: query.trim(), productId: product, validity, action }, { refresh: data.generated_at })

  return (
    <div className="ol-page">
      <PageIntro
        title="판단 사건"
        copy="사람의 수정은 검토 전까지 정답으로 쓰지 않습니다."
        actions={<button className="ol-primary" type="button" onClick={() => open('event')}>판단 기록</button>}
      />

      <p className="field-muted">검색과 필터는 열람 권한이 있는 전체 이력에 적용합니다. 최신 사건부터 페이지별로 표시하며, 조직 집계는 페이지 이동과 관계없이 전체 기록을 사용합니다.</p>

      <div className="ol-toolbar">
        <label className="ol-search"><span aria-hidden="true">⌕</span><input value={query} maxLength={200} onChange={(event) => setQuery(event.target.value)} placeholder="사건·근거·제품 검색" /></label>
        <select value={product} onChange={(event) => setProduct(event.target.value)} aria-label="AI 제품 필터">
          <option value="all">모든 AI 제품</option>
          {data.products.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <select value={action} onChange={(event) => setAction(event.target.value)} aria-label="판단 필터">
          <option value="all">모든 판단</option>
          {DECISION_ACTIONS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
        </select>
        <select value={validity} onChange={(event) => setValidity(event.target.value)} aria-label="타당성 필터">
          <option value="all">모든 검토 상태</option>
          <option value="pending">검토 대기</option><option value="valid">타당</option><option value="invalid">사람 오류</option><option value="uncertain">판단 불가</option>
        </select>
      </div>

      {listing.error && <ErrorState message={listing.error} onRetry={listing.reload} />}
      {listing.loading && !listing.data && <p role="status">판단 사건을 불러오는 중입니다.</p>}
      {listing.page && <p className="field-muted">검색 결과 {listing.page.total.toLocaleString('ko-KR')}건 · 현재 {listing.events.length}건 표시</p>}
      <div className="ol-event-list">
        {listing.events.map(event => <EventCard key={event.id} event={event} open={open} askAi={askAi} />)}
        {!listing.loading && !listing.error && listing.events.length === 0 && <Empty title="조건에 맞는 판단 사건이 없습니다." />}
      </div>
      <OverrideEventPager listing={listing} />
    </div>
  )
}

function EventDetail({ eventId, open, askAi, refresh }) {
  const listing = useOverrideEvents({ eventId }, { refresh })
  if (listing.error) return <ErrorState message={listing.error} onRetry={listing.reload} />
  if (!listing.data) return <p role="status">판단 사건 원문을 불러오는 중입니다.</p>
  const event = listing.events.find(item => item.id === eventId)
  return event ? <EventCard event={event} open={open} askAi={askAi} /> : <Empty title="이 판단 사건을 찾을 수 없습니다." />
}

function EventCard({ event, open, askAi }) {
  return <article className="ol-event-card">
            <div className="ol-event-meta">
              <span className={`ol-action action-${event.decision_action}`}>{actionLabel(event.decision_action)}</span>
              <strong>{event.product_name}</strong>
              <span>{event.external_ref || event.id}</span>
              <span>{fmtDate(event.occurred_at, true)}</span>
              <Validity value={event.validity} />
            </div>
            <div className="ol-decision-compare">
              <div><span>AI 원안</span><p>{event.ai_decision}</p></div>
              <span className="ol-compare-arrow" aria-hidden="true">→</span>
              <div className="human"><span>사람의 최종 판단</span><p>{event.human_decision}</p></div>
            </div>
            <div className="ol-event-reason">
              <span>왜 바뀌었나</span>
              <p>{event.reason_detail}</p>
              <small>{event.policy_refs.join(' · ') || '연결된 정책 없음'} · {event.model_version} · {event.prompt_version}</small>
              {(event.changed_fields.length > 0 || event.data_refs.length > 0) && (
                <small>
                  {event.changed_fields.length > 0 && `변경 · ${event.changed_fields.join(' · ')}`}
                  {event.changed_fields.length > 0 && event.data_refs.length > 0 && ' / '}
                  {event.data_refs.length > 0 && `원본 · ${event.data_refs.join(' · ')}`}
                </small>
              )}
            </div>
            <div className="ol-card-actions">
              {event.validity === 'pending' && <button className="ol-secondary ol-compact" type="button" onClick={() => open('validate', event)}>수정 타당성 검토</button>}
              <button className="ol-text-button" type="button" onClick={() => askAi('event', event, 'override_event', event.id)}>Claude 원인 초안</button>
            </div>
          </article>
}

function Validity({ value }) {
  const map = {
    pending: ['검토 대기', 'warning'],
    valid: ['타당 확인', 'success'],
    invalid: ['사람 오류', 'danger'],
    uncertain: ['판단 불가', 'neutral'],
  }
  const [label, tone] = map[value] ?? [value, 'neutral']
  return <span className={`ol-validity ${tone}`}>{label}</span>
}

function ClustersView({ data, open, askAi, mutate, busy, role, initialSelectedId }) {
  const fromHash = window.location.hash.startsWith('#clusters:') ? window.location.hash.split(':')[1] : null
  const [selectedId, setSelectedId] = useState(initialSelectedId || fromHash || data.clusters[0]?.id)
  const [query, setQuery] = useState('')
  const [onlyMine, setOnlyMine] = useState(false)
  const isMine = cluster => Boolean(cluster.assignee_email && cluster.assignee_email === (data.demo_mode ? 'demo-owner@ilson.invalid' : data.current_actor?.email))
  const clusters = data.clusters.filter((cluster) =>
    (!onlyMine || (isMine(cluster) && !['resolved', 'accepted_exception'].includes(cluster.status))) &&
    `${cluster.title} ${cluster.summary} ${cluster.owner_team} ${cluster.assignee_label || cluster.assignee_email || ''}`.toLowerCase().includes(query.toLowerCase())
  )
  const linkedMissing = initialSelectedId === selectedId && initialSelectedId && !data.clusters.some(cluster => cluster.id === initialSelectedId)
  const selected = clusters.find((cluster) => cluster.id === selectedId) ?? (linkedMissing ? null : clusters[0])
  const assigneeLabel = cluster => cluster.assignee_label || data.assignment_candidates?.find(person => person.email === cluster.assignee_email)?.label || cluster.assignee_email || '미배정'
  const overdue = cluster => cluster.next_response_on && cluster.next_response_on < new Date().toISOString().slice(0, 10) && !['resolved', 'accepted_exception'].includes(cluster.status)
  const listing = useOverrideEvents({ clusterId: selected?.id }, { refresh: data.generated_at, skip: !selected })
  const related = listing.events.filter(event => event.cluster_id === selected?.id)

  return (
    <div className="ol-page">
      <PageIntro
        title="반복 문제"
      />
      <div className="ol-split-workspace">
        <section className="ol-master-list">
          <label className="ol-search"><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="반복 문제 검색" /></label>
          <label className="ol-assignment-filter"><input type="checkbox" checked={onlyMine} onChange={event => setOnlyMine(event.target.checked)} />{data.demo_mode ? '시연 담당자의 할 일만' : '내가 맡은 할 일만'}</label>
          <div className="ol-cluster-list">
            {clusters.map((cluster) => (
              <button key={cluster.id} type="button" className={selected?.id === cluster.id ? 'active' : ''} onClick={() => setSelectedId(cluster.id)}>
                <div><PriorityPill score={cluster.priority_score} /><span>{statusLabel(cluster.status)}</span></div>
                <strong>{cluster.title}</strong>
                <p>{causeByKey(cluster.cause_code).label}</p>
                <small>{cluster.recurrence_count}건 · {cluster.owner_team}</small>
                <small>{assigneeLabel(cluster)}{cluster.assignee_email && !cluster.acknowledged_at ? ' · 접수 확인 대기' : ''}{overdue(cluster) ? ' · 회신 기한 지남' : ''}</small>
              </button>
            ))}
          </div>
        </section>

        {selected ? (
          <article className="ol-detail-panel">
            <div className="ol-detail-head">
              <div><PriorityPill score={selected.priority_score} /><span className="ol-status">{statusLabel(selected.status)}</span></div>
              <h2>{selected.title}</h2>
              <p>{selected.summary}</p>
              <div className="ol-card-actions">
                <button className="ol-secondary ol-compact" type="button" onClick={() => open('cluster', selected)}>원인·담당 확정</button>
                <button className="ol-primary ol-compact" type="button" onClick={() => open('experiment', selected)}>실험 만들기</button>
                <button className="ol-text-button" type="button" disabled={listing.loading || Boolean(listing.error)} onClick={() => askAi('cluster', { cluster: selected, events: related }, 'issue_cluster', selected.id)}>현재 원문으로 Claude 가설</button>
              </div>
            </div>

            <section className="ol-detail-section ol-assignment-summary" aria-label="문제 담당과 회신 일정">
              <div><span>개인 담당자</span><strong>{assigneeLabel(selected)}</strong></div>
              <div><span>접수 확인</span><strong>{selected.acknowledged_at ? fmtDate(selected.acknowledged_at, true) : selected.assignee_email ? '담당자 확인 대기' : '담당자 배정 후 확인'}</strong></div>
              <div><span>다음 회신 기한</span><strong className={overdue(selected) ? 'field-error' : undefined}>{selected.next_response_on || '미지정'}{overdue(selected) ? ' · 기한 지남' : ''}</strong></div>
              {isMine(selected) && !selected.acknowledged_at && (!data.demo_mode || roleCan(role, 'update_cluster')) && <button className="ol-secondary ol-compact" type="button" disabled={busy} onClick={() => mutate('acknowledge_cluster', { clusterId: selected.id }, '담당 접수를 확인했습니다.')}>담당 접수 확인</button>}
            </section>

            <div className="ol-detail-metrics">
              <Metric label="반복" value={`${selected.recurrence_count}건`} note={`${fmtDate(selected.first_seen_at)} — ${fmtDate(selected.last_seen_at)}`} />
              <Metric label="운영 비용" value={won(selected.operations_cost_krw)} note="연결 사건의 재작업" />
              <Metric label="규제 위험" value={valueOrDash(selected.regulatory_risk_score, '/5')} note="가장 높은 사건 기준" tone={Number(selected.regulatory_risk_score) >= 4 ? 'danger' : undefined} />
            </div>

            <p className="field-muted">문제 수치는 전체 연결 사건 기준입니다. 원문은 계정에 열람이 허용된 사건만 표시합니다.</p>

            <section className="ol-detail-section">
              <div className="ol-section-head"><h3>원인 판정</h3><span>{selected.cause_status === 'confirmed' ? '사람이 확정' : '후보'}</span></div>
              <div className="ol-cause-block">
                <strong>{causeByKey(selected.cause_code).label}</strong>
                <span>책임 조직 · {selected.owner_team}</span>
              </div>
              {selected.cause_candidates.length > 0 && (
                <div className="ol-candidate-row">
                  {selected.cause_candidates.map((candidate) => (
                    <span key={candidate.key ?? candidate.cause_code}>{causeByKey(candidate.key ?? candidate.cause_code).label}<strong>{candidate.confidence}%</strong></span>
                  ))}
                </div>
              )}
            </section>

            <section className="ol-detail-section">
              <div className="ol-section-head"><h3>연결된 판단 사건</h3><span>현재 {related.length}건 표시 · 열람 가능 전체 {listing.page?.total ?? selected.visible_event_count ?? related.length}건</span></div>
              {listing.error && <ErrorState message={listing.error} onRetry={listing.reload} />}
              {listing.loading && !listing.data && <p role="status">연결된 원문을 불러오는 중입니다.</p>}
              <div className="ol-mini-events">
                {related.map((event) => (
                  <div key={event.id}>
                    <Validity value={event.validity} />
                    <strong>{event.product_name}</strong>
                    <p>{event.reason_detail}</p>
                    <small>{fmtDate(event.occurred_at)} · {event.segment}</small>
                    <button className="ol-text-button" type="button" onClick={() => open('eventDetail', event.id)}>원문 보기</button>
                  </div>
                ))}
              </div>
              <OverrideEventPager listing={listing} label="연결된 판단 사건 페이지" />
            </section>
          </article>
        ) : <Empty title={linkedMissing ? '연결된 문제를 현재 조회 범위에서 찾지 못했습니다.' : onlyMine ? '현재 맡은 미해결 문제가 없습니다.' : '조건에 맞는 반복 문제가 없습니다.'} />}
      </div>
    </div>
  )
}

function ExperimentsView({ data, open }) {
  const [selectedId, setSelectedId] = useState(data.experiments[0]?.id)
  const selected = data.experiments.find((experiment) => experiment.id === selectedId) ?? data.experiments[0]
  const cluster = data.clusters.find((item) => item.id === selected?.cluster_id)
  const gate = selected ? canExpandExperiment(selected, selected.runs) : null
  const plan = safeJson(selected?.evaluation_plan_json)

  return (
    <div className="ol-page">
      <PageIntro
        title="개선 실험"
        copy="측정 근거를 기록하고 기준 위반을 판정합니다. 외부 시스템의 배포·중단·롤백은 실행하지 않습니다."
      />
      <div className="ol-experiment-board">
        <aside className="ol-experiment-list">
          {data.experiments.map((experiment) => (
            <button key={experiment.id} type="button" className={selected?.id === experiment.id ? 'active' : ''} onClick={() => setSelectedId(experiment.id)}>
              <span className={`ol-status-dot ${experiment.status}`} aria-hidden="true" />
              <div><strong>{experiment.title}</strong><small>{statusLabel(experiment.status)} · {experiment.risk_level === 'high' ? '고위험' : '일반'}</small></div>
            </button>
          ))}
          <button className="ol-empty-action" type="button" onClick={() => open('experiment', data.clusters[0])}>새 실험 +</button>
        </aside>

        {selected ? (
          <article className="ol-experiment-detail">
            <div className="ol-detail-head">
              <div><span className={`ol-risk ${selected.risk_level}`}>{selected.risk_level === 'high' ? '고위험 변경' : '통제된 변경'}</span><span className="ol-status">{statusLabel(selected.status)}</span></div>
              <h2>{selected.title}</h2>
              <p>{selected.hypothesis}</p>
              <small>문제 · {cluster?.title ?? selected.cluster_id}</small>
            </div>

            <div className="ol-phase-track">
              {EXPERIMENT_PHASES.map((phase, index) => {
                const run = [...selected.runs].sort((a,b)=>Number(b.run_sequence)-Number(a.run_sequence)).find((item) => item.phase === phase.key && selected.approval_id && item.approval_id === selected.approval_id && item.change_version === selected.change_version)
                return (
                  <div key={phase.key} className={`ol-phase ${run?.status ?? ''}`}>
                    <span>{run ? (run.status === 'passed' ? '✓' : '!') : index + 1}</span>
                    <strong>{phase.label}</strong>
                    <small>{run ? `${runLabel(run.status)} · ${run.improvement_percent}%` : '현재 승인 주기 기록 없음'}</small>
                  </div>
                )
              })}
            </div>

            <div className="ol-experiment-grid">
              <section><span>변경 대상</span><p>{selected.change_target}</p></section>
              <section><span>비교 대상</span><p>{selected.comparator}</p></section>
              <section><span>성공 지표</span><p>{selected.success_metric} · {selected.target_improvement}% {selected.metric_direction === 'higher' ? '증가' : '감소'}</p></section>
              <section><span>적용 범위</span><p>{selected.scope}</p></section>
            </div>

            {plan && <section className="ol-safety-box" aria-label="사전 측정 계획">
              <div><span>표본·기간 선정 근거</span><p>{plan.rationale}</p></div>
              <div><span>최소 표본 · 측정 시간</span><p>{EXPERIMENT_PHASES.map(phase=>`${phase.label} ${plan.minimumSamples[phase.key]}건`).join(' · ')} / {plan.minimumWindowSeconds}초</p></div>
              <div><span>데이터 · 모델 · 정책 버전</span><p>{plan.datasetVersion} · {plan.modelVersion} · {plan.policyVersion}</p></div>
            </section>}
            {selected.runs.length>0 && <details className="ol-decision-records"><summary>전체 결과·원본 근거 {selected.runs.length}건</summary>
              {selected.runs.map(run=><article key={run.id}>
                <strong>{run.phase} · {runLabel(run.status)}</strong>
                <p>{run.approval_id === selected.approval_id && run.approval_id ? '현재 승인 주기' : '이전 참고 기록'} · {run.source_kind === 'manual' ? '수동 입력' : '참고 자료'}</p>
                <p>표본 {run.sample_size}건 · 대조군 {run.control_value} / 변경군 {run.variant_value} · 위반 {run.guardrail_breaches}건</p>
                <p>{run.measurement_start || '기간 미기록'} ~ {run.measurement_end || '기간 미기록'}</p>
                <p>{safeJson(run.evidence_refs_json,[]).join(' · ') || '원본 근거 미등록'} · {run.notes}</p>
              </article>)}
            </details>}
            <div className="ol-safety-box">
              <div><span>안전 가드레일</span><ul>{selected.guardrails.map((item) => <li key={item}>{item}</li>)}</ul></div>
              <div><span>즉시 중단 조건</span><ul>{selected.stop_conditions.map((item) => <li key={item}>{item}</li>)}</ul></div>
              <div><span>롤백</span><p>{selected.rollback_plan}</p></div>
            </div>

            {selected.decisions.length > 0 && (
              <section className="ol-decision-records">
                <div className="ol-section-head"><h3>최종 결정 기록</h3><span>수정 불가 스냅샷</span></div>
                {selected.decisions.map((decision) => (
                  <article key={decision.id}>
                    <div><strong>{statusLabel(decision.decision)}</strong><span>{fmtDate(decision.created_at, true)} · {decision.decided_by}</span></div>
                    <p>{decision.basis}</p>
                    <details><summary>결정 당시 측정 근거</summary><pre className="ol-evidence-json">{JSON.stringify(decision.metrics_snapshot,null,2)}</pre></details>
                    <small>
                      {decision.metrics_snapshot.runs?.length ?? 0}개 단계 · 실험 {decision.experiment_id}
                    </small>
                  </article>
                ))}
              </section>
            )}

            <div className="ol-card-actions ol-experiment-actions">
              {['draft','held','stopped'].includes(selected.status) && selected.evaluation_plan_json && <button className="ol-secondary" type="button" onClick={() => open('approve', selected)}>사람 승인</button>}
              <button className="ol-primary" type="button" disabled={!selected.evaluation_plan_json || !selected.approval_id || !['approved','running'].includes(selected.status)} onClick={() => open('run', selected)}>실험 결과 입력</button>
              <button className="ol-secondary" type="button" disabled={selected.status === 'rolled_back'} onClick={() => open('decision', selected)}>{selected.status === 'expanded' ? '롤백 결정 기록' : '최종 결정'}</button>
            </div>
            <p className="ol-gate-copy">수동 입력 근거의 기준 충족 여부를 기록합니다. 실제 AI 배포·중단·롤백은 실행하지 않습니다.</p>
            {!selected.evaluation_plan_json && <p className="ol-gate-copy">이전 참고 기록입니다. 사전 측정 계획이 없어 추가 시험·확대 승인을 할 수 없습니다. 반복 문제에서 새 개선 실험을 만들어 주세요.</p>}
            {gate && !gate.ok && (
              <p className="ol-gate-copy">확대 전 확인 · {gate.needsPlan ? '사전 측정 계획 필요' : !gate.stateAllowed ? '현재 상태에서는 확대 불가' : gate.needsApproval ? '현재 시험 주기 승인 필요' : gate.missing.length ? `${gate.missing.join(' → ')} 필요` : gate.timingIssues.length ? gate.timingIssues.map(issue=>`${issue.phase} · ${issue.reason}`).join(' / ') : `${gate.blocked.join(' · ')} 재검토 필요`}</p>
            )}
          </article>
        ) : <Empty title="아직 만든 개선 실험이 없습니다." />}
      </div>
    </div>
  )
}

function IntelligenceView({ data }) {
  const [policy, setPolicy] = useState(data.policy_impact[0]?.policy ?? '')
  const scenario = data.policy_impact.find((item) => item.policy === policy)
  const exportRows = data.events
    .filter((event) => event.validity === 'valid' && event.is_override && data.clusters.find((cluster) => cluster.id === event.cluster_id)?.cause_code === 'model')
    .map((event) => ({
      id: event.id,
      product: event.product_name,
      model_version: event.model_version,
      prompt_version: event.prompt_version,
      ai_decision: event.ai_decision,
      corrected_decision: event.human_decision,
      evidence: event.validity_reason,
    }))

  function downloadDataset() {
    const blob = new Blob([JSON.stringify({ generated_at: new Date().toISOString(), rows: exportRows }, null, 2)], { type: 'application/json' })
    const href = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = href
    anchor.download = 'overrideloop-evaluation-dataset.json'
    anchor.click()
    URL.revokeObjectURL(href)
  }

  return (
    <div className="ol-page">
      <PageIntro
        title="조직 인사이트"
        actions={<button className="ol-secondary" type="button" onClick={downloadDataset}>현재 목록의 모델 오류 내보내기</button>}
      />
      {data.metrics?.totals_scope && <p className="field-muted">원본 자료 집계 범위: {data.metrics.totals_scope}</p>}
      <p className="field-muted">내보내기는 운영 자료에 불러온 최근 {data.events.length}건 중 타당성이 확인된 모델 오류만 포함합니다. 전체 이력이나 다른 사건 페이지를 합친 자료는 아닙니다.</p>
      {data.event_list?.truncated && <p className="field-muted">열람 가능한 전체 {data.event_list.total.toLocaleString('ko-KR')}건 중 최근 최대 {data.event_list.limit}건의 미리보기입니다. 이전 원문은 판단 사건에서 검색할 수 있습니다.</p>}

      <div className="ol-insight-grid">
        <section className="ol-panel ol-span-2">
          <div className="ol-section-head"><h2>고객군별 수정률</h2><span>최근 30일 · 같은 날짜·고객군의 분모 필요</span></div>
          <div className="ol-fairness-table">
            <div className="head"><span>AI 제품</span><span>고객군</span><span>수정 / 적용 가능</span><span>수정률</span></div>
            {data.fairness.map((row) => (
              <div key={`${row.product_id}-${row.segment}`}>
                <span>{row.product_name}</span><strong>{row.segment}</strong><span>{row.overrides} / {row.applicable.toLocaleString('ko-KR')}</span><strong className={(row.rate ?? 0) >= 1 ? 'hot' : ''}>{valueOrDash(row.rate, '%')}</strong>
              </div>
            ))}
          </div>
        </section>

        <section className="ol-panel">
          <div className="ol-section-head"><h2>정책 변경 영향</h2></div>
          <select className="ol-wide-select" value={policy} onChange={(event) => setPolicy(event.target.value)}>
            {data.policy_impact.map((item) => <option key={item.policy} value={item.policy}>{item.policy}</option>)}
          </select>
          {scenario ? (
            <div className="ol-scenario-result"><strong>{scenario.events}건</strong><p>{scenario.products}개 AI 제품 · 고위험 {scenario.high_risk}건</p><span>연결 재작업 {won(scenario.cost_krw)}</span></div>
          ) : <Empty title="연결된 정책이 없습니다." />}
        </section>

        <section className="ol-panel">
          <div className="ol-section-head"><h2>제품을 가로지른 원인</h2></div>
          <div className="ol-common-list">
            {data.common_issues.map((issue) => (
              <div key={issue.cause_code}><strong>{issue.cause_label}</strong><span>{issue.events}건</span><p>{issue.products.join(' · ')}</p></div>
            ))}
            {data.common_issues.length === 0 && <p className="ol-empty-copy">두 제품 이상에서 확인된 공통 원인이 없습니다.</p>}
          </div>
        </section>

        <section className="ol-panel ol-span-2">
          <div className="ol-section-head"><h2>판단 그래프</h2><span>{data.graph.nodes.length}개 노드 · {data.graph.edges.length}개 연결</span></div>
          <DecisionGraph data={data} />
        </section>

        <section className="ol-panel">
          <div className="ol-section-head"><h2>개선 투자 순서</h2></div>
          <ol className="ol-invest-list">
            {data.clusters.slice(0, 5).map((cluster, index) => (
              <li key={cluster.id}><span>{index + 1}</span><div><strong>{cluster.title}</strong><small>{cluster.owner_team}</small></div><b>{Math.round(cluster.priority_score)}</b></li>
            ))}
          </ol>
        </section>

        <section className="ol-panel">
          <div className="ol-section-head"><h2>새 예외·증가 신호</h2></div>
          <div className="ol-signal-list">
            {data.clusters.map((cluster) => {
              const trend = cluster.trend
              const hasTrend = Number.isFinite(trend?.change) && ['surge', 'down', 'new', 'flat'].includes(trend?.direction)
              const direction = hasTrend ? trend.direction : 'unavailable'
              return (
                <div key={cluster.id}><span className={`ol-trend ${direction}`}>{direction === 'surge' ? '↑' : direction === 'down' ? '↓' : direction === 'new' ? 'NEW' : '–'}</span><p>{cluster.title}</p><strong>{hasTrend ? `${trend.change > 0 ? '+' : ''}${trend.change}%` : '자료 없음'}</strong></div>
              )
            })}
          </div>
        </section>
      </div>
    </div>
  )
}

function DecisionGraph({ data }) {
  const columns = [
    { kind: 'product', label: 'AI 제품' },
    { kind: 'cluster', label: '반복 문제' },
    { kind: 'experiment', label: '변경 실험' },
    { kind: 'decision', label: '결정 기록' },
  ]
  return (
    <div className="ol-decision-graph">
      {columns.map((column, index) => {
        const nodes = data.graph.nodes.filter((node) => node.kind === column.kind).slice(0, 5)
        return (
          <div key={column.kind} className="ol-graph-column">
            <span className="ol-graph-label">{column.label}</span>
            {nodes.map((node) => (
              <div key={node.id} className={`ol-graph-node ${node.kind}`}>
                <i aria-hidden="true" />
                <span>{node.label}</span>
                {index < columns.length - 1 && <b aria-hidden="true">→</b>}
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}

function IntegrationsView({ data, open, mutate, role, busy }) {
  const catalog = [
    { kind: 'mlops', title: 'MLOps', copy: '검증된 모델 원인을 평가 데이터셋으로 전달' },
    { kind: 'policy', title: '정책 저장소', copy: '영향받은 정책·내규와 반복 문제를 연결' },
    { kind: 'ticket', title: '업무 티켓', copy: '책임 조직에 개선 과제와 근거를 전달' },
    { kind: 'evaluation', title: '평가 파이프라인', copy: '수정 전후 품질·비용 지표를 교환' },
  ]
  return (
    <div className="ol-page">
      <PageIntro
        title="연동"
        copy="시크릿 값은 저장하지 않고 Cloudflare 바인딩 이름만 보관합니다."
        actions={<button className="ol-primary" type="button" onClick={() => open('integration')}>연동 추가</button>}
      />
      <div className="ol-integration-catalog">
        {catalog.map((item) => (
          <article key={item.kind}><h2>{item.title}</h2><p>{item.copy}</p><button className="ol-text-button" type="button" onClick={() => open('integration', item)}>연결 설정</button></article>
        ))}
      </div>

      <section className="ol-panel">
        <div className="ol-section-head"><h2>연결된 시스템</h2><span>{data.integrations.length}개</span></div>
        <div className="ol-connected-list">
          {data.integrations.map((integration) => (
            <div key={integration.id}><span className={`ol-connection-state ${integration.status}`}><i />{integration.status}</span><div><strong>{integration.name}</strong><p>{integration.kind} · {integration.endpoint_url}</p><small>{integration.last_sync_at ? `${fmtDate(integration.last_sync_at, true)} · ${integration.last_result}` : '아직 동기화하지 않음'}</small></div><button className="ol-secondary ol-compact" type="button" disabled={busy || !roleCan(role, 'sync_integration')} onClick={() => mutate('sync_integration', { integrationId: integration.id }, '연동 자료를 전송했습니다.')}>지금 동기화</button></div>
          ))}
          {data.integrations.length === 0 && <Empty title="아직 연결한 외부 시스템이 없습니다." />}
        </div>
      </section>

      <section className="ol-api-card">
        <div><h2>판단 수집 API</h2><p>외부 사건 번호는 중복 저장을 막습니다.</p><p>인증된 연결에서 먼저 GET /api/session으로 접근 범위를 확인합니다. 반환된 scope를 이후 조회·저장의 X-Ilson-Scope 헤더에 넣습니다. 계정이 바뀌면 저장은 거절되며 새 계정에서 내용을 다시 확인해야 합니다. 이 값은 인증 토큰을 대신하지 않습니다.</p></div>
        <pre>{`POST /api/override
Content-Type: application/json
X-Ilson-Request: 1
X-Ilson-Scope: <GET /api/session에서 확인한 scope>

{
  "action": "capture_event",
  "productId": "olp_...",
  "decisionAction": "modify",
  "aiDecision": "...",
  "humanDecision": "...",
  "reasonDetail": "...",
  "modelVersion": "...",
  "policyRefs": ["..."]
}`}</pre>
      </section>
    </div>
  )
}

function AuditView({ data, open, role }) {
  const canManage = data.demo_mode === false && (data.current_actor?.is_admin || roleCan(role, 'save_actor'))
  return (
    <div className="ol-page">
      <PageIntro
        title="감사 기록"
        actions={canManage ? <button className="ol-secondary" type="button" onClick={() => open('actor')}>접근 역할 등록</button> : null}
      />
      {data.demo_mode && <p className="ol-gate-copy">체험 모드에서는 실제 계정의 접근 권한을 변경하지 않습니다.</p>}
      {canManage && <section className="ol-panel ol-account-panel" aria-label="계정 접근 관리">
        <div className="ol-section-head"><h2>계정 접근 관리</h2><span>{data.actors?.length ?? 0}명</span></div>
        <p className="ol-gate-copy">부서 또는 제품 범위 안에서만 기록을 조회합니다. 계정을 비활성화하면 새 요청부터 접근을 차단하며 기존 작성 기록은 유지합니다.</p>
        <div className="ol-account-list">{(data.actors ?? []).map(actor => <article key={actor.email}>
          <div><strong>{actor.display_name || actor.email}</strong><p>{actor.email} · {roleLabel(actor.role)} · {actor.active ? '활성' : '비활성'}</p><small>부서: {actor.departments?.join(' · ') || '미지정'} / 제품: {actor.product_ids?.map(id => data.products?.find(product => product.id === id)?.name || id).join(' · ') || '미지정'}</small></div>
          <button className="ol-secondary ol-compact" type="button" onClick={() => open('actor', actor)} aria-label={`${actor.display_name || actor.email} 접근 권한 변경`}>권한 변경</button>
        </article>)}</div>
        {!data.actors?.length && <p className="field-muted">등록된 계정이 없습니다.</p>}
      </section>}
      <div className="ol-audit-summary">
        <Metric label="감사 사건" value={`${data.audit.length}건`} note="최근 160건 표시" />
        <Metric label="Claude 호출" value={`${data.ai_calls.length}건`} note="모델·프롬프트·토큰 기록" />
      </div>
      <div className="ol-audit-layout">
        <section className="ol-panel">
          <div className="ol-section-head"><h2>감사 타임라인</h2><span>최신순</span></div>
          <div className="ol-audit-list">
            {data.audit.map((item) => (
              <div key={item.id}><span className="ol-audit-line" aria-hidden="true"><i /></span><div><strong>{item.action}</strong><p>{item.actor_label} · {roleLabel(item.actor_role)}</p><small>{item.entity_kind} · {item.entity_id || '—'} · {fmtDate(item.created_at, true)}</small></div></div>
            ))}
          </div>
        </section>
        <section className="ol-panel">
          <div className="ol-section-head"><h2>AI 호출 근거</h2><span>Claude Opus 5만 허용</span></div>
          <div className="ol-ai-log">
            {data.ai_calls.map((call) => (
              <div key={call.id}><span className={Number(call.ok) ? 'ok' : 'fail'}>{Number(call.ok) ? '완료' : '실패'}</span><strong>{call.purpose}</strong><p>{call.model} · {call.prompt_version}</p><small>입력 {call.input_tokens} · 출력 {call.output_tokens} · {call.duration_ms ?? '—'}ms</small></div>
            ))}
            {data.ai_calls.length === 0 && <Empty title="아직 AI 분석 초안 호출이 없습니다." />}
          </div>
        </section>
      </div>
    </div>
  )
}

function Empty({ title }) {
  return <div className="ol-empty"><p>{title}</p></div>
}

function Modal({ title, onClose, children }) {
  const dialogRef = useRef(null)
  const closeRef = useRef(onClose)
  useEffect(() => { closeRef.current = onClose }, [onClose])
  useEffect(() => {
    const dialog = dialogRef.current
    const returnTarget = document.activeElement
    function focusableElements() {
      return [...dialog.querySelectorAll('a[href], button, input, select, textarea, summary, [tabindex], [contenteditable="true"]')].filter((element) => {
        if (element.tabIndex < 0 || element.matches(':disabled, input[type="hidden"]')) return false
        for (let current = element; current && current !== dialog.parentElement; current = current.parentElement) {
          if (current.hidden || current.hasAttribute('inert') || current.getAttribute('aria-hidden') === 'true') return false
          if (current.tagName === 'DETAILS' && !current.open && !current.querySelector(':scope > summary')?.contains(element)) return false
          const style = window.getComputedStyle(current)
          if (style.display === 'none' || style.visibility === 'hidden') return false
        }
        return true
      })
    }
    function focusFirst() {
      ;(focusableElements()[0] || dialog).focus({ preventScroll: true })
    }
    function keydown(event) {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        closeRef.current()
      }
      if (event.key !== 'Tab') return
      const elements = focusableElements()
      const first = elements[0]
      const last = elements.at(-1)
      const active = document.activeElement
      if (!first) {
        event.preventDefault()
        dialog.focus({ preventScroll: true })
      } else if (!elements.includes(active) || (event.shiftKey ? active === first : active === last)) {
        event.preventDefault()
        ;(event.shiftKey ? last : first).focus({ preventScroll: true })
      }
    }
    function focusin(event) {
      if (!dialog.contains(event.target)) focusFirst()
    }
    document.addEventListener('keydown', keydown)
    document.addEventListener('focusin', focusin)
    document.body.classList.add('ol-modal-open')
    focusFirst()
    return () => {
      document.removeEventListener('keydown', keydown)
      document.removeEventListener('focusin', focusin)
      document.body.classList.remove('ol-modal-open')
      if (returnTarget instanceof HTMLElement && returnTarget.isConnected) returnTarget.focus({ preventScroll: true })
    }
  }, [])
  return (
    <div className="ol-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section ref={dialogRef} tabIndex={-1} className="ol-modal" role="dialog" aria-modal="true" aria-labelledby="ol-modal-title">
        <header><h2 id="ol-modal-title">{title}</h2><button type="button" onClick={onClose} aria-label="닫기">×</button></header>
        <div className="ol-modal-body">{children}</div>
      </section>
    </div>
  )
}

function Field({ label, hint, required, children, wide = false }) {
  return (
    <label className={`ol-field${wide ? ' wide' : ''}`}>
      <span>{label}{required && <b aria-hidden="true">*</b>}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  )
}

function SubmitBar({ busy, disabled = false, label, note }) {
  return (
    <div className="ol-submit-bar">
      {note && <p>{note}</p>}
      <button className="ol-primary" type="submit" disabled={busy || disabled}>{busy ? '저장 중…' : label}</button>
    </div>
  )
}

function EventForm({ data, busy, onSubmit }) {
  const products = data.capture_products ?? data.products ?? []
  return (
    <form className="ol-form" onSubmit={(event) => { event.preventDefault(); onSubmit(Object.fromEntries(Object.entries(formObject(event.currentTarget)).filter(([, value]) => value !== ''))) }}>
      <p className="ol-gate-copy">문제가 된 답변과 원하셨던 결과를 남겨주세요. 기술 정보는 아는 경우에만 추가하시면 됩니다.</p>
      <div className="ol-form-grid">
        <Field label="AI 제품" name="productId" required><select name="productId" required defaultValue={products[0]?.id || ''}>{!products.length && <option value="">등록된 제품이 없습니다</option>}{products.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
        <Field label="직원의 최종 판단" name="decisionAction" required><select name="decisionAction" required defaultValue="modify">{DECISION_ACTIONS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></Field>
        <Field label="AI의 원래 판단" name="aiDecision" wide required><textarea name="aiDecision" rows="3" required placeholder="AI가 답변·추천·실행하려던 내용을 원문 그대로" /></Field>
        <Field label="사람의 최종 판단" name="humanDecision" wide required><textarea name="humanDecision" rows="3" required placeholder="수정·거절·이관 후 실제로 확정한 내용" /></Field>
        <Field label="수정 이유" name="reasonDetail" wide required><textarea name="reasonDetail" rows="3" required placeholder="당시 확인한 근거와 달랐던 점" /></Field>
      </div>
      <details className="ol-optional-details"><summary>추가 정보 · 선택</summary>
      <div className="ol-form-grid">
        <Field label="외부 사건 번호" name="externalRef" hint="같은 번호의 중복 수집을 막습니다."><input name="externalRef" placeholder="예: CRM-20491" /></Field>
        <Field label="고객·업무군" name="segment"><input name="segment" placeholder="예: 신혼특례" /></Field>
        <Field label="바뀐 항목" name="changedFields" hint="쉼표로 구분"><input name="changedFields" placeholder="요구 서류, 답변 표현" /></Field>
        <Field label="정책·내규 원문" name="policyRefs" hint="쉼표로 구분"><input name="policyRefs" placeholder="대출내규-2026.08-14" /></Field>
        <Field label="모델 버전" name="modelVersion"><input name="modelVersion" placeholder="비우면 제품 기본 버전" /></Field>
        <Field label="프롬프트 버전" name="promptVersion"><input name="promptVersion" placeholder="비우면 제품 기본 버전" /></Field>
        <Field label="Agent 버전" name="agentVersion"><input name="agentVersion" /></Field>
        <Field label="업무 도구 버전" name="toolVersion"><input name="toolVersion" /></Field>
        <Field label="참고 데이터·문서" name="dataRefs"><input name="dataRefs" placeholder="CRM 상태, 검색 문서" /></Field>
        <Field label="실행 도구" name="tools"><input name="tools" placeholder="CRM, 정책 검색" /></Field>
        <Field label="고객 영향" name="customerImpact"><select name="customerImpact" defaultValue=""><option value="">아직 확인하지 않음</option>{[0,1,2,3,4,5].map((n) => <option key={n} value={n}>{n} / 5</option>)}</select></Field>
        <Field label="규제 위험" name="regulatoryRisk"><select name="regulatoryRisk" defaultValue=""><option value="">아직 확인하지 않음</option>{[0,1,2,3,4,5].map((n) => <option key={n} value={n}>{n} / 5</option>)}</select></Field>
        <Field label="재작업 비용(원)" name="operationsCost"><input name="operationsCost" type="number" min="0" /></Field>
        <Field label="기록 시간(초)" name="recordingSeconds"><input name="recordingSeconds" type="number" min="0" max="3600" /></Field>
        <Field label="실제 고객 결과" name="customerOutcome" wide><textarea name="customerOutcome" rows="2" placeholder="재문의, 사후 정정, 민원 또는 해결 결과" /></Field>
        <Field label="실제 업무 결과" name="businessOutcome" wide><textarea name="businessOutcome" rows="2" placeholder="재작업 시간, 비용, 처리 결과" /></Field>
      </div>
      </details>
      <SubmitBar busy={busy} label="판단 증거 저장" note="원본과 수정 이유를 보존하고 담당자가 원인과 후속 처리를 확인합니다." />
    </form>
  )
}

function ValidateForm({ event, busy, onSubmit }) {
  return (
    <form className="ol-form" onSubmit={(formEvent) => { formEvent.preventDefault(); onSubmit({ ...formObject(formEvent.currentTarget), eventId: event.id }) }}>
      <div className="ol-compare-small"><div><span>AI</span><p>{event.ai_decision}</p></div><div><span>사람</span><p>{event.human_decision}</p></div></div>
      <Field label="수정의 타당성" required><select name="validity" defaultValue="valid"><option value="valid">타당함</option><option value="invalid">사람의 수정이 잘못됨</option><option value="uncertain">근거로 판단할 수 없음</option></select></Field>
      <Field label="검증 근거" required><textarea name="reason" rows="5" required placeholder="정책 원문, 실제 결과 또는 전문가 검토로 확인한 내용" /></Field>
      <SubmitBar busy={busy} label="타당성 확정" note="타당 확인 전에는 학습 데이터나 정답으로 내보내지 않습니다." />
    </form>
  )
}

function ClusterForm({ cluster, candidates, busy, onSubmit }) {
  const [assigned, setAssigned] = useState(cluster.assignee_email || '')
  function submit(event) {
    event.preventDefault()
    const values = formObject(event.currentTarget)
    for (const [field, original] of [['customerImpact', cluster.customer_impact_score], ['regulatoryRisk', cluster.regulatory_risk_score], ['operationsCost', cluster.operations_cost_krw]]) {
      if (values[field] !== '') continue
      if (original == null) delete values[field]
      else values[field] = null
    }
    onSubmit({ ...values, nextResponseOn: assigned ? values.nextResponseOn : '', clusterId: cluster.id })
  }
  return (
    <form className="ol-form" onSubmit={submit}>
      <div className="ol-form-grid">
        <Field label="문제 이름" wide><input name="title" defaultValue={cluster.title} /></Field>
        <Field label="최종 원인" required><select name="causeCode" defaultValue={cluster.cause_code}>{CAUSES.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></Field>
        <Field label="판정 상태"><select name="causeStatus" defaultValue={cluster.cause_status}><option value="candidate">후보</option><option value="confirmed">사람이 확정</option><option value="disputed">이견 있음</option></select></Field>
        <Field label="책임 조직" required><input name="ownerTeam" defaultValue={cluster.owner_team} required /></Field>
        <Field label="개인 담당자"><select name="assigneeEmail" value={assigned} onChange={event => setAssigned(event.target.value)}><option value="">미배정</option>{cluster.assignee_email && !candidates.some(person => person.email === cluster.assignee_email) && <option value={cluster.assignee_email}>{cluster.assignee_label || cluster.assignee_email} · 기존 배정</option>}{candidates.map(person => <option key={person.email} value={person.email}>{person.label || person.email} · {person.email}</option>)}</select></Field>
        <Field label="다음 회신 기한" required={Boolean(assigned)} hint="담당자를 지정하면 회신 기한도 함께 정합니다."><input name="nextResponseOn" type="date" disabled={!assigned} required={Boolean(assigned)} defaultValue={cluster.next_response_on || ''} /></Field>
        <Field label="처리 상태"><select name="status" defaultValue={cluster.status}><option value="open">원인 검토</option><option value="experiment">실험 설계</option><option value="monitoring">재발 측정</option><option value="resolved">해결</option><option value="accepted_exception">정당한 예외</option></select></Field>
        <Field label="고객 영향"><select name="customerImpact" defaultValue={cluster.customer_impact_score ?? ''}><option value="">미기록</option>{[0,1,2,3,4,5].map((n) => <option key={n} value={n}>{n} / 5</option>)}</select></Field>
        <Field label="규제 위험"><select name="regulatoryRisk" defaultValue={cluster.regulatory_risk_score ?? ''}><option value="">미기록</option>{[0,1,2,3,4,5].map((n) => <option key={n} value={n}>{n} / 5</option>)}</select></Field>
        <Field label="운영 비용(원)"><input type="number" name="operationsCost" min="0" defaultValue={cluster.operations_cost_krw ?? ''} /></Field>
        <Field label="문제 설명" wide><textarea name="summary" rows="4" defaultValue={cluster.summary} /></Field>
        <Field label="판정·배정 근거" wide required><textarea name="reason" rows="4" required placeholder="왜 이 원인이고 왜 이 조직이 책임져야 하는지" /></Field>
      </div>
      <SubmitBar busy={busy} label="원인과 담당 확정" note="우선순위는 고객 25% · 규제 30% · 재발 25% · 비용 20%로 다시 계산합니다." />
    </form>
  )
}

function ExperimentForm({ cluster, busy, onSubmit, onAssist }) {
  if (!cluster) return <Empty title="먼저 반복 문제를 선택해주세요." />
  return (
    <form className="ol-form" onSubmit={(event) => { event.preventDefault(); const values = formObject(event.currentTarget); onSubmit({ ...values, clusterId: cluster.id,
      evaluationPlan: { metricType: values.metricType, rationale: values.sampleRationale, minimumWindowSeconds: Number(values.minimumWindowSeconds),
        minimumSamples: {historical:Number(values.historicalSample),shadow:Number(values.shadowSample),limited:Number(values.limitedSample)},
        datasetVersion:values.datasetVersion,modelVersion:values.modelVersion,policyVersion:values.policyVersion } }) }}>
      <div className="ol-form-context"><span>해결할 문제</span><strong>{cluster.title}</strong><button className="ol-text-button" type="button" onClick={onAssist}>Claude로 초안 만들기</button></div>
      <div className="ol-form-grid">
        <Field label="실험 이름" wide required><input name="title" required placeholder="무엇을 어느 수준까지 바꾸는가" /></Field>
        <Field label="변경 대상" required><input name="changeTarget" required placeholder="모델, 검색 파이프라인, 정책, 업무 절차…" /></Field>
        <Field label="적용 범위" required><input name="scope" required placeholder="대상 고객·업무·트래픽 비율" /></Field>
        <Field label="변경 가설" wide required><textarea name="hypothesis" rows="3" required placeholder="이것을 바꾸면 왜 같은 예외가 줄어드는가" /></Field>
        <Field label="비교 대상" required><input name="comparator" required placeholder="현재 버전 또는 대조군" /></Field>
        <Field label="성공 지표" required><input name="successMetric" required placeholder="동일 원인 수정률" /></Field>
        <Field label="좋아지는 방향"><select name="metricDirection" defaultValue="lower"><option value="lower">낮을수록 좋음</option><option value="higher">높을수록 좋음</option></select></Field>
        <Field label="목표 개선폭(%)"><input name="targetImprovement" type="number" required min="0.1" step="0.1" defaultValue="20" /></Field>
        <Field label="측정값 단위" required><select name="metricType"><option value="rate">비율 (%)</option><option value="count">건수</option><option value="duration">소요 시간</option><option value="amount">금액</option></select></Field>
        {['historical','shadow','limited'].map((phase,index)=><Field key={phase} label={`${EXPERIMENT_PHASES[index].label} 최소 표본`} required><input name={`${phase}Sample`} type="number" min="2" step="1" required /></Field>)}
        <Field label="최소 측정 시간(초)" required><input name="minimumWindowSeconds" type="number" min="1" step="1" required /></Field>
        <Field label="표본·기간 선정 근거" wide required><textarea name="sampleRationale" required placeholder="대상군, 관측 변동성, 허용 오차와 운영 주기를 고려한 이유" /></Field>
        <Field label="데이터셋 버전" required><input name="datasetVersion" required /></Field>
        <Field label="모델·프롬프트 버전" required><input name="modelVersion" required /></Field>
        <Field label="정책 버전" required><input name="policyVersion" required /></Field>
        <Field label="안전 가드레일" wide required hint="줄바꿈 또는 쉼표로 구분"><textarea name="guardrails" rows="3" required defaultValue={'중대한 정책 위반 0건\n승인 없는 고위험 변경 0건'} /></Field>
        <Field label="즉시 중단 조건" wide required><textarea name="stopConditions" rows="3" required defaultValue={'정책 위반 1건\n권한 없는 개인정보 열람 1건'} /></Field>
        <Field label="승인자" required><input name="approver" required placeholder="역할 또는 책임자" /></Field>
        <Field label="위험 수준"><select name="riskLevel" defaultValue="medium"><option value="low">낮음</option><option value="medium">중간</option><option value="high">고위험</option></select></Field>
        <Field label="롤백 방법" wide required><textarea name="rollbackPlan" rows="3" required placeholder="몇 분 안에 어느 버전과 라우팅으로 되돌리는가" /></Field>
      </div>
      <SubmitBar busy={busy} label="실험 카드 생성" note="AI 초안은 저장되지 않습니다. 사람이 확인해 제출한 내용만 실험이 됩니다." />
    </form>
  )
}

function ApproveForm({ experiment, busy, onSubmit }) {
  return (
    <form className="ol-form" onSubmit={(event) => { event.preventDefault(); onSubmit({ ...formObject(event.currentTarget), experimentId: experiment.id }) }}>
      <div className="ol-form-context"><span>{experiment.risk_level === 'high' ? '고위험 변경' : '변경 실험'}</span><strong>{experiment.title}</strong></div>
      <Field label="승인 근거" required><textarea name="basis" rows="6" required placeholder="범위·지표·가드레일·롤백을 검토한 근거" /></Field>
      <SubmitBar busy={busy} label="사람 승인 기록" note={experiment.risk_level === 'high' ? '고위험 실험은 정책·감사·사업 책임자 역할만 승인할 수 있습니다.' : '승인 전에는 실험 결과를 등록할 수 없습니다.'} />
    </form>
  )
}

function RunForm({ experiment, busy, onSubmit }) {
  const completed = new Set(experiment.runs.filter((run) => run.status === 'passed' && run.approval_id === experiment.approval_id && run.change_version === experiment.change_version).map((run) => run.phase))
  const suggested = EXPERIMENT_PHASES.find((phase, index) => index === 0 ? !completed.has(phase.key) : completed.has(EXPERIMENT_PHASES[index - 1].key) && !completed.has(phase.key))?.key ?? 'limited'
  const [phase, setPhase] = useState(suggested)
  return (
    <form className="ol-form" onSubmit={(event) => { event.preventDefault(); const values = formObject(event.currentTarget); onSubmit({ ...values, measurementStart:new Date(values.measurementStart).toISOString(), measurementEnd:new Date(values.measurementEnd).toISOString(), experimentId: experiment.id }) }}>
      <div className="ol-form-context"><span>실험</span><strong>{experiment.title}</strong></div>
      <div className="ol-form-grid">
        <Field label="실행 단계" required><select name="phase" value={phase} onChange={event=>setPhase(event.target.value)}>{EXPERIMENT_PHASES.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></Field>
        <Field label="표본 수" required><input name="sampleSize" type="number" min="0" required /></Field>
        <Field label="대조군 값" required><input name="controlValue" type="number" min="0" step="0.01" required /></Field>
        <Field label="변경군 값" required><input name="variantValue" type="number" min="0" step="0.01" required /></Field>
        <Field label="가드레일 위반 건수" required><input name="guardrailBreaches" type="number" min="0" required /></Field>
        <Field label="기존 업무 비용(원)"><input name="costBefore" type="number" min="0" defaultValue="0" /></Field>
        <Field label="변경 후 비용(원)"><input name="costAfter" type="number" min="0" defaultValue="0" /></Field>
        <Field label={phase === 'historical' ? '재생 대상 데이터 시작 시각' : '측정 시작 시각'} required><input name="measurementStart" type="datetime-local" required /></Field>
        <Field label={phase === 'historical' ? '재생 대상 데이터 종료 시각' : '측정 종료 시각'} required><input name="measurementEnd" type="datetime-local" required /></Field>
        <Field label="원본 실행·데이터 근거" wide required><textarea name="evidenceRefs" required placeholder="원본 실행 ID 또는 검토 가능한 자료 주소 (줄바꿈 구분)" /></Field>
        <Field label="실행 근거·관찰" wide><textarea name="notes" rows="4" placeholder="데이터셋 버전, 트래픽 범위, 예상 밖의 변화" /></Field>
      </div>
      <p className="ol-gate-copy">{phase === 'historical' ? '과거 사건 재생은 대상 데이터의 기간을 기록합니다. 승인 전 데이터도 사용할 수 있습니다.' : 'Shadow·제한 배포는 현재 승인 이후의 실제 측정 기간을 기록합니다. 앞 단계 종료와 다음 단계 시작이 같은 시각인 경우는 허용합니다.'} 입력 시각은 현재 기기 시간대에서 UTC로 변환해 비교합니다.</p>
      <SubmitBar busy={busy} label="결과 판정" note={`목표는 ${experiment.success_metric} ${experiment.target_improvement}% 개선입니다. 위반 1건이면 성과와 관계없이 차단합니다.`} />
    </form>
  )
}

function DecisionForm({ experiment, busy, onSubmit }) {
  const gate = canExpandExperiment(experiment, experiment.runs)
  const rollbackOnly = experiment.status === 'expanded'
  return (
    <form className="ol-form" onSubmit={(event) => { event.preventDefault(); onSubmit({ ...formObject(event.currentTarget), experimentId: experiment.id }) }}>
      <div className={`ol-gate ${gate.ok ? 'ok' : 'blocked'}`}><strong>{rollbackOnly ? '확대 이후 롤백 결정' : gate.ok ? '확대 조건 충족' : '확대 조건 미충족'}</strong><p>{rollbackOnly ? '최초 확대 결정과 근거는 그대로 보존하고, 새 롤백 결정을 추가합니다. 외부 시스템의 배포나 복귀를 실행하지 않습니다.' : gate.ok ? '현재 승인 주기의 수동 입력값이 세 단계의 사전 기준을 충족했습니다. 통계적 유의성이나 실제 배포 완료를 뜻하지 않습니다.' : gate.needsPlan ? '사전 측정 계획 필요' : !gate.stateAllowed ? '현재 상태에서는 확대 불가' : gate.needsApproval ? '현재 시험 주기 승인 기록이 없습니다.' : gate.missing.length ? `${gate.missing.join(' → ')} 결과가 없습니다.` : gate.timingIssues.length ? gate.timingIssues.map(issue=>`${issue.phase} · ${issue.reason}`).join(' / ') : `${gate.blocked.join(' · ')} 단계가 통과하지 못했습니다.`}</p></div>
      <Field label="결정" required><select name="decision" defaultValue={rollbackOnly ? 'rollback' : gate.ok ? 'expand' : 'hold'}>{!rollbackOnly && <><option value="expand" disabled={!gate.ok}>적용 범위 확대</option><option value="hold">보류 및 추가 실험</option><option value="stop">중단</option></>}<option value="rollback">롤백 결정 기록</option></select></Field>
      <Field label="결정 근거" required><textarea name="basis" rows="6" required placeholder="어떤 지표와 안전 근거로 이 결정을 내렸는지" /></Field>
      <SubmitBar busy={busy} label="결정 기록" note="결정 당시의 모든 실험 결과가 스냅샷으로 함께 보존됩니다." />
    </form>
  )
}

function VolumeForm({ data, busy, onSubmit }) {
  return (
    <form className="ol-form" onSubmit={(event) => { event.preventDefault(); onSubmit(formObject(event.currentTarget)) }}>
      <Field label="AI 제품" required><select name="productId" defaultValue={data.products[0]?.id}>{data.products.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
      <div className="ol-form-grid"><Field label="측정일" required><input name="measuredOn" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} /></Field><Field label="고객·업무군" required><input name="segment" required defaultValue="전체" /></Field><Field label="전체 처리 건수" required><input name="totalCases" type="number" min="0" required /></Field><Field label="AI 적용 가능 건수" required><input name="applicableCases" type="number" min="0" required /></Field></div>
      <SubmitBar busy={busy} label="분모 저장" note="수정 건수만으로 비율을 만들지 않습니다. 같은 기간·고객군의 적용 가능 사건 수가 필요합니다." />
    </form>
  )
}

function IntegrationForm({ busy, onSubmit }) {
  return (
    <form className="ol-form" onSubmit={(event) => { event.preventDefault(); onSubmit(formObject(event.currentTarget)) }}>
      <div className="ol-form-grid"><Field label="연동 종류" required><select name="kind" defaultValue="ticket"><option value="mlops">MLOps</option><option value="policy">정책 저장소</option><option value="ticket">업무 티켓</option><option value="evaluation">평가 파이프라인</option><option value="webhook">일반 Webhook</option></select></Field><Field label="연동 이름" required><input name="name" required placeholder="예: Jira AI 개선 보드" /></Field><Field label="HTTPS Endpoint" wide required><input name="endpointUrl" type="url" required placeholder="https://…" /></Field><Field label="Cloudflare 시크릿 바인딩" wide hint="서버 허용 목록에 등록한 전용 환경 변수 이름만"><input name="secretBinding" placeholder="OVERRIDE_INTEGRATION_JIRA_TOKEN" pattern="OVERRIDE_INTEGRATION_[A-Z0-9_]+_TOKEN" /></Field></div>
      <SubmitBar busy={busy} label="연동 설정 저장" note="localhost·사설 IP·HTTP 주소는 서버가 거절합니다. 전송할 때마다 응답 상태를 감사로그에 남깁니다." />
    </form>
  )
}

function ProductForm({ busy, onSubmit }) {
  return (
    <form className="ol-form" onSubmit={(event) => { event.preventDefault(); onSubmit(formObject(event.currentTarget)) }}>
      <div className="ol-form-grid"><Field label="제품 이름" wide required><input name="name" required /></Field><Field label="업무 영역" required><input name="domain" required /></Field><Field label="책임 조직" required><input name="ownerTeam" required /></Field><Field label="모델" required><input name="modelName" required defaultValue="Claude Opus 5" /></Field><Field label="모델 버전" required><input name="modelVersion" required defaultValue="opus-5.0" /></Field><Field label="프롬프트 버전" required><input name="promptVersion" required /></Field><Field label="Agent 버전"><input name="agentVersion" /></Field><Field label="정책 버전" required><input name="policyVersion" required /></Field><Field label="도구 버전"><input name="toolVersion" /></Field><Field label="운영 상태"><select name="status"><option>시험</option><option>운영</option><option>중단</option></select></Field></div>
      <SubmitBar busy={busy} label="AI 제품 등록" note="이후 모든 사건은 여기 저장한 모델·프롬프트·정책 기본 버전을 상속합니다." />
    </form>
  )
}

function ActorForm({ actor, products, busy, onSubmit }) {
  const [active, setActive] = useState(actor ? Boolean(actor.active) : true)
  const [confirmed, setConfirmed] = useState(false)
  const disabling = Boolean(actor?.active && !active)
  return (
    <form className="ol-form" onSubmit={(event) => { event.preventDefault(); if (disabling && !confirmed) return; const form = new FormData(event.currentTarget); const values = Object.fromEntries(form.entries()); onSubmit({ email: values.email, displayName: values.displayName, actorRole: values.actorRole, active, departments: values.departments.split(/[\n,]/).map(value => value.trim()).filter(Boolean), productIds: form.getAll('productIds') }) }}>
      <Field label="Cloudflare Access 메일" required><input name="email" type="email" required defaultValue={actor?.email || ''} readOnly={Boolean(actor)} /></Field>
      <Field label="표시 이름" required><input name="displayName" required defaultValue={actor?.display_name || ''} /></Field>
      <Field label="역할" required><select name="actorRole" defaultValue={actor?.role || 'reviewer'}>{OVERRIDE_ROLES.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></Field>
      <Field label="접근 가능한 부서" hint="등록된 부서명을 쉼표 또는 줄바꿈으로 구분합니다."><textarea name="departments" rows="2" defaultValue={(actor?.departments ?? []).join(', ')} /></Field>
      <fieldset className="ol-scope-products"><legend>접근 가능한 AI 제품</legend>{products.map(product => <label key={product.id}><input type="checkbox" name="productIds" value={product.id} defaultChecked={actor?.product_ids?.includes(product.id)} />{product.name}</label>)}{(actor?.product_ids ?? []).filter(id => !products.some(product => product.id === id)).map(id => <label key={id}><input type="checkbox" name="productIds" value={id} defaultChecked />{id} · 기존 범위</label>)}</fieldset>
      <label className="ol-assignment-filter"><input type="checkbox" checked={active} onChange={event => { setActive(event.target.checked); setConfirmed(false) }} />계정 활성</label>
      {disabling && <label className="ol-disable-confirm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} required />이 계정의 접근을 차단합니다. 기존 업무 기록은 삭제하지 않습니다.</label>}
      <SubmitBar busy={busy} disabled={disabling && !confirmed} label="접근 역할 저장" note="범위가 없는 일반 계정에는 제품·부서 전체 접근을 허용하지 않습니다. 보안·감사 및 사업 책임자 역할은 관리자 권한입니다." />
    </form>
  )
}

function AiDraft({ result, busy }) {
  if (busy) return <div className="ol-ai-wait" role="status"><h3>분석 초안 생성 중…</h3></div>
  if (result?.error) return <div className="ol-ai-error"><strong>초안을 만들지 못했습니다.</strong><p>{result.error}</p></div>
  if (!result) return null
  return (
    <div className="ol-ai-result">
      <div className="ol-ai-meta">
        <span>{result.model}</span>
        <span>{result.prompt_version}</span>
        {result.sensitive_values_redacted && <span>민감정보 삭제 후 전송</span>}
      </div>
      <pre>{JSON.stringify(result.draft, null, 2)}</pre>
      {result.requires_human_confirmation && (
        <p>이 내용은 저장되지 않은 초안입니다. 원본 근거를 확인하고 사람이 입력한 내용만 최종 기록이 됩니다.</p>
      )}
    </div>
  )
}
