import { useState } from 'react'
import { useApi } from '../hooks/useApi.js'
import { useToast } from '../context/ToastContext.jsx'
import { api } from '../api/client.js'
import { ago, dateTimeLabel, num } from '../lib/format.js'

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
  const { data, error, loading, reload } = useApi('/codes')

  if (error) return <div className="notice notice-danger">{error}</div>
  if (loading && !data) return <div className="page-loading">불러오는 중…</div>
  if (!data) return null

  const s = data.summary

  return (
    <div className="stack">
      <header className="page-head">
        <span className="page-eyebrow">제작</span>
        <h1>알려 준 상품코드</h1>
        <p className="page-sub">
          채널마다 상품코드를 제멋대로 붙입니다. 그걸 우리 표준코드에 이어 두면 다음부터 저절로
          처리됩니다. <strong>코드 하나를 잘못 이으면 그 코드로 팔린 것이 전부 엉뚱한 상품 매출로
          잡힙니다</strong> — 밀려난 줄은 눈에 띄지만 잘못 이어진 줄은 조용히 섞입니다.
        </p>
        <p className="page-sub">
          그래서 부서가 알려준 것은 <strong>바로 쓰되</strong>, 여기 쌓아 두고 담당자가 나중에
          훑어봅니다. 승인을 기다리게 하면 부서가 아예 안 알려줍니다.
        </p>
      </header>

      <section className="stat-row">
        <Tile label="이어 둔 코드" value={num(s.total)} note={`부서가 ${s.byDept} · 담당자가 ${s.byStaff}`} />
        <Tile
          label="아직 확인 안 한 것"
          value={num(s.needsCheck)}
          note={s.needsCheck > 0 ? '부서가 알려준 뒤 아직 안 봤습니다' : '전부 확인했습니다'}
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
            <CodeRow key={c.external_code} code={c} catalog={data.catalog} onChanged={reload} />
          ))}
        </ul>
      )}
    </div>
  )
}

function CodeRow({ code, catalog, onChanged }) {
  const toast = useToast()
  const [mode, setMode] = useState(null)
  const [form, setForm] = useState({ canonicalCode: '', why: '', author: 'AX 담당자' })
  const [fieldErrors, setFieldErrors] = useState({})
  const [saving, setSaving] = useState(false)

  async function act(action, payload = {}) {
    setSaving(true)
    setFieldErrors({})
    try {
      await api.post('/codes', { externalCode: code.external_code, action, ...payload })
      toast.success(action === 'confirm' ? '확인했다고 남겼습니다.' : '바꾸고 기록에 남겼습니다.')
      setMode(null)
      await onChanged()
    } catch (err) {
      if (err.fields) setFieldErrors(err.fields)
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <li className={`code-row${code.needsCheck ? ' needs' : ''}`}>
      <div className="row" style={{ marginBottom: 6 }}>
        <span className={`badge ${code.side === '부서' ? 'badge-warning' : 'badge-neutral'}`}>
          {code.side}가 알려줌
        </span>
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

      {code.confirmed && !code.staleCheck && (
        <p className="card-note code-confirmed">
          {code.confirmed.by}가 {ago(code.confirmed.at)} 확인했습니다
        </p>
      )}

      {code.corrections.length > 0 && (
        <details className="code-history">
          <summary>정정 이력 {code.corrections.length}건</summary>
          <ul>
            {code.corrections.map((f, i) => (
              <li key={i}>
                <div>{f.what}</div>
                {/* 코드를 바꾸는 것은 지난 숫자까지 같이 움직이는 일이다.
                    왜 바꿨는지가 남아야 정산이 달라진 까닭을 찾는다. */}
                <div className="card-note">
                  {f.why} — {f.by}, {ago(f.at)}
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}

      {mode === null && (
        <div className="row code-actions">
          {code.needsCheck && (
            <button
              type="button"
              className="btn-primary btn-sm"
              disabled={saving}
              onClick={() => act('confirm')}
            >
              맞습니다
            </button>
          )}
          <button type="button" className="btn-ghost btn-sm" onClick={() => setMode('correct')}>
            다른 상품이었습니다
          </button>
        </div>
      )}

      {mode === 'correct' && (
        <form
          className="thread-form"
          onSubmit={(e) => {
            e.preventDefault()
            act('correct', form)
          }}
        >
          <label className="field">
            <span className="field-label">
              어느 상품이었습니까<span className="field-required"> *</span>
            </span>
            <select
              value={form.canonicalCode}
              onChange={(e) => setForm((f) => ({ ...f, canonicalCode: e.target.value }))}
            >
              <option value="">골라주세요</option>
              {catalog.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name} ({s.code})
                </option>
              ))}
            </select>
            {fieldErrors.canonicalCode && (
              <div className="field-error">{fieldErrors.canonicalCode}</div>
            )}
          </label>
          <label className="field">
            <span className="field-label">
              왜 바꾸십니까<span className="field-required"> *</span>
            </span>
            <textarea
              rows={2}
              value={form.why}
              onChange={(e) => setForm((f) => ({ ...f, why: e.target.value }))}
              placeholder="이름이 비슷한 다른 상품이었습니다. 원본 주문서와 맞춰 봤습니다."
            />
            {fieldErrors.why && <div className="field-error">{fieldErrors.why}</div>}
          </label>
          <div className="row">
            <button type="submit" className="btn-primary btn-sm" disabled={saving}>
              {saving ? '바꾸는 중…' : '바꾸고 기록에 남기기'}
            </button>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setMode(null)}>
              그만두기
            </button>
            <span className="spacer" />
            <span className="card-note">지난 정산 숫자가 함께 움직입니다</span>
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
