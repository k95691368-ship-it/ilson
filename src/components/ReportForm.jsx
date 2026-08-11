import { useState } from 'react'
import { api } from '../api/client.js'
import { useToast } from '../context/ToastContext.jsx'
import { REPORT_KINDS, REPORT_BY_CODE } from '../../shared/report.js'

// 부서가 도구에 이상을 신고한다.
//
// 도구를 넘기고 나면 그때부터가 진짜다. 그런데 부서가 돌려 보고 "이 숫자
// 좀 이상한데" 싶어도 말할 데가 없었다. 결국 담당자에게 메신저로 말하거나,
// 더 흔하게는 그냥 안 쓴다. 안 쓰는 이유는 아무 데도 안 남는다.
//
// 로그인을 요구하지 않는다. 요구하는 순간 아무도 신고하지 않고, 신고가
// 없으면 도구가 멀쩡한 줄 알게 된다.
export default function ReportForm({ slug }) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ code: '', body: '', reporter: '' })
  const [fieldErrors, setFieldErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(null)

  const kind = REPORT_BY_CODE[form.code]

  async function send(e) {
    e.preventDefault()
    setSaving(true)
    setFieldErrors({})
    try {
      const r = await api.post(`/tools/${slug}/report`, form)
      setDone(r)
      setForm({ code: '', body: '', reporter: form.reporter })
      setOpen(false)
    } catch (err) {
      if (err.fields) setFieldErrors(err.fields)
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (done) {
    return (
      <section className="report-done">
        <div className="report-done-title">알려주셔서 고맙습니다</div>
        {/* 신고하고 나서 아무 말도 없으면 "말해도 소용없구나"가 된다.
            다음에 무슨 일이 있을지 그 자리에서 알려 준다. */}
        <p className="card-note">{done.next}</p>
        <button type="button" className="btn-ghost btn-sm" onClick={() => setDone(null)}>
          하나 더 알리기
        </button>
      </section>
    )
  }

  if (!open) {
    return (
      <div className="report-open">
        <span className="card-note">
          결과가 이상하거나 안 돌아가면 알려주세요. 만들 때 놓친 것은 만든 사람이 못 찾습니다.
        </span>
        <button type="button" className="btn-ghost btn-sm" onClick={() => setOpen(true)}>
          이상한 점 알리기
        </button>
      </div>
    )
  }

  return (
    <form className="card report-form" onSubmit={send}>
      <div className="card-head">
        <span className="card-title">무엇이 이상하셨습니까</span>
        <span className="spacer" />
        <button type="button" className="btn-ghost btn-sm" onClick={() => setOpen(false)}>
          그만두기
        </button>
      </div>

      <div className="report-kinds">
        {REPORT_KINDS.map((k) => (
          <button
            key={k.code}
            type="button"
            className={`report-kind${form.code === k.code ? ' on' : ''}`}
            onClick={() => setForm((f) => ({ ...f, code: k.code }))}
            aria-pressed={form.code === k.code}
          >
            <span className="report-kind-label">
              {k.label}
              {k.severity === '높음' && <span className="badge badge-danger">급함</span>}
            </span>
            {k.detail && <span className="report-kind-detail">{k.detail}</span>}
          </button>
        ))}
      </div>
      {fieldErrors.code && <div className="field-error">{fieldErrors.code}</div>}

      {/* 유형을 먼저 고르게 하면 그 유형에 필요한 것을 그 자리에서 물을 수 있다.
          자유롭게 적게만 하면 "이상해요" 한 줄이 오고, 담당자가 다시 물어야 한다. */}
      {kind && (
        <label className="field" style={{ marginTop: 12 }}>
          <span className="field-label">
            {kind.ask}
            <span className="field-required"> *</span>
          </span>
          <textarea
            rows={3}
            value={form.body}
            onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
            placeholder={placeholderFor(kind.code)}
          />
          {fieldErrors.body && <div className="field-error">{fieldErrors.body}</div>}
        </label>
      )}

      <label className="field">
        <span className="field-label">
          누가 겪으신 일입니까<span className="field-required"> *</span>
        </span>
        <input
          value={form.reporter}
          onChange={(e) => setForm((f) => ({ ...f, reporter: e.target.value }))}
          placeholder="정산 담당자"
          maxLength={60}
        />
        {fieldErrors.reporter && <div className="field-error">{fieldErrors.reporter}</div>}
      </label>

      <button type="submit" className="btn-primary btn-sm" disabled={saving || !form.code}>
        {saving ? '보내는 중…' : '알리기'}
      </button>
    </form>
  )
}

function placeholderFor(code) {
  if (code === 'wrong_number')
    return '자사몰 순매출이 2,145,000원으로 나왔는데 제가 세어 본 것은 1,890,000원입니다.'
  if (code === 'missing_rows')
    return '7월 3주차 쿠팡 반품 건이 결과에 없습니다. 원본에는 12줄 있습니다.'
  if (code === 'wont_run') return '자사몰 정산서를 넣으니 "어느 채널인지 알 수 없음"이라고 뜹니다.'
  if (code === 'quarantine') return '밀려난 줄이 60개인데 대부분 6월 말 정산 건입니다.'
  if (code === 'hard_to_use') return '파일을 다섯 번 나눠 올려야 해서 시간이 더 걸립니다.'
  return '무슨 일이 있었는지 적어주세요.'
}
