import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../api/client.js'
import FileList from '../components/FileList.jsx'
import Thread from '../components/Thread.jsx'
import { ago, dateTimeLabel, duration, num } from '../lib/format.js'
import { noticesFrom, actionsFrom, newSince, seenKey } from '../../shared/notice.js'
import { validateResubmit, MAX_RESUBMIT } from '../../shared/resubmit.js'
import { validateSignoff, VERDICTS } from '../../shared/signoff.js'
import { JOIN_KIND, UNJOIN_KIND } from '../../shared/join.js'
import { RESUBMIT_BACK_KIND } from '../../shared/resubmit.js'

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
      // 손든 부서가 자기 시점으로 여는 주소(?as=부서)를 지우지 않는다.
      // 지우면 새로고침 한 번에 낸 부서 시점으로 돌아가고, 그 부서는
      // 자기가 적어 낸 한 줄을 다시 못 찾는다.
      const as = params.get('as')
      setParams(as ? { no: clean, as } : { no: clean }, { replace: true })
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

      {data && <Result data={data} as={params.get('as')} onChanged={() => look(data.ticket)} />}

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

function Result({ data, as, onChanged }) {
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
          <strong>{data.currentStage}</strong> 단계에 있습니다
          {data.stageProgress &&
            ` — 끝난 것 ${data.stageProgress.done}, 남은 것 ${data.stageProgress.total - data.stageProgress.done}`}
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

      {/* 손든 부서가 자기 시점으로 열었을 때.
          손든 부서는 접수번호가 없어서 낸 부서의 번호로 열게 되는데,
          그러면 화면 전체가 낸 부서 시점이라 자기가 적어 낸 한 줄이
          어떻게 됐는지 못 찾는다. */}
      {as && <AsDept data={data} dept={as} />}

      {/* 반려는 지금까지 막다른 길이었다. 부서는 "그건 원래 안 됩니다"와
          대안 한 줄을 읽고 끝났다. 대안을 읽는 것과 그 대안대로 신청서를
          고치는 것은 다른 일이고, 그 사이를 메우지 않으면 대안은 읽히기만
          하고 아무 일도 안 일어난다. */}
      {refused && <Retry ticket={data.ticket} onDone={onChanged} />}

      {/* 협의안 화면은 이 기준을 "부서와 합의해 정한 것"이라고 말한다.
          그런데 확정은 담당자 혼자 하고, 부서는 그 문장을 본 적이 없다.
          여기서 실제로 보여드리고 받는다. */}
      <Signoff ticket={data.ticket} as={as} onDone={onChanged} />

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
                {/* 소식이 다른 신청서를 가리키면 그리로 갈 수 있어야 한다.
                    "고쳐서 다시 내셨습니다"만 적어 두고 그 신청서로 가는
                    길이 없으면, 부서는 접수번호를 손으로 옮겨 적는다. */}
                {n.link && (
                  <Link to={n.link} className="btn-ghost btn-sm notice-link">
                    {n.linkLabel ?? '열어 보기'}
                  </Link>
                )}
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

// 반려당한 뒤에 부서가 할 수 있는 일.
//
// 지금까지 반려는 막다른 길이었다. 이유와 대안을 읽고 끝났다. 그런데
// **다시 내기를 그냥 열어 두면 반려가 뜻이 없어진다** — 같은 것이 그대로
// 다시 오고, 담당자는 같은 판정을 두 번 한다.
//
// 그래서 되는 것만 열어 둔다. 안 되는 사유는 안 된다고 먼저 말한다.
// 헛수고를 시키지 않는 것이 이 자리의 핵심이다.
function Retry({ ticket, onDone }) {
  const [info, setInfo] = useState(null)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(null)
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)

  useEffect(() => {
    let alive = true
    api
      .get(`/track/${encodeURIComponent(ticket)}/resubmit`)
      .then((r) => {
        if (alive) setInfo(r)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [ticket])

  if (!info?.eligible) return null
  const plan = info.plan

  if (done) {
    return (
      <section className="retry retry-done">
        <div className="retry-head">
          <span className="badge badge-accent">다시 내셨습니다</span>
        </div>
        <h3>새 접수번호는 {done.ticket_no}입니다</h3>
        <p>
          앞 신청서({done.previous_ticket})와 이어서 기록됩니다. 담당자는 이것이 고쳐 낸 것이라는
          것과, 무엇을 바꾸셨는지를 열자마자 봅니다.
        </p>
        <Link to={`/track?no=${done.ticket_no}`} className="btn-primary btn-sm">
          새 신청서 조회하기
        </Link>
      </section>
    )
  }

  function start() {
    setForm({ ...info.draft, changed: '' })
    setOpen(true)
  }

  async function submit(e) {
    e.preventDefault()
    const bad = validateResubmit(form)
    setErrors(bad)
    if (Object.keys(bad).length > 0) return
    setBusy(true)
    try {
      const r = await api.post(`/track/${encodeURIComponent(ticket)}/resubmit`, form)
      setDone(r)
      setOpen(false)
      onChangedSafely(onDone)
    } catch (err) {
      setErrors({ changed: err.message })
    } finally {
      setBusy(false)
    }
  }

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  return (
    <section className={`retry${plan.canRetry ? '' : ' retry-no'}`}>
      <div className="retry-head">
        <span className={`badge ${plan.canRetry ? 'badge-accent' : 'badge-neutral'}`}>
          반려된 뒤에 하실 수 있는 것
        </span>
        {plan.canRetry && (
          <span className="card-note">
            {plan.left}번 더 고쳐 내실 수 있습니다 (최대 {MAX_RESUBMIT}번)
          </span>
        )}
      </div>

      <h3>{plan.headline}</h3>

      {/* 담당자가 이 건을 보고 직접 쓴 대안이 있으면 그것부터. 규칙이 만든
          일반론보다 언제나 낫다. */}
      {plan.fromReviewer && (
        <p className="retry-from-reviewer">
          <strong>담당자가 적어 둔 대안</strong> {plan.fromReviewer}
        </p>
      )}

      <p className="retry-change">{plan.change}</p>

      {plan.canRetry && !open && (
        <button type="button" className="btn-primary btn-sm" onClick={start}>
          {plan.cta}
        </button>
      )}

      {open && (
        <form className="retry-form" onSubmit={submit}>
          {/* 바꾼 것을 맨 위에 둔다. 담당자가 열자마자 보는 것도 이것이고,
              부서가 적으면서 스스로 확인하게 되는 것도 이것이다. */}
          <label>
            <span>무엇을 바꾸셨습니까</span>
            <textarea
              rows={3}
              value={form.changed}
              onChange={set('changed')}
              placeholder="등록까지가 아니라 올릴 파일까지만 만들어 주시면 됩니다. 등록 버튼은 저희가 누르겠습니다."
            />
            {errors.changed && <em className="field-error">{errors.changed}</em>}
            <small className="card-note">
              이걸 안 적으면 담당자가 앞 판정을 찾아 대조해야 무엇이 달라졌는지 압니다. 그 일을
              시키지 않으려고 여쭙습니다.
            </small>
          </label>

          <label>
            <span>제목</span>
            <input value={form.title} onChange={set('title')} />
            {errors.title && <em className="field-error">{errors.title}</em>}
          </label>

          <label>
            <span>무엇이 병목입니까</span>
            <textarea rows={3} value={form.bottleneck} onChange={set('bottleneck')} />
            {errors.bottleneck && <em className="field-error">{errors.bottleneck}</em>}
          </label>

          <label>
            <span>그래서 지금 무슨 일이 벌어집니까</span>
            <textarea rows={3} value={form.problem} onChange={set('problem')} />
            {errors.problem && <em className="field-error">{errors.problem}</em>}
          </label>

          <label>
            <span>바라시는 해결 방안 (선택)</span>
            <textarea rows={2} value={form.wish ?? ''} onChange={set('wish')} />
          </label>

          <p className="card-note">
            부서·신청자·연락처는 앞 신청서 그대로 갑니다. 같은 분이 같은 일로 다시 내시는 것이라
            다시 여쭙지 않습니다.
          </p>

          <div className="row">
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? '내는 중…' : '다시 내기'}
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              그만두기
            </button>
          </div>
        </form>
      )}
    </section>
  )
}

// 부모가 새로고침 함수를 안 넘겨도 터지지 않게.
function onChangedSafely(fn) {
  if (typeof fn === 'function') fn()
}

// 합격 기준을 부서가 직접 보고 확인한다.
//
// 서명 버튼 하나를 놓고 "동의합니다"를 누르게 하지 않는다. 그건 아무도
// 안 읽는다. **항목마다** 맞다/아니다를 고르게 하고, 아니라고 하면 왜
// 아닌지를 받는다. 한 항목이라도 안 고르면 못 넘어간다 — 안 고른 것을
// 동의로 세면, 안 읽은 것을 읽었다고 기록하는 셈이 된다.
function Signoff({ ticket, as, onDone }) {
  const [data, setData] = useState(null)
  const [by, setBy] = useState('')
  // 손든 부서가 ?as=부서로 들어왔으면 그 부서를 골라 둔다. 안 그러면
  // 자기 부서를 다시 고르게 되고, 안 고르고 넘기면 남의 부서 서명이 된다.
  const [dept, setDept] = useState(as ?? '')
  const [verdicts, setVerdicts] = useState({})
  const [reasons, setReasons] = useState({})
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  const reload = useCallback(() => {
    api
      .get(`/track/${encodeURIComponent(ticket)}/signoff`)
      .then(setData)
      .catch(() => {})
  }, [ticket])

  useEffect(() => {
    reload()
  }, [reload])

  if (!data) return null
  const { criteria, state } = data
  // 기준 자체가 아직 없으면 이 자리는 아무 말도 하지 않는다. 없는 것을
  // "준비중"이라고 띄우면 화면만 늘어난다.
  if (criteria.length === 0) return null

  async function submit(e) {
    e.preventDefault()
    const bad = validateSignoff({
      by,
      dept,
      requiredDepts: data.requiredDepts,
      criteria,
      verdicts,
      reasons,
    })
    setErrors(bad)
    if (Object.keys(bad).length > 0) return
    setBusy(true)
    try {
      const r = await api.post(`/track/${encodeURIComponent(ticket)}/signoff`, {
        by,
        // 안 고른 것을 아무 부서로나 채우지 않는다. 부서가 하나뿐이면
        // 서버가 채워 주고, 여럿이면 아래 validateSignoff가 먼저 막는다.
        dept,
        verdicts,
        reasons,
      })
      setMsg(r.message)
      reload()
      onChangedSafely(onDone)
    } catch (err) {
      setErrors({ by: err.message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={`signoff signoff-${state.status === '확인됨' ? 'done' : state.status === '이의 있음' ? 'objected' : 'open'}`}>
      <div className="signoff-head">
        <span className="badge badge-neutral">합격 기준 {criteria.length}개</span>
        <span className={`badge ${state.binding ? 'badge-success' : 'badge-warning'}`}>
          {state.status}
        </span>
      </div>

      <h3>{state.headline}</h3>
      <p className="signoff-why">
        이 기준으로 시험하고 통과·불통과를 판정합니다. 안 보신 채로 넘어가면, 나중에 "내가 원한
        건 이게 아닌데"라고 하셔도 저희는 <strong>"기준을 통과했습니다"라고밖에 답할 수 없습니다.</strong>
      </p>
      {state.why && <p className="card-note">{state.why}</p>}

      {/* 여러 부서가 걸린 일이면 누가 확인했고 누가 아직인지 보여준다.
          안 보여주면 각 부서는 자기가 확인하면 끝난 줄 안다. */}
      {(state.requiredDepts?.length ?? 0) > 1 && (
        <ul className="signoff-depts">
          {state.requiredDepts.map((d) => (
            <li key={d} className={state.signedDepts?.includes(d) ? 'done' : ''}>
              <span aria-hidden="true">{state.signedDepts?.includes(d) ? '○' : '·'}</span> {d}
              <span className="card-note">
                {state.signedDepts?.includes(d) ? ' 확인하셨습니다' : ' 아직입니다'}
              </span>
            </li>
          ))}
        </ul>
      )}
      {msg && <p className="signoff-msg">{msg}</p>}

      <ul className="signoff-list">
        {criteria.map((c) => (
          <li key={c.id} className={verdicts[c.id] === 'no' ? 'objected' : ''}>
            <div className="signoff-body">
              {c.body}
              {c.is_required_safety === 1 && (
                <span className="badge badge-danger">이건 빼면 안 되는 것</span>
              )}
              <span className="card-note">
                {c.check_kind === 'rule' ? '기계가 자동으로 판정' : '사람이 직접 확인'}
              </span>
            </div>

            {data.objectionsByCriterion?.[c.id] && (
              <>
                <p className="signoff-objected-note">
                  <strong>아니라고 하신 이유</strong> {data.objectionsByCriterion[c.id].body}
                </p>
                {/* 담당자가 뭐라고 답했는지까지 보여준다. 안 보여주면
                    부서는 자기가 낸 이의가 읽히기는 했는지 모른다. */}
                {data.objectionsByCriterion[c.id].answer && (
                  <p className="signoff-answer">
                    <strong>{data.objectionsByCriterion[c.id].answer.by}님 답</strong>{' '}
                    {data.objectionsByCriterion[c.id].answer.body}
                  </p>
                )}
              </>
            )}

            {state.canSign && (
              <div className="signoff-pick">
                {Object.entries(VERDICTS).map(([code, v]) => (
                  <label key={code}>
                    <input
                      type="radio"
                      name={`v-${c.id}`}
                      checked={verdicts[c.id] === code}
                      onChange={() => setVerdicts((s) => ({ ...s, [c.id]: code }))}
                    />
                    {v.label}
                  </label>
                ))}
                {verdicts[c.id] === 'no' && (
                  <input
                    className="signoff-reason"
                    placeholder="무엇이 다릅니까 — 이걸 모르면 고칠 수가 없습니다"
                    value={reasons[c.id] ?? ''}
                    onChange={(e) => setReasons((s) => ({ ...s, [c.id]: e.target.value }))}
                  />
                )}
              </div>
            )}
          </li>
        ))}
      </ul>

      {state.canSign && (
        <form className="signoff-form" onSubmit={submit}>
          {errors.verdicts && <em className="field-error">{errors.verdicts}</em>}
          {errors.reasons && <em className="field-error">{errors.reasons}</em>}
          {/* 걸린 부서가 여럿이면 어느 부서로 확인하시는지 골라야 한다.
              자유 입력으로 두면 "마케팅"과 "마케팅팀"이 다른 부서가 되어,
              다 모였는데도 영영 "일부만 확인"으로 남는다. */}
          {(data.requiredDepts?.length ?? 0) > 1 && (
            <label>
              <span>어느 부서로 확인하십니까</span>
              <select value={dept} onChange={(e) => setDept(e.target.value)}>
                <option value="">고르세요</option>
                {data.requiredDepts.map((d) => (
                  <option key={d} value={d} disabled={state.signedDepts?.includes(d)}>
                    {d}
                    {state.signedDepts?.includes(d) ? ' (이미 확인하셨습니다)' : ''}
                  </option>
                ))}
              </select>
              {errors.dept && <em className="field-error">{errors.dept}</em>}
              <small className="card-note">
                이 일은 {data.requiredDepts.length}개 부서가 걸려 있습니다. 부서마다 한 번씩
                확인해주셔야 이 기준으로 판정할 수 있습니다.
              </small>
            </label>
          )}

          <label>
            <span>확인하신 분</span>
            <input
              value={by}
              onChange={(e) => setBy(e.target.value)}
              placeholder="김대리"
            />
            {errors.by && <em className="field-error">{errors.by}</em>}
            <small className="card-note">
              계정을 만드시라고 하지 않습니다. 다만 서명인데 누가 하셨는지 모르면 서명이 아니라서
              성함만 여쭙습니다.
            </small>
          </label>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? '남기는 중…' : '확인했습니다'}
          </button>
        </form>
      )}
    </section>
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
  // 성과는 계속 쌓이는 것이라 '진행중'과 다르게 칠한다. 같은 색이면
  // 아직 뭔가 만들고 있는 것처럼 읽힌다.
  if (s === '집계 중') return 'counting'
  if (s === '되돌림') return 'back'
  return 'wait'
}

// 손든 부서가 자기 시점으로 열었을 때 맨 위에 뜨는 것.
//
// 이 화면은 원래 낸 부서 것이다. 손든 부서가 그대로 열면 남의 신청서를
// 구경하는 꼴이 되고, 자기가 적어 낸 한 줄이 어디로 갔는지 못 찾는다.
//
// **이의 칸은 안 연다.** 부서가 말할 자리는 합격 기준 서명이고, 그 앞에
// 말할 칸을 하나 더 만들면 부서는 같은 것을 두 번 확인하게 된다. 그리고
// 담당자는 "물어봤는데 답이 없다 = 동의했다"는 착시를 얻는다.
// 알려 주기만 하고 묻지 않는다.
function AsDept({ data, dept }) {
  const status = data.application?.status
  const mine = (data.decisions ?? []).find((d) => {
    if (d.link_kind !== JOIN_KIND) return false
    try {
      return JSON.parse(d.alternatives || d.why).dept === dept
    } catch {
      return String(d.title ?? '').startsWith(dept)
    }
  })
  if (!mine) return null

  const released = (data.decisions ?? []).some(
    (d) => d.link_kind === UNJOIN_KIND && d.link_id === mine.id
  )

  // 반려된 뒤 고쳐서 다시 냈으면 그쪽 번호를 알려 준다.
  //
  // 재신청은 새 신청서를 만들고 손들기는 안 옮긴다. 그래서 손든 부서는
  // 한 번의 재신청으로 조용히 증발한다 — 담당자는 새 건을 다시 한 부서
  // 일로 보고 우선순위를 매긴다. 손들기 기능이 막으려던 바로 그 상황이다.
  const resubmitted = (data.decisions ?? []).find((d) => d.link_kind === RESUBMIT_BACK_KIND)
    ?.link_ticket

  return (
    <section className={`as-dept${released ? ' released' : ''}`}>
      <div className="as-dept-head">
        <span className="badge badge-accent">{dept} 시점으로 보고 계십니다</span>
        <span className="card-note">{ago(mine.created_at)}에 붙이셨습니다</span>
      </div>

      <p className="as-dept-said">
        <strong>적어 주신 것</strong> {mine.what}
      </p>

      {released ? (
        <p className="as-dept-gone">
          담당자가 <strong>이 건은 그쪽 일과 다르다</strong>고 판정했습니다. {dept} 병목은 따로
          신청서를 내 주셔야 합니다.
        </p>
      ) : status === '반려' ? (
        // 신청서 상태를 안 보면, 반려된 건에서도 "진행되면 같이 쓰시게
        // 됩니다"라고 말하게 된다. 화면 위쪽에는 반려 배지가 떠 있는데
        // 아래에서는 진행된다고 하는 꼴이다.
        <p className="as-dept-gone">
          이 신청서는 <strong>반려됐습니다.</strong> 붙여 주신 것도 여기서 함께 멈춥니다.
          {resubmitted ? (
            <>
              {' '}
              낸 부서가 <strong>{resubmitted}</strong>로 고쳐서 다시 냈습니다. 그쪽에도 손들어
              주셔야 {dept} 몫이 같이 세어집니다.
            </>
          ) : (
            ' 그쪽 병목이 그대로라면 따로 신청서를 내 주셔야 합니다.'
          )}
        </p>
      ) : status === '보류' ? (
        <p className="as-dept-gone">
          이 신청서는 <strong>보류된 상태입니다.</strong> 다시 볼 때까지 붙여 주신 것도 같이
          기다립니다.
        </p>
      ) : status === '완료' ? (
        <p className="card-note">
          이 신청서는 <strong>끝났습니다.</strong> 넘어간 도구를 {dept}도 그대로 쓰실 수 있습니다.
        </p>
      ) : (
        <p className="card-note">
          이 신청서가 진행되면 {dept}도 같이 쓰시게 됩니다. 아래 진행 상황이 그대로 그쪽 일의
          진행 상황입니다. 합격 기준이 정해지면 {dept} 몫으로 한 번 확인해주셔야 합니다.
        </p>
      )}

      {status === '반려' && resubmitted && (
        <Link to={`/track?no=${resubmitted}&as=${encodeURIComponent(dept)}`} className="btn-primary btn-sm">
          다시 낸 신청서 보기
        </Link>
      )}
    </section>
  )
}
