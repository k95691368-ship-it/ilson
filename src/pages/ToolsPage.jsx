import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useApi } from '../hooks/useApi.js'
import { useToast } from '../context/ToastContext.jsx'
import { api } from '../api/client.js'
import { ago, dateTimeLabel, duration, ms, num } from '../lib/format.js'

// 넘긴 뒤에 무슨 일이 일어나고 있나.
//
// 도구를 하나만 넘길 것처럼 만들어 뒀다. 두 번째를 넘기면 둘을 나란히 볼
// 데가 없다. 그런데 목록만 만들면 반쪽이다. 넘겼다는 사실보다 중요한 것은
// 넘긴 뒤에 어떻게 됐는가다.
//
// 만들었다는 기록은 흔하다. 만든 것이 지금도 돌고 있다는 증거는 드물다.
// 그래서 이 화면은 "넘겼음"이 아니라 "그 뒤로 몇 번 돌았고 몇 번 실패했고
// 마지막이 언제인가"를 앞에 둔다.
//
// 넘겨 놓고 아무도 안 쓰는 도구를 숨기지 않는다. 그게 가장 중요한 신호다.
export default function ToolsPage() {
  const { data, error, loading } = useApi('/tools')
  // 넘긴 뒤 부서가 겪은 것. 이게 없으면 "돌고 있음"만 보고 잘 되는 줄 안다.
  const { data: reports, reload: reloadReports } = useApi('/reports')
  // 부서가 알려준 상품코드 중 아직 담당자가 안 본 것. 잘못 이어져 있으면
  // 그 코드로 팔린 것이 전부 엉뚱한 상품 매출로 잡힌다.
  const { data: codes } = useApi('/codes')

  if (error) return <div className="notice notice-danger">{error}</div>
  if (loading && !data) return <div className="page-loading">불러오는 중…</div>
  if (!data) return null

  const s = data.summary

  return (
    <div className="stack">
      <header className="page-head">
        <span className="page-eyebrow">넘긴 뒤</span>
        <h1>넘긴 도구는 지금 어떻게 됐나</h1>
        <p className="page-sub">
          만들었다는 기록은 흔합니다. 만든 것이 <strong>지금도 돌고 있다는 증거</strong>는 드뭅니다.
          넘겨 놓고 아무도 안 쓰는 도구를 여기서 숨기지 않습니다 — 그게 가장 중요한 신호입니다.
        </p>
      </header>

      {data.items.length === 0 ? (
        <div className="empty">
          <div className="empty-title">아직 넘긴 도구가 없습니다</div>
          <div className="empty-sub">
            7단계 배포에서 부서에 넘기면 여기에 쌓입니다. 넘긴 뒤 실제로 쓰이는지가 이 화면에
            그대로 나옵니다.
          </div>
          <Link to="/deploy" className="btn-ghost btn-sm">
            배포 화면으로
          </Link>
        </div>
      ) : (
        <>
          <section className="stat-row">
            <Tile label="넘긴 도구" value={num(s.total)} note={`돌고 있는 것 ${s.running}개`} />
            <Tile
              label="넘긴 뒤 실행"
              value={num(s.totalRuns)}
              note={
                s.totalFailed > 0
                  ? `그중 ${s.totalFailed}번 실패했습니다`
                  : '실패한 실행은 없습니다'
              }
              tone={s.totalFailed > 0 ? 'warn' : undefined}
            />
            <Tile
              label="한 번도 안 쓰인 것"
              value={num(s.idle)}
              note={s.idle > 0 ? '넘긴 것으로 끝난 도구입니다' : '전부 한 번은 쓰였습니다'}
              tone={s.idle > 0 ? 'warn' : undefined}
            />
            <Tile
              label="부서가 이상하다고 한 것"
              value={num(reports?.summary.open ?? 0)}
              note={
                (reports?.summary.urgent ?? 0) > 0
                  ? `그중 결과를 믿을 수 없는 것 ${reports.summary.urgent}건`
                  : '아직 못 고친 신고'
              }
              tone={(reports?.summary.urgent ?? 0) > 0 ? 'warn' : undefined}
            />
            <Tile
              label="받았다는 확인이 없는 것"
              value={num(s.unconfirmed)}
              note={s.unconfirmed > 0 ? '넘겼다고 받은 것이 아닙니다' : '전부 확인받았습니다'}
              tone={s.unconfirmed > 0 ? 'warn' : undefined}
            />
          </section>

          {codes?.summary?.needsCheck > 0 && (
            <div className="notice notice-warn">
              <div className="notice-title">
                부서가 알려준 상품코드 {codes.summary.needsCheck}개를 아직 안 보셨습니다
              </div>
              <p>
                잘못 이어져 있으면 그 코드로 팔린 것이 전부 엉뚱한 상품 매출로 잡힙니다. 밀려난
                줄은 눈에 띄지만 잘못 이어진 줄은 조용히 섞입니다.
              </p>
              <Link to="/codes" className="btn-ghost btn-sm">
                훑어보기
              </Link>
            </div>
          )}

          <div className="tool-cards">
            {data.items.map((t) => (
              <article key={t.application_id} className={`tool-card ${healthClass(t.health)}`}>
                <div className="tool-card-head">
                  <span className={`badge ${healthTone(t.health)}`}>{t.health}</span>
                  {t.rolled_back_at && <span className="badge badge-danger">되돌림</span>}
                  <span className="spacer" />
                  <Link to={`/record/${t.ticket_no}`} className="mono card-note">
                    {t.ticket_no}
                  </Link>
                </div>

                <h2 className="tool-card-title">
                  {t.rolled_back_at ? (
                    t.title
                  ) : (
                    <Link to={`/t/${t.slug}`}>{t.title}</Link>
                  )}
                </h2>
                <p className="card-note">
                  <Link to={`/dept/${encodeURIComponent(t.handed_to_dept)}`}>
                    {t.handed_to_dept}
                  </Link>{' '}
                  {t.handed_to_person}에게 {ago(t.handed_at)} 넘겼습니다
                </p>

                {/* 넘긴 뒤 실제로 어떻게 됐는가. 이 화면의 중심이다. */}
                <dl className="tool-stats">
                  <div>
                    <dt>돌린 횟수</dt>
                    <dd>
                      {t.runs > 0 ? (
                        <>
                          {num(t.runs)}번
                          {t.failedRuns > 0 && (
                            <span className="tool-fail"> · 실패 {t.failedRuns}번</span>
                          )}
                        </>
                      ) : (
                        <span className="tool-fail">한 번도 안 돌았습니다</span>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>마지막 사용</dt>
                    <dd>
                      {t.lastUse ? (
                        <span title={dateTimeLabel(t.lastUse)}>{ago(t.lastUse)}</span>
                      ) : (
                        '—'
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>최근 {data.summary.recentDays}일</dt>
                    <dd>{t.recentRuns > 0 ? `${num(t.recentRuns)}번` : '없음'}</dd>
                  </div>
                  <div>
                    <dt>처리한 줄</dt>
                    <dd>
                      {num(t.rowsOut)}
                      {t.quarantined > 0 && (
                        <span className="card-note"> · 격리 {num(t.quarantined)}</span>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>한 번에 걸리는 시간</dt>
                    <dd>{t.avgMs != null ? ms(t.avgMs) : '—'}</dd>
                  </div>
                  <div>
                    <dt>부서가 받았다고 확인</dt>
                    <dd>
                      {t.accepted_at ? (
                        <span title={dateTimeLabel(t.accepted_at)}>{ago(t.accepted_at)}</span>
                      ) : (
                        <span className="tool-fail">아직 없음</span>
                      )}
                    </dd>
                  </div>
                </dl>

                {/* 대신한 분량. "아꼈다"가 아니라 여기까지만 말한다. */}
                {t.replacedSeconds != null && t.runs > 0 && (
                  <p className="tool-replaced">
                    사람이 하면 한 번에 {duration(t.median_seconds)} 걸리던 일을 {num(t.runs)}번
                    대신했습니다 — 합쳐서 {duration(t.replacedSeconds)}.
                    <span className="card-note">
                      {' '}
                      다만 그 뒤에도 사람이 검토에 {duration(t.reviewSeconds)}
                      {t.reworkSeconds > 0 && `, 다시 하는 데 ${duration(t.reworkSeconds)}`}를 썼고,
                      실제 절감은 8단계에서 이것까지 빼고 계산합니다.
                    </span>
                  </p>
                )}

                {t.rolled_back_at && (
                  <p className="tool-rollback">
                    {dateTimeLabel(t.rolled_back_at)}에 내렸습니다 — {t.rollback_reason}
                  </p>
                )}

                <div className="tool-card-foot">
                  {!t.rolled_back_at && (
                    <Link to={`/t/${t.slug}`} className="btn-ghost btn-sm">
                      도구 열기
                    </Link>
                  )}
                  <Link to={`/record/${t.ticket_no}`} className="btn-ghost btn-sm">
                    이 신청서 기록 전부
                  </Link>
                  {!t.manual_published_at && !t.rolled_back_at && (
                    <span className="badge badge-warning">사용법서 없이 넘김</span>
                  )}
                  <span className="spacer" />
                  <span className="card-note">
                    하루 {t.daily_limit}회 · 파일 {t.max_file_mb}MB
                  </span>
                </div>
              </article>
            ))}
          </div>

          {reports?.tools?.length > 0 && (
            <section className="stack">
              <div className="card-head">
                <span className="card-title">
                  부서가 겪은 것 {reports.summary.open}건이 아직 안 고쳐졌습니다
                </span>
                <span className="card-note">
                  만들 때 놓친 것은 만든 사람이 못 찾습니다. 매일 그 일을 하는 사람만 찾습니다.
                </span>
              </div>
              {reports.tools.map((t) => (
                <ReportTool key={t.applicationId} tool={t} onFixed={reloadReports} />
              ))}
            </section>
          )}

          {data.failures.length > 0 && (
            <section className="card">
              <div className="card-head">
                <span className="card-title">실패한 실행 {data.failures.length}건</span>
                <span className="card-note">성공만 세면 잘 돌고 있는 것처럼 보입니다</span>
              </div>
              <ul className="tool-failures">
                {data.failures.map((f, i) => (
                  <li key={i}>
                    <div className="row" style={{ marginBottom: 3 }}>
                      <Link to={`/t/${f.slug}`} className="dept-app-title">
                        {f.title}
                      </Link>
                      <span className="spacer" />
                      <span className="card-note" title={dateTimeLabel(f.used_at)}>
                        {ago(f.used_at)}
                      </span>
                    </div>
                    <div className="card-note">
                      {f.actor_label} · {f.fail_reason || '이유가 남아 있지 않습니다'}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  )
}

// 도구 하나에 들어온 신고와, 담당자가 고쳤다고 남기는 자리.
function ReportTool({ tool, onFixed }) {
  return (
    <article className={`report-tool${tool.urgent > 0 ? ' untrusted' : ''}`}>
      <div className="row" style={{ marginBottom: 8 }}>
        {tool.urgent > 0 ? (
          <span className="badge badge-danger">결과를 믿을 수 없음</span>
        ) : tool.open > 0 ? (
          <span className="badge badge-warning">불편하다는 신고</span>
        ) : (
          <span className="badge badge-success">전부 고쳤습니다</span>
        )}
        <span className="badge badge-neutral">{tool.dept}</span>
        <span className="spacer" />
        {tool.slug && (
          <Link to={`/t/${tool.slug}`} className="card-note">
            도구 열기
          </Link>
        )}
        <Link to={`/record/${tool.ticket_no}`} className="mono card-note">
          {tool.ticket_no}
        </Link>
      </div>
      <div className="tool-card-title" style={{ marginBottom: 10 }}>
        {tool.toolTitle}
      </div>

      <ul className="honest-list">
        {tool.reports.map((r) => (
          <ReportItem key={r.id} report={r} onFixed={onFixed} />
        ))}
      </ul>
    </article>
  )
}

function ReportItem({ report, onFixed }) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ how: '', why: '', author: 'AX 담당자' })
  const [fieldErrors, setFieldErrors] = useState({})
  const [saving, setSaving] = useState(false)

  async function send(e) {
    e.preventDefault()
    setSaving(true)
    setFieldErrors({})
    try {
      await api.post('/reports', { ...form, reportId: report.id })
      toast.success('처리한 것을 남겼습니다.')
      setOpen(false)
      await onFixed()
    } catch (err) {
      if (err.fields) setFieldErrors(err.fields)
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <li className={`report-item${report.open ? ' open' : ''}${report.urgent ? ' urgent' : ''}`}>
      <div className="row" style={{ marginBottom: 4 }}>
        <span className={`badge ${report.urgent ? 'badge-danger' : 'badge-warning'}`}>
          {report.label}
        </span>
        {!report.open && <span className="badge badge-success">고쳤습니다</span>}
        <span className="spacer" />
        <span className="card-note">
          {report.reporter} · {ago(report.at)}
        </span>
      </div>
      <div className="thread-body">{report.body}</div>

      {report.fix ? (
        <div className="report-fix">
          <div>
            <strong>고친 것</strong> {report.fix.how}
          </div>
          <div style={{ marginTop: 4 }}>
            {/* 원인이 남아야 다음에 같은 것을 또 안 겪는다. */}
            <strong>왜 그랬나</strong> {report.fix.why}
          </div>
        </div>
      ) : open ? (
        <form className="thread-form" onSubmit={send}>
          <div className="field">
            <label className="field-label">
              무엇을 하셨습니까<span className="field-required"> *</span>
            </label>
            <textarea
              rows={2}
              value={form.how}
              onChange={(e) => setForm((f) => ({ ...f, how: e.target.value }))}
              placeholder="할인액 컬럼 이름이 바뀐 것을 못 잡고 있었습니다. 컬럼이 사라지면 막도록 고쳤습니다."
            />
            {fieldErrors.how && <div className="field-error">{fieldErrors.how}</div>}
          </div>
          <div className="field">
            <label className="field-label">
              왜 그랬던 것입니까<span className="field-required"> *</span>
            </label>
            <textarea
              rows={2}
              value={form.why}
              onChange={(e) => setForm((f) => ({ ...f, why: e.target.value }))}
              placeholder="필수 컬럼이 아니어서 없어도 넘어가게 해 뒀습니다. 금액에 들어가는 컬럼은 없으면 막아야 합니다."
            />
            {fieldErrors.why && <div className="field-error">{fieldErrors.why}</div>}
          </div>
          <div className="row">
            <button type="submit" className="btn-primary btn-sm" disabled={saving}>
              {saving ? '남기는 중…' : '처리했다고 남기기'}
            </button>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setOpen(false)}>
              그만두기
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          className="btn-ghost btn-sm"
          style={{ marginTop: 8 }}
          onClick={() => setOpen(true)}
        >
          처리했다고 남기기
        </button>
      )}
    </li>
  )
}

function healthTone(health) {
  if (health === '돌고 있음') return 'badge-success'
  if (health === '내림') return 'badge-danger'
  if (health === '실패 있음' || health === '안 쓰임') return 'badge-warning'
  return 'badge-neutral'
}

function healthClass(health) {
  if (health === '안 쓰임' || health === '실패 있음') return 'attention'
  if (health === '내림') return 'down'
  return ''
}

function Tile({ label, value, note, tone }) {
  return (
    <div className={`stat-tile${tone === 'warn' ? ' held' : ''}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      <div className="stat-note">{note}</div>
    </div>
  )
}
