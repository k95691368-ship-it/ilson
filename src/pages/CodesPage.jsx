import { useReducer, useRef, useSyncExternalStore } from 'react'
import { useApi } from '../hooks/useApi.js'
import { useToast } from '../context/ToastContext.jsx'
import { api } from '../api/client.ts'
import { ago, dateTimeLabel, num } from '../lib/format.js'
import Field from '../components/Field.jsx'
import { getAccessSession, subscribeAccessSession } from '../lib/accessSession.js'
import { useActionLifetime } from '../hooks/useActionLifetime.js'

const VERSION = /^[a-f0-9]{64}$/
const REVIEW_REASON = {
  origin_unavailable: '현재 접근 가능한 기록에서 관련 업무 근거를 확인하지 못했습니다.',
  origin_ambiguous: '여러 업무의 근거가 연결되어 있어 이 화면에서 변경할 수 없습니다.',
  origin_unknown_admin: '업무 출처가 연결되지 않은 기록입니다. 관리자 확인으로 남깁니다.',
  not_authorized: '현재 계정에는 코드 검토 권한이 없습니다.',
  invalid_mapping: '상품 연결 정보를 확인하지 못했습니다.',
}

export function isCodeReviewResult(value, payload) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && value.ok === true
    && typeof value.id === 'string' && value.id.length > 0
    && value.action === payload.action && value.externalCode === payload.externalCode
    && value.canonicalCode === payload.expectedCanonical
    && (value.productName === undefined || typeof value.productName === 'string')
    && (value.author === undefined || typeof value.author === 'string'))
}

// 알려 준 상품코드.
//
// 부서가 "이 코드는 이 상품입니다"를 알려주면 다음 실행부터 그대로 쓰입니다.
// 편하지만 위험합니다 — 코드 하나를 잘못 이어 두면 그 코드로 팔린 것이
// 전부 엉뚱한 상품 매출로 잡힙니다. 금액이 틀리는데 아무도 안 틀렸다고
// 생각합니다. 격리된 줄은 눈에 띄지만 잘못 이어진 줄은 조용히 섞입니다.
//
// 그렇다고 승인을 받아야 쓰이게 하면 부서가 며칠씩 기다리게 되고, 그러면
// 알려주지 않습니다. 바로 쓰되 여기 쌓아 두고 나중에 훑어봅니다.
export default function CodesPage() {
  const session = useSyncExternalStore(subscribeAccessSession, getAccessSession, getAccessSession)
  const { data, error, loading, reload } = useApi('/codes')

  if (error && !data) return <div className="notice notice-danger">{error}</div>
  if (loading && !data) return <div className="page-loading">불러오는 중…</div>
  if (!data) return null

  const s = data.summary

  return (
    <div className="stack">
      {error && <div className="notice notice-danger" role="status">최신 목록을 불러오지 못했습니다. {error}</div>}
      <header className="page-head">
        <h1>상품코드 관리</h1>
        <p className="page-sub">
          다음 계산에 적용됩니다. 원본과 상품 연결을 확인해 주세요.
        </p>
      </header>

      <section className="stat-row">
        <Tile label="조회된 코드" value={num(s.total)} note="현재 목록 · 최대 500개" />
        <Tile
          label="현재 연결 미확인"
          value={num(s.needsCheck)}
          note={s.needsCheck > 0 ? '현재 연결의 확인 근거가 필요합니다' : '현재 목록에서 미확인 항목 없음'}
          warn={s.needsCheck > 0}
        />
        <Tile label="정정한 것" value={num(s.corrected)} note="잘못 이어져 있던 것" />
      </section>

      {data.codes.length === 0 ? (
        <div className="empty">
          <div className="empty-title">아직 이어 둔 코드가 없습니다</div>
          <div className="empty-sub">
            도구가 모르는 상품코드를 만나면 그 줄을 밀어 둡니다. 부서가 도구 화면에서 어느
            상품인지 알려주면 여기에 쌓입니다.
          </div>
        </div>
      ) : (
        <ul className="code-list">
          {data.codes.map((c) => (
            <CodeRow key={`${session.generation}:${c.external_code}`} code={c} catalog={data.catalog} onChanged={reload} session={session} refreshing={loading} />
          ))}
        </ul>
      )}
    </div>
  )
}

function CodeRow({ code, catalog, onChanged, session, refreshing }) {
  const toast = useToast()
  const [, redraw] = useReducer(value => value + 1, 0)
  const lifetime = useRef(null)
  if (!lifetime.current || lifetime.current.session !== session || lifetime.current.version !== code.edit_version) {
    const previous = lifetime.current?.session === session ? lifetime.current : null
    lifetime.current = { session, version: code.edit_version, mode: previous?.mode ?? null,
      form: previous?.form ?? { canonicalCode: '', why: '', author: 'AX 담당자' },
      fieldErrors: {}, saving: false, done: null, error: '', conflict: false, refreshError: '' }
  }
  const view = lifetime.current
  const { mode, form, fieldErrors, saving, done } = view
  const capture = useActionLifetime(view)
  const current = () => lifetime.current === view && getAccessSession() === session && session.status === 'active'
  const update = change => { if (current()) { Object.assign(view, change); redraw() } }
  const edit = (name, value) => update({ form: { ...view.form, [name]: value } })
  const available = code.review_available === true && VERSION.test(code.edit_version ?? '')
  const disabled = saving || Boolean(done) || !available || refreshing

  async function act(action) {
    if (!current() || view.saving || view.done || !available || refreshing) return
    const active = capture()
    const payload = { externalCode: code.external_code, action, expectedVersion: code.edit_version,
      ...(action === 'correct' ? { canonicalCode: view.form.canonicalCode, why: view.form.why } : {}),
      ...(session.mode === 'demo' ? { author: view.form.author } : {}) }
    const expected = { ...payload, expectedCanonical: action === 'correct' ? payload.canonicalCode : code.canonical_code }
    // Lock before rendering, hashing or fetch; two same-tick submits share no work.
    update({ saving: true, fieldErrors: {}, error: '', conflict: false, refreshError: '' })
    try {
      const result = await api.post('/codes', payload, { validateResponse: value => isCodeReviewResult(value, expected) })
      if (!active() || !current()) return
      update({ saving: false, done: result, mode: null })
      toast.success(action === 'confirm' ? '확인했다고 남겼습니다.' : '바꾸고 기록에 남겼습니다.')
    } catch (err) {
      if (!active() || !current()) return
      update({ saving: false, fieldErrors: err.fields ?? {}, error: err.message, conflict: err.status === 409 })
      toast.error(err.message)
      return
    }
    // A failed refresh never changes a confirmed write back into a failed write.
    try { await onChanged() } catch {
      if (!active() || !current()) return
      update({ refreshError: '이 요청은 저장됐지만 최신 목록을 불러오지 못했습니다.' })
    }
  }

  async function refresh() {
    if (!current() || view.saving || refreshing) return
    const active = capture()
    try { await onChanged() } catch {
      if (active() && current()) update({ refreshError: '최신 연결을 불러오지 못했습니다. 작성 내용은 유지됩니다.' })
    }
  }

  return (
    <li className={`code-row${code.needsCheck ? ' needs' : ''}`}>
      <div className="row" style={{ marginBottom: 6 }}>
        {code.needsCheck && <span className="badge badge-danger">확인 안 함</span>}
        {code.staleCheck && <span className="badge badge-warning">확인 뒤에 또 바뀜</span>}
        {code.corrections.length > 0 && (
          <span className="badge badge-neutral">정정 {code.corrections.length}번</span>
        )}
        <span className="spacer" />
        <span className="card-note" title={dateTimeLabel(code.created_at)}>
          {ago(code.created_at)} · {code.taught_by}
        </span>
      </div>

      <div className="code-map">
        <span className="mono code-ext">{code.external_code}</span>
        <span className="code-arrow" aria-hidden="true">
          →
        </span>
        <span className="code-canon">
          {code.product_name}
          <span className="mono card-note"> {code.canonical_code}</span>
        </span>
      </div>

      {code.confirmed?.verified === true && !code.staleCheck && (
        <p className="card-note code-confirmed">
          {code.confirmed.by}가 {ago(code.confirmed.at)} 확인했습니다
        </p>
      )}
      {code.confirmed && code.confirmed.verified !== true && <p className="card-note">과거 확인 기록 · 현재 연결의 확인 근거는 아닙니다.</p>}
      {code.review_reason && <p className="card-note">{REVIEW_REASON[code.review_reason] ?? '코드 검토 상태를 확인하지 못했습니다.'}</p>}
      {!available && !code.review_reason && <p className="card-note">최신 연결 정보를 확인한 뒤 검토해주세요.</p>}
      {view.error && <p className="card-note" role="alert">{view.error}</p>}
      {(view.conflict || view.refreshError) && <div className="row">
        {view.refreshError && <p className="card-note" role="status">{view.refreshError}</p>}
        <button type="button" className="btn-ghost btn-sm" disabled={saving || refreshing} onClick={refresh}>최신 연결 확인</button>
      </div>}
      {done && <p className="card-note code-confirmed" role="status">
        이 요청을 기록했습니다: {done.externalCode} → {done.productName ?? done.canonicalCode}
        {done.author && ` · 기록된 작성자: ${done.author}`}
      </p>}

      {code.corrections.length > 0 && (
        <details className="code-history">
          <summary>정정 이력 {code.corrections.length}건</summary>
          <ul>
            {code.corrections.map((f, i) => (
              <li key={i}>
                <div>{f.what}</div>
                {/* 과거 결과는 바꾸지 않는다. 새 재계산의 변경 근거를 남긴다. */}
                <div className="card-note">
                  {f.why} — {f.by}, {ago(f.at)}
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}

      {mode === null && !done && available && (
        <div className="row code-actions">
          {code.needsCheck && (
            <button
              type="button"
              className="btn-primary btn-sm"
              disabled={disabled}
              onClick={() => act('confirm')}
            >
              맞습니다
            </button>
          )}
          <button type="button" className="btn-ghost btn-sm" disabled={disabled} onClick={() => update({ mode: 'correct' })}>
            다른 상품이었습니다
          </button>
        </div>
      )}

      {mode === 'correct' && !done && (
        <form
          className="thread-form"
          onSubmit={(e) => {
            e.preventDefault()
            act('correct')
          }}
        >
          <Field label="어느 상품이었습니까" required error={fieldErrors.canonicalCode}>
            <select
              value={form.canonicalCode}
              disabled={disabled}
              onChange={(e) => edit('canonicalCode', e.target.value)}
            >
              <option value="">골라주세요</option>
              {catalog.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name} ({s.code})
                </option>
              ))}
            </select>
          </Field>
          <Field label="왜 바꾸십니까" required error={fieldErrors.why}>
            <textarea
              rows={2}
              value={form.why}
              disabled={disabled}
              maxLength={2000}
              onChange={(e) => edit('why', e.target.value)}
              placeholder="이름이 비슷한 다른 상품이었습니다. 원본 주문서와 맞춰 봤습니다."
            />
          </Field>
          <div className="row">
            <button type="submit" className="btn-primary btn-sm" disabled={disabled}>
              {saving ? '바꾸는 중…' : '바꾸고 기록에 남기기'}
            </button>
            <button type="button" className="btn-ghost btn-sm" disabled={saving} onClick={() => update({ mode: null })}>
              그만두기
            </button>
            <span className="spacer" />
            <span className="card-note">이후 재계산 결과에 영향을 줍니다</span>
          </div>
        </form>
      )}
    </li>
  )
}

function Tile({ label, value, note, warn }) {
  return (
    <div className={`stat-tile${warn ? ' held' : ''}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      <div className="stat-note">{note}</div>
    </div>
  )
}
