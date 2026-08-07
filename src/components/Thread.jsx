import { useState } from 'react'
import { api } from '../api/client.js'
import { useToast } from '../context/ToastContext.jsx'
import { toThread, openQuestions, waitingOnDept, waitingOnStaff } from '../../shared/thread.js'
import { ago, dateTimeLabel } from '../lib/format.js'

// 담당자와 부서가 주고받은 것.
//
// 두 자리에서 같은 것을 보여 준다. 담당자는 검토 화면에서 묻고, 부서는
// 접수번호 조회 화면에서 답한다. 같은 것을 보되 할 수 있는 일이 다르다.
export default function Thread({ decisions, applicationId, ticket, mode, onChanged }) {
  const thread = toThread(decisions)
  const open = openQuestions(thread)
  // 누구를 기다리는 것인지 갈라야 배지가 반대로 안 뜬다.
  const theirs = waitingOnDept(thread) // 담당자가 물어 부서 답을 기다리는 것
  const mine = waitingOnStaff(thread) // 부서가 물어 담당자 답을 기다리는 것
  const isDept = mode === 'dept'

  // 여기서 칸이 통째로 사라지고 있었다. 담당자가 먼저 물어본 적이 없으면
  // 부서 화면에서 이 자리가 없어졌는데, **뒤로 밀린 부서가 대개 그 경우다.**
  // 말을 걸고 싶은 사람에게만 말 걸 자리가 없었던 것이다.

  return (
    <section className={`thread${open.length > 0 ? ' waiting' : ''}`}>
      <div className="card-head">
        <span className="card-title">
          {isDept ? '담당자와 주고받은 것' : '부서와 주고받은 것'}
          {thread.length > 0 && <span className="card-note"> {thread.length}개</span>}
        </span>
        <span className="spacer" />
        {open.length > 0 && (
          <span className="badge badge-warning">
            {isDept
              ? mine.length > 0
                ? `담당자 답을 기다리는 중 ${mine.length}건`
                : `답을 기다리고 있습니다 ${open.length}건`
              : theirs.length > 0
                ? `부서 답을 기다리는 중 ${theirs.length}건`
                : `부서가 물어봤습니다 ${open.length}건`}
          </span>
        )}
      </div>

      {thread.length === 0 ? (
        <p className="card-note">
          {isDept
            ? '아직 주고받은 것이 없습니다. 궁금하신 것이 있으면 먼저 물어보셔도 됩니다 — 답이 오면 이 자리에 뜹니다.'
            : '아직 주고받은 것이 없습니다. 신청서만 보고 판정하기 어려우면 물어보세요 — 짐작으로 판정하거나 보류로 미루는 것보다 낫습니다.'}
        </p>
      ) : (
        <ol className="thread-list">
          {thread.map((m) => (
            <li key={m.id} className={`thread-msg thread-${m.side === '담당자' ? 'staff' : 'dept'}`}>
              <div className="thread-msg-head">
                <span className={`badge ${m.side === '담당자' ? 'badge-accent' : 'badge-neutral'}`}>
                  {m.side}
                </span>
                <span className="card-note">{m.author}</span>
                <span className="spacer" />
                {m.waiting && <span className="badge badge-warning">답 기다리는 중</span>}
                <span className="card-note" title={dateTimeLabel(m.at)}>
                  {ago(m.at)}
                </span>
              </div>
              <div className="thread-body">{m.body}</div>
              {m.note && (
                <div className="thread-note">
                  <strong>이걸 알아야 하는 이유</strong> {m.note}
                </div>
              )}
              {/* 답하는 쪽은 물은 쪽의 반대편이다. 담당자가 물으면 부서가,
                  부서가 물으면 담당자가 답한다. */}
              {isDept && m.waiting && m.side === '담당자' && (
                <AnswerForm ticket={ticket} questionId={m.id} onSaved={onChanged} />
              )}
              {!isDept && m.waiting && m.side === '부서' && (
                <ReplyForm applicationId={applicationId} questionId={m.id} onSaved={onChanged} />
              )}
            </li>
          ))}
        </ol>
      )}

      {!isDept && <AskForm applicationId={applicationId} onSaved={onChanged} />}
      {/* 화면이 "되묻기로 물어봐 주세요"라고 시켜 놓고 그 버튼이 없었다.
          이 저장소에서 같은 모양의 구멍을 이미 두 번 고쳤다 — 보류 해제,
          시험판 의견. 이게 세 번째다. */}
      {isDept && <DeptAskForm ticket={ticket} onSaved={onChanged} />}
    </section>
  )
}

// 담당자가 묻는다.
function AskForm({ applicationId, onSaved }) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ question: '', why: '', author: 'AX 담당자' })
  const [fieldErrors, setFieldErrors] = useState({})
  const [saving, setSaving] = useState(false)

  async function send(e) {
    e.preventDefault()
    setSaving(true)
    setFieldErrors({})
    try {
      const r = await api.post(`/applications/${applicationId}/ask`, form)
      toast.success(r.tellThem)
      setForm({ question: '', why: '', author: form.author })
      setOpen(false)
      await onSaved?.()
    } catch (err) {
      if (err.fields) setFieldErrors(err.fields)
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <button type="button" className="btn-ghost btn-sm thread-ask-open" onClick={() => setOpen(true)}>
        되물어보기
      </button>
    )
  }

  return (
    <form className="thread-form" onSubmit={send}>
      <div className="field">
        <label className="field-label">
          무엇이 궁금하십니까<span className="field-required"> *</span>
        </label>
        <textarea
          rows={2}
          value={form.question}
          onChange={(e) => setForm((f) => ({ ...f, question: e.target.value }))}
          placeholder="정산서를 받는 채널이 몇 개인지, 그리고 양식이 매달 바뀌는지 알려주실 수 있을까요?"
        />
        {fieldErrors.question && <div className="field-error">{fieldErrors.question}</div>}
      </div>

      <div className="field">
        <label className="field-label">
          이걸 알아야 무엇을 정할 수 있습니까<span className="field-required"> *</span>
        </label>
        <textarea
          rows={2}
          value={form.why}
          onChange={(e) => setForm((f) => ({ ...f, why: e.target.value }))}
          placeholder="채널이 셋 이하면 규칙으로 풀리고, 그보다 많으면 양식이 바뀔 때마다 손이 갑니다. 만들지 말지가 여기서 갈립니다."
        />
        {/* 왜 묻는지를 안 적으면 부서는 "이걸 왜 물어보지" 하고 대충 답한다.
            판정에 무엇이 걸려 있는지 알면 답이 달라진다. */}
        {fieldErrors.why && <div className="field-error">{fieldErrors.why}</div>}
      </div>

      <div className="row">
        <button type="submit" className="btn-primary btn-sm" disabled={saving}>
          {saving ? '남기는 중…' : '질문 남기기'}
        </button>
        <button type="button" className="btn-ghost btn-sm" onClick={() => setOpen(false)}>
          그만두기
        </button>
        <span className="spacer" />
        <span className="card-note">
          부서는 접수번호로 조회하면 이 질문을 봅니다. 알려주는 것은 아직 사람이 해야 합니다.
        </span>
      </div>
    </form>
  )
}

// 부서가 답한다.
function AnswerForm({ ticket, questionId, onSaved }) {
  const toast = useToast()
  const [form, setForm] = useState({ answer: '', author: '' })
  const [fieldErrors, setFieldErrors] = useState({})
  const [saving, setSaving] = useState(false)

  async function send(e) {
    e.preventDefault()
    setSaving(true)
    setFieldErrors({})
    try {
      await api.post(`/track/${ticket}/answer`, { ...form, questionId })
      toast.success('답을 남겼습니다. 담당자가 확인하면 다음 단계로 넘어갑니다.')
      setForm({ answer: '', author: form.author })
      await onSaved?.()
    } catch (err) {
      if (err.fields) setFieldErrors(err.fields)
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="thread-form" onSubmit={send}>
      <div className="field">
        <label className="field-label">
          답<span className="field-required"> *</span>
        </label>
        <textarea
          rows={2}
          value={form.answer}
          onChange={(e) => setForm((f) => ({ ...f, answer: e.target.value }))}
          placeholder="다섯 개입니다. 양식은 자사몰만 가끔 바뀌고 나머지는 그대로입니다."
        />
        {fieldErrors.answer && <div className="field-error">{fieldErrors.answer}</div>}
      </div>

      <div className="field">
        <label className="field-label">
          누가 답하십니까<span className="field-required"> *</span>
        </label>
        <input
          value={form.author}
          onChange={(e) => setForm((f) => ({ ...f, author: e.target.value }))}
          placeholder="정산 담당자"
          maxLength={60}
        />
        {fieldErrors.author && <div className="field-error">{fieldErrors.author}</div>}
      </div>

      <div className="row">
        <button type="submit" className="btn-primary btn-sm" disabled={saving}>
          {saving ? '남기는 중…' : '답 보내기'}
        </button>
        <span className="spacer" />
        {/* 아닌 것을 맞다고 하지 않는다. 접수번호를 아는 사람이면 누구나
            답할 수 있고, 이름은 스스로 밝히는 것이지 증명이 아니다. */}
        <span className="card-note">
          접수번호를 아시는 분이면 답하실 수 있습니다. 성함은 기록에 남지만 본인 확인은 하지
          않습니다.
        </span>
      </div>
    </form>
  )
}

// 부서가 먼저 묻는다.
//
// 담당자 쪽 AskForm 과 다른 점 하나 — "이걸 알아야 무엇을 정할 수 있는지"를
// 안 받는다. 그건 판정하는 사람의 말이다. 부서에게 그걸 적으라고 하면
// 물어보려다 만다.
function DeptAskForm({ ticket, onSaved }) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ question: '', author: '' })
  const [fieldErrors, setFieldErrors] = useState({})
  const [saving, setSaving] = useState(false)

  async function send(e) {
    e.preventDefault()
    setSaving(true)
    setFieldErrors({})
    try {
      const r = await api.post(`/track/${encodeURIComponent(ticket)}/ask`, form)
      toast.success(r.message)
      setForm({ question: '', author: form.author })
      setOpen(false)
      await onSaved?.()
    } catch (err) {
      if (err.fields) setFieldErrors(err.fields)
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        className="btn-ghost btn-sm thread-ask-open"
        onClick={() => setOpen(true)}
      >
        담당자에게 물어보기
      </button>
    )
  }

  return (
    <form className="thread-form" onSubmit={send}>
      <div className="field">
        <label className="field-label">
          무엇이 궁금하십니까<span className="field-required"> *</span>
        </label>
        <textarea
          rows={2}
          value={form.question}
          onChange={(e) => setForm((f) => ({ ...f, question: e.target.value }))}
          placeholder="언제쯤 시작될지 알 수 있을까요? 이번 달 마감 전에 필요해서 그렇습니다."
        />
        {fieldErrors.question && <div className="field-error">{fieldErrors.question}</div>}
      </div>

      <div className="field">
        <label className="field-label">
          누가 물으십니까<span className="field-required"> *</span>
        </label>
        <input
          value={form.author}
          onChange={(e) => setForm((f) => ({ ...f, author: e.target.value }))}
          placeholder="정산 담당자"
        />
        {/* 로그인이 없어서 계정으로 증명할 수 없다. 아닌 것을 맞다고 하지
            않는다 — 증명이 아니라고 화면에도 적어 둔다. */}
        <div className="field-hint">
          이름 대신 직책도 됩니다. 로그인이 없어서 증명은 아니고, 나중에 누가 물었는지
          알아볼 수 있게 하는 것입니다.
        </div>
        {fieldErrors.author && <div className="field-error">{fieldErrors.author}</div>}
      </div>

      <div className="row">
        <button type="submit" className="btn-primary btn-sm" disabled={saving}>
          {saving ? '보내는 중…' : '보내기'}
        </button>
        <button type="button" className="btn-ghost btn-sm" onClick={() => setOpen(false)}>
          그만두기
        </button>
        <span className="spacer" />
        <span className="card-note">물어보신 것도 결정 기록에 그대로 남습니다.</span>
      </div>
    </form>
  )
}

// 담당자가 부서 질문에 답한다.
//
// 물을 자리만 만들고 답할 자리를 안 만들면, 부서는 물어 놓고 영영 답을
// 못 받는다. 그건 물을 데가 없는 것보다 나쁘다 — 물어본 사람은 기다린다.
function ReplyForm({ applicationId, questionId, onSaved }) {
  const toast = useToast()
  const [form, setForm] = useState({ answer: '', author: 'AX 담당자' })
  const [fieldErrors, setFieldErrors] = useState({})
  const [saving, setSaving] = useState(false)

  async function send(e) {
    e.preventDefault()
    setSaving(true)
    setFieldErrors({})
    try {
      const r = await api.post(`/applications/${applicationId}/reply`, { ...form, questionId })
      toast.success(r.message)
      setForm({ answer: '', author: form.author })
      await onSaved?.()
    } catch (err) {
      if (err.fields) setFieldErrors(err.fields)
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="thread-answer" onSubmit={send}>
      <textarea
        rows={2}
        value={form.answer}
        onChange={(e) => setForm((f) => ({ ...f, answer: e.target.value }))}
        placeholder="이번 주 안에 착수합니다. 마감 전에 쓰실 수 있게 하겠습니다."
      />
      {fieldErrors.answer && <div className="field-error">{fieldErrors.answer}</div>}
      <div className="row">
        <input
          className="thread-author"
          value={form.author}
          onChange={(e) => setForm((f) => ({ ...f, author: e.target.value }))}
          placeholder="누가 답하십니까"
        />
        <button type="submit" className="btn-primary btn-sm" disabled={saving}>
          {saving ? '보내는 중…' : '답하기'}
        </button>
      </div>
      {fieldErrors.author && <div className="field-error">{fieldErrors.author}</div>}
    </form>
  )
}
