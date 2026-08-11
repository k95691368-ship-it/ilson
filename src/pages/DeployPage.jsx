import { useEffect, useMemo, useState } from 'react'
import { DEPTS } from '../../shared/depts.js'
import { Link } from 'react-router-dom'
import StageHeader from '../components/StageHeader.jsx'
import { useApi } from '../hooks/useApi.js'
import { useToast } from '../context/ToastContext.jsx'
import { api } from '../api/client.js'
import { num, ms, ago, duration } from '../lib/format.js'


export default function DeployPage() {
  const { data: list } = useApi('/applications')
  const [selectedId, setSelectedId] = useState(null)

  const targets = useMemo(
    () => (list?.items ?? []).filter((a) => ['수용', '진행중', '완료'].includes(a.status)),
    [list]
  )

  useEffect(() => {
    if (!selectedId && targets.length > 0) setSelectedId(targets[0].id)
  }, [targets, selectedId])

  return (
    <div className="stack">
      <StageHeader stageKey="deploy" />

      {targets.length === 0 ? (
        <div className="empty">
          <div className="empty-title">넘길 도구가 없습니다</div>
          <div className="empty-sub">베타 테스트를 통과한 것이 여기로 넘어옵니다.</div>
          {/* 여기가 막다른 길이었다. 부서가 여는 주소(/t/…)는 이 화면에서
              넘길 때 만들어지는데, 그 사실도 앞 단계로 돌아가는 길도 없어서
              "그럼 그 주소는 언제 생기나"에 아무 데서도 답하지 않았다. */}
          <div className="empty-sub">
            부서가 여는 주소(<span className="mono">/t/…</span>)는 여기서 넘길 때 만들어집니다.
          </div>
          <Link to="/beta" className="btn-ghost btn-sm">
            베타 테스트로 돌아가기
          </Link>
        </div>
      ) : (
        <>
          <div className="chip-row">
            {targets.map((a) => (
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
          {selectedId && <Deploy id={selectedId} />}
        </>
      )}
    </div>
  )
}

function Deploy({ id }) {
  const { data, error, loading, reload } = useApi(`/applications/${id}/deploy`)
  const toast = useToast()
  const [form, setForm] = useState({
    handed_to_dept: '',
    handed_to_person: '',
    slug: '',
    daily_limit: 20,
    max_file_mb: 10,
    note: '',
  })

  useEffect(() => {
    if (!data) return
    setForm((f) => ({
      ...f,
      handed_to_dept: data.handover?.handed_to_dept ?? data.application.dept,
      handed_to_person:
        data.handover?.handed_to_person ?? data.stakeholders[0]?.person_label ?? '',
      slug: data.handover?.slug ?? '',
      daily_limit: data.handover?.daily_limit ?? 20,
      max_file_mb: data.handover?.max_file_mb ?? 10,
      note: data.handover?.note ?? '',
    }))
  }, [data])

  async function send(body, okMessage) {
    try {
      await api.post(`/applications/${id}/deploy`, body)
      toast.success(okMessage)
      await reload()
    } catch (err) {
      if (err.status === 400 && err.message.includes('넘길 수 없습니다')) toast.error(err.message)
      else toast.error(err.message)
    }
  }

  if (loading && !data) return <div className="page-loading">불러오는 중…</div>
  if (error) return <div className="notice notice-danger">{error}</div>
  if (!data) return null

  const h = data.handover

  return (
    <div className="stack">
      {!data.canHandOver && (
        <div className="notice notice-warn">
          <div className="notice-title">아직 넘길 수 없습니다</div>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            {data.blockers.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        </div>
      )}

      {h && !h.rolled_back_at && (
        <section className="handed-card">
          <div className="row" style={{ marginBottom: 8 }}>
            <span className="badge badge-success">넘김</span>
            {h.accepted_at ? (
              <span className="badge badge-success">
                {ago(h.accepted_at)} 부서가 받음 확인
              </span>
            ) : (
              <span className="badge badge-warning">부서 확인 대기</span>
            )}
            <span className="spacer" />
            <span className="card-note">{ago(h.handed_at)}</span>
          </div>

          <div className="handed-to">
            <strong>
              {h.handed_to_dept} {h.handed_to_person}
            </strong>
            <span className="card-note">에게 넘겼습니다. 여기서부터 이 도구의 주인은 부서입니다.</span>
          </div>

          <div className="handed-link">
            <span className="card-note">부서가 여는 주소</span>
            <Link to={`/t/${h.slug}`} className="mono">
              /t/{h.slug}
            </Link>
          </div>

          <div className="row" style={{ marginTop: 10 }}>
            {!h.accepted_at && (
              <button
                type="button"
                className="btn-primary btn-sm"
                onClick={() => {
                  const by = window.prompt('누가 받았다고 확인했나요?', h.handed_to_person)
                  if (by == null) return
                  send({ kind: 'accept', accepted_by: by }, '부서가 받았다고 확인했습니다.')
                }}
              >
                부서가 받았음 확인
              </button>
            )}
            <button
              type="button"
              className="btn-danger btn-sm"
              onClick={() => {
                const reason = window.prompt('왜 되돌리나요?')
                if (!reason) return
                send({ kind: 'rollback', reason }, '되돌렸습니다.')
              }}
            >
              되돌리기
            </button>
          </div>
        </section>
      )}

      {/* 내려 둔 도구. 여기가 막다른 길이었다 — 왜 내렸는지는 적혀 있는데
          다시 올릴 자리가 없었다. 그동안 그 부서는 원래 하던 방식으로 일한다.
          되돌리기 옆에 다시 올리기가 없으면, 담당자는 되돌리기를 안 누르게
          된다. 되돌릴 수 없는 것처럼 보이기 때문이다. */}
      {h?.rolled_back_at && (
        <div className="notice notice-danger">
          <div className="notice-title">{ago(h.rolled_back_at)} 되돌렸습니다</div>
          <p>{h.rollback_reason}</p>
          <p className="card-note">
            그동안 {h.handed_to_dept}는 이 일을 원래 하던 방식으로 하고 있습니다.
          </p>
          <button
            type="button"
            className="btn-primary btn-sm"
            onClick={() => {
              // 무엇을 고쳤는지 받는다. "고쳤습니다" 한 마디로 다시 열면
              // 부서는 안 쓴다 — 한 번 틀린 숫자를 낸 도구이기 때문이다.
              const fixed = window.prompt('무엇을 고치셨습니까? 부서가 이걸 보고 다시 씁니다.')
              if (!fixed) return
              send({ kind: 'restore', fixed }, '다시 올렸습니다.')
            }}
          >
            고쳐서 다시 올리기
          </button>
        </div>
      )}

      <section className="card">
        <div className="card-head">
          <span className="card-title">{h ? '넘긴 내용 고치기' : '누구에게 넘기나'}</span>
          <span className="card-note">주소는 한 번 정해지면 바뀌지 않습니다</span>
        </div>

        <div className="field-row">
          <Field label="부서">
            <select
              value={form.handed_to_dept}
              onChange={(e) => setForm({ ...form, handed_to_dept: e.target.value })}
            >
              <option value="">고르세요</option>
              {DEPTS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </Field>
          <Field label="누구에게">
            <input
              value={form.handed_to_person}
              onChange={(e) => setForm({ ...form, handed_to_person: e.target.value })}
              placeholder="정산 담당자"
            />
          </Field>
          {!h && (
            <Field label="주소" hint="영문·숫자">
              <input
                value={form.slug}
                onChange={(e) => setForm({ ...form, slug: e.target.value })}
                placeholder="settlement"
              />
            </Field>
          )}
        </div>

        <div className="field-row">
          <Field label="하루 실행 횟수" hint="부서 화면에 항상 보입니다">
            <input
              inputMode="numeric"
              value={form.daily_limit}
              onChange={(e) => setForm({ ...form, daily_limit: e.target.value })}
            />
          </Field>
          <Field label="파일 하나당 최대 MB">
            <input
              inputMode="numeric"
              value={form.max_file_mb}
              onChange={(e) => setForm({ ...form, max_file_mb: e.target.value })}
            />
          </Field>
        </div>

        <Field label="부서에 함께 전할 말" hint="선택">
          <input
            value={form.note}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
          />
        </Field>

        <button
          type="button"
          className="btn-primary btn-block"
          disabled={!data.canHandOver}
          onClick={() => send({ kind: 'hand_over', ...form }, h ? '고쳤습니다.' : '넘겼습니다.')}
        >
          {h ? '고치기' : '넘기기'}
        </button>
      </section>

      {h && (
        <>
          <section className="stat-row">
            <Tile label="넘긴 뒤 돈 횟수" value={num(data.stats.runs)} note="실제로 쓰이고 있는가" />
            <Tile
              label="실패"
              value={num(data.stats.failures)}
              note={data.stats.failures > 0 ? '원인을 확인하세요' : '없음'}
              tone={data.stats.failures > 0 ? 'warn' : undefined}
            />
            <Tile
              label="평균 걸린 시간"
              value={data.stats.avgMs ? ms(data.stats.avgMs) : '—'}
              note="사람이 하던 시간과 견주는 값"
            />
            <Tile
              label="마지막 사용"
              value={data.stats.lastUsed ? ago(data.stats.lastUsed) : '아직 없음'}
              note={data.stats.runs === 0 ? '넘겼지만 아무도 안 썼습니다' : ''}
              tone={data.stats.runs === 0 ? 'warn' : undefined}
            />
          </section>

          <section className="card">
            <div className="card-head">
              <span className="card-title">넘긴 뒤 사용 기록</span>
              <span className="card-note">
                사람이 검토한 시간을 적어야 8단계 성과에서 뺄 수 있습니다
              </span>
            </div>

            {data.uses.length === 0 ? (
              <div className="empty">
                <div className="empty-title">아직 아무도 쓰지 않았습니다</div>
                <div className="empty-sub">
                  넘긴 것과 쓰이는 것은 다릅니다. 부서에 다시 안내하거나, 왜 안 쓰는지 물어보세요.
                </div>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>언제</th>
                      <th>누가</th>
                      <th className="num">합친 줄</th>
                      <th className="num">검토할 줄</th>
                      <th className="num">걸린 시간</th>
                      <th className="num">사람이 검토한 시간</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {data.uses.map((u) => (
                      <tr key={u.id}>
                        <td>{ago(u.used_at)}</td>
                        <td>{u.actor_label}</td>
                        <td className="num">{num(u.rows_out)}</td>
                        <td className="num">{num(u.quarantined)}</td>
                        <td className="num">{ms(u.duration_ms)}</td>
                        <td className="num">
                          {u.human_review_seconds > 0 ? duration(u.human_review_seconds) : '—'}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="btn-ghost btn-sm"
                            onClick={() => {
                              const v = window.prompt(
                                '검토함을 보고 처리하는 데 몇 분 걸렸나요? (분 단위)',
                                String(Math.round((u.human_review_seconds ?? 0) / 60))
                              )
                              if (v == null) return
                              send(
                                {
                                  kind: 'review_time',
                                  id: u.id,
                                  human_review_seconds: (Number(v) || 0) * 60,
                                  rework_seconds: u.rework_seconds ?? 0,
                                },
                                '적었습니다.'
                              )
                            }}
                          >
                            검토 시간 적기
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}

// 라벨이 글자만 감싸고 입력칸은 형제로 있어서 둘이 연결돼 있지 않았다.
// 바깥을 label 로 바꿔 입력칸을 품게 한다(암묵적 연결).
function Field({ label, hint, children }) {
  return (
    <label className="field">
      <span className="field-label">
        {label}
        {hint && <span className="field-hint">{hint}</span>}
      </span>
      {children}
    </label>
  )
}

function Tile({ label, value, note, tone }) {
  return (
    <div className="stat-tile">
      <div className="stat-label">{label}</div>
      <div
        className="stat-value"
        style={tone === 'warn' ? { color: 'var(--warning-text)' } : undefined}
      >
        {value}
      </div>
      {note && <div className="stat-note">{note}</div>}
    </div>
  )
}
