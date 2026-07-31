import { useEffect, useMemo, useState } from 'react'
import StageHeader from '../components/StageHeader.jsx'
import { useApi } from '../hooks/useApi.js'
import { useToast } from '../context/ToastContext.jsx'
import { api } from '../api/client.js'
import { ago, duration, num, krw } from '../lib/format.js'
import {
  VERDICTS,
  REFUSE_REASONS,
  IMPACT_SCALE,
  DIFFICULTY_SCALE,
} from '../../shared/review.js'

const EMPTY_FORM = {
  impact_score: '3',
  impact_reason: '',
  difficulty_score: '3',
  difficulty_reason: '',
  verdict: '',
  verdict_reason: '',
  alternatives_considered: '',
  refuse_code: '',
  refuse_alternative: '',
  hold_until_condition: '',
  reviewer_label: 'AX 담당자',
}

export default function ReviewPage() {
  const { data, error, reload } = useApi('/applications')
  const toast = useToast()
  const [selectedId, setSelectedId] = useState(null)
  const [seeding, setSeeding] = useState(false)

  // data가 그대로여도 매 렌더에서 새 배열을 만들면, 이 값을 보는 useEffect가
  // 매번 다시 돌아 선택이 튄다.
  const items = useMemo(() => data?.items ?? [], [data])

  // 처음 열었을 때 아직 판정하지 않은 것 중 가장 오래 묵은 것을 고른다.
  // 담당자가 실제로 다음에 볼 것이 그것이기 때문이다.
  useEffect(() => {
    if (selectedId || items.length === 0) return
    const waiting = items.filter((i) => i.status === '접수')
    const target = waiting.length > 0 ? waiting[waiting.length - 1] : items[0]
    setSelectedId(target.id)
  }, [items, selectedId])

  const counts = useMemo(() => {
    const by = (s) => items.filter((i) => i.status === s).length
    return {
      waiting: by('접수'),
      accepted: by('수용'),
      refused: by('반려'),
      held: by('보류'),
    }
  }, [items])

  async function seed() {
    setSeeding(true)
    try {
      const r = await api.post('/demo/seed', {})
      toast.success(
        r.added > 0
          ? `시연 신청서 ${r.added}건을 심었습니다.`
          : '이미 다 심겨 있습니다. 바뀐 것이 없습니다.'
      )
      await reload()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSeeding(false)
    }
  }

  return (
    <div className="stack">
      <StageHeader stageKey="review" />

      {error && (
        <div className="notice notice-danger">
          <div className="notice-title">신청서를 불러오지 못했습니다</div>
          <p>{error}</p>
        </div>
      )}

      {!error && items.length === 0 && (
        <section className="card">
          <div className="card-title">아직 접수된 신청서가 없습니다</div>
          <p className="card-note" style={{ marginBottom: 12 }}>
            검토는 여럿을 놓고 견주는 일이라 한 건만으로는 보여줄 것이 없습니다. 서로 성격이 다른
            신청서 여덟 건을 심어 두면, 우선순위를 정하고 반려를 판정하는 과정을 그대로 보실 수
            있습니다.
          </p>
          <button type="button" className="btn-primary" onClick={seed} disabled={seeding}>
            {seeding ? '심는 중…' : '시연 신청서 심기'}
          </button>
        </section>
      )}

      {items.length > 0 && (
        <>
          <section className="stat-row">
            <Tile label="검토 대기" value={num(counts.waiting)} note="아직 내가 안 본 것" />
            <Tile label="수용" value={num(counts.accepted)} note="만들기로 한 것" />
            <Tile label="반려" value={num(counts.refused)} note="이유와 대안을 함께 보냈다" />
            <Tile label="보류" value={num(counts.held)} note="조건이 풀리면 다시 본다" />
          </section>

          <div className="review-layout">
            <nav className="review-list" aria-label="접수된 신청서">
              <div className="review-list-head">
                <span className="card-title">접수함</span>
                <button type="button" className="btn-ghost btn-sm" onClick={seed} disabled={seeding}>
                  시연 데이터
                </button>
              </div>
              <ul>
                {items.map((a) => (
                  <li key={a.id}>
                    <button
                      type="button"
                      className={`review-list-item${selectedId === a.id ? ' on' : ''}`}
                      onClick={() => setSelectedId(a.id)}
                      aria-current={selectedId === a.id ? 'true' : undefined}
                    >
                      <span className="review-list-top">
                        <span className="badge badge-neutral">{a.dept}</span>
                        <span className={`badge ${statusTone(a.status)}`}>{a.status}</span>
                        {a.status === '접수' && a.hours_since >= 24 && (
                          <span className="badge badge-warning">{Math.floor(a.hours_since / 24)}일 경과</span>
                        )}
                      </span>
                      <span className="review-list-title">{a.title}</span>
                      <span className="review-list-meta">
                        {a.annual_hours != null
                          ? `연 ${num(a.annual_hours, 0)}시간 · `
                          : '소요 미기재 · '}
                        {ago(a.created_at)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </nav>

            <div className="review-detail">
              {selectedId ? (
                <Detail id={selectedId} onSaved={reload} />
              ) : (
                <div className="empty">
                  <div className="empty-title">왼쪽에서 신청서를 고르세요</div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function Detail({ id, onSaved }) {
  const { data, error, loading, reload } = useApi(`/applications/${id}`)
  const toast = useToast()
  const [form, setForm] = useState(EMPTY_FORM)
  const [fieldErrors, setFieldErrors] = useState({})
  const [saving, setSaving] = useState(false)

  // 신청서를 바꾸면 폼을 그 신청서의 상태로 되돌린다. 이전 신청서에 적던
  // 내용이 다음 신청서 폼에 남아 있으면, 그대로 저장해 버리는 사고가 난다.
  useEffect(() => {
    if (!data) return
    if (data.review) {
      setForm({
        impact_score: String(data.review.impact_score),
        impact_reason: data.review.impact_reason,
        difficulty_score: String(data.review.difficulty_score),
        difficulty_reason: data.review.difficulty_reason,
        verdict: data.review.verdict,
        verdict_reason: data.review.verdict_reason,
        alternatives_considered: data.review.alternatives_considered,
        refuse_code: data.review.refuse_code ?? '',
        refuse_alternative: data.review.refuse_alternative ?? '',
        hold_until_condition: data.review.hold_until_condition ?? '',
        reviewer_label: data.review.reviewer_label,
      })
    } else {
      setForm(EMPTY_FORM)
    }
    setFieldErrors({})
  }, [data])

  function set(key, value) {
    setForm((f) => ({ ...f, [key]: value }))
    if (fieldErrors[key]) setFieldErrors((e) => ({ ...e, [key]: undefined }))
  }

  async function save(e) {
    e.preventDefault()
    setSaving(true)
    setFieldErrors({})
    try {
      const json = await api.post(`/applications/${id}/review`, form)
      toast.success(`${json.verdict} 판정을 저장했습니다.`)
      await Promise.all([reload(), onSaved()])
    } catch (err) {
      if (err.fields) setFieldErrors(err.fields)
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading && !data) return <div className="page-loading">불러오는 중…</div>
  if (error) return <div className="notice notice-danger">{error}</div>
  if (!data) return null

  const a = data.application

  return (
    <div className="stack">
      <section className="card">
        <div className="card-head">
          <span className="card-title">{a.title}</span>
          <span className="mono card-note">{a.ticket_no}</span>
        </div>
        <div className="row" style={{ marginBottom: 12 }}>
          <span className="badge badge-neutral">{a.dept}</span>
          <span className="badge badge-neutral">{a.applicant_label}</span>
          <span className={`badge ${statusTone(a.status)}`}>{a.status}</span>
          <span className="card-note">{ago(a.created_at)} 접수</span>
        </div>

        <div className="origin-label origin-human">◆ 부서가 적어 낸 원문</div>
        <dl className="kv source-kv">
          <dt>무엇이 병목인가</dt>
          <dd>{a.bottleneck}</dd>
          <dt>지금 무슨 일이 생기나</dt>
          <dd>{a.problem}</dd>
          {a.wish && (
            <>
              <dt>바라는 해결</dt>
              <dd>{a.wish}</dd>
            </>
          )}
          {a.impact_if_wrong && (
            <>
              <dt>틀리면</dt>
              <dd>{a.impact_if_wrong}</dd>
            </>
          )}
        </dl>

        <div className="cost-strip">
          <span>
            <strong>신청자 체감</strong>{' '}
            {a.current_minutes ? duration(a.current_minutes * 60) : '미기재'}
            {a.current_people ? ` × ${a.current_people}명` : ''}
            {a.current_frequency ? ` × ${a.current_frequency}` : ''}
          </span>
          {a.annual_hours != null && (
            <span>
              연 <strong>{num(a.annual_hours, 0)}시간</strong> · 시급 25,000원 환산{' '}
              {krw(a.annual_hours * 25000)}
            </span>
          )}
          <span className="cost-note">
            실측이 아닙니다. 협의안 단계에서 직접 재서 다시 확정합니다.
          </span>
        </div>

        {data.files.length > 0 && (
          <div className="row" style={{ marginTop: 12 }}>
            <span className="card-note">첨부</span>
            {data.files.map((f) => (
              <span key={f.id} className="badge badge-neutral">
                {f.name}
              </span>
            ))}
          </div>
        )}
      </section>

      <form className="card decided" onSubmit={save}>
        <div className="card-head">
          <span className="origin-label origin-human">◆ 내 판정</span>
          {data.review && (
            <span className="card-note">{ago(data.review.updated_at)} 저장됨 · 다시 판정할 수 있습니다</span>
          )}
        </div>

        <ScoreField
          label="임팩트"
          scale={IMPACT_SCALE}
          value={form.impact_score}
          onChange={(v) => set('impact_score', v)}
          error={fieldErrors.impact_score}
        />
        <Field label="왜 그 점수인가" hint="비워 둬도 저장됩니다" error={fieldErrors.impact_reason}>
          <textarea
            rows={2}
            value={form.impact_reason}
            onChange={(e) => set('impact_reason', e.target.value)}
            placeholder="대표 보고에 들어가고 정정 공시까지 이어지는 숫자다. 다섯 부서가 이 표를 본다."
          />
        </Field>

        <ScoreField
          label="난이도"
          scale={DIFFICULTY_SCALE}
          value={form.difficulty_score}
          onChange={(v) => set('difficulty_score', v)}
          error={fieldErrors.difficulty_score}
        />
        <Field label="왜 그 점수인가" hint="비워 둬도 저장됩니다" error={fieldErrors.difficulty_reason}>
          <textarea
            rows={2}
            value={form.difficulty_reason}
            onChange={(e) => set('difficulty_reason', e.target.value)}
            placeholder="원천이 다섯 종이고 포맷·인코딩·통화가 전부 다르다. 다만 규칙으로 풀리는 범위다."
          />
        </Field>

        <div className="field">
          <label className="field-label">
            판정<span className="field-required"> *</span>
          </label>
          <div className="verdict-row">
            {VERDICTS.map((v) => (
              <button
                key={v}
                type="button"
                className={`verdict-btn ${v}${form.verdict === v ? ' on' : ''}`}
                onClick={() => set('verdict', v)}
                aria-pressed={form.verdict === v}
              >
                {v}
              </button>
            ))}
          </div>
          {fieldErrors.verdict && <div className="field-error">{fieldErrors.verdict}</div>}
        </div>

        <Field label="판정 근거" hint="비워 둬도 저장됩니다" error={fieldErrors.verdict_reason}>
          <textarea
            rows={3}
            value={form.verdict_reason}
            onChange={(e) => set('verdict_reason', e.target.value)}
            placeholder="주 1회 반복 × 다섯 부서가 결과를 쓴다 × 이미 오류가 실제로 발생했다. 임팩트는 가장 크고 난이도는 중간이다."
          />
        </Field>

        <Field
          label="고려했다 뺀 것"
          hint="비워 둬도 저장됩니다"
          error={fieldErrors.alternatives_considered}
        >
          <textarea
            rows={2}
            value={form.alternatives_considered}
            onChange={(e) => set('alternatives_considered', e.target.value)}
            placeholder="재고 소진일을 먼저 하는 안. 더 쉽지만 이 과제가 만드는 매출 데이터가 없으면 두 번 일하게 된다."
          />
        </Field>

        {form.verdict === '반려' && (
          <div className="conditional-box">
            <Field label="무엇이 범위 밖인가" error={fieldErrors.refuse_code}>
              <select value={form.refuse_code} onChange={(e) => set('refuse_code', e.target.value)}>
                <option value="">고르세요</option>
                {REFUSE_REASONS.map((r) => (
                  <option key={r.code} value={r.code}>
                    {r.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="대신 무엇을 해 드릴 수 있나"
              hint='정말 없으면 "다른 도구로 가야 합니다"라고 적으세요'
              error={fieldErrors.refuse_alternative}
            >
              <textarea
                rows={2}
                value={form.refuse_alternative}
                onChange={(e) => set('refuse_alternative', e.target.value)}
                placeholder="업로드 양식에 맞춘 파일까지는 만들어 드립니다. 등록 버튼은 사람이 누릅니다."
              />
            </Field>
            <p className="card-note">
              &quot;안 됩니다&quot;만 돌려보내면 그 부서는 다시 신청하지 않습니다. 병목은 그대로
              남습니다.
            </p>
          </div>
        )}

        {form.verdict === '보류' && (
          <div className="conditional-box">
            <Field
              label="무엇이 풀리면 다시 볼 것인가"
              error={fieldErrors.hold_until_condition}
            >
              <textarea
                rows={2}
                value={form.hold_until_condition}
                onChange={(e) => set('hold_until_condition', e.target.value)}
                placeholder="정산서에 과세·면세 구분 컬럼이 생기면. 그전에는 원천에 없는 값을 만들어 낼 수 없다."
              />
            </Field>
            <p className="card-note">조건 없는 보류는 그냥 방치입니다.</p>
          </div>
        )}

        <button type="submit" className="btn-primary btn-block" disabled={saving}>
          {saving ? '저장하는 중…' : data.review ? '판정 다시 저장' : '판정 저장'}
        </button>
      </form>

      {data.decisions.length > 0 && (
        <section className="card">
          <div className="card-title">이 신청서에 남은 기록</div>
          <ol className="decision-list">
            {data.decisions.map((dec) => (
              <li key={dec.id} className={dec.actor === 'ai' ? 'draft' : 'decided'}>
                <span
                  className={`origin-label ${dec.actor === 'ai' ? 'origin-ai' : 'origin-human'}`}
                >
                  {dec.actor === 'ai' ? '◇ AI' : '◆ 사람'} · {dec.stage} · {ago(dec.created_at)}
                </span>
                <div className="item-body" style={{ fontSize: 14.5, fontWeight: 700 }}>
                  {dec.title}
                </div>
                <div className="card-note" style={{ marginTop: 4 }}>
                  {dec.what}
                </div>
                <div className="decision-why">
                  <strong>왜</strong> {dec.why}
                </div>
                {dec.alternatives && (
                  <div className="decision-why">
                    <strong>고르지 않은 길</strong> {dec.alternatives}
                  </div>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  )
}

function ScoreField({ label, scale, value, onChange, error }) {
  const current = scale.find((s) => String(s.score) === String(value))
  return (
    <div className="field">
      <label className="field-label">
        {label}
        <span className="field-required"> *</span>
        {current && <span className="field-hint">{current.detail}</span>}
      </label>
      <div className="score-row">
        {scale.map((s) => (
          <button
            key={s.score}
            type="button"
            className={`score-btn${String(s.score) === String(value) ? ' on' : ''}`}
            onClick={() => onChange(String(s.score))}
            aria-pressed={String(s.score) === String(value)}
          >
            <span className="score-num">{s.score}</span>
            <span className="score-label">{s.label}</span>
          </button>
        ))}
      </div>
      {error && <div className="field-error">{error}</div>}
    </div>
  )
}

function Field({ label, required, hint, error, children }) {
  return (
    <div className={`field${error ? ' has-error' : ''}`}>
      <label className="field-label">
        {label}
        {required && <span className="field-required"> *</span>}
        {hint && <span className="field-hint">{hint}</span>}
      </label>
      {children}
      {error && <div className="field-error" style={{ marginTop: 5 }}>{error}</div>}
    </div>
  )
}

function Tile({ label, value, note }) {
  return (
    <div className="stat-tile">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      <div className="stat-note">{note}</div>
    </div>
  )
}

function statusTone(status) {
  if (status === '수용' || status === '완료') return 'badge-success'
  if (status === '반려') return 'badge-danger'
  if (status === '보류') return 'badge-warning'
  if (status === '진행중' || status === '검토중') return 'badge-accent'
  return 'badge-neutral'
}
