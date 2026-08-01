import { Link, useParams } from 'react-router-dom'
import { useApi } from '../hooks/useApi.js'
import { ago, dateTimeLabel, duration, num } from '../lib/format.js'

// 부서 한 곳과 나 사이에 있었던 일 전부.
//
// 다른 화면은 전부 신청서 단위다. 그런데 실제로 일하는 단위는 부서다.
// 재무 팀장을 만나기 전에 알아야 할 것은 "AX-EFD-E58이 어디까지 왔나"가
// 아니라 "재무와 그동안 뭘 했고, 지금 내가 재무에 못 준 게 뭔가"다.
//
// 그래서 이 화면은 '내가 이 부서에 빚진 것'으로 시작한다. 보통 대시보드는
// 남이 나한테 안 해 준 것을 센다. 만들기 쉽고 보기 편하지만, 부서와 마주
// 앉을 때 아무 쓸모가 없다.
export default function DeptPage() {
  const { dept } = useParams()
  const { data, error, loading } = useApi(`/depts/${encodeURIComponent(dept)}`)

  if (error) return <div className="notice notice-danger">{error}</div>
  if (loading && !data) return <div className="page-loading">불러오는 중…</div>
  if (!data) return null

  const s = data.summary

  return (
    <div className="stack">
      <header className="page-head">
        <span className="page-eyebrow">부서</span>
        <h1>{data.dept}와 나 사이에 있었던 일</h1>
        <p className="page-sub">
          신청서 단위가 아니라 부서 단위로 봅니다. 이 부서 담당자와 마주 앉기 전에 알아야 할 것은
          신청서 하나가 어디까지 왔는지가 아니라, <strong>지금 내가 이 부서에 못 준 것이 무엇인지</strong>
          입니다.
        </p>
      </header>

      {/* 내가 빚진 것. 맨 위다. */}
      {data.owed.length > 0 ? (
        <section className="owed">
          <div className="owed-head">
            <span className="owed-title">내가 {data.dept}에 못 준 것 {data.owed.length}가지</span>
            <span className="card-note">이 부서를 만나기 전에 이것부터 봅니다</span>
          </div>
          <ol>
            {data.owed.map((o, i) => (
              <li key={i}>
                <div className="owed-top">
                  <span className="badge badge-warning">{OWED_LABEL[o.code] ?? '미처리'}</span>
                  {o.ticket_no && (
                    <Link to={`/record/${o.ticket_no}`} className="mono card-note">
                      {o.ticket_no}
                    </Link>
                  )}
                </div>
                <div className="owed-what">{o.title}</div>
                <div className="owed-why">{o.text}</div>
              </li>
            ))}
          </ol>
        </section>
      ) : (
        <section className="card decided">
          <div className="card-title">{data.dept}에 밀린 것은 없습니다</div>
          <p className="card-note">
            답을 못 준 신청서도, 사유 없이 기각한 요구도, 판정 못 낸 충돌도, 답 못 한 의견도
            없습니다. 이 상태를 유지하는 것이 이 화면의 목적입니다.
          </p>
        </section>
      )}

      <section className="stat-row">
        <Tile label="이 부서가 낸 신청서" value={num(s.total)} note={`그중 아직 안 본 것 ${s.waiting}건`} />
        <Tile
          label="만들기로 한 것"
          value={num(s.accepted + s.inProgress + s.done)}
          note={`반려 ${s.refused} · 보류 ${s.held}`}
        />
        <Tile
          label="이 부서가 적어 낸 소요"
          value={`연 ${num(s.claimedAnnualHours, 0)}시간`}
          note={
            s.claimedMissing > 0
              ? `${s.claimedMissing}건은 안 적었습니다 · 실측이 아닌 체감치입니다`
              : '실측이 아닌 체감치입니다'
          }
        />
        <Tile
          label="넘긴 도구"
          value={num(s.handedTools)}
          note={
            s.handedBaselineSeconds > 0
              ? `자동화 전 실측 합 ${duration(s.handedBaselineSeconds)}`
              : '아직 없습니다'
          }
        />
      </section>

      <div className="dept-grid">
        <div className="stack">
          <section className="card">
            <div className="card-head">
              <span className="card-title">이 부서가 낸 신청서</span>
              <span className="card-note">{data.applications.length}건</span>
            </div>
            {data.applications.length === 0 ? (
              <p className="card-note">아직 이 부서에서 들어온 것이 없습니다.</p>
            ) : (
              <ol className="dept-apps">
                {data.applications.map((a) => (
                  <li key={a.id}>
                    <div className="dept-app-top">
                      <span className={`badge ${statusTone(a.status)}`}>{a.status}</span>
                      {a.status === '접수' && a.hours_since >= 24 && (
                        <span className="badge badge-warning">
                          {Math.floor(a.hours_since / 24)}일째 답 없음
                        </span>
                      )}
                      <span className="spacer" />
                      <Link to={`/record/${a.id}`} className="mono card-note">
                        {a.ticket_no}
                      </Link>
                    </div>
                    <Link to={`/record/${a.id}`} className="dept-app-title">
                      {a.title}
                    </Link>
                    <div className="card-note">
                      {a.applicant_label} · {ago(a.created_at)}
                      {a.annual_hours != null && ` · 연 ${num(a.annual_hours, 0)}시간이라고 적어 냄`}
                      {a.median_seconds != null &&
                        ` · 재 보니 ${duration(a.median_seconds)}(${a.sample_n}회)`}
                    </div>
                    {a.verdict && (
                      <div className="dept-app-verdict">
                        <strong>{a.verdict}</strong> — {a.verdict_reason}
                        {a.refuse_alternative && (
                          <div className="card-note">대신 제안한 것 — {a.refuse_alternative}</div>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </section>

          {data.requirements.length > 0 && (
            <section className="card">
              <div className="card-head">
                <span className="card-title">이 부서가 회의에서 낸 요구</span>
                <span className="card-note">
                  채택 {data.summary.requirementsTaken} · 기각 {data.summary.requirementsRejected}
                </span>
              </div>
              <p className="card-note" style={{ marginBottom: 10 }}>
                기각한 것도 지웁니다. 기각한 것을 안 보이게 하면, 다음 회의에서 같은 요구가 다시
                나오고 저는 왜 기각했는지 기억하지 못합니다.
              </p>
              <ul className="dept-reqs">
                {data.requirements.map((r) => (
                  <li key={r.id} className={r.status === '기각' ? 'rejected' : ''}>
                    <div className="row" style={{ marginBottom: 3 }}>
                      <span className="badge badge-neutral">{r.kind}</span>
                      <span className="badge badge-neutral">{r.priority}</span>
                      <span
                        className={`badge ${r.status === '기각' ? 'badge-warning' : 'badge-success'}`}
                      >
                        {r.status}
                      </span>
                    </div>
                    <div>{r.status === '수정채택' && r.decided_body ? r.decided_body : r.body}</div>
                    {r.status === '기각' && (
                      <div className="card-note">
                        {r.reject_reason ? `기각 사유 — ${r.reject_reason}` : '기각 사유를 안 적었습니다'}
                      </div>
                    )}
                    {r.quote && <blockquote className="record-quote">“{r.quote}”</blockquote>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {data.conflicts.length > 0 && (
            <section className="card">
              <div className="card-head">
                <span className="card-title">다른 부서와 부딪힌 것</span>
                <span className="card-note">{data.conflicts.length}건</span>
              </div>
              <p className="card-note" style={{ marginBottom: 10 }}>
                부서마다 원하는 것이 다릅니다. 어느 쪽이 이겼는지와 왜 그렇게 정했는지가 남아
                있어야, 진 쪽에게 설명할 수 있습니다.
              </p>
              <ul className="dept-conflicts">
                {data.conflicts.map((c) => (
                  <li key={c.id}>
                    <div className="conflict-pair">
                      <span className={c.a_dept === data.dept ? 'mine' : ''}>
                        <strong>{c.a_dept}</strong> {c.a_body}
                      </span>
                      <span className="conflict-vs">맞섬</span>
                      <span className={c.b_dept === data.dept ? 'mine' : ''}>
                        <strong>{c.b_dept}</strong> {c.b_body}
                      </span>
                    </div>
                    <div className="card-note">{c.reason}</div>
                    {c.verdict ? (
                      <div className="dept-app-verdict">
                        <strong>{verdictText(c, data.dept)}</strong> — {c.verdict_reason}
                      </div>
                    ) : (
                      <span className="badge badge-warning">아직 판정하지 못했습니다</span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <div className="stack">
          {data.stakeholders.length > 0 && (
            <section className="card">
              <div className="card-title">이 부서에서 만난 사람</div>
              <ul className="dept-people">
                {data.stakeholders.map((p) => (
                  <li key={p.id}>
                    <strong>{p.person_label}</strong>
                    <span className="card-note"> {p.role_label}</span>
                    {p.is_owner === 1 && <span className="badge badge-accent">주관</span>}
                    <div className="card-note">원하는 것 — {p.wants}</div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {data.tools.length > 0 && (
            <section className="card">
              <div className="card-title">이 부서에 넘긴 도구</div>
              <ul className="dept-tools">
                {data.tools.map((t) => (
                  <li key={t.application_id}>
                    <Link to={`/t/${t.slug}`} className="dept-app-title">
                      {t.title}
                    </Link>
                    <div className="card-note">
                      {t.handed_to_person}에게 {dateTimeLabel(t.handed_at)}
                    </div>
                    <div className="card-note">
                      {t.accepted_at ? (
                        `받았다고 확인해 주셨습니다 (${ago(t.accepted_at)})`
                      ) : (
                        <span className="owed-flag">아직 받았다는 확인이 없습니다</span>
                      )}
                    </div>
                    <div className="card-note">
                      {t.uses > 0
                        ? `넘긴 뒤 ${t.uses}번 쓰였습니다 · 마지막 ${ago(t.last_use)}`
                        : '넘긴 뒤 아직 한 번도 쓰이지 않았습니다'}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {data.meetings.length > 0 && (
            <section className="card">
              <div className="card-title">함께한 회의 {data.meetings.length}번</div>
              <ul className="dept-meetings">
                {data.meetings.map((m) => (
                  <li key={m.id}>
                    <strong>
                      {m.seq}차 {m.title}
                    </strong>
                    <div className="card-note">
                      {m.held_at ? dateTimeLabel(m.held_at) : '일시 미정'} · {m.status}
                    </div>
                    <div className="card-note">{m.application_title}</div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {data.feedback.length > 0 && (
            <section className="card">
              <div className="card-title">써 보고 남겨 주신 말</div>
              <ul className="dept-feedback">
                {data.feedback.map((f) => (
                  <li key={f.id}>
                    <div className="row" style={{ marginBottom: 3 }}>
                      <span className="badge badge-neutral">{f.kind}</span>
                      <span className="card-note">{f.person_label}</span>
                    </div>
                    <div>{f.body}</div>
                    <div className="card-note">
                      {f.resolution ? (
                        `→ ${f.resolution}`
                      ) : (
                        <span className="owed-flag">아직 답을 못 드렸습니다</span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {data.decisions.length > 0 && (
            <section className="card">
              <div className="card-title">이 부서 건으로 내린 결정 {data.decisions.length}건</div>
              <ul className="dept-decisions">
                {data.decisions.map((d, i) => (
                  <li key={i}>
                    <div className="row" style={{ marginBottom: 3 }}>
                      <span className="badge badge-accent">{d.stage}</span>
                      {d.unrequested === 1 && <span className="badge badge-warning">먼저 제안</span>}
                      <span className="spacer" />
                      <span className="card-note">{ago(d.created_at)}</span>
                    </div>
                    <strong>{d.title}</strong>
                    <div className="card-note">{d.why}</div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}

const OWED_LABEL = {
  no_answer: '답을 못 줌',
  refused_no_alternative: '대안 없이 반려',
  held: '보류 중',
  rejected_no_reason: '사유 없이 기각',
  conflict_unjudged: '판정 못 냄',
  feedback_open: '답 못 한 의견',
  handover_pending: '확인 못 받음',
}

// 이 부서 입장에서 그 판정이 무슨 뜻이었는지로 바꿔 적는다.
// 'A우선'이라고만 적어 두면 자기가 이겼는지 졌는지 세어 봐야 안다.
function verdictText(c, dept) {
  if (c.verdict === '충돌아님') return '둘 다 됩니다'
  if (c.verdict === '절충') return '가운데서 맞췄습니다'
  const winner = c.verdict === 'A우선' ? c.a_dept : c.b_dept
  return winner === dept ? '이 부서 쪽을 택했습니다' : `${winner} 쪽을 택했습니다`
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

function statusTone(status) {
  if (status === '수용' || status === '완료') return 'badge-success'
  if (status === '반려') return 'badge-danger'
  if (status === '보류') return 'badge-warning'
  return 'badge-neutral'
}
