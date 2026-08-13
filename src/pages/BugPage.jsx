import { useState } from 'react'
import { useApi } from '../hooks/useApi.js'
import { useToast } from '../context/ToastContext.jsx'
import { api } from '../api/client.js'
import { ago } from '../lib/format.js'
import Fold from '../components/Fold.jsx'
import {
  BUG_AREAS,
  BUG_KINDS,
  BUG_KIND_BY_CODE,
  BUG_STATUSES,
  BUG_DONE,
} from '../../shared/bug.js'

// 이 사이트 자체가 이상할 때 말할 데.
//
// 여기까지 이 사이트는 부서가 낸 일만 받았다. 정작 이 사이트가 안 열리거나
// 숫자가 이상하면 말할 데가 없었고, 보시는 분은 그냥 닫았다. 닫은 이유는
// 아무 데도 안 남는다.
//
// 그런데 이 저장소가 파는 것이 "못 한 것을 숨기지 않는다"이다. 자기 버그를
// 받을 자리가 없으면 그 말이 안쪽에서 먼저 깨진다.
//
// **들어온 것을 그대로 다 보여준다.** 골라서 보여주면 다른 화면에서 하는
// 말("데이터에서 만들어지므로 잘 보이려고 손댈 수 없습니다")이 자기 버그
// 앞에서만 예외가 된다.

const EMPTY = { area: '', kind: '', body: '', steps: '', reporter: '' }

export default function BugPage() {
  const { data, error, loading, reload } = useApi('/bugs')
  const toast = useToast()
  const [form, setForm] = useState(EMPTY)
  const [fieldErrors, setFieldErrors] = useState({})
  const [sending, setSending] = useState(false)

  const set = (patch) => setForm((f) => ({ ...f, ...patch }))
  const asked = BUG_KIND_BY_CODE[form.kind]?.ask

  async function send(e) {
    e.preventDefault()
    setSending(true)
    setFieldErrors({})
    try {
      await api.post('/bugs', form)
      toast.success('받았습니다. 아래 목록에 그대로 올라갑니다.')
      setForm(EMPTY)
      await reload()
    } catch (err) {
      if (err.fields) setFieldErrors(err.fields)
      toast.error(err.message)
    } finally {
      setSending(false)
    }
  }

  const bugs = data?.bugs ?? []
  const summary = data?.summary ?? {}
  const open = bugs.filter((b) => b.open)
  const closed = bugs.filter((b) => !b.open)

  return (
    <div className="stack">
      <header className="page-head">
        <span className="page-eyebrow">기타</span>
        <h1>버그 신고</h1>
        <p className="page-sub">
          이 사이트가 이상하게 굴면 여기 적어 주세요. 로그인은 없습니다.{' '}
          <strong>적어 주신 것은 고쳤든 못 고쳤든 아래에 그대로 남습니다.</strong>
        </p>
      </header>

      <form className="card card-boxed" onSubmit={send}>
        <div className="card-head">
          <span className="card-title">무슨 일이 있었나요</span>
        </div>

        <label className="field">
          <span className="field-label">
            어느 화면<span className="field-required"> *</span>
          </span>
          <select value={form.area} onChange={(e) => set({ area: e.target.value })}>
            <option value="">고르기</option>
            {BUG_AREAS.map((a) => (
              <option key={a.code} value={a.code}>
                {a.label}
              </option>
            ))}
          </select>
          {fieldErrors.area && <span className="field-error">{fieldErrors.area}</span>}
        </label>

        <label className="field">
          <span className="field-label">
            무슨 일이<span className="field-required"> *</span>
          </span>
          <select value={form.kind} onChange={(e) => set({ kind: e.target.value })}>
            <option value="">고르기</option>
            {BUG_KINDS.map((k) => (
              <option key={k.code} value={k.code}>
                {k.label}
              </option>
            ))}
          </select>
          {fieldErrors.kind && <span className="field-error">{fieldErrors.kind}</span>}
        </label>

        <label className="field">
          <span className="field-label">
            자세히<span className="field-required"> *</span>
            {/* 고른 유형에 맞춰 무엇을 적어야 하는지 그 자리에서 알려준다.
                되물을 길이 없다 — 로그인이 없어서 연락할 데가 없다. */}
            {asked && <span className="field-hint">{asked}</span>}
          </span>
          <textarea
            rows={3}
            value={form.body}
            onChange={(e) => set({ body: e.target.value })}
            placeholder="본 대로 적어 주시면 됩니다"
          />
          {fieldErrors.body && <span className="field-error">{fieldErrors.body}</span>}
        </label>

        <label className="field">
          <span className="field-label">
            다시 나오게 하는 방법
            <span className="field-hint">모르시면 비워 두셔도 됩니다</span>
          </span>
          <textarea
            rows={2}
            value={form.steps}
            onChange={(e) => set({ steps: e.target.value })}
            placeholder="예: 3 협의안에서 신청서를 누르고 뒤로 갔다가 다시 들어오면"
          />
        </label>

        <label className="field">
          <span className="field-label">
            누구신지
            <span className="field-hint">안 적으셔도 됩니다</span>
          </span>
          <input
            value={form.reporter}
            onChange={(e) => set({ reporter: e.target.value })}
            placeholder="비워 두셔도 접수됩니다"
          />
          {fieldErrors.reporter && <span className="field-error">{fieldErrors.reporter}</span>}
        </label>

        <button type="submit" className="btn-primary" disabled={sending}>
          {sending ? '보내는 중…' : '신고하기'}
        </button>
      </form>

      {error && <div className="notice notice-danger">{error}</div>}
      {loading && !data && <div className="page-loading">불러오는 중…</div>}

      {data && bugs.length === 0 && (
        <div className="empty">
          <div className="empty-title">아직 들어온 신고가 없습니다</div>
          <div className="empty-sub">
            없어서 안 보이는 것이지, 숨겨서 안 보이는 것이 아닙니다.
          </div>
        </div>
      )}

      {open.length > 0 && (
        <section className="card">
          <div className="card-head">
            <span className="card-title">아직 안 끝난 것 {open.length}건</span>
            {summary.urgent > 0 && (
              <span className="badge badge-danger">급한 것 {summary.urgent}건</span>
            )}
          </div>
          <div className="stack-sm">
            {open.map((b) => (
              <BugCard key={b.id} b={b} reload={reload} toast={toast} />
            ))}
          </div>
        </section>
      )}

      {closed.length > 0 && (
        <Fold label="끝난 것" count={closed.length} note="고친 것과 버그가 아니었던 것">
          <div className="stack-sm">
            {closed.map((b) => (
              <BugCard key={b.id} b={b} reload={reload} toast={toast} />
            ))}
          </div>
        </Fold>
      )}
    </div>
  )
}

function BugCard({ b, reload, toast }) {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState(b.status)
  const [note, setNote] = useState(b.note ?? '')
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    setErr('')
    try {
      await api.patch(`/bugs/${b.id}`, { status, note })
      toast.success('처리했습니다.')
      setOpen(false)
      await reload()
    } catch (e) {
      setErr(e.fields?.note ?? e.fields?.status ?? e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card card-boxed">
      <div className="card-head">
        <span className={`badge ${b.urgent && b.open ? 'badge-danger' : 'badge-neutral'}`}>
          {b.kindLabel}
        </span>
        <span className="card-note">{b.areaLabel}</span>
        <span className="spacer" />
        <span className={`badge ${b.open ? 'badge-warning' : 'badge-success'}`}>{b.status}</span>
      </div>

      <p>{b.body}</p>
      {b.steps && <p className="card-note">다시 나오게 하는 방법: {b.steps}</p>}
      <p className="card-note">
        {b.reporter ? `${b.reporter} · ` : ''}
        {ago(b.at)}
      </p>

      {/* 닫힌 것도 왜 닫혔는지를 같이 보여준다. 근거 없이 닫히면 신고한
          사람은 고쳐진 것인지 무시당한 것인지 알 수 없다. */}
      {b.note && (
        <p>
          <strong>{b.status}</strong> — {b.note}
        </p>
      )}

      {!open ? (
        <button type="button" className="btn-ghost btn-sm" onClick={() => setOpen(true)}>
          처리하기
        </button>
      ) : (
        <div className="stack-sm">
          <label className="field">
            <span className="field-label">어떻게 됐나요</span>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              {BUG_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          {BUG_DONE.includes(status) && (
            <label className="field">
              <span className="field-label">
                {status === '고침' ? '무엇을 고쳤나요' : '왜 버그가 아닌가요'}
                <span className="field-required"> *</span>
              </span>
              <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
          )}
          {err && <span className="field-error">{err}</span>}
          <div className="row">
            <button type="button" className="btn-primary btn-sm" onClick={save} disabled={saving}>
              {saving ? '저장 중…' : '저장'}
            </button>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setOpen(false)}>
              그만두기
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
