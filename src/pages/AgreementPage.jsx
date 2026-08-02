import { useEffect, useMemo, useState } from 'react'
import StageHeader from '../components/StageHeader.jsx'
import Stopwatch from '../components/Stopwatch.jsx'
import { useApi } from '../hooks/useApi.js'
import { useToast } from '../context/ToastContext.jsx'
import { api } from '../api/client.js'
import { duration, krw, num, ago } from '../lib/format.js'
import { validateResolve, RESOLUTION_BY_CODE } from '../../shared/signoff.js'
import { HOURLY_WAGE_KRW, RUNS_PER_YEAR } from '../../shared/outcome.js'
import { joinAsRequirement } from '../../shared/join.js'
import {
  CRITERION_CATALOG,
  CONFLICT_VERDICTS,
  REQUIREMENT_KINDS,
  PRIORITIES,
} from '../../shared/acceptance.js'

const DEPTS = ['재무', '마케팅', '영업', 'SCM', '운영', '인사', '기타']

export default function AgreementPage() {
  const { data: list } = useApi('/applications')
  const [selectedId, setSelectedId] = useState(null)

  // 협의는 수용된 신청서에만 한다. 아직 판정하지 않은 것을 협의하면
  // 만들지 않기로 한 것에 회의 시간을 쓰게 된다.
  const accepted = useMemo(
    () => (list?.items ?? []).filter((a) => ['수용', '진행중', '완료'].includes(a.status)),
    [list]
  )

  useEffect(() => {
    if (!selectedId && accepted.length > 0) setSelectedId(accepted[0].id)
  }, [accepted, selectedId])

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
          <div className="chip-row">
            {accepted.map((a) => (
              <button
                key={a.id}
                type="button"
                className={`chip${selectedId === a.id ? ' on' : ''}`}
                onClick={() => setSelectedId(a.id)}
              >
                {a.dept} · {a.title.slice(0, 22)}
                {a.title.length > 22 && '…'}
              </button>
            ))}
          </div>

          {selectedId && <Agreement id={selectedId} />}
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

  return (
    <div className="stack">
      <GateBanner gate={data.gate} />
      <Stakeholders data={data} send={send} toast={toast} />
      <Meetings data={data} send={send} toast={toast} />
      <Requirements data={data} send={send} toast={toast} />
      <Conflicts data={data} send={send} toast={toast} />
      <Criteria data={data} send={send} toast={toast} />
      <Objections id={id} toast={toast} />
      <Baseline data={data} send={send} toast={toast} />
    </div>
  )
}

function GateBanner({ gate }) {
  if (gate.ready) {
    return (
      <div className="notice notice-success">
        <div className="notice-title">협의가 끝났습니다</div>
        <p>
          요구를 전부 판단했고, 충돌을 판정했고, 합격 기준을 확정했고, 기준선을 봉인했습니다.
          이제 만들기 시작할 수 있습니다.
        </p>
      </div>
    )
  }
  return (
    <div className="notice notice-warn">
      <div className="notice-title">아직 만들기 시작하면 안 되는 이유</div>
      <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
        {gate.blockers.map((b, i) => (
          <li key={i}>{b}</li>
        ))}
      </ul>
    </div>
  )
}

// ── 이해관계자 ──────────────────────────────────────────────
function Stakeholders({ data, send, toast }) {
  const [form, setForm] = useState({ dept: '', role_label: '', person_label: '', wants: '' })

  return (
    <section className="card">
      <div className="card-head">
        <span className="card-title">누가 이 일에 얽혀 있나</span>
        <span className="card-note">각자 원하는 것이 다르고, 그 차이가 충돌이 된다</span>
      </div>

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
    </section>
  )
}

// ── 회의록 ──────────────────────────────────────────────────
function Meetings({ data, send, toast }) {
  const [draft, setDraft] = useState({ title: '', minutes_text: '' })
  const [editing, setEditing] = useState(null)

  return (
    <section className="card">
      <div className="card-head">
        <span className="card-title">회의록</span>
        <span className="card-note">여기 적힌 말만 요구의 근거가 된다</span>
      </div>

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
    </section>
  )
}

// ── 요구사항 ────────────────────────────────────────────────
function Requirements({ data, send, toast }) {
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
    <section className="card">
      <div className="card-head">
        <span className="card-title">회의에서 나온 것들</span>
        <span className="card-note">
          가정이 특히 중요하다 — 나중에 깨지는 것은 대개 확인 없이 전제한 것이다
        </span>
      </div>

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
    </section>
  )
}

function RequirementCard({ r, send, toast, editable }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')

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

      {open && (
        <div className="conditional-box" style={{ marginTop: 8 }}>
          <textarea
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="왜 기각하는지 (비워 둬도 됩니다)"
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

// ── 충돌 판정 ───────────────────────────────────────────────
function Conflicts({ data, send, toast }) {
  const [form, setForm] = useState({ req_a_id: '', req_b_id: '', reason: '', tradeoff_axis: '', severity: '보통' })
  const usable = data.requirements.filter((r) => r.status !== '기각')

  return (
    <section className="card">
      <div className="card-head">
        <span className="card-title">동시에 될 수 없는 것들</span>
        <span className="card-note">여기가 사람이 판단해야 하는 자리다</span>
      </div>

      {data.conflicts.length === 0 && (
        <p className="card-note" style={{ marginBottom: 12 }}>
          아직 등록한 충돌이 없습니다. 재무는 정확도를, 영업은 속도를 원하는 식으로 부딪히는
          지점이 있으면 여기 적고 무엇을 택할지 정합니다.
        </p>
      )}

      <div className="stack-sm">
        {data.conflicts.map((c) => (
          <ConflictCard key={c.id} c={c} send={send} toast={toast} />
        ))}
      </div>

      <details className="disclose" style={{ marginTop: 12 }}>
        <summary>부딪히는 요구 두 개 등록하기</summary>
        <div className="disclose-body">
          <div className="field-row">
            <select
              value={form.req_a_id}
              onChange={(e) => setForm({ ...form, req_a_id: e.target.value })}
            >
              <option value="">한쪽</option>
              {usable.map((r) => (
                <option key={r.id} value={r.id}>
                  [{r.dept}] {r.body.slice(0, 30)}
                </option>
              ))}
            </select>
            <select
              value={form.req_b_id}
              onChange={(e) => setForm({ ...form, req_b_id: e.target.value })}
            >
              <option value="">다른 쪽</option>
              {usable.map((r) => (
                <option key={r.id} value={r.id}>
                  [{r.dept}] {r.body.slice(0, 30)}
                </option>
              ))}
            </select>
            <select
              value={form.severity}
              onChange={(e) => setForm({ ...form, severity: e.target.value })}
            >
              {['낮음', '보통', '높음'].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <textarea
            rows={2}
            value={form.reason}
            onChange={(e) => setForm({ ...form, reason: e.target.value })}
            placeholder="왜 둘이 동시에 될 수 없는지 — 무엇을 얻으면 무엇을 잃는지"
            style={{ width: '100%', marginTop: 8 }}
          />
          <input
            value={form.tradeoff_axis}
            onChange={(e) => setForm({ ...form, tradeoff_axis: e.target.value })}
            placeholder="무엇과 무엇을 맞바꾸나 (예: 정확도 ↔ 마감시각)"
            style={{ width: '100%', marginTop: 8 }}
          />
          <button
            type="button"
            className="btn-ghost"
            style={{ marginTop: 8 }}
            onClick={async () => {
              if (!form.req_a_id || !form.req_b_id || !form.reason.trim()) {
                toast.error('요구 두 개와 이유를 적어주세요.')
                return
              }
              await send('post', { kind: 'conflict', ...form })
              setForm({ req_a_id: '', req_b_id: '', reason: '', tradeoff_axis: '', severity: '보통' })
            }}
          >
            등록
          </button>
        </div>
      </details>
    </section>
  )
}

function ConflictCard({ c, send, toast }) {
  const [verdict, setVerdict] = useState(c.verdict ?? '')
  const [reason, setReason] = useState(c.verdict_reason ?? '')
  const [note, setNote] = useState(c.tradeoff_note ?? '')

  return (
    <div className={c.verdict ? 'decided' : 'draft'}>
      <div className="row" style={{ marginBottom: 6 }}>
        <span className={`badge ${c.severity === '높음' ? 'badge-danger' : 'badge-neutral'}`}>
          {c.severity}
        </span>
        {c.tradeoff_axis && <span className="badge badge-accent">{c.tradeoff_axis}</span>}
        <span className="spacer" />
        {c.verdict ? (
          <span className="badge badge-success">{c.verdict}</span>
        ) : (
          <span className="badge badge-warning">판정 대기</span>
        )}
      </div>

      <div className="conflict-pair">
        <div>
          <span className="conflict-tag">A</span> [{c.a?.dept}] {c.a?.decided_body || c.a?.body}
        </div>
        <div>
          <span className="conflict-tag">B</span> [{c.b?.dept}] {c.b?.decided_body || c.b?.body}
        </div>
      </div>

      <div className="card-note" style={{ marginTop: 8 }}>{c.reason}</div>

      {c.verdict ? (
        <>
          {c.verdict_reason && (
            <div className="decision-why">
              <strong>왜 그렇게 정했나</strong> {c.verdict_reason}
            </div>
          )}
          {c.tradeoff_note && (
            <div className="decision-why">
              <strong>대신 잃은 것</strong> {c.tradeoff_note}
            </div>
          )}
          <button
            type="button"
            className="btn-ghost btn-sm"
            style={{ marginTop: 8 }}
            onClick={() => send('remove', { kind: 'conflict', id: c.id })}
          >
            지우기
          </button>
        </>
      ) : (
        <div className="conditional-box" style={{ marginTop: 10 }}>
          <div className="verdict-row" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            {CONFLICT_VERDICTS.map((v) => (
              <button
                key={v}
                type="button"
                className={`verdict-btn${verdict === v ? ' on 수용' : ''}`}
                onClick={() => setVerdict(v)}
              >
                {v}
              </button>
            ))}
          </div>
          <textarea
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="왜 그렇게 정했는지"
            style={{ width: '100%', marginTop: 8 }}
          />
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="대신 무엇을 잃는지 (선택)"
            style={{ width: '100%', marginTop: 8 }}
          />
          <button
            type="button"
            className="btn-primary btn-sm"
            style={{ marginTop: 8 }}
            onClick={async () => {
              if (!verdict) {
                toast.error('판정을 골라주세요.')
                return
              }
              await send('patch', {
                kind: 'conflict',
                id: c.id,
                verdict,
                verdict_reason: reason,
                tradeoff_note: note,
                summary: `${c.a?.body?.slice(0, 40)} ↔ ${c.b?.body?.slice(0, 40)}`,
              })
              toast.success('판정을 저장했습니다.')
            }}
          >
            판정 저장
          </button>
        </div>
      )}
    </div>
  )
}

// ── 합격 기준 ───────────────────────────────────────────────
function Criteria({ data, send, toast }) {
  const chosen = new Set(data.criteria.map((c) => c.check_key).filter(Boolean))

  return (
    <section className="card">
      <div className="card-head">
        <span className="card-title">무엇을 통과로 볼 것인가</span>
        <span className="card-note">만들기 전에 정한다 — 나중에 정하면 결과에 맞춰 기준이 움직인다</span>
      </div>

      {data.criteria.length > 0 && (
        <div className="stack-sm" style={{ marginBottom: 14 }}>
          {data.criteria.map((c) => (
            <div key={c.id} className={c.confirmed_at ? 'decided' : 'draft'}>
              <div className="row" style={{ marginBottom: 4 }}>
                <span className="badge badge-neutral">{c.ord}</span>
                <span className={`badge ${c.check_kind === 'rule' ? 'badge-accent' : 'badge-neutral'}`}>
                  {c.check_kind === 'rule' ? '기계가 채점' : '사람이 확인'}
                </span>
                {c.is_required_safety === 1 && <span className="badge badge-danger">필수 안전</span>}
                <span className="spacer" />
                <span className="card-note">{c.confirmed_at ? '확정됨' : '미확정'}</span>
              </div>
              <div className="item-body">{c.body}</div>
              <div className="item-actions">
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  onClick={() =>
                    send('patch', {
                      kind: 'criterion',
                      id: c.id,
                      confirmed: !c.confirmed_at,
                      is_required_safety: c.is_required_safety,
                    })
                  }
                >
                  {c.confirmed_at ? '확정 풀기' : '확정'}
                </button>
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  onClick={() =>
                    send('patch', {
                      kind: 'criterion',
                      id: c.id,
                      confirmed: Boolean(c.confirmed_at),
                      is_required_safety: c.is_required_safety ? 0 : 1,
                    })
                  }
                >
                  {c.is_required_safety ? '필수 해제' : '필수로'}
                </button>
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  onClick={() => send('remove', { kind: 'criterion', id: c.id })}
                >
                  빼기
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <details className="disclose" open={data.criteria.length === 0}>
        <summary>기준 고르기</summary>
        <div className="disclose-body">
          <p className="card-note" style={{ marginBottom: 10 }}>
            <strong>기계가 채점</strong>이라고 붙은 것은 5단계 베타 테스트에서 자동으로 판정됩니다.
            시험 파일을 만들 때 정답도 같이 만들어 두었기 때문에 사람이 눈으로 맞춰 볼 필요가
            없습니다.
          </p>
          <div className="stack-sm">
            {CRITERION_CATALOG.filter((c) => !chosen.has(c.key)).map((c) => (
              <button
                key={c.key}
                type="button"
                className="criterion-pick"
                onClick={async () => {
                  await send('post', { kind: 'criterion', check_key: c.key })
                  toast.success('기준을 넣었습니다. 확정 버튼을 눌러야 채점에 쓰입니다.')
                }}
              >
                <span className="row" style={{ marginBottom: 3 }}>
                  <span className={`badge ${c.kind === 'rule' ? 'badge-accent' : 'badge-neutral'}`}>
                    {c.kind === 'rule' ? '기계가 채점' : '사람이 확인'}
                  </span>
                  {c.safetyDefault && <span className="badge badge-danger">필수 안전</span>}
                </span>
                <strong>{c.body}</strong>
                <span className="card-note">{c.why}</span>
              </button>
            ))}
          </div>
        </div>
      </details>
    </section>
  )
}

// ── 기준선 ──────────────────────────────────────────────────
function Baseline({ data, send, toast }) {
  // 봉인할 때 같이 굳히는 값. 신청서에 적힌 체감값으로 채워 두고
  // 담당자가 고칠 수 있게 한다 — 실측해 보면 신청서와 다를 때가 많다.
  const [seal, setSeal] = useState({ people: '', frequency: '', hourly_wage_krw: '' })
  const runs = data.shadowRuns
  const b = data.baseline

  return (
    <section className="card">
      <div className="card-head">
        <span className="card-title">지금 실제로 얼마나 걸리나</span>
        <span className="card-note">만들기 전에 잰다</span>
      </div>

      <p className="card-note" style={{ marginBottom: 14 }}>
        신청서에 적힌 시간은 신청자의 <strong>체감</strong>입니다. 8단계에서 &quot;몇 분이 몇 분이
        됐다&quot;를 말하려면 그 숫자가 어디서 왔는지 답할 수 있어야 하는데, 만들고 나서 기억으로
        적은 값으로는 답이 안 됩니다. 담당자 옆에서 직접 재세요.
      </p>

      {b ? (
        <div className="baseline-sealed">
          <div className="row" style={{ marginBottom: 6 }}>
            <span className="badge badge-success">봉인됨</span>
            <span className="badge badge-warning">표본 {b.sample_n}회</span>
            <span className="card-note">{ago(b.sealed_at)}</span>
          </div>
          <div className="stat-value">{duration(b.median_seconds)}</div>
          <div className="card-note">
            가장 빠를 때 {duration(b.min_seconds)} · 가장 느릴 때 {duration(b.max_seconds)} ·
            실수가 난 회차 {Math.round(b.error_rate * 100)}%
          </div>
          <p className="card-note" style={{ marginTop: 8 }}>
            표본이 {b.sample_n}회라 통계적으로는 약합니다. 그래서 이 값에 신뢰구간을 붙이지 않고,
            화면 어디에서든 <strong>표본 횟수를 함께</strong> 보여줍니다.
          </p>
          <p className="card-note">
            시급 {krw(b.hourly_wage_krw)} 기준 1회당 약{' '}
            <strong>{krw((b.median_seconds / 3600) * b.hourly_wage_krw)}</strong>
          </p>
        </div>
      ) : (
        <Stopwatch
          onDone={async (payload) => {
            await send('post', { kind: 'shadow_run', ...payload })
            toast.success('기록했습니다.')
          }}
        />
      )}

      {runs.length > 0 && (
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>회차</th>
                <th>걸린 시간</th>
                <th>실수</th>
                <th>메모</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td>{r.seq}</td>
                  <td className="num">{duration(r.total_seconds)}</td>
                  <td className="num">{num(r.error_count)}</td>
                  <td>{r.note ?? '—'}</td>
                  <td>
                    {!b && (
                      <button
                        type="button"
                        className="btn-ghost btn-sm"
                        onClick={() => send('remove', { kind: 'shadow_run', id: r.id })}
                      >
                        빼기
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 몇 명이 몇 번 하는 일인지 여기서 확정한다.
          이 두 값이 8단계 절감 계산의 곱하기 자리에 그대로 들어간다.
          안 보내면 서버가 1명으로 봉인하고, 세 명이 하던 일의 절감이
          3분의 1로 나온다. 그 숫자가 이 사이트의 결론이다. */}
      {!b && <SealInputs seal={seal} setSeal={setSeal} app={data.application} />}

      {!b && (
        <button
          type="button"
          className="btn-primary btn-block"
          style={{ marginTop: 12 }}
          disabled={runs.length < 3}
          onClick={async () => {
            await send('post', { kind: 'baseline', ...seal })
            toast.success('기준선을 봉인했습니다.')
          }}
        >
          {runs.length < 3
            ? `세 번은 재야 봉인할 수 있습니다 (지금 ${runs.length}번)`
            : `${runs.length}번 잰 값으로 기준선 봉인하기`}
        </button>
      )}
    </section>
  )
}

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
function Objections({ id, toast }) {
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
    <section className="card">
      <div className="card-head">
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
      </div>
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
    </section>
  )
}

// 봉인할 때 같이 굳히는 값.
//
// 인원과 주기는 8단계 절감 계산의 곱하기 자리에 그대로 들어간다. 이 칸이
// 없던 동안 화면이 아무것도 안 보내서 서버가 전부 1명으로 봉인했고,
// 세 명이 하던 일의 절감이 3분의 1로 나왔다. 오류는 어디에도 안 떴다.
//
// 신청서에 적힌 값으로 채워 둔다. 다만 그 값은 신청자의 체감이라,
// 세 번 재 보고 다르면 담당자가 여기서 고친다.
const FREQUENCIES = Object.keys(RUNS_PER_YEAR)

function SealInputs({ seal, setSeal, app }) {
  const set = (k) => (e) => setSeal((v) => ({ ...v, [k]: e.target.value }))
  const ph = (v) => (v == null || v === '' ? '적혀 있지 않음' : String(v))

  return (
    <div className="seal-inputs">
      <p className="card-note">
        아래 두 값이 <strong>8단계 절감 계산에 그대로 곱해집니다</strong>. 신청서에 적힌 체감값을
        채워 뒀습니다 — 재 보시고 다르면 여기서 고쳐 주세요.
      </p>
      <div className="seal-row">
        <label>
          <span>몇 분이 하십니까</span>
          <input
            type="number"
            min="1"
            value={seal.people}
            onChange={set('people')}
            placeholder={ph(app?.current_people)}
          />
          <small className="card-note">비워 두면 신청서 값({ph(app?.current_people)})으로 굳습니다</small>
        </label>
        <label>
          <span>얼마나 자주</span>
          <select value={seal.frequency} onChange={set('frequency')}>
            <option value="">신청서 값 그대로 ({ph(app?.current_frequency)})</option>
            {FREQUENCIES.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>시급 (원)</span>
          <input
            type="number"
            min="0"
            step="1000"
            value={seal.hourly_wage_krw}
            onChange={set('hourly_wage_krw')}
            placeholder={String(HOURLY_WAGE_KRW)}
          />
          <small className="card-note">비워 두면 {HOURLY_WAGE_KRW.toLocaleString()}원</small>
        </label>
      </div>
    </div>
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
        <span className="card-note">
          이 부서들 사정이 요구 목록에 들어와야 만들기 시작할 수 있습니다. 지금 합의하시는 기준을,
          이 부서들은 다 만들어진 뒤에 처음 봅니다.
        </span>
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
