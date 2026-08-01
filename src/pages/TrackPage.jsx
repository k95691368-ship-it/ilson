import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../api/client.js'
import FileList from '../components/FileList.jsx'
import Thread from '../components/Thread.jsx'
import { ago, dateTimeLabel, duration, num } from '../lib/format.js'
import { noticesFrom, actionsFrom, newSince, seenKey } from '../../shared/notice.js'

// 접수번호로 내 신청서가 어디까지 왔는지 보는 화면.
//
// 부서 담당자가 여는 자리다. 신청서를 내면 접수번호를 주는데 그걸로 볼 데가
// 없어서, 결국 담당자에게 전화해 "제가 낸 거 어떻게 됐나요"를 묻게 된다.
// 그 전화를 없애는 것이 이 화면의 목적이다.
//
// 로그인이 없다. 상단 목차도 없다 — 부서 담당자는 이 사이트의 나머지를 볼
// 이유가 없다.
export default function TrackPage() {
  const [params, setParams] = useSearchParams()
  const [ticket, setTicket] = useState(params.get('no') ?? '')
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  async function look(no) {
    const clean = String(no ?? '').trim().toUpperCase()
    if (!clean) return
    setLoading(true)
    setError(null)
    try {
      const r = await api.get(`/track/${encodeURIComponent(clean)}`)
      setData(r)
      setParams({ no: clean }, { replace: true })
    } catch (err) {
      setError(err.message)
      setData(null)
    } finally {
      setLoading(false)
    }
  }

  // 주소에 번호가 붙어 있으면 바로 찾아 준다.
  // 담당자가 "여기 눌러 보세요" 하고 링크를 보낼 수 있다.
  useEffect(() => {
    const no = params.get('no')
    if (no && !data && !loading) look(no)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 사람이 대시를 빼고 적거나 소문자로 적는 일이 흔하다. 알아서 맞춰 준다.
  function normalize(raw) {
    const only = raw.toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (only.length <= 2) return only
    if (only.length <= 5) return `${only.slice(0, 2)}-${only.slice(2)}`
    return `${only.slice(0, 2)}-${only.slice(2, 5)}-${only.slice(5, 8)}`
  }

  return (
    <div className="stack track-page">
      <header className="page-head">
        <span className="page-eyebrow">부서 담당자용</span>
        <h1>내가 낸 신청서, 어떻게 됐나요</h1>
        <p className="page-sub">
          신청서를 낼 때 받은 접수번호를 넣으면 지금 어느 단계까지 왔는지 보여드립니다.
          반려된 경우에도 이유와 대안을 함께 보여드립니다.
        </p>
      </header>

      <form
        className="track-form"
        onSubmit={(e) => {
          e.preventDefault()
          look(ticket)
        }}
      >
        <input
          value={ticket}
          onChange={(e) => setTicket(normalize(e.target.value))}
          placeholder="AX-000-000"
          className="track-input mono"
          maxLength={10}
          autoComplete="off"
          aria-label="접수번호"
        />
        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? '찾는 중…' : '찾기'}
        </button>
      </form>

      {error && (
        <div className="notice notice-warn">
          <div className="notice-title">찾지 못했습니다</div>
          <p>{error}</p>
          <p className="card-note" style={{ marginTop: 6 }}>
            접수번호는 신청서를 낼 때 화면에 나옵니다. 0과 O, 1과 I는 쓰지 않으니 헷갈리시면
            그 글자들은 아닙니다.
          </p>
        </div>
      )}

      {data && <Result data={data} onChanged={() => look(data.ticket)} />}

      {!data && !error && (
        <div className="card">
          <div className="card-title">접수번호가 없으신가요</div>
          <p className="card-note" style={{ marginBottom: 10 }}>
            아직 신청하지 않으셨다면 지금 내실 수 있습니다. 로그인은 필요 없습니다.
          </p>
          <Link to="/apply" className="btn-ghost">
            병목 신청서 내기
          </Link>
        </div>
      )}
    </div>
  )
}

function Result({ data, onChanged }) {
  const a = data.application
  const refused = a.status === '반려'

  const notices = useMemo(() => noticesFrom(data), [data])
  const actions = useMemo(() => actionsFrom(data), [data])

  // 이 브라우저에서 마지막으로 본 시각. 서버에 저장하지 않는다.
  //
  // 이 사이트는 부서 담당자에게 계정을 만들게 하지 않기로 했다. 계정이
  // 없으면 누가 읽었는지 구분할 수 없어서, 접수번호 단위로 서버에 저장하면
  // AX 담당자가 열어 본 것까지 신청자가 읽은 것으로 처리된다. 그건 틀린
  // 기록이다. 그래서 브라우저에만 남기고, 화면에도 그렇게 적는다.
  const [lastSeen, setLastSeen] = useState(null)

  useEffect(() => {
    let prev = null
    try {
      prev = window.localStorage.getItem(seenKey(data.ticket))
    } catch {
      // 사생활 보호 모드 등으로 저장소를 못 쓰는 브라우저가 있다.
      // 그때는 새 표시가 안 붙을 뿐, 화면 나머지는 그대로 돌아야 한다.
    }
    setLastSeen(prev)

    // 이번에 본 시각을 남긴다. 다음에 오면 이 뒤에 생긴 것이 새 것이다.
    // 화면을 그린 뒤에 남겨야 이번 방문의 '새 것'이 살아 있다.
    try {
      const now = notices[0]?.at
      if (now) window.localStorage.setItem(seenKey(data.ticket), now)
    } catch {
      // 위와 같다.
    }
  }, [data.ticket, notices])

  const fresh = useMemo(() => newSince(notices, lastSeen), [notices, lastSeen])
  const freshKeys = useMemo(() => new Set(fresh.map((n) => n.key)), [fresh])

  return (
    <div className="stack">
      <section className={`track-head${refused ? ' refused' : ''}`}>
        <div className="row" style={{ marginBottom: 8 }}>
          <span className="mono badge badge-neutral">{data.ticket}</span>
          <span className="badge badge-neutral">{a.dept}</span>
          <span className={`badge ${statusTone(a.status)}`}>{a.status}</span>
          {fresh.length > 0 && (
            <span className="badge badge-accent">지난번 뒤로 새 소식 {fresh.length}건</span>
          )}
          <span className="spacer" />
          <span className="card-note">{ago(a.created_at)} 접수</span>
        </div>
        <h2 style={{ margin: 0 }}>{a.title}</h2>
        <p className="card-note" style={{ marginTop: 4 }}>
          {a.applicant} · 지금{' '}
          <strong>{data.currentStage}</strong> 단계까지 왔습니다
          {a.annual_hours != null && ` · 연 ${num(a.annual_hours, 0)}시간이 드는 일로 접수됐습니다`}
        </p>
      </section>

      {/* 다른 신청서와 같은 건으로 묶였으면 그것부터. 모르면 이미 만들고
          있는 것을 두고 몇 주를 기다린다. "중복입니다"로 끝내지 않는다 —
          버린 것이 아니라 그쪽에서 함께 처리된다는 것을 말해야 한다. */}
      {data.mergedInto && (
        <section className="merged-notice">
          <div className="merged-head">
            <span className="badge badge-accent">같은 건으로 묶임</span>
            <span className="card-note">{ago(data.mergedInto.at)}</span>
          </div>
          <h3>{data.mergedInto.ticket_no} 와 같은 건입니다</h3>
          <p>
            내주신 것과 같은 병목을 {data.mergedInto.dept}에서 먼저 냈습니다. 두 번 만들지
            않으려고 <strong>그쪽에서 함께 처리합니다</strong>.
          </p>
          <p className="card-note">
            따로 만들지 않을 뿐이지 안 하는 것이 아닙니다. 그쪽이 다 되면 바로 쓰실 수 있습니다.
          </p>
          {data.mergedInto.why && (
            <p className="merged-why">
              <strong>왜 같은 건이라고 봤나</strong> {data.mergedInto.why}
            </p>
          )}
          <div className="row">
            <Link to={`/track?no=${data.mergedInto.ticket_no}`} className="btn-primary btn-sm">
              그 신청서가 어디까지 왔는지 보기
            </Link>
            <span className="card-note">
              지금 {data.mergedInto.status} 단계입니다 — {data.mergedInto.title}
            </span>
          </div>
        </section>
      )}

      {/* 지금 이 부서가 움직여야 진행되는 것.
          진행 상황보다 위에 둔다. 어디까지 왔는지보다, 지금 멈춰 있는
          이유가 내 쪽에 있다는 것을 먼저 알아야 하기 때문이다. */}
      {actions.length > 0 && (
        <section className="track-actions">
          <div className="track-actions-head">
            <span className="track-actions-title">해주셔야 할 일 {actions.length}가지</span>
            <span className="card-note">이게 있으면 저희 쪽에서는 더 못 나갑니다</span>
          </div>
          <ol>
            {actions.map((x) => (
              <li key={x.code}>
                <div className="track-action-headline">{x.headline}</div>
                {x.body && <div className="track-action-body">{x.body}</div>}
                <div className="track-action-why">{x.why}</div>
                {x.link && (
                  <Link to={x.link} className="btn-primary btn-sm">
                    열어 보기
                  </Link>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}

      {notices.length > 0 && (
        <section className="card">
          <div className="card-head">
            <span className="card-title">그동안의 소식</span>
            <span className="spacer" />
            <span className="card-note">
              {lastSeen
                ? `이 브라우저에서 ${dateTimeLabel(lastSeen)}까지 보셨습니다`
                : '이 브라우저에서는 처음 여셨습니다'}
            </span>
          </div>
          <ol className="notice-list">
            {notices.map((n) => (
              <li key={n.key} className={freshKeys.has(n.key) ? 'fresh' : ''}>
                <div className="notice-top">
                  {freshKeys.has(n.key) && <span className="badge badge-accent">새 소식</span>}
                  <span className="badge badge-neutral">{n.stage}</span>
                  <span className="spacer" />
                  <span className="card-note" title={dateTimeLabel(n.at)}>
                    {ago(n.at)}
                  </span>
                </div>
                <div className="notice-headline">{n.headline}</div>
                <div className="notice-body">{n.body}</div>
              </li>
            ))}
          </ol>
          <p className="card-note notice-foot">
            메일이나 문자로 보내드리지는 않습니다. 이 주소를 저장해 두시면 언제든 여기서 확인하실
            수 있습니다. 새 소식 표시는 이 브라우저 기준이라, 다른 기기에서 여시면 다시 처음부터
            보입니다.
          </p>
        </section>
      )}

      <section className="card">
        <div className="card-head">
          <span className="card-title">진행 상황</span>
          <span className="card-note">여덟 단계</span>
        </div>
        <ol className="track-timeline">
          {data.timeline.map((t) => (
            <li key={t.stage} className={`track-step ${stepClass(t.status)}`}>
              <span className="track-mark" aria-hidden="true">
                {t.status === '완료' ? '✓' : t.status === '진행중' ? '•' : t.status === '되돌림' ? '↩' : ''}
              </span>
              <div className="track-body">
                <div className="track-stage">
                  {t.stage}
                  <span className={`badge ${stageTone(t.status)}`}>{t.status}</span>
                  {t.at && <span className="card-note">{dateTimeLabel(t.at)}</span>}
                </div>
                <div className="track-summary">{t.summary}</div>

                {t.detail && (
                  <dl className="kv track-detail">
                    {t.detail.판정_이유 && (
                      <>
                        <dt>왜 그렇게 정했나</dt>
                        <dd>{t.detail.판정_이유}</dd>
                      </>
                    )}
                    {t.detail.대안 && (
                      <>
                        <dt>대신 해 드릴 수 있는 것</dt>
                        <dd>{t.detail.대안}</dd>
                      </>
                    )}
                    {t.detail.다시_볼_조건 && (
                      <>
                        <dt>다시 볼 조건</dt>
                        <dd>{t.detail.다시_볼_조건}</dd>
                      </>
                    )}
                  </dl>
                )}

                {t.link && (
                  <Link to={t.link} className="btn-ghost btn-sm" style={{ marginTop: 8 }}>
                    도구 열기
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ol>
      </section>

      <details className="disclose">
        <summary>내가 적어 낸 내용 다시 보기</summary>
        <div className="disclose-body">
          <dl className="kv">
            <dt>무엇이 병목인가</dt>
            <dd>{a.bottleneck || '(비워 두셨습니다)'}</dd>
            <dt>그래서 무슨 일이</dt>
            <dd>{a.problem || '(비워 두셨습니다)'}</dd>
            {a.wish && (
              <>
                <dt>바라는 것</dt>
                <dd>{a.wish}</dd>
              </>
            )}
            {a.claimed_minutes && (
              <>
                <dt>지금 드는 시간</dt>
                <dd>
                  {duration(a.claimed_minutes * 60)}
                  {a.claimed_frequency && ` · ${a.claimed_frequency}`}
                </dd>
              </>
            )}
          </dl>
          {data.files.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div className="card-note" style={{ marginBottom: 6 }}>
                함께 올리신 파일 {data.files.length}개 — 그대로 보관 중입니다
              </div>
              <FileList applicationId={data.ticket} files={data.files} compact />
            </div>
          )}
        </div>
      </details>

      <Thread
        decisions={data.decisions}
        ticket={data.ticket}
        mode="dept"
        onChanged={onChanged}
      />

      {data.decisions.length > 0 && (
        <details className="disclose">
          <summary>담당자가 내린 결정 {data.decisions.length}건</summary>
          <div className="disclose-body">
            <div className="stack-sm">
              {data.decisions.map((d, i) => (
                <div key={i} className="decided">
                  <span className="origin-label origin-human">
                    ◆ {d.stage} · {ago(d.created_at)}
                  </span>
                  <div className="item-body" style={{ fontSize: 14, fontWeight: 700 }}>
                    {d.title}
                  </div>
                  <div className="card-note" style={{ marginTop: 3 }}>
                    {d.what}
                  </div>
                  <div className="decision-why">
                    <strong>왜</strong> {d.why}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </details>
      )}

      <p className="card-note track-foot">
        {data.contact
          ? `궁금한 것이 있으면 — ${data.contact}`
          : '궁금한 것이 있으면 AX 담당자에게 문의해주세요.'}
      </p>
    </div>
  )
}

function statusTone(s) {
  if (s === '수용' || s === '완료') return 'badge-success'
  if (s === '반려') return 'badge-danger'
  if (s === '보류') return 'badge-warning'
  if (s === '진행중') return 'badge-accent'
  return 'badge-neutral'
}

function stageTone(s) {
  if (s === '완료') return 'badge-success'
  if (s === '진행중') return 'badge-accent'
  if (s === '되돌림') return 'badge-danger'
  return 'badge-neutral'
}

function stepClass(s) {
  if (s === '완료') return 'done'
  if (s === '진행중') return 'now'
  if (s === '되돌림') return 'back'
  return 'wait'
}
