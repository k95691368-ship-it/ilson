import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useApi } from '../hooks/useApi.js'
import { useToast } from '../context/ToastContext.jsx'
import { api } from '../api/client.js'
import { ago, duration, num } from '../lib/format.js'

// 두 신청서를 나란히 놓고 본다.
//
// 중복 판정이 "이 둘이 비슷합니다"까지는 말해 준다. 그다음 판단 — 같은
// 건인가, 말만 비슷하고 다른 일인가 — 은 사람이 해야 한다.
//
// 그게 왜 어려운가. 왼쪽을 읽고 오른쪽으로 옮기면 왼쪽이 흐려지고, 다시
// 왼쪽을 보면 오른쪽이 흐려진다. 그래서 겹치는 말과 한쪽에만 있는 말을
// 미리 갈라 둔다. 담당자는 다른 대목만 읽으면 된다.
export default function ComparePage() {
  const [params] = useSearchParams()
  const a = params.get('a')
  const b = params.get('b')
  const { data, error, loading, reload } = useApi(a && b ? `/compare?a=${a}&b=${b}` : null)

  if (!a || !b) {
    return (
      <div className="empty">
        <div className="empty-title">견줄 신청서 둘을 골라주세요</div>
        <div className="empty-sub">
          검토 화면에서 비슷한 신청서가 걸리면 "나란히 놓고 보기"로 여기에 옵니다.
        </div>
        <Link to="/review" className="btn-ghost btn-sm">
          검토 화면으로
        </Link>
      </div>
    )
  }

  if (error) return <div className="notice notice-danger">{error}</div>
  if (loading && !data) return <div className="page-loading">불러오는 중…</div>
  if (!data) return null

  return (
    <div className="stack">
      <header className="page-head">
        <span className="page-eyebrow">검토</span>
        <h1>같은 건인가, 말만 비슷한가</h1>
        <p className="page-sub">
          겹치는 말은 <span className="tok tok-both">이렇게</span>, 왼쪽에만 있는 말은{' '}
          <span className="tok tok-a">이렇게</span>, 오른쪽에만 있는 말은{' '}
          <span className="tok tok-b">이렇게</span> 갈라 뒀습니다. <strong>다른 대목만</strong>{' '}
          읽으시면 됩니다.
        </p>
      </header>

      <section className="stat-row">
        <Tile label="말이 겹치는 정도" value={`${Math.round(data.score * 100)}%`} note="낱말 기준" />
        <Tile
          label="양쪽에 다 있는 말"
          value={num(data.summary.sharedWords)}
          note="같은 것을 말하고 있다는 근거"
        />
        <Tile
          label="한쪽에만 있는 말"
          value={num(data.summary.onlyAWords + data.summary.onlyBWords)}
          note="다른 일일 수 있다는 근거"
        />
        <Tile
          label="값이 다른 칸"
          value={num(data.summary.differentValues)}
          note="부서·소요시간 같은 것"
        />
      </section>

      {data.pastVerdicts.length > 0 && (
        <div className="notice">
          <div className="notice-title">이 둘은 전에 이미 판정했습니다</div>
          {data.pastVerdicts.map((p, i) => (
            <p key={i} style={{ margin: '4px 0 0' }}>
              <strong>{p.title}</strong> — {p.why}{' '}
              <span className="card-note">({ago(p.created_at)})</span>
            </p>
          ))}
        </div>
      )}

      <div className="cmp-heads">
        <Head side="a" app={data.a} />
        <Head side="b" app={data.b} />
      </div>

      {/* 값으로 된 칸. 글이 아니라 값이라 갈라 볼 낱말이 없다.
          다른 것만 도드라지게 한다. */}
      <section className="card">
        <div className="card-head">
          <span className="card-title">값으로 적힌 것</span>
          <span className="card-note">다른 칸에 표시가 붙습니다</span>
        </div>
        <div className="cmp-values">
          {data.values
            .filter((v) => !v.bothEmpty)
            .map((v) => (
              <div key={v.key} className={`cmp-value${v.same ? '' : ' differ'}`}>
                <div className="cmp-value-label">
                  {v.label}
                  {!v.same && <span className="badge badge-warning">다름</span>}
                </div>
                <div className="cmp-value-pair">
                  <span>{fmtValue(v.a, v.unit)}</span>
                  <span className="cmp-vs">{v.same ? '=' : '≠'}</span>
                  <span>{fmtValue(v.b, v.unit)}</span>
                </div>
              </div>
            ))}
        </div>
      </section>

      {/* 글로 된 칸. 여기가 이 화면의 본체다. */}
      {data.fields
        .filter((f) => !f.bothEmpty)
        .map((f) => (
          <section key={f.key} className="card">
            <div className="card-head">
              <span className="card-title">{f.label}</span>
              {f.onlyOneSide ? (
                <span className="badge badge-neutral">한쪽만 적었습니다</span>
              ) : (
                <span className="card-note">
                  겹치는 말 {f.both.length}개 · 왼쪽에만 {f.onlyA.length}개 · 오른쪽에만{' '}
                  {f.onlyB.length}개
                </span>
              )}
            </div>

            <div className="cmp-texts">
              <blockquote className="cmp-text">
                {f.aText || <span className="card-note">비워 두셨습니다</span>}
              </blockquote>
              <blockquote className="cmp-text">
                {f.bText || <span className="card-note">비워 두셨습니다</span>}
              </blockquote>
            </div>

            {(f.both.length > 0 || f.onlyA.length > 0 || f.onlyB.length > 0) && (
              <div className="cmp-tokens">
                <TokenRow label="양쪽 다" tokens={f.both} kind="both" />
                <TokenRow label="왼쪽에만" tokens={f.onlyA} kind="a" />
                <TokenRow label="오른쪽에만" tokens={f.onlyB} kind="b" />
              </div>
            )}
          </section>
        ))}

      <Verdict a={a} b={b} verdicts={data.verdicts} onSaved={reload} />
    </div>
  )
}

function Head({ side, app }) {
  return (
    <article className={`cmp-head cmp-head-${side}`}>
      <div className="row" style={{ marginBottom: 5 }}>
        <span className={`badge badge-${side === 'a' ? 'accent' : 'neutral'}`}>
          {side === 'a' ? '왼쪽' : '오른쪽'}
        </span>
        <span className="badge badge-neutral">{app.dept}</span>
        <span className="badge badge-neutral">{app.status}</span>
        <span className="spacer" />
        <span className="card-note">{ago(app.created_at)}</span>
      </div>
      <h2 className="cmp-head-title">{app.title}</h2>
      <div className="card-note">
        {app.applicant_label} · {app.ticket_no}
        {app.annual_hours != null && ` · 연 ${num(app.annual_hours, 0)}시간`}
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <Link to={`/record/${app.ticket_no}`} className="btn-ghost btn-sm">
          이 신청서 기록 전부
        </Link>
        <Link to={`/track?no=${app.ticket_no}`} className="btn-ghost btn-sm">
          어디까지 왔는지
        </Link>
      </div>
    </article>
  )
}

function TokenRow({ label, tokens, kind }) {
  if (tokens.length === 0) return null
  return (
    <div className="cmp-token-row">
      <span className="filter-label">{label}</span>
      <div className="chip-row">
        {tokens.map((t) => (
          <span key={t} className={`tok tok-${kind}`}>
            {t}
          </span>
        ))}
      </div>
    </div>
  )
}

// 판정을 남긴다.
//
// 이 판단이 사라지면 다음 사람이 같은 두 건을 놓고 처음부터 다시 견주게 된다.
// 근거를 안 적으면 저장하지 않는다 — "왜 다른 건이라고 했지"에 답이 없는
// 기록은 나중에 아무 쓸모가 없다.
function Verdict({ a, b, verdicts, onSaved }) {
  const toast = useToast()
  const [verdict, setVerdict] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [fieldErrors, setFieldErrors] = useState({})

  async function save(e) {
    e.preventDefault()
    setSaving(true)
    setFieldErrors({})
    try {
      const r = await api.post('/compare', { a, b, verdict, reason })
      toast.success(`"${r.verdict}"으로 판정하고 기록에 남겼습니다.`)
      setReason('')
      setVerdict('')
      await onSaved()
    } catch (err) {
      if (err.fields) setFieldErrors(err.fields)
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  const chosen = verdicts.find((v) => v.verdict === verdict)

  return (
    <form className="card decided" onSubmit={save}>
      <div className="card-head">
        <span className="origin-label origin-human">◆ 내 판정</span>
        <span className="card-note">기록에 남아서 다음 사람이 다시 견주지 않아도 됩니다</span>
      </div>

      <div className="field">
        <label className="field-label">
          같은 건입니까<span className="field-required"> *</span>
        </label>
        <div className="verdict-row">
          {verdicts.map((v) => (
            <button
              key={v.verdict}
              type="button"
              className={`verdict-btn${verdict === v.verdict ? ' on' : ''}`}
              onClick={() => setVerdict(v.verdict)}
              aria-pressed={verdict === v.verdict}
            >
              {v.verdict}
            </button>
          ))}
        </div>
        {chosen && <p className="card-note" style={{ marginTop: 7 }}>{chosen.meaning}</p>}
        {fieldErrors.verdict && <div className="field-error">{fieldErrors.verdict}</div>}
      </div>

      <div className="field">
        <label className="field-label">
          왜 그렇게 보셨습니까<span className="field-required"> *</span>
        </label>
        <textarea
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="둘 다 다섯 채널 정산서를 엑셀로 합치는 일이다. 부서도 같고 주기도 같다. 적은 사람만 다르다."
        />
        {fieldErrors.reason && <div className="field-error">{fieldErrors.reason}</div>}
      </div>

      <button type="submit" className="btn-primary" disabled={saving || !verdict}>
        {saving ? '남기는 중…' : '판정하고 기록에 남기기'}
      </button>
    </form>
  )
}

function fmtValue(v, unit) {
  if (v == null || v === '') return <span className="card-note">비어 있음</span>
  if (unit === '분') return duration(Number(v) * 60)
  return `${v}${unit ?? ''}`
}

function Tile({ label, value, note }) {
  return (
    <div className="stat-tile">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      <div className="stat-note">{note}</div>
    </div>
  )
}
