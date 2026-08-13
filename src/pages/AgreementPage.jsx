import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { DEPTS } from '../../shared/depts.js'
import StageHeader from '../components/StageHeader.jsx'
import { useApi } from '../hooks/useApi.js'
import { useToast } from '../context/ToastContext.jsx'
import { api } from '../api/client.js'
import { ago } from '../lib/format.js'
import { validateResolve, RESOLUTION_BY_CODE } from '../../shared/signoff.js'
import { joinAsRequirement } from '../../shared/join.js'
import { withJosa } from '../../shared/korean.js'
import {
  REQUIREMENT_KINDS,
  PRIORITIES,
} from '../../shared/acceptance.js'


export default function AgreementPage() {
  const { data: list } = useApi('/applications')
  const [params] = useSearchParams()
  const [selectedId, setSelectedId] = useState(null)

  // 협의는 수용된 신청서에만 한다. 아직 판정하지 않은 것을 협의하면
  // 만들지 않기로 한 것에 회의 시간을 쓰게 된다.
  const accepted = useMemo(
    () => (list?.items ?? []).filter((a) => ['수용', '진행중', '완료'].includes(a.status)),
    [list]
  )

  // 할 일 목록이 "이의 보기"로 보낼 때 어느 건인지까지 실어 보낸다.
  // 이게 없으면 늘 첫 건 앞에 떨어지고, 담당자는 칩을 하나씩 눌러 찾아야
  // 한다. 그러면 할 일 목록이 "여기 볼 것이 있습니다"까지만 말하고
  // "어디를 보세요"는 안 말하는 셈이 된다.
  const wanted = params.get('id')

  // 들어오자마자 아무것도 펼치지 않는다.
  //
  // 전에는 첫 건을 자동으로 골라 회의록·이해관계자·요구가 한꺼번에 펼쳐졌다.
  // 3단계를 눌렀을 뿐인데 입력칸 여러 개가 먼저 나오면, 어느 신청서 얘기인지
  // 확인하기도 전에 화면부터 채워진다. 신청서를 눌러야 그 아래가 열린다.
  //
  // 다만 할 일 목록이 `?id=` 로 특정 건을 짚어 보낼 때는 연다. 거기까지
  // 데려다 놓고 다시 한 번 누르게 하면 "어디를 보세요"를 말하다 만 것이 된다.
  useEffect(() => {
    if (selectedId || accepted.length === 0 || !wanted) return
    const found = accepted.find((a) => a.id === wanted)
    if (found) setSelectedId(found.id)
  }, [accepted, selectedId, wanted])

  return (
    <div className="stack">
      <StageHeader stageKey="agreement" />

      {accepted.length === 0 ? (
        <div className="empty">
          <div className="empty-title">협의할 과제가 없습니다</div>
          <div className="empty-sub">
            2단계 검토에서 <strong>수용</strong>으로 판정한 신청서가 여기로 넘어옵니다.
          </div>
        </div>
      ) : (
        <>
          {/* 고르는 칩이 여는 단추를 겸한다. 한 번 더 누르면 접힌다 —
              펼치는 길만 있고 접는 길이 없으면 한 번 누른 뒤로는 되돌릴 수
              없다. */}
          <div className="chip-row">
            {accepted.map((a) => (
              <button
                key={a.id}
                type="button"
                className={`chip${selectedId === a.id ? ' on' : ''}`}
                aria-expanded={selectedId === a.id}
                onClick={() => setSelectedId((prev) => (prev === a.id ? null : a.id))}
              >
                {a.dept} · {a.title.slice(0, 22)}
                {a.title.length > 22 && '…'}
              </button>
            ))}
          </div>

          {selectedId ? (
            <Agreement id={selectedId} />
          ) : (
            <p className="card-note">
              위에서 신청서를 누르면 그 건의 협의 내용이 아래에 펼쳐집니다.
            </p>
          )}
        </>
      )}
    </div>
  )
}

function Agreement({ id }) {
  const { data, error, loading, reload } = useApi(`/applications/${id}/agreement`)
  const toast = useToast()

  async function send(method, body) {
    try {
      const r = await api[method](`/applications/${id}/agreement`, body)
      await reload()
      return r
    } catch (err) {
      // 여기서 다시 던지면 버튼 onClick이 받아 주는 곳이 없어 브라우저 콘솔에
      // 처리되지 않은 오류로 남는다. 사용자에게는 이미 알림으로 알렸으므로
      // null을 돌려주고, 이어서 할 일이 있는 곳만 그 값을 확인하면 된다.
      toast.error(err.message)
      return null
    }
  }

  if (loading && !data) return <div className="page-loading">불러오는 중…</div>
  if (error) return <div className="notice notice-danger">{error}</div>
  if (!data) return null

  // 한 화면에서 일곱 가지를 다 한다 — 이해관계자·회의록·요구·충돌·합격
  // 기준·이의·기준선. 그런데 이건 **순서가 있는 일**이다. 요구를 판단해야
  // 충돌이 보이고, 충돌을 판정해야 무엇을 통과로 볼지가 정해진다.
  //
  // 그래서 끝난 칸은 접는다. 지금 손봐야 하는 칸만 펼쳐 둔다. 접어도 제목은
  // 남으므로 무엇이 있는지는 보이고, 눌러서 언제든 다시 편다.
  //
  // 아무것도 안 끝났으면 첫 칸부터 펼친다. 다 끝났으면 전부 접는다 — 그때는
  // 위의 '협의가 끝났습니다'가 할 말을 다 한 것이다.
  const done = {
    '누가 이 일에 얽혀 있나': data.stakeholders.length > 0 && (data.pendingJoins ?? []).length === 0,
    회의록: data.meetings.length > 0,
    '회의에서 나온 것들': data.requirements.length > 0 && data.requirements.every((r) => r.status !== '초안'),
    '부서가 합격 기준을 본 결과': false,
  }
  // 아직 안 끝난 것 중 **첫 칸**만 펼친다. 여러 칸을 한꺼번에 펼치면
  // 접기 전과 같아진다.
  const order = [
    '누가 이 일에 얽혀 있나',
    '회의록',
    '회의에서 나온 것들',
    '부서가 합격 기준을 본 결과',
  ]
  const first = order.find((k) => !done[k]) ?? null
  const openBy = (title) => title === first

  return (
    <div className="stack">
      <Stakeholders data={data} send={send} toast={toast} openBy={openBy} />
      <Meetings data={data} send={send} toast={toast} openBy={openBy} />
      <Requirements data={data} send={send} toast={toast} openBy={openBy} />
      <Objections id={id} toast={toast} openBy={openBy} />
    </div>
  )
}

// 맨 위에 '아직 만들기 시작하면 안 되는 이유' 띠가 있었다. 지웠다.
// 합격 기준과 기준선을 넣을 자리를 이 화면에서 걷어낸 뒤로는, 그 띠가
// 미는 두 줄을 아무도 채울 수 없었다 — 시키는 대로 할 수 없는 안내는
// 안내가 아니다.

// ── 이해관계자 ──────────────────────────────────────────────
function Stakeholders({ data, send, toast, openBy }) {
  const [form, setForm] = useState({ dept: '', role_label: '', person_label: '', wants: '' })

  return (
    <details className="card card-boxed" open={openBy('누가 이 일에 얽혀 있나')}>
      <summary className="card-head">
        <span className="card-title">누가 이 일에 얽혀 있나</span>
      </summary>

      {/* 손들었는데 아직 협의안에 사정이 안 들어온 부서.
          이걸 안 하면 담당자는 낸 부서하고만 합의하고 넘어가고, 손든
          부서는 다 만들어진 뒤에 처음 기준을 본다. */}
      <PendingJoins pending={data.pendingJoins ?? []} send={send} toast={toast} />

      {data.stakeholders.length > 0 && (
        <div className="stack-sm" style={{ marginBottom: 14 }}>
          {data.stakeholders.map((s) => (
            <div key={s.id} className="stake-row">
              <span className="badge badge-neutral">{s.dept}</span>
              <div className="stake-body">
                <strong>{s.person_label}</strong>
                <span className="card-note"> · {s.role_label}</span>
                <div className="item-body" style={{ fontSize: 14 }}>
                  {s.wants}
                </div>
              </div>
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() => send('remove', { kind: 'stakeholder', id: s.id })}
              >
                빼기
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="field-row">
        <select value={form.dept} onChange={(e) => setForm({ ...form, dept: e.target.value })}>
          <option value="">부서</option>
          {DEPTS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <input
          value={form.person_label}
          onChange={(e) => setForm({ ...form, person_label: e.target.value })}
          placeholder="누구 (예: 정산 담당자)"
        />
        <input
          value={form.role_label}
          onChange={(e) => setForm({ ...form, role_label: e.target.value })}
          placeholder="역할 (예: 주관)"
        />
      </div>
      <input
        value={form.wants}
        onChange={(e) => setForm({ ...form, wants: e.target.value })}
        placeholder="이 사람이 원하는 것 한 줄 — 예: 금액이 1원도 틀리면 안 된다"
        style={{ width: '100%', marginTop: 8 }}
      />
      <button
        type="button"
        className="btn-ghost"
        style={{ marginTop: 8 }}
        onClick={async () => {
          if (!form.dept || !form.wants.trim()) {
            toast.error('부서와 원하는 것은 적어주세요.')
            return
          }
          await send('post', { kind: 'stakeholder', ...form })
          setForm({ dept: '', role_label: '', person_label: '', wants: '' })
        }}
      >
        추가
      </button>
    </details>
  )
}

// ── 회의록 ──────────────────────────────────────────────────
function Meetings({ data, send, toast, openBy }) {
  const [draft, setDraft] = useState({ title: '', minutes_text: '' })
  const [editing, setEditing] = useState(null)

  return (
    <details className="card card-boxed" open={openBy('회의록')}>
      <summary className="card-head">
        <span className="card-title">회의록</span>
      </summary>

      {data.meetings.map((m) => (
        <div key={m.id} className="meeting">
          <div className="row-between">
            <strong>
              {m.seq}차 · {m.title}
            </strong>
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={() => setEditing(editing === m.id ? null : m.id)}
            >
              {editing === m.id ? '접기' : '펼쳐서 고치기'}
            </button>
          </div>
          {editing === m.id ? (
            <>
              <textarea
                rows={14}
                defaultValue={m.minutes_text ?? ''}
                id={`minutes-${m.id}`}
                style={{ width: '100%', marginTop: 8, fontFamily: 'var(--mono)', fontSize: 13 }}
              />
              <button
                type="button"
                className="btn-primary btn-sm"
                style={{ marginTop: 8 }}
                onClick={async () => {
                  const el = document.getElementById(`minutes-${m.id}`)
                  await send('patch', {
                    kind: 'meeting',
                    id: m.id,
                    title: m.title,
                    minutes_text: el.value,
                  })
                  setEditing(null)
                  toast.success('회의록을 저장했습니다.')
                }}
              >
                저장
              </button>
            </>
          ) : (
            <pre className="minutes-preview">
              {(m.minutes_text ?? '(아직 비어 있습니다)').slice(0, 400)}
              {(m.minutes_text?.length ?? 0) > 400 && '\n…'}
            </pre>
          )}
        </div>
      ))}

      <div className="row" style={{ marginTop: 12 }}>
        <input
          value={draft.title}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          placeholder="회의 제목 (예: 1차 발굴 회의)"
          style={{ flex: 1 }}
        />
        <button
          type="button"
          className="btn-ghost"
          onClick={async () => {
            await send('post', { kind: 'meeting', title: draft.title })
            setDraft({ title: '', minutes_text: '' })
          }}
        >
          회의 추가
        </button>
      </div>
    </details>
  )
}

// ── 요구사항 ────────────────────────────────────────────────
function Requirements({ data, send, toast, openBy }) {
  const [form, setForm] = useState({
    req_kind: '요구',
    dept: '',
    body: '',
    quote: '',
    priority: '보통',
    measurable: '',
  })

  const groups = {
    초안: data.requirements.filter((r) => r.status === '초안'),
    확정: data.requirements.filter((r) => ['채택', '수정채택'].includes(r.status)),
    기각: data.requirements.filter((r) => r.status === '기각'),
  }

  return (
    <details className="card card-boxed" open={openBy('회의에서 나온 것들')}>
      <summary className="card-head">
        <span className="card-title">회의에서 나온 것들</span>
      </summary>

      {groups.초안.length > 0 && (
        <>
          <h4>아직 판단하지 않음 {groups.초안.length}</h4>
          <div className="stack-sm" style={{ marginBottom: 14 }}>
            {groups.초안.map((r) => (
              <RequirementCard key={r.id} r={r} send={send} toast={toast} editable />
            ))}
          </div>
        </>
      )}

      {groups.확정.length > 0 && (
        <>
          <h4>확정 {groups.확정.length}</h4>
          <div className="stack-sm" style={{ marginBottom: 14 }}>
            {groups.확정.map((r) => (
              <RequirementCard key={r.id} r={r} send={send} toast={toast} />
            ))}
          </div>
        </>
      )}

      {groups.기각.length > 0 && (
        <>
          <h4>기각 {groups.기각.length}</h4>
          <div className="stack-sm" style={{ marginBottom: 14 }}>
            {groups.기각.map((r) => (
              <RequirementCard key={r.id} r={r} send={send} toast={toast} />
            ))}
          </div>
        </>
      )}

      <details className="disclose">
        <summary>회의에서 나온 것 적기</summary>
        <div className="disclose-body">
          <div className="field-row">
            <select
              value={form.req_kind}
              onChange={(e) => setForm({ ...form, req_kind: e.target.value })}
            >
              {REQUIREMENT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
            <select value={form.dept} onChange={(e) => setForm({ ...form, dept: e.target.value })}>
              <option value="">어느 부서가</option>
              {DEPTS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <select
              value={form.priority}
              onChange={(e) => setForm({ ...form, priority: e.target.value })}
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <textarea
            rows={2}
            value={form.body}
            onChange={(e) => setForm({ ...form, body: e.target.value })}
            placeholder="내용 — 예: 정답 대비 금액 오차가 0원이어야 한다"
            style={{ width: '100%', marginTop: 8 }}
          />
          <input
            value={form.quote}
            onChange={(e) => setForm({ ...form, quote: e.target.value })}
            placeholder='회의록에서 그대로 옮긴 말 (예: "금액이 1원이라도 틀리면 안 됩니다")'
            style={{ width: '100%', marginTop: 8 }}
          />
          <input
            value={form.measurable}
            onChange={(e) => setForm({ ...form, measurable: e.target.value })}
            placeholder="통과/실패를 가를 수 있는 형태로 바꾼다면 (선택)"
            style={{ width: '100%', marginTop: 8 }}
          />
          <button
            type="button"
            className="btn-ghost"
            style={{ marginTop: 8 }}
            onClick={async () => {
              if (!form.body.trim()) {
                toast.error('내용을 적어주세요.')
                return
              }
              await send('post', { kind: 'requirement', ...form })
              setForm({ ...form, body: '', quote: '', measurable: '' })
            }}
          >
            추가
          </button>
        </div>
      </details>
    </details>
  )
}

function RequirementCard({ r, send, toast, editable }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  // 고쳐서 채택하기. 서버는 decided_body를 받는데 화면에 버튼이 없어서
  // 이 길이 죽어 있었다. 요구는 올린 뒤 본문을 못 고치므로, 문장을 다듬는
  // 유일한 길이 이것이다.
  const [amend, setAmend] = useState(null)

  const tone =
    r.status === '기각' ? 'rejected' : r.status === '초안' ? 'draft' : 'decided'

  return (
    <div className={tone}>
      <div className="row" style={{ marginBottom: 4 }}>
        <span className={`badge ${kindTone(r.kind)}`}>{r.kind}</span>
        <span className="badge badge-neutral">{r.dept}</span>
        {r.priority === '필수' && <span className="badge badge-danger">필수</span>}
        <span className="spacer" />
        <span className="card-note">{r.status}</span>
      </div>

      <div className="item-body">{r.decided_body || r.body}</div>

      {/* 고쳐서 채택했으면 부서가 말한 원문을 같이 남긴다.
          고친 문장만 보이면, 부서는 자기가 한 말이 어떻게 바뀌었는지 모른 채
          그 문장으로 판정받는다. 무엇을 고쳤는지 보이는 것이 협의다. */}
      {r.decided_body && r.decided_body !== r.body && (
        <div className="item-original">
          <strong>{withJosa(r.dept, '가')} 말한 것</strong> {r.body}
        </div>
      )}

      {r.quote && (
        <div className="item-quote">
          “{r.quote}”
          {r.quote_verified === false && (
            <span className="badge badge-warning" style={{ marginLeft: 6 }}>
              회의록에서 못 찾음
            </span>
          )}
          {r.quote_verified === true && (
            <span className="badge badge-success" style={{ marginLeft: 6 }}>
              회의록 확인됨
            </span>
          )}
        </div>
      )}

      {r.measurable && <div className="card-note" style={{ marginTop: 5 }}>판정 기준: {r.measurable}</div>}
      {r.reject_reason && (
        <div className="decision-why">
          <strong>기각 사유</strong> {r.reject_reason}
        </div>
      )}

      {editable && (
        <div className="item-actions">
          <button
            type="button"
            className="btn-ghost btn-sm"
            onClick={() => send('patch', { kind: 'requirement', id: r.id, status: '채택' })}
          >
            채택
          </button>
          <button
            type="button"
            className="btn-ghost btn-sm"
            onClick={() => setAmend(amend === null ? r.body : null)}
          >
            고쳐서 채택
          </button>
          <button
            type="button"
            className="btn-ghost btn-sm"
            onClick={() => setOpen(!open)}
          >
            기각
          </button>
          <button
            type="button"
            className="btn-ghost btn-sm"
            onClick={() => send('remove', { kind: 'requirement', id: r.id })}
          >
            지우기
          </button>
        </div>
      )}

      {amend !== null && (
        <div className="conditional-box" style={{ marginTop: 8 }}>
          <textarea
            rows={2}
            value={amend}
            onChange={(e) => setAmend(e.target.value)}
            placeholder="이 건에 맞게 다듬은 문장"
          />
          <div className="row">
            <button
              type="button"
              className="btn-primary btn-sm"
              onClick={async () => {
                if (!amend.trim()) {
                  toast.error('고친 문장을 적어주세요.')
                  return
                }
                await send('patch', {
                  kind: 'requirement',
                  id: r.id,
                  status: '수정채택',
                  decided_body: amend.trim(),
                })
                setAmend(null)
              }}
            >
              이 문장으로 채택
            </button>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setAmend(null)}>
              그만두기
            </button>
          </div>
        </div>
      )}

      {open && (
        <div className="conditional-box" style={{ marginTop: 8 }}>
          <textarea
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="왜 기각하는지 20자 이상 — 회의에서 나온 말을 이유 없이 접으면 그 부서는 다음부터 말하지 않습니다"
            style={{ width: '100%' }}
          />
          <button
            type="button"
            className="btn-danger btn-sm"
            style={{ marginTop: 6 }}
            onClick={async () => {
              await send('patch', {
                kind: 'requirement',
                id: r.id,
                status: '기각',
                reject_reason: reason,
                summary: r.body,
              })
              setOpen(false)
              toast.success('기각했습니다. 기록에 남았습니다.')
            }}
          >
            기각 확정
          </button>
        </div>
      )}
    </div>
  )
}

function kindTone(kind) {
  if (kind === '제약') return 'badge-danger'
  if (kind === '가정') return 'badge-warning'
  if (kind === '미결') return 'badge-neutral'
  return 'badge-accent'
}

// 충돌 판정·합격 기준·기준선 실측 세 칸이 여기 있었다. 화면에서 걷어냈다.
// 세 칸을 만드는 서버 길과 표는 그대로 두었다 — 지운 것은 이 화면이다.

// ── 부서가 단 이의 ──────────────────────────────────────────
//
// 부서에게 합격 기준을 확인받으면 이의가 달려 돌아온다. 그걸 푸는 자리가
// 없으면 그 신청서는 영영 "이의 있음"으로 남고, 담당자는 다음부터 서명을
// 아예 안 받는다 — 받아 봐야 되돌릴 수 없는 표시만 붙기 때문이다.
//
// **"그대로 갑니다"를 일부러 남겨 뒀다.** 이걸 못 하게 하면 부서가 아무
// 기준이나 영영 막을 수 있다. 대신 그렇게 하면 그 사실이 기록에 남고,
// 통과를 말할 때마다 같이 적힌다. 없앨 수 없게 하는 것이 못 하게 하는
// 것보다 정직하다.
function Objections({ id, toast, openBy }) {
  const { data, reload } = useApi(`/applications/${id}/signoff`)
  const [open, setOpen] = useState(null)
  const [form, setForm] = useState({ code: '', reason: '', by: 'AX 담당자' })
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)

  if (!data) return null
  const { state, objections, ways } = data
  // 아직 부서에 확인을 안 받았으면 이 자리는 아무 말도 하지 않는다.
  if (!state.by && objections.length === 0) return null

  async function resolve(objectionId) {
    const bad = validateResolve(form)
    setErrors(bad)
    if (Object.keys(bad).length > 0) return
    setBusy(true)
    try {
      const r = await api.post(`/applications/${id}/signoff`, { ...form, objection_id: objectionId })
      toast.success(r.message)
      setOpen(null)
      setForm({ code: '', reason: '', by: 'AX 담당자' })
      reload()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <details className="card card-boxed" open={openBy('부서가 합격 기준을 본 결과')}>
      <summary className="card-head">
        <span className="card-title">부서가 합격 기준을 본 결과</span>
        <span className={`badge ${state.binding ? 'badge-success' : 'badge-warning'}`}>
          {state.status}
        </span>
        <span className="spacer" />
        <span className="card-note">
          {state.binding
            ? '이 기준으로 통과를 말해도 근거가 있습니다'
            : '지금 통과를 말하면 그 통과에 단서가 붙습니다'}
        </span>
      </summary>
      <p className="card-note">{state.headline}</p>

      {objections.length === 0 && (
        <p className="card-note">이의 없이 확인해주셨습니다.</p>
      )}

      <ul className="objection-list">
        {objections.map((o) => (
          <li key={o.id} className={o.resolution ? 'resolved' : ''}>
            <div className="objection-crit">{o.criterion?.body ?? '(기준을 찾지 못했습니다)'}</div>
            <p className="objection-body">
              <strong>{o.by}님</strong> {o.body}
            </p>

            {o.resolution ? (
              <p className="objection-answer">
                <strong>{RESOLUTION_BY_CODE[o.resolution.code]?.label ?? o.resolution.code}</strong>{' '}
                {o.resolution.body}
                <span className="card-note"> — {o.resolution.by} · {ago(o.resolution.at)}</span>
              </p>
            ) : open === o.id ? (
              <div className="objection-form">
                {ways.map((w) => (
                  <label key={w.code}>
                    <input
                      type="radio"
                      name={`w-${o.id}`}
                      checked={form.code === w.code}
                      onChange={() => setForm((f) => ({ ...f, code: w.code }))}
                    />
                    {w.label}
                    {w.resign && <span className="card-note"> — 부서에 다시 확인을 요청합니다</span>}
                  </label>
                ))}
                {errors.code && <em className="field-error">{errors.code}</em>}

                <textarea
                  rows={2}
                  value={form.reason}
                  onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
                  placeholder={
                    RESOLUTION_BY_CODE[form.code]?.reasonLabel ?? '무엇을 하셨습니까'
                  }
                />
                {errors.reason && <em className="field-error">{errors.reason}</em>}
                <small className="card-note">이 문장이 그대로 부서 조회 화면에 갑니다.</small>

                <div className="row">
                  <button type="button" className="btn-primary btn-sm" disabled={busy} onClick={() => resolve(o.id)}>
                    {busy ? '남기는 중…' : '남기기'}
                  </button>
                  <button type="button" className="btn-ghost btn-sm" onClick={() => setOpen(null)}>
                    그만두기
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" className="btn-ghost btn-sm" onClick={() => setOpen(o.id)}>
                이 이의에 답하기
              </button>
            )}
          </li>
        ))}
      </ul>
    </details>
  )
}

// 손들었는데 아직 협의안에 사정이 안 들어온 부서.
//
// 손든 부서의 사정은 이미 다 적혀 있다. 없는 것은 그 한 줄이 협의 자리로
// 건너오는 다리 하나뿐이다.
//
// **버튼을 누르면 바로 안 올린다. 편집 칸을 연다.** 손들며 적어 주신 것은
// "그쪽에서 이 일이 어떻게 벌어지는가"(사정)이지 "무엇을 원하는가"(요구)가
// 아니다. 그대로 올리면 요구 목록에 요구가 아닌 신세 한탄이 박히고,
// 요구는 올린 뒤에 본문을 못 고친다.
function PendingJoins({ pending, send, toast }) {
  const [draft, setDraft] = useState({})
  const [busy, setBusy] = useState(null)

  if (pending.length === 0) return null

  async function lift(p) {
    const body = (draft[p.join_id] ?? p.story ?? '').trim()
    if (!body) {
      toast.error('무엇을 요구하시는지 한 줄로 적어주세요.')
      return
    }
    setBusy(p.join_id)
    try {
      await send('post', { ...joinAsRequirement(p), body })
      toast.success(`${p.dept}의 요구로 올렸습니다. 회의 뒤에 채택/기각을 정하세요.`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="pending-joins">
      <div className="pending-joins-head">
        <strong>손들었는데 아직 협의안에 없는 부서 {pending.length}곳</strong>
      </div>

      {pending.map((p) => {
        const value = draft[p.join_id] ?? p.story ?? ''
        const untouched = value.trim() === (p.story ?? '').trim()
        return (
          <div key={p.join_id} className="pending-join">
            <div className="pending-join-top">
              <span className="badge badge-warning">{p.dept}</span>
              <span className="card-note">
                {p.by}
                {p.annualHours != null && ` · 연 ${p.annualHours}시간`}
                {p.minutes && ` · 한 번에 ${p.minutes}분`}
                {p.frequency && ` · ${p.frequency}`}
              </span>
            </div>

            <p className="pending-join-said">&ldquo;{p.story}&rdquo;</p>

            <textarea
              rows={2}
              value={value}
              onChange={(e) => setDraft((d) => ({ ...d, [p.join_id]: e.target.value }))}
            />
            <small className="card-note">
              적어 주신 것은 <strong>사정</strong>입니다. 무엇을 요구하시는지로 바꿔 올리세요.
              올린 뒤에는 본문을 못 고칩니다 — 수정채택으로 덮거나 지우고 다시 올려야 합니다.
            </small>

            <div className="row">
              <button
                type="button"
                className="btn-primary btn-sm"
                disabled={busy === p.join_id}
                onClick={() => lift(p)}
              >
                {busy === p.join_id ? '올리는 중…' : '협의안에 올리기'}
              </button>
              {untouched && (
                <span className="card-note">사정 문장 그대로입니다 — 요구로 읽히십니까?</span>
              )}
            </div>
          </div>
        )
      })}

      <p className="card-note pending-joins-foot">
        마주 앉기 전이라 <strong>가정</strong>으로 올라갑니다. 회의 뒤에 채택·수정채택·기각을
        정하시면 됩니다. 이 부서가 이 건과 상관없다면 접수함에서 손들기를 푸세요.
      </p>
    </div>
  )
}
