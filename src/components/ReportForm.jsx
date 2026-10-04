import { useState, useSyncExternalStore } from 'react'
import { REPORT_KINDS, REPORT_BY_CODE, validateReport } from '../../shared/report.js'
import Field from './Field.jsx'
import { handleRadioGroupKeyDown } from '../lib/radioGroup.js'
import { getAccessSession, subscribeAccessSession } from '../lib/accessSession.js'
import { useFeedbackSubmission } from '../hooks/useFeedbackSubmission.js'

// 부서가 도구에 이상을 신고한다.
//
// 도구를 넘기고 나면 그때부터가 진짜다. 그런데 부서가 돌려 보고 "이 숫자
// 좀 이상한데" 싶어도 말할 데가 없었다. 결국 담당자에게 메신저로 말하거나,
// 더 흔하게는 그냥 안 쓴다. 안 쓰는 이유는 아무 데도 안 남는다.
//
// 로그인을 요구하지 않는다. 요구하는 순간 아무도 신고하지 않고, 신고가
// 없으면 도구가 멀쩡한 줄 알게 된다.
export default function ReportForm({ slug }) {
  const session = useSyncExternalStore(subscribeAccessSession, getAccessSession, getAccessSession)
  if (session.status !== 'active' || !['access', 'demo'].includes(session.mode)) return null
  return <ReportSession key={`${session.generation}:${slug}`} slug={slug} session={session} />
}

function ReportSession({ slug, session }) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ code: '', body: '', reporter: '' })
  const [localErrors, setLocalErrors] = useState({})
  const submission = useFeedbackSubmission({ session, slug, kind: 'report' })
  const { busy: saving, receipt: done, pending } = submission
  const fieldErrors = { ...submission.fields, ...localErrors }
  const locked = saving || Boolean(pending)

  const kind = REPORT_BY_CODE[form.code]

  async function send(e) {
    e.preventDefault()
    const current = submission.capture()
    if (saving) return
    if (!pending) {
      const fields = validateReport({ ...form, reporter: session.mode === 'access' ? '서버 계정' : form.reporter })
      if (form.body.trim().length > 3000) fields.body = '내용은 3,000자 이내로 적어주세요.'
      if (form.reporter.trim().length > 60) fields.reporter = '누가 겪은 일인지는 60자 이내로 적어주세요.'
      setLocalErrors(fields)
      if (Object.keys(fields).length) return
    }
    const receipt = await submission.submit(form)
    if (receipt && current()) {
      setForm({ code: '', body: '', reporter: form.reporter })
      setOpen(false)
    }
  }

  if (submission.denied) return <p className="notice notice-danger" role="alert">{submission.denied} 제보 내용을 숨겼습니다.</p>
  if (done) {
    return (
      <section className="report-done">
        <div className="report-done-title">알려주셔서 고맙습니다</div>
        {/* 신고하고 나서 아무 말도 없으면 "말해도 소용없구나"가 된다.
            다음에 무슨 일이 있을지 그 자리에서 알려 준다. */}
        <p className="card-note">{done.next}</p>
        <button type="button" className="btn-ghost btn-sm" onClick={submission.discard}>
          하나 더 알리기
        </button>
      </section>
    )
  }

  if (!open) {
    return (
      <div className="report-open">
        <button type="button" className="btn-ghost btn-sm" onClick={() => setOpen(true)}>
          이상한 점 알리기
        </button>
      </div>
    )
  }

  return (
    <form className="card report-form" aria-label="이상한 점 제보" onSubmit={send}>
      <div className="card-head">
        <h2 className="card-title">무엇이 이상하셨습니까</h2>
        <span className="spacer" />
        <button type="button" className="btn-ghost btn-sm" disabled={locked} onClick={() => setOpen(false)}>
          그만두기
        </button>
      </div>

      <div
        className="report-kinds"
        role="radiogroup"
        aria-label="이상 유형"
        aria-required="true"
        aria-invalid={fieldErrors.code ? 'true' : undefined}
        aria-describedby={fieldErrors.code ? 'report-code-error' : undefined}
        onKeyDown={handleRadioGroupKeyDown}
      >
        {REPORT_KINDS.map((k, index) => (
          <button
            key={k.code}
            type="button"
            className={`report-kind${form.code === k.code ? ' on' : ''}`}
            disabled={locked}
            onClick={() => { if (!locked) setForm((f) => ({ ...f, code: k.code })) }}
            role="radio"
            aria-checked={form.code === k.code}
            tabIndex={form.code ? (form.code === k.code ? 0 : -1) : (index === 0 ? 0 : -1)}
          >
            <span className="report-kind-label">
              {k.label}
              {k.severity === '높음' && <span className="badge badge-danger">급함</span>}
            </span>
            {k.detail && <span className="report-kind-detail">{k.detail}</span>}
          </button>
        ))}
      </div>
      {fieldErrors.code && <div className="field-error" id="report-code-error" role="alert">{fieldErrors.code}</div>}

      {/* 유형을 먼저 고르게 하면 그 유형에 필요한 것을 그 자리에서 물을 수 있다.
          자유롭게 적게만 하면 "이상해요" 한 줄이 오고, 담당자가 다시 물어야 한다. */}
      {kind && (
        <Field label={kind.ask} required error={fieldErrors.body}>
          <textarea
            rows={3}
            value={form.body}
            maxLength={3000}
            disabled={locked}
            onChange={(e) => { if (!locked) setForm((f) => ({ ...f, body: e.target.value })) }}
            placeholder={placeholderFor(kind.code)}
          />
        </Field>
      )}

      {session.mode === 'demo' ? <Field label="누가 겪으신 일입니까" required error={fieldErrors.reporter}>
        <input
          value={form.reporter}
          disabled={locked}
          onChange={(e) => { if (!locked) setForm((f) => ({ ...f, reporter: e.target.value })) }}
          placeholder="정산 담당자"
          maxLength={60}
        />
      </Field> : <p className="card-note">제보자는 서버에서 확인한 현재 계정으로 기록됩니다.</p>}

      {submission.error && <p className="notice notice-warn" role="alert">{submission.error}</p>}
      {pending && <p className="card-note">입력한 내용 그대로 저장 여부를 다시 확인합니다. 이 화면을 벗어나면 재시도 정보가 사라집니다.</p>}
      <button type="submit" className="btn-primary btn-sm" disabled={saving || !form.code || pending?.blocked}>
        {saving ? '보내는 중…' : pending ? '같은 제보 다시 확인' : '알리기'}
      </button>
      {pending && <details className="disclose"><summary>다른 내용으로 제보하기</summary>
        <p>기존 제보가 이미 저장됐을 수 있습니다. 보관을 끝내도 서버 저장은 취소되지 않으며 새 제보가 중복될 수 있습니다.</p>
        <button type="button" className="btn-ghost btn-sm" disabled={saving} onClick={() => { submission.discard(); setLocalErrors({}) }}>보관을 끝내고 현재 내용 수정</button>
      </details>}
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
