import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import StageHeader from '../components/StageHeader.jsx'
import FileList from '../components/FileList.jsx'
import { useApi } from '../hooks/useApi.js'
import { useToast } from '../context/ToastContext.jsx'
import { api } from '../api/client.js'
import { ago, duration, num, krw } from '../lib/format.js'
import {
  applyQuery,
  facetCounts,
  describeQuery,
  isFiltered,
  sumAnnualHours,
  SORTS,
  EMPTY_QUERY,
  STALE_HOURS,
} from '../lib/inbox.js'
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

  // 무엇을 어떤 순서로 볼 것인가.
  //
  // 서버에 다시 묻지 않고 브라우저에서 거른다. 목록은 한 번에 200건까지만
  // 오고, 그 정도는 브라우저가 즉시 처리한다. 한 글자 칠 때마다 서버에
  // 물으면 느리기도 하지만, 응답이 올 때마다 목록이 새로 그려져 지금 보고
  // 있던 신청서가 튄다. 그게 더 나쁘다.
  const [query, setQuery] = useState(EMPTY_QUERY)
  const [draft, setDraft] = useState('')

  // data가 그대로여도 매 렌더에서 새 배열을 만들면, 이 값을 보는 useEffect가
  // 매번 다시 돌아 선택이 튄다.
  const items = useMemo(() => data?.items ?? [], [data])

  const visible = useMemo(() => applyQuery(items, query), [items, query])
  const facets = useMemo(() => facetCounts(items, query), [items, query])
  const totals = useMemo(() => sumAnnualHours(visible), [visible])

  // 실제로 신청서가 들어온 부서만 칩으로 낸다. 아무것도 안 들어온 부서까지
  // 늘어놓으면 누를 것과 못 누를 것이 섞여 고르기 나빠진다.
  const depts = useMemo(
    () => [...new Set(items.map((i) => i.dept))].sort((a, b) => a.localeCompare(b, 'ko')),
    [items]
  )

  // 처음 열었을 때 맨 위를 고른다. 정렬 기본값이 '묵은 순'이라 그것은
  // 아직 판정 안 한 것 중 가장 오래 앉아 있는 것이다. 담당자가 실제로
  // 다음에 볼 것이 그것이다.
  useEffect(() => {
    if (selectedId || visible.length === 0) return
    setSelectedId(visible[0].id)
  }, [visible, selectedId])

  // 조건을 걸어서 지금 보고 있는 신청서가 목록에서 사라진 경우.
  //
  // 이때 자동으로 다른 것을 고르지 않는다. 담당자가 판정 근거를 반쯤 적어
  // 둔 채로 부서 칩을 눌렀을 수 있고, 그 상태에서 화면이 갈아치워지면
  // 쓰던 것이 날아간다. 대신 "지금 조건에 없다"고만 알린다.
  const selectionHidden =
    selectedId != null &&
    items.some((i) => i.id === selectedId) &&
    !visible.some((i) => i.id === selectedId)

  function setQ(patch) {
    setQuery((q) => ({ ...q, ...patch }))
  }

  // 같은 칩을 다시 누르면 풀린다. 끄는 방법을 따로 찾게 하지 않는다.
  function toggle(key, value) {
    setQuery((q) => ({ ...q, [key]: q[key] === value ? '' : value }))
  }

  function clearFilters() {
    // 정렬은 되돌리지 않는다. 정렬은 '무엇을 보느냐'가 아니라 '어떤 순서로
    // 보느냐'라서, 조건을 지웠다고 순서까지 바뀌면 사용자가 놀란다.
    setQuery((q) => ({ ...EMPTY_QUERY, sort: q.sort }))
    setDraft('')
  }

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
          {/* 숫자를 눌러서 그것만 볼 수 있게 한다. 세어 놓고 못 누르게 하면
              담당자는 결국 목록을 눈으로 훑어 세게 된다. */}
          <section className="stat-row">
            <Tile
              label="검토 대기"
              value={num(counts.waiting)}
              note="아직 내가 안 본 것"
              on={query.status === '접수'}
              onClick={() => toggle('status', '접수')}
            />
            <Tile
              label="수용"
              value={num(counts.accepted)}
              note="만들기로 한 것"
              on={query.status === '수용'}
              onClick={() => toggle('status', '수용')}
            />
            <Tile
              label="반려"
              value={num(counts.refused)}
              note="이유와 대안을 함께 보냈다"
              on={query.status === '반려'}
              onClick={() => toggle('status', '반려')}
            />
            <Tile
              label="보류"
              value={num(counts.held)}
              note="조건이 풀리면 다시 본다"
              on={query.status === '보류'}
              onClick={() => toggle('status', '보류')}
            />
          </section>

          <section className="card">
            <div className="card-head">
              <span className="card-title">골라 보기</span>
              <span className="card-note">{describeQuery(query, visible.length, items.length)}</span>
              <span className="spacer" />
              {isFiltered(query) && (
                <button type="button" className="btn-ghost btn-sm" onClick={clearFilters}>
                  조건 지우기
                </button>
              )}
            </div>

            <form
              className="row"
              style={{ marginBottom: 10 }}
              onSubmit={(e) => {
                e.preventDefault()
                setQ({ q: draft.trim() })
              }}
            >
              <input
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value)
                  // 브라우저에서 거르니 칠 때마다 바로 좁힌다. 엔터를 눌러야
                  // 결과가 나오면, 담당자는 엔터를 누르기 전까지 자기가 뭘
                  // 찾고 있는지 확인할 수 없다.
                  setQ({ q: e.target.value.trim() })
                }}
                placeholder="말로 찾기 — 제목·병목·문제·접수번호 어디에 있든 찾습니다"
                aria-label="신청서 검색"
                style={{ flex: 1, minWidth: 220 }}
              />
              {draft && (
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  onClick={() => {
                    setDraft('')
                    setQ({ q: '' })
                  }}
                >
                  지우기
                </button>
              )}
            </form>

            {depts.length > 1 && (
              <div className="filter-row">
                <span className="filter-label">부서</span>
                <div className="chip-row">
                  {depts.map((d) => {
                    const n = facets.byDept[d] ?? 0
                    return (
                      <button
                        key={d}
                        type="button"
                        className={`chip${query.dept === d ? ' on' : ''}`}
                        onClick={() => toggle('dept', d)}
                        // 눌러도 0건인 칩은 누르지 못하게 한다. 눌러 놓고
                        // 빈 화면을 보게 하는 것보다 낫다.
                        disabled={n === 0 && query.dept !== d}
                        aria-pressed={query.dept === d}
                      >
                        {d}
                        <span className="chip-count">{n}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            <div className="filter-row">
              <span className="filter-label">골라내기</span>
              <div className="chip-row">
                <button
                  type="button"
                  className={`chip${query.onlyStale ? ' on' : ''}`}
                  onClick={() => setQ({ onlyStale: !query.onlyStale })}
                  aria-pressed={query.onlyStale}
                >
                  {STALE_HOURS}시간 넘게 안 본 것
                  <span className="chip-count">{facets.stale}</span>
                </button>
                <button
                  type="button"
                  className={`chip${query.onlyWithFiles ? ' on' : ''}`}
                  onClick={() => setQ({ onlyWithFiles: !query.onlyWithFiles })}
                  aria-pressed={query.onlyWithFiles}
                >
                  첨부가 있는 것
                  <span className="chip-count">{facets.withFiles}</span>
                </button>
              </div>
            </div>

            <div className="filter-row">
              <span className="filter-label">순서</span>
              <div className="chip-row">
                {SORTS.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    className={`chip${query.sort === s.key ? ' on' : ''}`}
                    onClick={() => setQ({ sort: s.key })}
                    title={s.note}
                    aria-pressed={query.sort === s.key}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 조건을 걸면 이 합계도 따라 움직인다. 전체 합계를 그대로 두면
                "재무 것만 봤는데 왜 합계가 그대로지"가 된다. */}
            {visible.length > 0 && (
              <p className="card-note filter-sum">
                지금 보고 있는 {visible.length}건을 합치면 연 <strong>{num(totals.hours, 0)}시간</strong>
                {totals.missing > 0 && ` (소요를 안 적은 ${totals.missing}건은 뺐습니다)`} · 시급
                25,000원으로 환산하면 {krw(totals.hours * 25000)}
              </p>
            )}
          </section>

          <div className="review-layout">
            <nav className="review-list" aria-label="접수된 신청서">
              <div className="review-list-head">
                <span className="card-title">
                  접수함
                  {isFiltered(query) && (
                    <span className="card-note"> {visible.length}/{items.length}</span>
                  )}
                </span>
                <button type="button" className="btn-ghost btn-sm" onClick={seed} disabled={seeding}>
                  시연 데이터
                </button>
              </div>

              {selectionHidden && (
                <div className="review-list-warn">
                  지금 열어 둔 신청서는 이 조건에 들어오지 않습니다. 오른쪽 내용은 그대로 둡니다 —
                  적던 것이 날아가면 안 되니까요.
                  <button type="button" className="btn-ghost btn-sm" onClick={clearFilters}>
                    조건 지우기
                  </button>
                </div>
              )}

              {visible.length === 0 && (
                <div className="review-list-empty">
                  <div className="empty-title">조건에 맞는 신청서가 없습니다</div>
                  <div className="empty-sub">
                    {items.length}건이 접수되어 있지만 지금 건 조건에 맞는 것이 없습니다.
                  </div>
                  <button type="button" className="btn-ghost btn-sm" onClick={clearFilters}>
                    조건 지우기
                  </button>
                </div>
              )}

              <ul>
                {visible.map((a) => (
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
          <span className="spacer" />
          {/* 이 신청서에 지금까지 일어난 일 전부를 한 문서로. 결재에 붙이거나
              부서에 보낼 때 필요하다. 여덟 화면을 돌아다니게 하지 않는다. */}
          <Link to={`/record/${a.id}`} className="btn-ghost btn-sm">
            기록 전체 보기
          </Link>
        </div>
        <div className="row" style={{ marginBottom: 12 }}>
          {/* 이 부서와 그동안 뭘 했는지로 넘어간다. 판정하기 전에 "이 부서에
              내가 밀린 게 있나"를 보고 가는 것이 순서다. */}
          <Link to={`/dept/${encodeURIComponent(a.dept)}`} className="badge badge-neutral">
            {a.dept}
          </Link>
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
          <div style={{ marginTop: 14 }}>
            <div className="card-note" style={{ marginBottom: 6 }}>
              부서가 함께 올린 파일 {data.files.length}개
            </div>
            <FileList applicationId={a.id} files={data.files} compact />
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

// 세어 놓은 숫자를 눌러서 그것만 볼 수 있게 한다.
//
// 숫자만 보여 주고 못 누르게 하면, 담당자는 "반려 1건"을 보고 나서 그 1건을
// 찾으려고 목록을 처음부터 눈으로 훑게 된다. 이미 센 것을 다시 세게 하는 셈이다.
function Tile({ label, value, note, on, onClick }) {
  if (!onClick) {
    return (
      <div className="stat-tile">
        <div className="stat-label">{label}</div>
        <div className="stat-value">{value}</div>
        <div className="stat-note">{note}</div>
      </div>
    )
  }
  return (
    <button
      type="button"
      className={`stat-tile stat-tile-btn${on ? ' on' : ''}`}
      onClick={onClick}
      aria-pressed={on}
      title={on ? '다시 눌러 조건을 풉니다' : `${label}인 것만 봅니다`}
    >
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      <div className="stat-note">{note}</div>
    </button>
  )
}

function statusTone(status) {
  if (status === '수용' || status === '완료') return 'badge-success'
  if (status === '반려') return 'badge-danger'
  if (status === '보류') return 'badge-warning'
  if (status === '진행중' || status === '검토중') return 'badge-accent'
  return 'badge-neutral'
}
