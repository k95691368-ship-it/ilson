import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useApi } from '../hooks/useApi.js'
import { ago, dateTimeLabel, num } from '../lib/format.js'

// 이 조직이 내린 결정 전부를 한 화면에서 본다.
//
// 여덟 단계에 흩어져 있는 것을 가로로 훑는 자리다. 몇 달 뒤 "그때 왜 그렇게
// 정했냐"는 질문은 신청서 단위가 아니라 사람 단위로 온다 — "요즘 뭘 반려하고
// 계세요" 같은 식으로. 그 질문에 답하려면 이 화면이 필요하다.
export default function LogPage() {
  const [filters, setFilters] = useState({ stage: '', dept: '', actor: '', unrequested: false, q: '' })
  const [draft, setDraft] = useState('')

  const path = useMemo(() => {
    const p = new URLSearchParams()
    if (filters.stage) p.set('stage', filters.stage)
    if (filters.dept) p.set('dept', filters.dept)
    if (filters.actor) p.set('actor', filters.actor)
    if (filters.unrequested) p.set('unrequested', '1')
    if (filters.q) p.set('q', filters.q)
    const s = p.toString()
    return `/decisions${s ? `?${s}` : ''}`
  }, [filters])

  const { data, error, loading } = useApi(path)

  function toggle(key, value) {
    setFilters((f) => ({ ...f, [key]: f[key] === value ? '' : value }))
  }

  const t = data?.totals

  return (
    <div className="stack">
      <header className="page-head">
        <span className="page-eyebrow">기록</span>
        <h1>내린 결정 전부</h1>
        <p className="page-sub">
          여덟 단계에 흩어져 있는 결정을 한 자리에 모았습니다. 각 결정마다 <strong>무엇을</strong>{' '}
          정했고 <strong>왜</strong> 그렇게 정했고 <strong>무엇을 고르지 않았는지</strong>가 함께
          남습니다. 근거 없이 남은 결정은 나중에 아무 쓸모가 없습니다.
        </p>
      </header>

      {t && (
        <section className="stat-row">
          <Tile label="남은 결정" value={num(t.total)} note={`그중 사람이 내린 것 ${t.human}건`} />
          <Tile
            label="대안까지 적은 것"
            value={t.total > 0 ? `${Math.round((t.withAlternatives / t.total) * 100)}%` : '—'}
            note="무엇을 고르지 않았는지까지 남긴 비율"
          />
          <Tile
            label="먼저 제안한 것"
            value={num(t.unrequested)}
            note="아무도 요청하지 않았는데 내가 먼저 꺼낸 것"
          />
          <Tile label="지금 보고 있는 것" value={num(data.filtered)} note="아래 조건에 맞는 결정" />
        </section>
      )}

      <section className="card">
        <div className="card-head">
          <span className="card-title">골라 보기</span>
          {(filters.stage || filters.dept || filters.actor || filters.unrequested || filters.q) && (
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={() => {
                setFilters({ stage: '', dept: '', actor: '', unrequested: false, q: '' })
                setDraft('')
              }}
            >
              조건 지우기
            </button>
          )}
        </div>

        <form
          className="row"
          style={{ marginBottom: 10 }}
          onSubmit={(e) => {
            e.preventDefault()
            setFilters((f) => ({ ...f, q: draft.trim() }))
          }}
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="말로 찾기 — 제목·내용·근거·대안 어디에 있든 찾습니다"
            style={{ flex: 1, minWidth: 220 }}
          />
          <button type="submit" className="btn-ghost">
            찾기
          </button>
        </form>

        <div className="filter-row">
          <span className="filter-label">단계</span>
          <div className="chip-row">
            {(data?.stages ?? []).map((s) => (
              <button
                key={s}
                type="button"
                className={`chip${filters.stage === s ? ' on' : ''}`}
                onClick={() => toggle('stage', s)}
              >
                {s}
                {data?.byStage?.[s] > 0 && (
                  <span className="chip-count">{data.byStage[s]}</span>
                )}
              </button>
            ))}
          </div>
        </div>

        {data?.byDept?.length > 0 && (
          <div className="filter-row">
            <span className="filter-label">부서</span>
            <div className="chip-row">
              {data.byDept.map((d) => (
                <button
                  key={d.dept}
                  type="button"
                  className={`chip${filters.dept === d.dept ? ' on' : ''}`}
                  onClick={() => toggle('dept', d.dept)}
                >
                  {d.dept}
                  <span className="chip-count">{d.n}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="filter-row">
          <span className="filter-label">누가</span>
          <div className="chip-row">
            <button
              type="button"
              className={`chip${filters.actor === 'human' ? ' on' : ''}`}
              onClick={() => toggle('actor', 'human')}
            >
              사람이 정한 것
            </button>
            <button
              type="button"
              className={`chip${filters.unrequested ? ' on' : ''}`}
              onClick={() => setFilters((f) => ({ ...f, unrequested: !f.unrequested }))}
            >
              먼저 제안한 것만
            </button>
          </div>
        </div>
      </section>

      {error && <div className="notice notice-danger">{error}</div>}
      {loading && !data && <div className="page-loading">불러오는 중…</div>}

      {data && data.items.length === 0 && (
        <div className="empty">
          <div className="empty-title">조건에 맞는 결정이 없습니다</div>
          <div className="empty-sub">조건을 지우고 다시 보세요.</div>
        </div>
      )}

      {data && data.items.length > 0 && (
        <ol className="log-list">
          {data.items.map((d) => (
            <li key={d.id} className={d.actor === 'ai' ? 'draft' : 'decided'}>
              <div className="row" style={{ marginBottom: 5 }}>
                <span className="badge badge-accent">{d.stage}</span>
                {d.dept && <span className="badge badge-neutral">{d.dept}</span>}
                {d.unrequested === 1 && <span className="badge badge-warning">먼저 제안</span>}
                <span className="spacer" />
                {d.ticket_no && (
                  <Link to={`/track?no=${d.ticket_no}`} className="mono card-note">
                    {d.ticket_no}
                  </Link>
                )}
                <span className="card-note" title={dateTimeLabel(d.created_at)}>
                  {ago(d.created_at)}
                </span>
              </div>

              <div className="item-body" style={{ fontWeight: 700 }}>
                {d.title}
              </div>
              {d.application_title && (
                <div className="card-note" style={{ marginTop: 2 }}>
                  {d.application_title}
                </div>
              )}
              <div className="card-note" style={{ marginTop: 6 }}>
                {d.what}
              </div>

              <div className="decision-why">
                <strong>왜</strong> {d.why}
              </div>
              {d.alternatives && (
                <div className="decision-why">
                  <strong>고르지 않은 길</strong> {d.alternatives}
                </div>
              )}
            </li>
          ))}
        </ol>
      )}

      {data && data.items.length >= 200 && (
        <p className="card-note">
          가장 최근 200건만 보여주고 있습니다. 조건을 좁혀 보세요.
        </p>
      )}
    </div>
  )
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
