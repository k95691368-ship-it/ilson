import { Link } from 'react-router-dom'
import { useApi } from '../hooks/useApi.js'
import { useState } from 'react'
import { ago, num } from '../lib/format.js'
import { REFUSE_LABELS, REFUSE_REASONS } from '../../shared/review.js'
import { QUARANTINE_REASONS } from '../../shared/pipeline.js'
import { askOf } from '../../shared/response.js'

// 못 한 것, 안 되는 것, 증명하지 못한 것.
//
// 다른 화면은 전부 "무엇을 했는가"를 말한다. 그것만 있으면 읽는 사람은
// 결국 "그래서 안 된 건 뭔데"를 속으로 묻게 되고, 그 질문에 답이 없으면
// 잘된 것까지 못 믿는다.
//
// 여기 있는 숫자는 전부 다른 화면에도 있는 것이다. 숨겨 놓고 여기서만
// 꺼내는 것이 아니라, 흩어져 있어서 한눈에 안 보이던 것을 모으는 것이다.
// 데이터에서 만들어지므로 잘 보이려고 손댈 수 없다 — 반려가 늘면 여기
// 숫자가 늘고, 격리가 줄면 여기 숫자가 준다.
export default function HonestyPage() {
  const { data, error, loading } = useApi('/honesty')
  const { data: resp } = useApi('/response')

  if (error) return <div className="notice notice-danger">{error}</div>
  if (loading && !data) return <div className="page-loading">불러오는 중…</div>
  if (!data) return null

  const s = data.summary

  return (
    <div className="stack">
      <header className="page-head">
        <span className="page-eyebrow">정직</span>
        <h1>못 한 것과 증명하지 못한 것</h1>
      </header>

      <section className="stat-row">
        <Tile label="반려한 신청서" value={num(s.refused)} note="못 하겠다고 답한 것" />
        <Tile label="아직 손도 못 댄 것" value={num(s.stuck)} note="접수만 되고 그대로 앉아 있는 것" />
        <Tile label="처리 못 하고 밀어 둔 줄" value={num(s.quarantine)} note="도구가 못 읽은 줄" />
        <Tile label="증명하지 못한 것" value={num(s.unproven)} note="데이터로 답할 수 없는 것" />
      </section>

      {/* 부서에 부탁한 것 중 실제로 답이 온 것.
          이 사이트에서 가장 중요한 숫자다. 여기가 낮으면 나머지 기록이
          아무리 촘촘해도 혼자 만든 것이다. 그래서 정직 화면에 둔다. */}
      {resp?.show && (
        <section className={`card response-card${resp.answered === 0 ? ' none' : ''}`}>
          <div className="card-head">
            <h2 className="card-title">부서에 부탁한 것과 돌아온 답</h2>
            <span className="spacer" />
            <span className="badge badge-neutral">
              {num(resp.answered)} / {num(resp.asked)}
            </span>
          </div>

          <p className="response-line">{resp.line}</p>
          <p className="card-note response-note">{resp.note}</p>

          <ul className="response-list">
            {resp.per.map((x) => (
              <li key={x.key} className={x.never ? 'never' : x.answered === x.asked ? 'done' : ''}>
                <div className="response-top">
                  <span className="response-label">{x.label}</span>
                  <span className="spacer" />
                  {x.never ? (
                    // 안 물어본 것에 비율을 매기지 않는다. 0/0을 0%로 적으면
                    // "부서가 안 해줬다"로 읽히는데 사실은 여쭤본 적이 없다.
                    <span className="card-note">아직 여쭤본 적 없음</span>
                  ) : (
                    <span className="badge badge-neutral">
                      {num(x.answered)} / {num(x.asked)}
                    </span>
                  )}
                </div>
                {!x.never && (
                  <div className="response-why">{askOf(x.key)?.why ?? ''}</div>
                )}
                {x.proxied > 0 && (
                  <div className="response-proxy">
                    {num(x.proxied)}건은 담당자가 대신 눌러 둔 것입니다. 부서 응답으로 세지 않았습니다.
                  </div>
                )}
              </li>
            ))}
          </ul>

        </section>
      )}

      {/* 데이터로 증명할 수 없는 것. 이것만은 손으로 적었다. */}
      <section className="card">
        <div className="card-head">
          <h2 className="card-title">증명하지 못한 것</h2>
        </div>
        <div className="unproven-list">
          {data.unproven.map((u) => (
            <article key={u.key} className="unproven">
              <h3>{u.title}</h3>
              <p className="unproven-body">{u.body}</p>
              <p className="unproven-instead">
                <strong>그래서 어디까지 말하는가</strong> {u.instead}
              </p>
            </article>
          ))}
        </div>
      </section>

      {data.stuck.length > 0 && (
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">아직 손도 못 댄 신청서 {data.stuck.length}건</h2>
          </div>
          <ul className="honest-list">
            {data.stuck.map((a) => (
              <li key={a.id}>
                <div className="row">
                  <span className="badge badge-neutral">{a.dept}</span>
                  <span className="dept-app-title">{a.title}</span>
                  <span className="spacer" />
                  <span className={`card-note${a.days >= 3 ? ' honest-old' : ''}`}>
                    {a.days > 0 ? `${a.days}일째` : ago(a.created_at)}
                  </span>
                  <Link to={`/record/${a.ticket_no}`} className="mono card-note">
                    {a.ticket_no}
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.refused.length > 0 && (
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">못 하겠다고 답한 것 {data.refused.length}건</h2>
            {data.refusedWithoutAlternative > 0 ? (
              <span className="badge badge-warning">
                대안 없이 반려한 것 {data.refusedWithoutAlternative}건
              </span>
            ) : (
              <span className="card-note">전부 대안을 함께 보냈습니다</span>
            )}
          </div>
          <ul className="honest-list">
            {data.refused.map((r) => (
              <li key={r.id}>
                <div className="row" style={{ marginBottom: 4 }}>
                  <span className="badge badge-danger">
                    {REFUSE_LABELS[r.refuse_code] ?? r.refuse_code ?? '사유 없음'}
                  </span>
                  <span className="badge badge-neutral">{r.dept}</span>
                  <span className="spacer" />
                  <Link to={`/record/${r.ticket_no}`} className="mono card-note">
                    {r.ticket_no}
                  </Link>
                </div>
                <div className="dept-app-title">{r.title}</div>
                {r.verdict_reason && <div className="card-note honest-why">{r.verdict_reason}</div>}
                {r.refuse_alternative ? (
                  <div className="honest-alt">
                    <strong>대신 드릴 수 있는 것</strong> {r.refuse_alternative}
                  </div>
                ) : (
                  <div className="honest-alt honest-alt-missing">
                    대안을 적지 않고 반려했습니다. 이건 제 잘못입니다.
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {(data.quarantine.length > 0 || data.quarantineLive > 0) && (
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">
              도구가 처리 못 하고 밀어 둔 줄 {num(data.quarantineTotal)}줄
            </h2>
          </div>
          {/* 이유별로 나눌 수 있는 것은 만드는 중에 시운전한 것뿐이다.
              넘긴 뒤 실제 실행은 브라우저에서 돌고 서버에는 개수만 남는다.
              여태 이 화면은 시운전 것만 세서, 부서가 매주 겪는 줄이 0으로
              보였다 — 가장 정직해야 할 화면이 가장 적게 세고 있었다.
              모르는 것은 모른다고 적는다. */}
          {data.quarantineLive > 0 && (
            <p className="card-note" style={{ marginBottom: 11 }}>
              이 가운데 <strong>{num(data.quarantineLive)}줄</strong>은 넘긴 뒤 부서가 실제로
              돌리면서 밀려난 것입니다. 그쪽은 브라우저에서 도는 것이라 서버에 개수만 남아,
              아래 이유별 표에는 안 들어갑니다 — 왜 밀렸는지는 도구 화면의 검토함에서 보셔야
              합니다.
            </p>
          )}

          <ul className="honest-bars">
            {data.quarantine.map((q) => (
              <li key={q.reason}>
                <div className="row">
                  <span>{QUARANTINE_REASONS[q.reason] ?? q.reason}</span>
                  <span className="spacer" />
                  <strong>{num(q.n)}줄</strong>
                </div>
                <div className="honest-bar">
                  {/* 막대 길이는 **이유별로 나눌 수 있는 것** 안에서 견준다.
                      전체(실행 격리 포함)로 나누면 막대가 다 짧아져서 어느
                      이유가 큰지가 안 보인다. */}
                  <span style={{ width: `${(q.n / Math.max(1, data.quarantineBuild)) * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.idleTools.length > 0 && (
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">넘겨 놓고 아무도 안 쓰는 도구 {data.idleTools.length}개</h2>
          </div>
          <ul className="honest-list">
            {data.idleTools.map((t) => (
              <li key={t.slug}>
                <div className="row">
                  <span className="badge badge-warning">0번 사용</span>
                  <span className="dept-app-title">{t.title}</span>
                  <span className="spacer" />
                  <span className="card-note">
                    {t.handed_to_dept}에 {ago(t.handed_at)} 넘김
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(data.failedChecks.length > 0 || data.unresolvedChallenges.length > 0) && (
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">아직 통과 못 한 것과 못 푼 반박</h2>
          </div>
          {data.failedChecks.length > 0 && (
            <ul className="honest-list" style={{ marginBottom: 12 }}>
              {data.failedChecks.map((c, i) => (
                <li key={i}>
                  <div className="row" style={{ marginBottom: 3 }}>
                    <span className="badge badge-danger">{c.verdict}</span>
                    {c.is_required_safety === 1 && (
                      <span className="badge badge-warning">반드시 지켜야 할 것</span>
                    )}
                    <span className="spacer" />
                    <span className="card-note">{c.seq}차</span>
                  </div>
                  <div className="dept-app-title">{c.body}</div>
                  {c.evidence && <div className="card-note honest-why">{c.evidence}</div>}
                </li>
              ))}
            </ul>
          )}
          {data.unresolvedChallenges.map((c, i) => (
            <div key={i} className="honest-alt">
              <strong>{c.title}</strong> {c.body}
            </div>
          ))}
        </section>
      )}

      {data.acceptedWithoutBaseline.length > 0 && (
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">
              만들기로 해 놓고 아직 안 재 본 것 {data.acceptedWithoutBaseline.length}건
            </h2>
          </div>
          <ul className="honest-list">
            {data.acceptedWithoutBaseline.map((a) => (
              <li key={a.ticket_no}>
                <div className="row">
                  <span className="badge badge-neutral">{a.dept}</span>
                  <span className="dept-app-title">{a.title}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <RefuseCatalog />
      <Ready />
    </div>
  )
}

// 이 배포가 실제로 살아 있는가.
//
// 서버에는 검사 창구가 있는데 화면에서 아무도 안 불렀다. 그래서 DB 바인딩이나
// 스키마가 빠진 채 올라가면, 첫 화면은 멀쩡히 뜨고 각 API만 503을 낸다.
// 올린 사람은 원인이 아니라 증상만 본다.
//
// 이 화면에 두는 이유는, 여기가 "무엇이 안 됐는가"를 말하는 자리이기 때문이다.
// 다 준비됐으면 한 줄로 조용히 지나간다 — 늘 상태창이 떠 있으면 아무도 안 읽는다.
function Ready() {
  const { data, error } = useApi('/health')
  if (error || !data) return null

  // R2(파일 보관소) 확인도 이 목록에 있었다. 첨부 기능을 걷어낼 때 서버는
  // 그 확인을 지웠는데 목록만 남아서, **"파일 보관소(R2) 연결 — 모두 확인됨"
  // 이 라이브에 떠 있었다.** 있지도 않은 것을 확인했다고 말한 것이다.
  // 하필 이 화면이 그러면 여기 적힌 나머지도 다 못 믿게 된다.
  const provider = data.checks?.provider === 'supabase' ? 'Supabase' : 'Cloudflare D1'
  const labels = { db: `데이터베이스(${provider}) 연결`, schema: '표 구조 적용' }

  if (data.ready) {
    return (
      <p className="card-note honest-ready">
        이 배포는 준비된 상태입니다 — {Object.values(labels).join(' · ')} 모두 확인됨. 표{' '}
        {num(data.tables.length)}개.
      </p>
    )
  }

  return (
    <section className="notice notice-danger">
      <div className="notice-title">이 배포는 아직 덜 준비됐습니다</div>
      <ul className="honest-ready-list">
        {Object.entries(labels).map(([key, label]) => (
          <li key={key}>
            <span aria-hidden="true">{data.checks[key] ? '○' : '✕'}</span> {label}
            {data.checks[key] ? ' — 됨' : ' — 안 됨'}
          </li>
        ))}
      </ul>
      {data.notes.map((n) => (
        <p key={n} className="card-note">
          {n}
        </p>
      ))}
    </section>
  )
}

// 무엇을 못 하는지 미리 밝혀 둔다.
//
// 반려당한 뒤에 "그건 원래 안 돼요"를 듣는 것과, 내기 전에 알고 있는 것은
// 다르다. 부서가 헛수고를 하지 않게 하려면 목록이 먼저 있어야 한다.
function RefuseCatalog() {
  const [open, setOpen] = useState(false)
  return (
    <section className="card">
      <div className="card-head">
        <h2 className="card-title">애초에 안 받는 일 {REFUSE_REASONS.length}가지</h2>
        <span className="spacer" />
        <button type="button" className="btn-ghost btn-sm" onClick={() => setOpen((v) => !v)}>
          {open ? '접기' : '펼치기'}
        </button>
      </div>
      {open && (
        <ul className="honest-list" style={{ marginTop: 12 }}>
          {REFUSE_REASONS.map((r) => (
            <li key={r.code}>
              <div className="dept-app-title">{r.label}</div>
              <div className="card-note honest-why">{r.detail}</div>
              <div className="honest-alt">
                <strong>대신</strong> {r.alternative}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
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
