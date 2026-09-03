import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client.js'
import { useApi } from '../hooks/useApi.js'
import { useToast } from '../context/ToastContext.jsx'
import {
  CAUSES,
  DECISION_ACTIONS,
  EXPERIMENT_PHASES,
  OVERRIDE_ROLES,
  canExpandExperiment,
  causeByKey,
  priorityBand,
  roleCan,
} from '../../shared/override.js'

const NAV = [
  { key: 'overview', label: '운영판' },
  { key: 'events', label: '판단 사건' },
  { key: 'clusters', label: '반복 문제' },
  { key: 'experiments', label: '개선 실험' },
  { key: 'intelligence', label: '조직 인사이트' },
  { key: 'integrations', label: '연동' },
  { key: 'audit', label: '감사 기록' },
]

const MODAL_TITLES = {
  event: '새 판단 기록',
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
    passed: '통과',
    failed: '미달',
    blocked: '자동 중단',
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
    rolled_back: '롤백',
    expand: '적용 범위 확대',
    hold: '보류',
    stop: '중단',
    rollback: '즉시 롤백',
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
  const [view, setView] = useState(() => window.location.hash.replace('#', '') || 'overview')
  const [role, setRole] = useState(() => localStorage.getItem('override-role') || 'product')
  const [modal, setModal] = useState(null)
  const [busy, setBusy] = useState(false)
  const [aiDraft, setAiDraft] = useState(null)

  useEffect(() => {
    if (!NAV.some((item) => item.key === view)) setView('overview')
    window.location.hash = view
  }, [view])

  useEffect(() => {
    localStorage.setItem('override-role', role)
  }, [role])

  async function mutate(action, payload = {}, success = '저장했습니다.') {
    setBusy(true)
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
      toast.error(mutationError.message)
      return null
    } finally {
      setBusy(false)
    }
  }

  async function askAi(kind, context, entityKind, entityId) {
    setBusy(true)
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
    setModal({ type, entity })
  }

  return (
    <div className="ol-shell">
      <header className="ol-globalbar">
        <button className="ol-wordmark" type="button" onClick={() => setView('overview')}>
          <span className="ol-mark" aria-hidden="true"><span>O</span><span>L</span></span>
          <span>OverrideLoop</span>
        </button>
        <nav className="ol-globalnav" aria-label="OverrideLoop 주요 메뉴">
          {NAV.slice(0, 5).map((item) => (
            <button
              key={item.key}
              type="button"
              className={view === item.key ? 'active' : ''}
              onClick={() => setView(item.key)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="ol-global-actions">
          {data && (
            <span className={`ol-environment ${data.demo_mode ? 'demo' : 'live'}`}>
              <i aria-hidden="true" />
              {data.demo_mode ? '시연 데이터' : '운영 데이터'}
            </span>
          )}
          <label className="ol-role-select">
            <span className="sr-only">시연 역할</span>
            <select value={role} onChange={(event) => setRole(event.target.value)}>
              {OVERRIDE_ROLES.map((item) => (
                <option key={item.key} value={item.key}>{item.label}</option>
              ))}
            </select>
          </label>
          <button className="ol-primary ol-compact" type="button" onClick={() => open('event')}>
            판단 기록
          </button>
        </div>
      </header>

      <div className="ol-layout">
        <aside className="ol-sidebar">
          <div className="ol-side-kicker">AI 운영 시스템</div>
          <nav aria-label="전체 메뉴">
            {NAV.map((item, index) => (
              <button
                key={item.key}
                type="button"
                className={view === item.key ? 'active' : ''}
                onClick={() => setView(item.key)}
              >
                <span className="ol-side-index">{String(index + 1).padStart(2, '0')}</span>
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
          <div className="ol-side-foot">
            <span>일손 · 도입 이전 과정</span>
            <Link to="/portfolio">신청부터 성과까지 보기 →</Link>
          </div>
        </aside>

        <main className="ol-workspace" aria-live="polite">
          {loading && !data && <WorkspaceSkeleton />}
          {error && !data && (
            <ErrorState message={error} onRetry={reload} />
          )}
          {data && (
            <>
              {view === 'overview' && <OverviewView data={data} open={open} go={setView} />}
              {view === 'events' && <EventsView data={data} open={open} askAi={askAi} />}
              {view === 'clusters' && <ClustersView data={data} open={open} askAi={askAi} />}
              {view === 'experiments' && <ExperimentsView data={data} open={open} />}
              {view === 'intelligence' && <IntelligenceView data={data} />}
              {view === 'integrations' && (
                <IntegrationsView data={data} open={open} mutate={mutate} role={role} busy={busy} />
              )}
              {view === 'audit' && <AuditView data={data} open={open} role={role} />}
            </>
          )}
        </main>
      </div>

      <nav className="ol-mobile-nav" aria-label="모바일 메뉴">
        {NAV.slice(0, 5).map((item) => (
          <button
            key={item.key}
            type="button"
            className={view === item.key ? 'active' : ''}
            onClick={() => setView(item.key)}
          >
            <span aria-hidden="true">{NAV.findIndex((nav) => nav.key === item.key) + 1}</span>
            {item.label}
          </button>
        ))}
      </nav>

      {modal && (
        <Modal title={MODAL_TITLES[modal.type]} onClose={() => !busy && setModal(null)}>
          {modal.type === 'event' && (
            <EventForm data={data} busy={busy} onSubmit={(payload) => mutate('capture_event', payload, '판단과 근거를 저장했습니다.')} />
          )}
          {modal.type === 'validate' && (
            <ValidateForm event={modal.entity} busy={busy} onSubmit={(payload) => mutate('validate_event', payload, '사람의 수정 타당성을 기록했습니다.')} />
          )}
          {modal.type === 'cluster' && (
            <ClusterForm cluster={modal.entity} busy={busy} onSubmit={(payload) => mutate('update_cluster', payload, '원인과 책임 조직을 확정했습니다.')} />
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
            <ActorForm busy={busy} onSubmit={(payload) => mutate('save_actor', payload, '접근 역할을 등록했습니다.')} />
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

function PageIntro({ eyebrow, title, copy, actions }) {
  return (
    <header className="ol-page-intro">
      <div>
        <span className="ol-eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        {copy && <p>{copy}</p>}
      </div>
      {actions && <div className="ol-page-actions">{actions}</div>}
    </header>
  )
}

function OverviewView({ data, open, go }) {
  const metrics = data.metrics
  return (
    <div className="ol-page">
      <PageIntro
        eyebrow="Today · AI in production"
        title={<>AI가 틀린 순간을,<br />조직의 다음 결정으로.</>}
        copy="수정 한 건을 학습 데이터로 넘기기 전에, 왜 바뀌었고 조직의 무엇을 고쳐야 하는지 확인합니다."
        actions={
          <>
            <button className="ol-secondary" type="button" onClick={() => go('clusters')}>우선 문제 보기</button>
            <button className="ol-primary" type="button" onClick={() => open('event')}>새 판단 기록</button>
          </>
        }
      />

      <section className="ol-metrics" aria-label="핵심 운영 지표">
        <Metric label="반복 예외율" value={valueOrDash(metrics.recurring_exception_rate, '%')} note={`${metrics.overrides}건 / 적용 가능 사건`} />
        <Metric label="원인 확인" value={valueOrDash(metrics.root_cause_days, '일')} note="최초 발생부터 중앙 흐름" />
        <Metric label="검토 대기" value={`${metrics.pending_validation}건`} note="사람의 수정도 다시 검증" tone={metrics.pending_validation ? 'warning' : undefined} />
        <Metric label="안전 위반" value={`${metrics.guardrail_breaches}건`} note="1건이면 즉시 중단" tone={metrics.guardrail_breaches ? 'danger' : 'success'} />
      </section>

      <details className="ol-metric-details">
        <summary>전체 운영 측정 보기 <span>기록 품질 · 책임 배정 · 실험 전환</span></summary>
        <div className="ol-metric-detail-grid">
          <Metric label="전체 판단" value={`${metrics.total_decisions}건`} note="승인 포함 저장 사건" />
          <Metric label="기록 완결성" value={valueOrDash(metrics.capture_completeness, '%')} note="판단·근거·버전·정책 포함" />
          <Metric label="이유 기록률" value={valueOrDash(metrics.reason_confirmation_rate, '%')} note="수정 근거가 있는 사건" />
          <Metric label="평균 기록 시간" value={valueOrDash(metrics.average_recording_seconds, '초')} note="현업 입력 부담" />
          <Metric label="열린 반복 문제" value={`${metrics.active_clusters}건`} note={`P0 ${metrics.p0_clusters}건`} />
          <Metric label="책임 조직 배정" value={valueOrDash(metrics.assigned_rate, '%')} note="담당 조직이 있는 군집" />
          <Metric label="실험 전환" value={valueOrDash(metrics.experiment_conversion_rate, '%')} note={`현재 실험 ${metrics.in_experiment}건`} />
          <Metric label="검증된 개선" value={`${metrics.verified_improvements}건`} note={`재작업 ${won(metrics.rework_cost_krw)}`} />
        </div>
      </details>

      <section className="ol-loop-card">
        <div className="ol-section-head">
          <div>
            <span className="ol-kicker">One continuous loop</span>
            <h2>판단에서 재측정까지</h2>
          </div>
          <span className="ol-live"><i /> 운영 데이터 연결됨</span>
        </div>
        <div className="ol-loop" role="list" aria-label="OverrideLoop 전체 흐름">
          <LoopStep no="01" label="판단" text="승인 · 수정 · 거절 · 이관" active />
          <LoopStep no="02" label="증거" text="정책 · 모델 · 근거 · 결과" />
          <LoopStep no="03" label="원인" text="군집 · 타당성 · 책임 조직" />
          <LoopStep no="04" label="실험" text="Replay · Shadow · 제한 배포" />
          <LoopStep no="05" label="결정" text="확대 · 보류 · 중단 · 롤백" />
          <LoopStep no="06" label="재측정" text="예외 · 고객 · 비용 · 안전" />
        </div>
      </section>

      <div className="ol-two-col">
        <section className="ol-panel">
          <div className="ol-section-head">
            <div>
              <span className="ol-kicker">Needs a decision</span>
              <h2>지금 봐야 할 문제</h2>
            </div>
            <button className="ol-text-button" type="button" onClick={() => go('clusters')}>전체 보기 →</button>
          </div>
          <div className="ol-priority-list">
            {data.clusters.slice(0, 4).map((cluster) => (
              <button key={cluster.id} type="button" onClick={() => { go('clusters'); window.setTimeout(() => { window.location.hash = `clusters:${cluster.id}` }, 0) }}>
                <PriorityPill score={cluster.priority_score} band={cluster.priority_band} />
                <span className="ol-priority-copy">
                  <strong>{cluster.title}</strong>
                  <small>{causeByKey(cluster.cause_code).label} · {cluster.owner_team}</small>
                </span>
                <span className="ol-priority-number">{Math.round(Number(cluster.priority_score))}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="ol-panel ol-alert-panel">
          <div className="ol-section-head">
            <div>
              <span className="ol-kicker">Guardrails</span>
              <h2>안전 신호</h2>
            </div>
            <span className="ol-count-bubble">{data.alerts.length}</span>
          </div>
          <div className="ol-alert-list">
            {data.alerts.length === 0 && <p className="ol-empty-copy">지금 확인할 안전 신호가 없습니다.</p>}
            {data.alerts.slice(0, 4).map((alert) => (
              <div key={`${alert.entity_id}-${alert.title}`} className={`ol-alert ${alert.level}`}>
                <span className="ol-alert-dot" aria-hidden="true" />
                <div><strong>{alert.title}</strong><p>{alert.body}</p></div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="ol-product-strip">
        <div className="ol-section-head">
          <div>
            <span className="ol-kicker">Across products</span>
            <h2>운영 중인 AI</h2>
          </div>
          <button className="ol-text-button" type="button" onClick={() => open('product')}>제품 추가 +</button>
        </div>
        <div className="ol-product-grid">
          {data.products.map((product) => {
            const count = data.events.filter((event) => event.product_id === product.id && Number(event.is_override)).length
            return (
              <article key={product.id} className="ol-product-card">
                <span className="ol-product-status"><i /> {product.status}</span>
                <h3>{product.name}</h3>
                <p>{product.domain} · {product.owner_team}</p>
                <div><strong>{count}</strong><span>최근 수정 사건</span></div>
                <small>누적 {Number(product.total_cases).toLocaleString('ko-KR')}건 · 적용 가능 {Number(product.applicable_cases).toLocaleString('ko-KR')}건</small>
                <small>{product.model_name} · {product.model_version}</small>
              </article>
            )
          })}
        </div>
      </section>
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

function LoopStep({ no, label, text, active }) {
  return (
    <div className={`ol-loop-step${active ? ' active' : ''}`} role="listitem">
      <span>{no}</span>
      <strong>{label}</strong>
      <small>{text}</small>
    </div>
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
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return data.events.filter((event) => {
      if (product !== 'all' && event.product_id !== product) return false
      if (validity !== 'all' && event.validity !== validity) return false
      if (action !== 'all' && event.decision_action !== action) return false
      if (!needle) return true
      return [event.ai_decision, event.human_decision, event.reason_detail, event.external_ref, event.product_name]
        .join(' ')
        .toLowerCase()
        .includes(needle)
    })
  }, [action, data.events, product, query, validity])

  return (
    <div className="ol-page">
      <PageIntro
        eyebrow="Decision evidence"
        title="판단이 바뀐 순간"
        copy="AI의 원안과 사람의 최종 판단을 버전·정책·업무 결과와 함께 보존합니다. 사람의 수정은 검토 전까지 정답으로 쓰지 않습니다."
        actions={<button className="ol-primary" type="button" onClick={() => open('event')}>판단 기록</button>}
      />

      <div className="ol-toolbar">
        <label className="ol-search"><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="사건·근거·제품 검색" /></label>
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

      <div className="ol-event-list">
        {filtered.map((event) => (
          <article key={event.id} className="ol-event-card">
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
        ))}
        {filtered.length === 0 && <Empty title="조건에 맞는 판단 사건이 없습니다." />}
      </div>
    </div>
  )
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

function ClustersView({ data, open, askAi }) {
  const fromHash = window.location.hash.startsWith('#clusters:') ? window.location.hash.split(':')[1] : null
  const [selectedId, setSelectedId] = useState(fromHash || data.clusters[0]?.id)
  const [query, setQuery] = useState('')
  const selected = data.clusters.find((cluster) => cluster.id === selectedId) ?? data.clusters[0]
  const clusters = data.clusters.filter((cluster) =>
    `${cluster.title} ${cluster.summary} ${cluster.owner_team}`.toLowerCase().includes(query.toLowerCase())
  )
  const related = data.events.filter((event) => event.cluster_id === selected?.id)

  return (
    <div className="ol-page">
      <PageIntro
        eyebrow="Issue clusters"
        title="같은 문제가 반복되는 곳"
        copy="유사한 사건을 묶고 모델 탓인지, 정책·데이터·업무·시스템 문제인지 사람이 최종 판정합니다."
      />
      <div className="ol-split-workspace">
        <section className="ol-master-list">
          <label className="ol-search"><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="반복 문제 검색" /></label>
          <div className="ol-cluster-list">
            {clusters.map((cluster) => (
              <button key={cluster.id} type="button" className={selected?.id === cluster.id ? 'active' : ''} onClick={() => setSelectedId(cluster.id)}>
                <div><PriorityPill score={cluster.priority_score} /><span>{statusLabel(cluster.status)}</span></div>
                <strong>{cluster.title}</strong>
                <p>{causeByKey(cluster.cause_code).label}</p>
                <small>{cluster.recurrence_count}건 · {cluster.owner_team}</small>
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
                <button className="ol-text-button" type="button" onClick={() => askAi('cluster', { cluster: selected, events: related }, 'issue_cluster', selected.id)}>Claude 가설</button>
              </div>
            </div>

            <div className="ol-detail-metrics">
              <Metric label="반복" value={`${selected.recurrence_count}건`} note={`${fmtDate(selected.first_seen_at)} — ${fmtDate(selected.last_seen_at)}`} />
              <Metric label="운영 비용" value={won(selected.operations_cost_krw)} note="연결 사건의 재작업" />
              <Metric label="규제 위험" value={`${selected.regulatory_risk_score}/5`} note="가장 높은 사건 기준" tone={Number(selected.regulatory_risk_score) >= 4 ? 'danger' : undefined} />
            </div>

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
              <div className="ol-section-head"><h3>연결된 판단 사건</h3><span>{related.length}건</span></div>
              <div className="ol-mini-events">
                {related.map((event) => (
                  <div key={event.id}>
                    <Validity value={event.validity} />
                    <strong>{event.product_name}</strong>
                    <p>{event.reason_detail}</p>
                    <small>{fmtDate(event.occurred_at)} · {event.segment}</small>
                  </div>
                ))}
              </div>
            </section>
          </article>
        ) : <Empty title="아직 반복 문제 군집이 없습니다." />}
      </div>
    </div>
  )
}

function ExperimentsView({ data, open }) {
  const [selectedId, setSelectedId] = useState(data.experiments[0]?.id)
  const selected = data.experiments.find((experiment) => experiment.id === selectedId) ?? data.experiments[0]
  const cluster = data.clusters.find((item) => item.id === selected?.cluster_id)
  const gate = selected ? canExpandExperiment(selected, selected.runs) : null

  return (
    <div className="ol-page">
      <PageIntro
        eyebrow="Safe change experiments"
        title="배포 전에 틀릴 기회"
        copy="과거 사건 재생, Shadow Test, 제한 배포를 차례로 통과해야 합니다. 가드레일이 한 건이라도 깨지면 자동으로 멈춥니다."
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
                const run = [...selected.runs].reverse().find((item) => item.phase === phase.key)
                return (
                  <div key={phase.key} className={`ol-phase ${run?.status ?? ''}`}>
                    <span>{run ? (run.status === 'passed' ? '✓' : '!') : index + 1}</span>
                    <strong>{phase.label}</strong>
                    <small>{run ? `${runLabel(run.status)} · ${run.improvement_percent}%` : '아직 실행 전'}</small>
                  </div>
                )
              })}
            </div>

            <div className="ol-experiment-grid">
              <section><span>변경 대상</span><p>{selected.change_target}</p></section>
              <section><span>비교 대상</span><p>{selected.comparator}</p></section>
              <section><span>성공 지표</span><p>{selected.success_metric} · {selected.target_improvement}% 개선</p></section>
              <section><span>적용 범위</span><p>{selected.scope}</p></section>
            </div>

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
                    <small>
                      {decision.metrics_snapshot.runs?.length ?? 0}개 단계 · 실험 {decision.experiment_id}
                    </small>
                  </article>
                ))}
              </section>
            )}

            <div className="ol-card-actions ol-experiment-actions">
              {!selected.approved_at && <button className="ol-secondary" type="button" onClick={() => open('approve', selected)}>사람 승인</button>}
              <button className="ol-primary" type="button" onClick={() => open('run', selected)}>실험 결과 입력</button>
              <button className="ol-secondary" type="button" onClick={() => open('decision', selected)}>최종 결정</button>
            </div>
            {gate && !gate.ok && (
              <p className="ol-gate-copy">확대 전 확인 · {gate.needsApproval ? '고위험 승인 필요' : gate.missing.length ? `${gate.missing.join(' → ')} 필요` : `${gate.blocked.join(' · ')} 재검토 필요`}</p>
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
        eyebrow="Organization intelligence"
        title="한 제품 밖에서 보이는 것"
        copy="정책 영향, 고객군 격차, 제품 간 공통 원인과 투자 우선순위를 같은 증거 위에서 봅니다."
        actions={<button className="ol-secondary" type="button" onClick={downloadDataset}>검증된 모델 오류 내보내기</button>}
      />

      <div className="ol-insight-grid">
        <section className="ol-panel ol-span-2">
          <div className="ol-section-head"><div><span className="ol-kicker">Fairness</span><h2>고객군별 수정률</h2></div><span>분모가 있는 값만 계산</span></div>
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
          <div className="ol-section-head"><div><span className="ol-kicker">Policy scenario</span><h2>정책 변경 영향</h2></div></div>
          <select className="ol-wide-select" value={policy} onChange={(event) => setPolicy(event.target.value)}>
            {data.policy_impact.map((item) => <option key={item.policy} value={item.policy}>{item.policy}</option>)}
          </select>
          {scenario ? (
            <div className="ol-scenario-result"><strong>{scenario.events}건</strong><p>{scenario.products}개 AI 제품 · 고위험 {scenario.high_risk}건</p><span>연결 재작업 {won(scenario.cost_krw)}</span></div>
          ) : <Empty title="연결된 정책이 없습니다." />}
        </section>

        <section className="ol-panel">
          <div className="ol-section-head"><div><span className="ol-kicker">Shared failures</span><h2>제품을 가로지른 원인</h2></div></div>
          <div className="ol-common-list">
            {data.common_issues.map((issue) => (
              <div key={issue.cause_code}><strong>{issue.cause_label}</strong><span>{issue.events}건</span><p>{issue.products.join(' · ')}</p></div>
            ))}
            {data.common_issues.length === 0 && <p className="ol-empty-copy">두 제품 이상에서 확인된 공통 원인이 없습니다.</p>}
          </div>
        </section>

        <section className="ol-panel ol-span-2">
          <div className="ol-section-head"><div><span className="ol-kicker">Decision graph</span><h2>판단 그래프</h2></div><span>{data.graph.nodes.length}개 노드 · {data.graph.edges.length}개 연결</span></div>
          <DecisionGraph data={data} />
        </section>

        <section className="ol-panel">
          <div className="ol-section-head"><div><span className="ol-kicker">Investment</span><h2>개선 투자 순서</h2></div></div>
          <ol className="ol-invest-list">
            {data.clusters.slice(0, 5).map((cluster, index) => (
              <li key={cluster.id}><span>{index + 1}</span><div><strong>{cluster.title}</strong><small>{cluster.owner_team}</small></div><b>{Math.round(cluster.priority_score)}</b></li>
            ))}
          </ol>
        </section>

        <section className="ol-panel">
          <div className="ol-section-head"><div><span className="ol-kicker">Leading signals</span><h2>새 예외·증가 신호</h2></div></div>
          <div className="ol-signal-list">
            {data.clusters.map((cluster) => (
              <div key={cluster.id}><span className={`ol-trend ${cluster.trend.direction}`}>{cluster.trend.direction === 'surge' ? '↑' : cluster.trend.direction === 'down' ? '↓' : cluster.trend.direction === 'new' ? 'NEW' : '–'}</span><p>{cluster.title}</p><strong>{cluster.trend.change > 0 ? '+' : ''}{cluster.trend.change}%</strong></div>
            ))}
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
        eyebrow="Connected operations"
        title="기존 업무 안에서 연결"
        copy="새 화면으로 복사하지 않고 판단 사건을 API로 받고, 검증된 개선 과제만 기존 시스템으로 돌려보냅니다. 시크릿 값은 저장하지 않고 Cloudflare 바인딩 이름만 보관합니다."
        actions={<button className="ol-primary" type="button" onClick={() => open('integration')}>연동 추가</button>}
      />
      <div className="ol-integration-catalog">
        {catalog.map((item) => (
          <article key={item.kind}><span className={`ol-integration-icon ${item.kind}`}>{item.title.slice(0, 1)}</span><h2>{item.title}</h2><p>{item.copy}</p><button className="ol-text-button" type="button" onClick={() => open('integration', item)}>연결 설정 →</button></article>
        ))}
      </div>

      <section className="ol-panel">
        <div className="ol-section-head"><div><span className="ol-kicker">Configured</span><h2>연결된 시스템</h2></div><span>{data.integrations.length}개</span></div>
        <div className="ol-connected-list">
          {data.integrations.map((integration) => (
            <div key={integration.id}><span className={`ol-connection-state ${integration.status}`}><i />{integration.status}</span><div><strong>{integration.name}</strong><p>{integration.kind} · {integration.endpoint_url}</p><small>{integration.last_sync_at ? `${fmtDate(integration.last_sync_at, true)} · ${integration.last_result}` : '아직 동기화하지 않음'}</small></div><button className="ol-secondary ol-compact" type="button" disabled={busy || !roleCan(role, 'sync_integration')} onClick={() => mutate('sync_integration', { integrationId: integration.id }, '연동 자료를 전송했습니다.')}>지금 동기화</button></div>
          ))}
          {data.integrations.length === 0 && <Empty title="아직 연결한 외부 시스템이 없습니다." />}
        </div>
      </section>

      <section className="ol-api-card">
        <div><span className="ol-kicker">Inbound API</span><h2>업무 화면에서 자동 수집</h2><p>직원이 기존 도구에서 수정·거절·이관하는 순간 같은 스키마로 전송합니다. 외부 사건 번호는 중복 저장을 막습니다.</p></div>
        <pre>{`POST /api/override
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
  return (
    <div className="ol-page">
      <PageIntro
        eyebrow="Immutable evidence trail"
        title="누가, 무엇을, 왜"
        copy="사건 검토, 원인 확정, 실험 승인, 배포 결정과 외부 전송을 하나의 감사 흐름으로 남깁니다."
        actions={roleCan(role, 'save_actor') ? <button className="ol-secondary" type="button" onClick={() => open('actor')}>접근 역할 등록</button> : null}
      />
      <div className="ol-audit-summary">
        <Metric label="감사 사건" value={`${data.audit.length}건`} note="최근 160건 표시" />
        <Metric label="Claude 호출" value={`${data.ai_calls.length}건`} note="모델·프롬프트·토큰 기록" />
        <Metric label="고위험 무승인 확대" value="0건" note="서버 게이트가 차단" tone="success" />
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
  return <div className="ol-empty"><span aria-hidden="true">○</span><p>{title}</p></div>
}

function Modal({ title, onClose, children }) {
  useEffect(() => {
    function keydown(event) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', keydown)
    document.body.classList.add('ol-modal-open')
    return () => {
      document.removeEventListener('keydown', keydown)
      document.body.classList.remove('ol-modal-open')
    }
  }, [onClose])
  return (
    <div className="ol-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="ol-modal" role="dialog" aria-modal="true" aria-labelledby="ol-modal-title">
        <header><div><span>OverrideLoop</span><h2 id="ol-modal-title">{title}</h2></div><button type="button" onClick={onClose} aria-label="닫기">×</button></header>
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

function SubmitBar({ busy, label, note }) {
  return (
    <div className="ol-submit-bar">
      {note && <p>{note}</p>}
      <button className="ol-primary" type="submit" disabled={busy}>{busy ? '저장 중…' : label}</button>
    </div>
  )
}

function EventForm({ data, busy, onSubmit }) {
  return (
    <form className="ol-form" onSubmit={(event) => { event.preventDefault(); onSubmit(formObject(event.currentTarget)) }}>
      <div className="ol-form-grid">
        <Field label="AI 제품" name="productId" required><select name="productId" required defaultValue={data.products[0]?.id}>{data.products.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
        <Field label="직원의 최종 판단" name="decisionAction" required><select name="decisionAction" required defaultValue="modify">{DECISION_ACTIONS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></Field>
        <Field label="외부 사건 번호" name="externalRef" hint="같은 번호의 중복 수집을 막습니다."><input name="externalRef" placeholder="예: CRM-20491" /></Field>
        <Field label="고객·업무군" name="segment"><input name="segment" placeholder="예: 신혼특례" /></Field>
        <Field label="AI의 원래 판단" name="aiDecision" wide required><textarea name="aiDecision" rows="3" required placeholder="AI가 답변·추천·실행하려던 내용을 원문 그대로" /></Field>
        <Field label="사람의 최종 판단" name="humanDecision" wide required><textarea name="humanDecision" rows="3" required placeholder="수정·거절·이관 후 실제로 확정한 내용" /></Field>
        <Field label="수정 이유" name="reasonDetail" wide required><textarea name="reasonDetail" rows="3" required placeholder="당시 확인한 근거와 달랐던 점" /></Field>
        <Field label="바뀐 항목" name="changedFields" hint="쉼표로 구분"><input name="changedFields" placeholder="요구 서류, 답변 표현" /></Field>
        <Field label="정책·내규 원문" name="policyRefs" hint="쉼표로 구분"><input name="policyRefs" placeholder="대출내규-2026.08-14" /></Field>
        <Field label="모델 버전" name="modelVersion"><input name="modelVersion" placeholder="비우면 제품 기본 버전" /></Field>
        <Field label="프롬프트 버전" name="promptVersion"><input name="promptVersion" placeholder="비우면 제품 기본 버전" /></Field>
        <Field label="Agent 버전" name="agentVersion"><input name="agentVersion" /></Field>
        <Field label="업무 도구 버전" name="toolVersion"><input name="toolVersion" /></Field>
        <Field label="참고 데이터·문서" name="dataRefs"><input name="dataRefs" placeholder="CRM 상태, 검색 문서" /></Field>
        <Field label="실행 도구" name="tools"><input name="tools" placeholder="CRM, 정책 검색" /></Field>
        <Field label="고객 영향" name="customerImpact"><select name="customerImpact" defaultValue="3">{[0,1,2,3,4,5].map((n) => <option key={n} value={n}>{n} / 5</option>)}</select></Field>
        <Field label="규제 위험" name="regulatoryRisk"><select name="regulatoryRisk" defaultValue="3">{[0,1,2,3,4,5].map((n) => <option key={n} value={n}>{n} / 5</option>)}</select></Field>
        <Field label="재작업 비용(원)" name="operationsCost"><input name="operationsCost" type="number" min="0" defaultValue="0" /></Field>
        <Field label="기록 시간(초)" name="recordingSeconds"><input name="recordingSeconds" type="number" min="0" max="3600" defaultValue="20" /></Field>
        <Field label="실제 고객 결과" name="customerOutcome" wide><textarea name="customerOutcome" rows="2" placeholder="재문의, 사후 정정, 민원 또는 해결 결과" /></Field>
        <Field label="실제 업무 결과" name="businessOutcome" wide><textarea name="businessOutcome" rows="2" placeholder="재작업 시간, 비용, 처리 결과" /></Field>
      </div>
      <SubmitBar busy={busy} label="판단 증거 저장" note="저장 직후 유사 사건을 검색해 군집 후보와 원인 후보를 만듭니다." />
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

function ClusterForm({ cluster, busy, onSubmit }) {
  return (
    <form className="ol-form" onSubmit={(event) => { event.preventDefault(); onSubmit({ ...formObject(event.currentTarget), clusterId: cluster.id }) }}>
      <div className="ol-form-grid">
        <Field label="문제 이름" wide><input name="title" defaultValue={cluster.title} /></Field>
        <Field label="최종 원인" required><select name="causeCode" defaultValue={cluster.cause_code}>{CAUSES.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></Field>
        <Field label="판정 상태"><select name="causeStatus" defaultValue={cluster.cause_status}><option value="candidate">후보</option><option value="confirmed">사람이 확정</option><option value="disputed">이견 있음</option></select></Field>
        <Field label="책임 조직" required><input name="ownerTeam" defaultValue={cluster.owner_team} required /></Field>
        <Field label="처리 상태"><select name="status" defaultValue={cluster.status}><option value="open">원인 검토</option><option value="experiment">실험 설계</option><option value="monitoring">재발 측정</option><option value="resolved">해결</option><option value="accepted_exception">정당한 예외</option></select></Field>
        <Field label="고객 영향"><select name="customerImpact" defaultValue={cluster.customer_impact_score}>{[0,1,2,3,4,5].map((n) => <option key={n} value={n}>{n} / 5</option>)}</select></Field>
        <Field label="규제 위험"><select name="regulatoryRisk" defaultValue={cluster.regulatory_risk_score}>{[0,1,2,3,4,5].map((n) => <option key={n} value={n}>{n} / 5</option>)}</select></Field>
        <Field label="운영 비용(원)"><input type="number" name="operationsCost" min="0" defaultValue={cluster.operations_cost_krw} /></Field>
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
    <form className="ol-form" onSubmit={(event) => { event.preventDefault(); onSubmit({ ...formObject(event.currentTarget), clusterId: cluster.id }) }}>
      <div className="ol-form-context"><span>해결할 문제</span><strong>{cluster.title}</strong><button className="ol-text-button" type="button" onClick={onAssist}>Claude로 초안 만들기</button></div>
      <div className="ol-form-grid">
        <Field label="실험 이름" wide required><input name="title" required placeholder="무엇을 어느 수준까지 바꾸는가" /></Field>
        <Field label="변경 대상" required><input name="changeTarget" required placeholder="모델, 검색 파이프라인, 정책, 업무 절차…" /></Field>
        <Field label="적용 범위" required><input name="scope" required placeholder="대상 고객·업무·트래픽 비율" /></Field>
        <Field label="변경 가설" wide required><textarea name="hypothesis" rows="3" required placeholder="이것을 바꾸면 왜 같은 예외가 줄어드는가" /></Field>
        <Field label="비교 대상" required><input name="comparator" required placeholder="현재 버전 또는 대조군" /></Field>
        <Field label="성공 지표" required><input name="successMetric" required placeholder="동일 원인 수정률" /></Field>
        <Field label="좋아지는 방향"><select name="metricDirection" defaultValue="lower"><option value="lower">낮을수록 좋음</option><option value="higher">높을수록 좋음</option></select></Field>
        <Field label="목표 개선폭(%)"><input name="targetImprovement" type="number" min="0" step="0.1" defaultValue="20" /></Field>
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
      <SubmitBar busy={busy} label="사람 승인 기록" note={experiment.risk_level === 'high' ? '고위험 실험은 정책·감사·사업 책임자 역할만 승인할 수 있습니다.' : '승인 전에는 어떤 실험 단계도 실행할 수 없습니다.'} />
    </form>
  )
}

function RunForm({ experiment, busy, onSubmit }) {
  const completed = new Set(experiment.runs.filter((run) => run.status === 'passed').map((run) => run.phase))
  const suggested = EXPERIMENT_PHASES.find((phase, index) => index === 0 ? !completed.has(phase.key) : completed.has(EXPERIMENT_PHASES[index - 1].key) && !completed.has(phase.key))?.key ?? 'limited'
  return (
    <form className="ol-form" onSubmit={(event) => { event.preventDefault(); onSubmit({ ...formObject(event.currentTarget), experimentId: experiment.id }) }}>
      <div className="ol-form-context"><span>실험</span><strong>{experiment.title}</strong></div>
      <div className="ol-form-grid">
        <Field label="실행 단계" required><select name="phase" defaultValue={suggested}>{EXPERIMENT_PHASES.map((phase) => <option key={phase.key} value={phase.key}>{phase.label}</option>)}</select></Field>
        <Field label="표본 수" required><input name="sampleSize" type="number" min="0" defaultValue="100" required /></Field>
        <Field label="대조군 값" required><input name="controlValue" type="number" step="0.01" defaultValue="10" required /></Field>
        <Field label="변경군 값" required><input name="variantValue" type="number" step="0.01" defaultValue="7" required /></Field>
        <Field label="가드레일 위반 건수" required><input name="guardrailBreaches" type="number" min="0" defaultValue="0" required /></Field>
        <Field label="기존 업무 비용(원)"><input name="costBefore" type="number" min="0" defaultValue="0" /></Field>
        <Field label="변경 후 비용(원)"><input name="costAfter" type="number" min="0" defaultValue="0" /></Field>
        <Field label="실행 근거·관찰" wide><textarea name="notes" rows="4" placeholder="데이터셋 버전, 트래픽 범위, 예상 밖의 변화" /></Field>
      </div>
      <SubmitBar busy={busy} label="결과 판정" note={`목표는 ${experiment.success_metric} ${experiment.target_improvement}% 개선입니다. 위반 1건이면 성과와 관계없이 차단합니다.`} />
    </form>
  )
}

function DecisionForm({ experiment, busy, onSubmit }) {
  const gate = canExpandExperiment(experiment, experiment.runs)
  return (
    <form className="ol-form" onSubmit={(event) => { event.preventDefault(); onSubmit({ ...formObject(event.currentTarget), experimentId: experiment.id }) }}>
      <div className={`ol-gate ${gate.ok ? 'ok' : 'blocked'}`}><strong>{gate.ok ? '확대 조건 충족' : '확대 조건 미충족'}</strong><p>{gate.ok ? '세 단계와 모든 가드레일을 통과했습니다.' : gate.needsApproval ? '고위험 승인 기록이 없습니다.' : gate.missing.length ? `${gate.missing.join(' → ')} 결과가 없습니다.` : `${gate.blocked.join(' · ')} 단계가 통과하지 못했습니다.`}</p></div>
      <Field label="결정" required><select name="decision" defaultValue={gate.ok ? 'expand' : 'hold'}><option value="expand" disabled={!gate.ok}>적용 범위 확대</option><option value="hold">보류 및 추가 실험</option><option value="stop">중단</option><option value="rollback">즉시 롤백</option></select></Field>
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
      <div className="ol-form-grid"><Field label="연동 종류" required><select name="kind" defaultValue="ticket"><option value="mlops">MLOps</option><option value="policy">정책 저장소</option><option value="ticket">업무 티켓</option><option value="evaluation">평가 파이프라인</option><option value="webhook">일반 Webhook</option></select></Field><Field label="연동 이름" required><input name="name" required placeholder="예: Jira AI 개선 보드" /></Field><Field label="HTTPS Endpoint" wide required><input name="endpointUrl" type="url" required placeholder="https://…" /></Field><Field label="Cloudflare 시크릿 바인딩" wide hint="토큰 값이 아니라 환경 변수 이름만"><input name="secretBinding" placeholder="OVERRIDE_JIRA_TOKEN" pattern="[A-Z][A-Z0-9_]{2,99}" /></Field></div>
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

function ActorForm({ busy, onSubmit }) {
  return (
    <form className="ol-form" onSubmit={(event) => { event.preventDefault(); onSubmit(formObject(event.currentTarget)) }}>
      <Field label="Cloudflare Access 메일" required><input name="email" type="email" required /></Field><Field label="표시 이름" required><input name="displayName" required /></Field><Field label="역할" required><select name="actorRole">{OVERRIDE_ROLES.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></Field>
      <SubmitBar busy={busy} label="접근 역할 저장" note="실서비스에서 OVERRIDE_DEMO_MODE=false로 두면 Access 인증 메일과 이 역할이 일치해야만 쓸 수 있습니다." />
    </form>
  )
}

function AiDraft({ result, busy }) {
  if (busy) return <div className="ol-ai-wait"><span className="ol-ai-pulse" /><h3>근거를 나누어 보고 있습니다.</h3><p>사람의 수정도 틀릴 수 있다는 전제로 반증 근거까지 찾습니다.</p></div>
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
