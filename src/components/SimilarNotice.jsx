import { useState } from 'react'
import { Link } from 'react-router-dom'
import { reasonText } from '../../shared/similar.js'
import { api } from '../api/client.js'
import { ago, num } from '../lib/format.js'
import { validateJoin, FREQUENCIES, joinTrackPath } from '../../shared/join.js'

// "이거 이미 들어와 있는데요"
//
// 부서 사람이 바뀌었거나, 낸 걸 잊었거나, 옆자리가 낸 걸 몰랐거나. 어느
// 쪽이든 결과는 같다 — 부서는 이미 있는 도구를 못 쓴 채 몇 주를 더 기다리고,
// 담당자는 같은 일을 두 번 검토한다.
//
// 겹친 낱말을 반드시 함께 보여 준다. "비슷합니다"라고만 하면 사람은 "뭐가
// 비슷한데"라고 생각하고 그냥 닫는다. "오프라인·오픈마켓·자사몰 같은 말이
// 겹칩니다"라고 하면 그 자리에서 맞는지 틀린지 판단할 수 있다.
//
// 막지 않는다. 비슷해 보인다고 신청을 못 하게 하면, 진짜 다른 건을 내려던
// 사람이 낼 데를 잃는다. 알려 주고 고르게 한다.
export default function SimilarNotice({ hits, tone = 'apply', onDismiss, selfId, draft }) {
  if (!hits || hits.length === 0) return null

  const strongest = hits[0]
  const isApply = tone === 'apply'

  return (
    <section className={`similar ${strongest.same ? 'same' : ''}`}>
      <div className="similar-head">
        <span className="similar-title">
          {strongest.same
            ? isApply
              ? '이미 들어와 있는 것 같습니다'
              : '거의 같은 신청서가 이미 있습니다'
            : isApply
              ? '비슷한 신청서가 이미 있습니다'
              : '비슷한 신청서가 있습니다'}
        </span>
        <span className="spacer" />
        {onDismiss && (
          <button type="button" className="btn-ghost btn-sm" onClick={onDismiss}>
            닫기
          </button>
        )}
      </div>

      <p className="similar-lead">
        {isApply ? (
          <>
            같은 일이라면 아래 신청서를 보시면 어디까지 왔는지 알 수 있습니다. 이미 만들어 둔 것이
            있으면 기다리지 않고 바로 쓰실 수 있습니다. <strong>다른 일이라면 그냥 계속 적으세요</strong>
            {' '}— 막지 않습니다.
          </>
        ) : (
          <>
            판정하기 전에 보고 가세요. 같은 건이면 두 번 만들지 않아야 하고, 다른 건이면 어디가
            다른지가 판정 근거에 들어가야 합니다.
          </>
        )}
      </p>

      <ol className="similar-list">
        {hits.map((h) => (
          <li key={h.id ?? h.ticket_no}>
            <div className="similar-item-top">
              <span className={`badge ${h.same ? 'badge-warning' : 'badge-neutral'}`}>
                {Math.round(h.score * 100)}% 겹침
              </span>
              <span className="badge badge-neutral">{h.dept}</span>
              <span className={`badge ${statusTone(h.status)}`}>{h.status}</span>
              <span className="spacer" />
              <span className="card-note">{ago(h.created_at)}</span>
            </div>

            <div className="similar-item-title">{h.title}</div>

            {/* 왜 비슷하다고 봤는지. 이 줄이 없으면 아무도 이 경고를 안 믿는다. */}
            <div className="similar-why">{reasonText(h)}</div>

            <div className="similar-item-foot">
              {/* 담당자 자리에서는 나란히 놓고 볼 수 있게 한다. 번갈아 읽는
                  것으로는 같은 건인지 판정하기 어렵다. */}
              {!isApply && selfId && (
                <Link
                  to={`/compare?a=${encodeURIComponent(selfId)}&b=${encodeURIComponent(h.id ?? h.ticket_no)}`}
                  className="btn-ghost btn-sm"
                >
                  나란히 놓고 보기
                </Link>
              )}
              <Link
                to={isApply ? `/track?no=${h.ticket_no}` : `/record/${h.id ?? h.ticket_no}`}
                className="btn-ghost btn-sm"
              >
                {isApply ? '어디까지 왔는지 보기' : '이 신청서 기록 전부'}
              </Link>
              <span className="mono card-note">{h.ticket_no}</span>
              {h.annual_hours != null && (
                <span className="card-note">
                  · 연 {num(h.annual_hours, 0)}시간짜리로 접수된 건입니다
                </span>
              )}
            </div>

            {/* 알려 주기만 하면 부서는 할 수 있는 일이 없다. 그냥 똑같이
                내거나(담당자가 두 번 판정한다) 그만두거나인데, 그만두면
                그 부서도 같은 일로 시간을 쓴다는 사실이 어디에도 안 남는다. */}
            {isApply && <JoinIn hit={h} draft={draft} />}
          </li>
        ))}
      </ol>

      <p className="card-note similar-foot">
        낱말이 얼마나 겹치는지로 골라낸 것입니다. 여러 신청서에 다 나오는 말은 거의 세지 않고,
        몇 건에만 나오는 말이 겹칠 때만 의심합니다. AI가 판단한 것이 아니라 정해진 규칙입니다.
      </p>
    </section>
  )
}

function statusTone(status) {
  if (status === '수용' || status === '완료') return 'badge-success'
  if (status === '반려') return 'badge-danger'
  if (status === '보류') return 'badge-warning'
  return 'badge-neutral'
}

// "저것도 우리 얘기입니다" — 새로 안 내고 있는 신청서에 손든다.
//
// 부서 이름만 받지 않는다. 그 부서에서 이 일이 얼마나 걸리는지를 같이
// 받아야 담당자가 우선순위를 다시 매길 수 있다. 부서 이름만 있으면
// "세 부서가 겪습니다"까지밖에 못 말한다.
function JoinIn({ hit, draft }) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(() => ({
    dept: draft?.dept ?? '',
    by: draft?.applicant_label ?? '',
    minutes: draft?.current_minutes ?? '',
    people: draft?.current_people ?? '',
    frequency: draft?.current_frequency ?? '',
    story: draft?.problem ?? '',
  }))
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)

  if (done) {
    return (
      <p className="join-done">
        {done}{' '}
        {/* 부서 시점 주소를 준다. 그냥 접수번호만 주면 낸 부서 시점으로
            열려서, 자기가 적어 낸 한 줄을 못 찾는다. */}
        <Link to={joinTrackPath({ ticket: hit.ticket_no, dept: form.dept })}>
          그쪽 부서 것이 어떻게 됐는지 보기
        </Link>
      </p>
    )
  }

  async function send(e) {
    e.preventDefault()
    const bad = validateJoin(form)
    setErrors(bad)
    if (Object.keys(bad).length > 0) return
    setBusy(true)
    try {
      const r = await api.post(`/applications/${encodeURIComponent(hit.ticket_no)}/join`, form)
      setDone(r.message)
    } catch (err) {
      setErrors({ story: err.message })
    } finally {
      setBusy(false)
    }
  }

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  if (!open) {
    return (
      <button type="button" className="join-ask" onClick={() => setOpen(true)}>
        저것도 우리 얘기입니다 — 새로 내지 말고 저기 붙이기
      </button>
    )
  }

  return (
    <form className="join-form" onSubmit={send}>
      <p className="card-note">
        새 신청서를 만들지 않습니다. 저 신청서에 <strong>그쪽 부서 몫을 같이 세어</strong> 둡니다.
        저것이 만들어지면 그쪽도 바로 쓰시게 됩니다.
      </p>

      <div className="join-row">
        <label>
          <span>부서</span>
          <input value={form.dept} onChange={set('dept')} placeholder="마케팅" />
          {errors.dept && <em className="field-error">{errors.dept}</em>}
        </label>
        <label>
          <span>성함</span>
          <input value={form.by} onChange={set('by')} placeholder="이과장" />
          {errors.by && <em className="field-error">{errors.by}</em>}
        </label>
      </div>

      <label>
        <span>그쪽 부서에서는 이 일이 어떻게 벌어집니까</span>
        <textarea
          rows={2}
          value={form.story}
          onChange={set('story')}
          placeholder="저희도 매주 채널별로 숫자를 옮겨 적습니다. 다만 저희는 광고비까지 같이 봅니다."
        />
        {errors.story && <em className="field-error">{errors.story}</em>}
        <small className="card-note">같은 병목이라도 부서마다 다릅니다. 다른 데가 있으면 그것부터 적어 주세요.</small>
      </label>

      <div className="join-row">
        <label>
          <span>한 번에 몇 분</span>
          <input type="number" min="1" value={form.minutes} onChange={set('minutes')} />
          {errors.minutes && <em className="field-error">{errors.minutes}</em>}
        </label>
        <label>
          <span>몇 분이</span>
          <input type="number" min="1" value={form.people} onChange={set('people')} placeholder="1" />
          {errors.people && <em className="field-error">{errors.people}</em>}
        </label>
        <label>
          <span>얼마나 자주</span>
          <select value={form.frequency} onChange={set('frequency')}>
            <option value="">고르세요</option>
            {FREQUENCIES.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
          {errors.frequency && <em className="field-error">{errors.frequency}</em>}
        </label>
      </div>

      <div className="row">
        <button type="submit" className="btn-primary btn-sm" disabled={busy}>
          {busy ? '붙이는 중…' : '이 신청서에 붙이기'}
        </button>
        <button type="button" className="btn-ghost btn-sm" onClick={() => setOpen(false)}>
          그만두기
        </button>
      </div>
    </form>
  )
}
