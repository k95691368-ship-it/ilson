import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useApi } from '../hooks/useApi.js'
import { useToast } from '../context/ToastContext.jsx'
import { api } from '../api/client.js'
import { ago, num } from '../lib/format.js'
import { validatePick, QUADRANTS, QUADRANT_BY_KEY, MID } from '../../shared/priority.js'

// 무엇을 먼저 할 것인가.
//
// 접수함에서 판정은 한 건씩 한다. 그런데 "수용"이 여러 건 쌓이면 그다음
// 질문이 온다 — 이 중에 무엇부터 하나. 지금까지 그걸 정하는 자리가 없어서,
// 담당자는 목록을 위에서부터 하거나 마지막에 들어온 것부터 했다.
//
// **판이 순서를 정해 주지 않는다.** 규칙이 할 수 있는 것은 무엇이 어디에
// 있는지 보여 주는 것까지다. 그다음은 사람이 정하고, 정한 이유가 기록에
// 남는다. 그게 이 사이트의 주어다.
//
// 차트 라이브러리를 안 쓴다. SVG로 직접 그린다 — 이 사이트에서 숫자를
// 그리는 자리는 전부 그렇게 했다.
export default function PriorityPage() {
  const { data, error, loading, reload } = useApi('/priority')
  const toast = useToast()
  const [open, setOpen] = useState(null)

  if (error) return <div className="notice notice-danger">{error}</div>
  if (loading && !data) return <div className="page-loading">불러오는 중…</div>
  if (!data) return null

  return (
    <div className="stack">
      <header className="page-head">
        <span className="page-eyebrow">무엇을 먼저 할까</span>
        <h1>수용한 것 중에 무엇부터 하나</h1>
      </header>

      {data.items.length === 0 ? (
        <section className="card">
          <div className="card-title">판에 올릴 것이 없습니다</div>
          <p className="card-note">
            2단계에서 <strong>수용</strong>으로 판정하고 임팩트·난이도를 매기신 신청서가 여기
            올라옵니다.
          </p>
          <Link to="/review" className="btn-ghost btn-sm" style={{ marginTop: 10 }}>
            접수함 열기
          </Link>
        </section>
      ) : (
        <>
          <section className="card">
            <div className="card-head">
              <span className="card-title">{data.items.length}건이 판 위에 있습니다</span>
              <span className="card-note">점 크기 = 연 몇 시간짜리 일인가</span>
            </div>
            <Board items={data.items} picked={data.picked} onPick={(id) => setOpen(id)} />
          </section>

          {/* 순서를 정해 주는 대신, 놓치기 쉬운 것을 짚는다.
              짚는 것과 정하는 것은 다르다. */}
          {data.notes.length > 0 && (
            <section className="board-notes">
              {data.notes.map((n) => (
                <p key={n.key}>{n.text}</p>
              ))}
            </section>
          )}

          <section className="card">
            <div className="card-head">
              <span className="card-title">먼저 하기로 정한 것</span>
              <span className="card-note">{data.line}</span>
            </div>
            <Picked
              picked={data.picked}
              onCancel={async (p) => {
                const why = window.prompt('왜 무르십니까? 앞서 적으신 이유와 나란히 남습니다.')
                if (why == null) return
                try {
                  const r = await api.post('/priority', {
                    kind: 'cancel',
                    application_id: p.application_id,
                    why,
                    by: 'AX 담당자',
                  })
                  toast.success(r.message)
                  reload()
                } catch (err) {
                  toast.error(err.message)
                }
              }}
            />
          </section>
        </>
      )}

      {open && (
        <PickForm
          item={data.items.find((i) => i.id === open)}
          onClose={() => setOpen(null)}
          onDone={() => {
            setOpen(null)
            reload()
          }}
          toast={toast}
        />
      )}

      {/* 판에 못 올린 것도 밝힌다. 안 밝히면 담당자는 이 판이 전부인 줄
          알고, 여기 없는 신청서를 잊는다. */}
      {data.off.length > 0 && <OffBoard off={data.off} />}
    </div>
  )
}

// 판.
//
// 가로가 난이도, 세로가 임팩트다. 오른쪽 위가 아니라 **왼쪽 위**가
// "크게 걸리는데 쉬운 것"이 되도록 난이도를 왼쪽부터 낮게 놓았다.
// 사람은 왼쪽 위부터 읽는다.
function Board({ items, picked, onPick }) {
  const W = 520
  const H = 420
  const PAD = 44
  const pickedIds = new Set((picked ?? []).map((p) => p.application_id))

  const maxHours = Math.max(1, ...items.map((i) => i.annualHours ?? 0))
  const x = (d) => PAD + ((d - 1) / 4) * (W - PAD * 2)
  const y = (i) => H - PAD - ((i - 1) / 4) * (H - PAD * 2)
  // 넓이가 시간에 비례해야 크기가 정직하다. 지름에 비례시키면 두 배짜리가
  // 네 배로 보인다.
  const r = (h) => (h == null ? 6 : 8 + Math.sqrt(h / maxHours) * 16)

  const midX = x(MID)
  const midY = y(MID)

  return (
    <div className="board-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="board" role="img" aria-label="임팩트와 난이도로 놓은 판">
        <rect x={PAD} y={PAD} width={W - PAD * 2} height={H - PAD * 2} className="board-bg" />
        <line x1={midX} y1={PAD} x2={midX} y2={H - PAD} className="board-mid" />
        <line x1={PAD} y1={midY} x2={W - PAD} y2={midY} className="board-mid" />

        <text x={PAD + 6} y={PAD + 16} className="board-q">크게 걸림 · 쉬움</text>
        <text x={midX + 6} y={PAD + 16} className="board-q">크게 걸림 · 어려움</text>
        <text x={PAD + 6} y={H - PAD - 8} className="board-q">적게 걸림 · 쉬움</text>
        <text x={midX + 6} y={H - PAD - 8} className="board-q">적게 걸림 · 어려움</text>

        <text x={W / 2} y={H - 10} className="board-axis" textAnchor="middle">
          만들기 어려운 정도 →
        </text>
        <text x={14} y={H / 2} className="board-axis" transform={`rotate(-90 14 ${H / 2})`} textAnchor="middle">
          틀리면 크게 걸리는 정도 →
        </text>

        {items.map((i) => (
          <g key={i.id} className={`board-dot${pickedIds.has(i.id) ? ' picked' : ''}`}>
            <circle cx={x(i.difficulty)} cy={y(i.impact)} r={r(i.annualHours)} />
            <title>
              {`${i.dept} · ${i.title}\n임팩트 ${i.impact} / 난이도 ${i.difficulty}` +
                (i.annualHours != null ? `\n연 ${i.annualHours}시간` : '\n연간 시간 모름') +
                (i.deptCount > 1 ? `\n${i.deptCount}개 부서가 걸린 일` : '')}
            </title>
          </g>
        ))}
      </svg>

      <ul className="board-list">
        {items.map((i) => {
          const q = QUADRANT_BY_KEY[i.quadrant]
          return (
            <li key={i.id} className={pickedIds.has(i.id) ? 'picked' : ''}>
              <div className="board-list-top">
                <span className={`badge badge-${q.tone === 'good' ? 'success' : q.tone === 'warn' ? 'warning' : 'neutral'}`}>
                  {q.label}
                </span>
                <span className="badge badge-neutral">{i.dept}</span>
                {i.deptCount > 1 && (
                  <span className="badge badge-accent">{i.deptCount}개 부서</span>
                )}
                <span className="spacer" />
                <span className="card-note">
                  임팩트 {i.impact} / 난이도 {i.difficulty}
                  {i.annualHours != null ? ` · 연 ${num(i.annualHours, 0)}시간` : ' · 시간 모름'}
                </span>
              </div>
              <Link to={`/record/${i.id}`} className="board-list-title">
                {i.title}
              </Link>
              {!pickedIds.has(i.id) && (
                <button type="button" className="btn-ghost btn-sm" onClick={() => onPick(i.id)}>
                  이걸 먼저 합니다
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function Picked({ picked, onCancel }) {
  if (picked.length === 0) {
    return (
      <p className="card-note">
        아직 정하지 않으셨습니다. 위에서 하나 고르시면 <strong>왜 그것부터인지</strong>를 여쭙고,
        그 이유가 결정 기록에 남습니다.
      </p>
    )
  }

  return (
    <ol className="picked-list">
      {picked.map((p) => (
        <li key={p.id}>
          <div className="picked-top">
            <strong>{p.item.title}</strong>
            <span className="card-note">
              {p.item.dept} · {p.by} · {ago(p.at)}
            </span>
          </div>
          <p className="picked-why">{p.why}</p>
          <button type="button" className="btn-ghost btn-sm" onClick={() => onCancel(p)}>
            무르기
          </button>
        </li>
      ))}
    </ol>
  )
}

// 왜 이것부터인지.
//
// 이유 없이 고른 순서는 다음 주에 자기도 왜 그랬는지 모른다. 그리고 뒤로
// 밀린 부서가 "왜 우리 것이 밀렸냐"고 물으면 답할 것이 없다.
function PickForm({ item, onClose, onDone, toast }) {
  const [why, setWhy] = useState('')
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  if (!item) return null

  const q = QUADRANT_BY_KEY[item.quadrant]

  async function send(e) {
    e.preventDefault()
    const bad = validatePick({ why })
    setErrors(bad)
    if (Object.keys(bad).length > 0) return
    setBusy(true)
    try {
      const r = await api.post('/priority', {
        application_id: item.id,
        why,
        by: 'AX 담당자',
      })
      toast.success(r.message)
      onDone()
    } catch (err) {
      setErrors({ why: err.message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="pick-form" onSubmit={send}>
      <div className="pick-head">
        <span className="badge badge-accent">먼저 할 것으로 정하기</span>
        <strong>{item.title}</strong>
      </div>

      <p className="card-note">
        {item.dept} · 임팩트 {item.impact} / 난이도 {item.difficulty}
        {item.annualHours != null && ` · 연 ${num(item.annualHours, 0)}시간`}
        {item.deptCount > 1 && ` · ${item.deptCount}개 부서가 걸린 일`}
      </p>
      <p className="card-note">{q.hint}</p>

      <label>
        <textarea
          rows={3}
          value={why}
          onChange={(e) => setWhy(e.target.value)}
          placeholder="정산 마감이 다음 주라 금액이 틀리면 되돌릴 수 없습니다. 다른 건은 한 주 밀려도 됩니다."
        />
        {errors.why && <em className="field-error">{errors.why}</em>}
        <small className="card-note">
          이 문장이 결정 기록에 남습니다. 뒤로 밀린 부서가 물어볼 때 답할 것이 됩니다.
        </small>
      </label>

      <div className="row">
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? '정하는 중…' : '먼저 할 것으로 정하기'}
        </button>
        <button type="button" className="btn-ghost" onClick={onClose}>
          그만두기
        </button>
      </div>
    </form>
  )
}

// 판에 못 올린 것.
//
// 안 밝히면 담당자는 이 판이 전부인 줄 알고, 여기 없는 신청서를 잊는다.
function OffBoard({ off }) {
  const [open, setOpen] = useState(false)
  return (
    <section className="card">
      <div className="card-head">
        <span className="card-title">판에 안 올라온 것 {off.length}건</span>
        <span className="spacer" />
        <button type="button" className="btn-ghost btn-sm" onClick={() => setOpen((v) => !v)}>
          {open ? '접기' : '펼치기'}
        </button>
      </div>
      {open && (
        <ul className="offboard-list">
          {off.map((o) => (
            <li key={o.id}>
              <span className="badge badge-neutral">{o.status}</span>
              <Link to={`/record/${o.id}`}>{o.title}</Link>
              <span className="card-note">{o.why}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// 화면에서 안 쓰지만, 사분면 목록이 바뀌면 여기서 먼저 깨지라고 둔다.
export const QUADRANT_COUNT = QUADRANTS.length
