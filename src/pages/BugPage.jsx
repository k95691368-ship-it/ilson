import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useApi } from '../hooks/useApi.js'
import { useToast } from '../context/ToastContext.jsx'
import { api } from '../api/client.js'
import { ago } from '../lib/format.js'
import Fold from '../components/Fold.jsx'
import Field from '../components/Field.jsx'
import { REPORT_KINDS, REPORT_BY_CODE } from '../../shared/report.js'

// 우리가 만든 기능이 이상할 때 말할 데.
//
// 여태 신고하려면 넘겨받은 도구 주소(/t/…)를 알아야 했다. 그 주소를 아는
// 사람은 그 도구를 받은 부서뿐이고, 주소를 잃어버리면 말할 데가 없어진다.
// 아직 안 넘긴 것은 신고할 길이 아예 없었다 — 만드는 중에 이상한 걸 본
// 사람이 가장 먼저 아는데도.
//
// 신고는 새 저장소에 담지 않는다. 이미 쌓이는 자리에 그대로 얹는다. 그래야
// 첫 화면의 "믿을 수 없는 도구"와 넘긴 뒤 화면의 판정이 이 신고까지 같이
// 센다. 따로 담으면 두 화면이 서로 다른 숫자를 말한다.

const EMPTY = { applicationId: '', code: '', body: '', reporter: '' }

export default function BugPage() {
  const { data: targetData, error: targetErr } = useApi('/bugs')
  const { data: reportData, error: reportErr, loading, reload } = useApi('/reports')
  const toast = useToast()
  const [form, setForm] = useState(EMPTY)
  const [fieldErrors, setFieldErrors] = useState({})
  const [sending, setSending] = useState(false)

  const set = (patch) => setForm((f) => ({ ...f, ...patch }))
  const asked = REPORT_BY_CODE[form.code]?.ask
  const targets = targetData?.targets ?? []

  async function send(e) {
    e.preventDefault()
    setSending(true)
    setFieldErrors({})
    try {
      const r = await api.post('/bugs', form)
      toast.success(`${r.ticket_no} 에 대한 신고로 접수했습니다.`)
      setForm(EMPTY)
      await reload()
    } catch (err) {
      if (err.fields) setFieldErrors(err.fields)
      toast.error(err.message)
    } finally {
      setSending(false)
    }
  }

  const tools = reportData?.tools ?? []
  const summary = reportData?.summary ?? {}
  const openTools = tools.filter((t) => t.open > 0)
  const doneTools = tools.filter((t) => t.open === 0)

  return (
    <div className="stack">
      <header className="page-head">
        <span className="page-eyebrow">기타</span>
        <h1>버그 신고</h1>
        <p className="page-sub">
          만들어 드린 기능이 이상하게 굴면 여기 적어 주세요. 로그인은 없습니다.{' '}
          <strong>적어 주신 것은 고쳤든 못 고쳤든 그대로 남습니다.</strong>
        </p>
      </header>

      {targets.length === 0 ? (
        <div className="empty">
          <div className="empty-title">아직 신고할 기능이 없습니다</div>
          <div className="empty-sub">
            2단계 검토에서 수용한 신청서가 여기 목록에 올라옵니다.
          </div>
          <Link to="/review" className="btn-ghost btn-sm">
            검토 화면으로
          </Link>
        </div>
      ) : (
        <form className="card card-boxed" onSubmit={send} noValidate>
          <div className="card-head">
            <h2 className="card-title">무엇이 이상한가요</h2>
          </div>

          <Field label="어느 기능" required error={fieldErrors.applicationId}>
            <select
              value={form.applicationId}
              onChange={(e) => set({ applicationId: e.target.value })}
            >
              <option value="">고르기</option>
              {targets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.ticket_no} · {t.dept} · {t.title}
                </option>
              ))}
            </select>
          </Field>

          <Field label="무슨 일이" required error={fieldErrors.code}>
            <select value={form.code} onChange={(e) => set({ code: e.target.value })}>
              <option value="">고르기</option>
              {REPORT_KINDS.map((k) => (
                <option key={k.code} value={k.code}>
                  {k.label}
                </option>
              ))}
            </select>
          </Field>

          {/* 고른 유형에 맞춰 무엇을 적어야 하는지 그 자리에서 알려준다.
              "이상해요" 한 줄이 오면 담당자가 다시 물어야 하고 하루가 간다. */}
          <Field label="자세히" required hint={asked} error={fieldErrors.body}>
            <textarea
              rows={3}
              value={form.body}
              onChange={(e) => set({ body: e.target.value })}
              placeholder="본 대로 적어 주시면 됩니다"
            />
          </Field>

          <Field
            label="누구신지"
            required
            hint="되물을 데가 있어야 고칠 수 있습니다"
            error={fieldErrors.reporter}
          >
            <input
              value={form.reporter}
              onChange={(e) => set({ reporter: e.target.value })}
              placeholder="예: 재무 정산 담당자"
            />
          </Field>

          <button type="submit" className="btn-primary" disabled={sending}>
            {sending ? '보내는 중…' : '신고하기'}
          </button>
        </form>
      )}

      {(targetErr || reportErr) && (
        <div className="notice notice-danger">{targetErr || reportErr}</div>
      )}
      {loading && !reportData && <div className="page-loading">불러오는 중…</div>}

      {reportData && tools.length === 0 && (
        <div className="empty">
          <div className="empty-title">아직 들어온 신고가 없습니다</div>
          <div className="empty-sub">없어서 안 보이는 것이지, 숨겨서 안 보이는 것이 아닙니다.</div>
        </div>
      )}

      {openTools.length > 0 && (
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">아직 안 고친 것 {summary.open}건</h2>
            {summary.urgent > 0 && (
              <span className="badge badge-danger">결과를 믿을 수 없는 것 {summary.urgent}건</span>
            )}
            <span className="spacer" />
            {/* 고치는 자리는 「넘긴 뒤」 화면에 이미 있다. 같은 일을 두 화면에
                만들면 한쪽만 고쳐진다. */}
            <Link to="/tools" className="btn-ghost btn-sm">
              처리하러 가기
            </Link>
          </div>
          <div className="stack-sm">
            {openTools.map((t) => (
              <ToolReports key={t.applicationId} t={t} />
            ))}
          </div>
        </section>
      )}

      {doneTools.length > 0 && (
        <Fold label="다 처리한 것" count={doneTools.length} note="고친 내용까지 그대로 남습니다">
          <div className="stack-sm">
            {doneTools.map((t) => (
              <ToolReports key={t.applicationId} t={t} />
            ))}
          </div>
        </Fold>
      )}
    </div>
  )
}

function ToolReports({ t }) {
  return (
    <div className="card card-boxed">
      <div className="card-head">
        <h3 className="card-title">{t.toolTitle}</h3>
        <span className="card-note">
          {t.ticket_no} · {t.dept}
        </span>
        <span className="spacer" />
        {t.open > 0 ? (
          <span className={`badge ${t.urgent > 0 ? 'badge-danger' : 'badge-warning'}`}>
            안 고친 것 {t.open}건
          </span>
        ) : (
          <span className="badge badge-success">전부 처리됨</span>
        )}
      </div>

      <div className="stack-sm">
        {t.reports.map((r) => (
          <div key={r.id}>
            <p>
              <span className={`badge ${r.urgent && r.open ? 'badge-danger' : 'badge-neutral'}`}>
                {r.label}
              </span>{' '}
              {r.body}
            </p>
            <p className="card-note">
              {r.reporter} · {ago(r.at)}
            </p>
            {/* 고쳤다는 말만 있고 무엇을 고쳤는지가 없으면, 신고한 사람은
                자기가 겪은 일이 다뤄졌는지 알 수 없다. */}
            {r.fix && (
              <p>
                <strong>고침</strong> — {r.fix.how} <span className="card-note">({r.fix.why})</span>
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
