import { useEffect, useState } from 'react'
import { DEPTS } from '../../shared/depts.js'
import StageHeader from '../components/StageHeader.jsx'
import { useApi } from '../hooks/useApi.js'
import { api } from '../api/client.js'
import { useToast } from '../context/ToastContext.jsx'
import { ago, duration, num } from '../lib/format.js'

const FREQUENCIES = ['하루 여러 번', '매일', '주 2~3회', '주 1회', '격주', '매월', '분기', '비정기']

import SimilarNotice from '../components/SimilarNotice.jsx'
import Field from '../components/Field.jsx'
import {
  loadDraft,
  saveDraft,
  clearDraft,
  draftAge,
  describeDraft,
  DRAFT_MAX_DAYS,
} from '../lib/draft.js'

const EMPTY = {
  dept: '',
  applicant_label: '',
  contact: '',
  title: '',
  bottleneck: '',
  problem: '',
  wish: '',
  current_minutes: '',
  current_people: '1',
  current_frequency: '',
  impact_if_wrong: '',
}

// 브라우저 저장소. 없거나 막혀 있을 수 있어서 한 곳에서만 꺼낸다.
function browserStore() {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    // 쿠키를 막아 둔 브라우저에서는 이걸 읽는 것만으로도 터진다.
    return null
  }
}

export default function ApplyPage() {
  const { data, error, reload } = useApi('/applications')
  const toast = useToast()

  const [form, setForm] = useState(EMPTY)
  // 적다 만 것을 잃지 않는다.
  //
  // 폼이 길어서 다 적으면 십 분이 간다. 그러다 회의에 불려 가 탭을 닫거나
  // 실수로 새로고침하면 전부 날아갔다. 한 번 날려 본 사람은 다시 안 적고,
  // 그러면 그 병목은 영영 접수되지 않는다.
  //
  // 되살릴 것이 있어도 먼저 묻는다. 말없이 채워 넣으면, 새 걸 적으러 온
  // 사람이 남의 옛 글 위에 덧쓰게 된다.
  const [restorable, setRestorable] = useState(null)
  // 이미 들어와 있는 것을 또 내는 것을 막는다.
  //
  // 다 적고 낸 뒤에 "이미 있습니다"라고 하면 늦다 — 그 사람은 이미 십 분을
  // 썼다. 적는 도중에 알려 준다.
  const [similar, setSimilar] = useState([])
  const [similarHidden, setSimilarHidden] = useState(false)
  const [fieldErrors, setFieldErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [receipt, setReceipt] = useState(null)

  useEffect(() => {
    const found = loadDraft(browserStore())
    if (found) setRestorable(found)
  }, [])

  // 손을 멈추면 그때 저장한다. 한 글자마다 저장하면 쓸데없이 시끄럽다.
  //
  // 되살릴지 물어보는 중에는 저장하지 않는다. 그 사이에 저장해 버리면
  // 사람이 "이어서 쓰기"를 누르기도 전에 옛 초안이 지워진다.
  useEffect(() => {
    if (restorable) return
    const timer = setTimeout(() => saveDraft(browserStore(), form), 800)
    return () => clearTimeout(timer)
  }, [form, restorable])

  // 타이핑이 멈추면 그때 묻는다. 한 글자마다 물으면 서버도 사람도 시끄럽다.
  useEffect(() => {
    const written = `${form.title}${form.bottleneck}${form.problem}`.trim()
    if (written.length < 8) {
      setSimilar([])
      return
    }
    const timer = setTimeout(() => {
      api
        .post('/applications/similar', {
          dept: form.dept,
          title: form.title,
          bottleneck: form.bottleneck,
          problem: form.problem,
        })
        .then((r) => setSimilar(r.hits ?? []))
        // 못 찾아도 신청은 계속돼야 한다. 이건 거들어 주는 기능이지
        // 신청을 막는 기능이 아니다.
        .catch(() => setSimilar([]))
    }, 700)
    return () => clearTimeout(timer)
  }, [form.dept, form.title, form.bottleneck, form.problem])

  function set(key, value) {
    setForm((f) => ({ ...f, [key]: value }))
    if (fieldErrors[key]) setFieldErrors((e) => ({ ...e, [key]: undefined }))
  }

  async function submit(e) {
    e.preventDefault()
    setSubmitting(true)
    setFieldErrors({})

    const body = new FormData()
    Object.entries(form).forEach(([k, v]) => body.append(k, v))

    try {
      const json = await api.form('/applications', body)
      // 냈으면 초안은 쓸모가 없다. 남겨 두면 다음에 열었을 때 이미 낸 것을
      // 또 내라고 권하게 된다.
      clearDraft(browserStore())
      setReceipt(json)
      setForm(EMPTY)
      toast.success(`접수됐습니다. 접수번호 ${json.ticket_no}`)
      await reload()
    } catch (err) {
      // 칸별 오류가 있으면 그 칸 아래에 붙이고, 아니면 알림으로 알린다.
      if (err.fields) setFieldErrors(err.fields)
      toast.error(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const items = data?.items ?? []

  return (
    <div className="stack">
      <StageHeader stageKey="apply" />

      {receipt && (
        <section className="receipt">
          <div className="receipt-mark" aria-hidden="true">
            ✓
          </div>
          <div>
            <div className="receipt-title">접수됐습니다</div>
            <p className="receipt-body">
              접수번호 <strong className="mono">{receipt.ticket_no}</strong> — 이 번호로 진행 상황을
              확인하실 수 있습니다. 담당자가 <strong>영업일 1일 안에</strong> 열람하고, 만들 수 있는
              일인지부터 알려드립니다. 만들 수 없는 경우에도 이유와 대안을 함께 보내드립니다.
            </p>
            <a className="btn-ghost btn-sm" href={`/track?no=${receipt.ticket_no}`}>
              지금 진행 상황 보기
            </a>
          </div>
          <button type="button" className="btn-ghost btn-sm" onClick={() => setReceipt(null)}>
            닫기
          </button>
        </section>
      )}

      <div className="grid-side">
        <form className="stack" onSubmit={submit} noValidate>
          {restorable && (
            <section className="draft-restore">
              <div className="draft-restore-head">
                <span className="draft-restore-title">적으시던 것이 있습니다</span>
                <span className="card-note">{draftAge(restorable.savedAt)}</span>
              </div>
              <p className="draft-restore-body">
                {describeDraft(restorable.form)} — 이어서 쓰시겠습니까? 이 브라우저에만 두었고
                서버로 보낸 적은 없습니다.
              </p>
              <div className="row">
                <button
                  type="button"
                  className="btn-primary btn-sm"
                  onClick={() => {
                    setForm({ ...EMPTY, ...restorable.form })
                    setRestorable(null)
                  }}
                >
                  이어서 쓰기
                </button>
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  onClick={() => {
                    clearDraft(browserStore())
                    setRestorable(null)
                  }}
                >
                  버리고 새로 쓰기
                </button>
                <span className="spacer" />
                <span className="card-note">{DRAFT_MAX_DAYS}일이 지나면 저절로 지워집니다</span>
              </div>
            </section>
          )}

          <section className="card card-boxed">
            <div className="card-head">
              <h2 className="card-title">누가 신청하나요</h2>
            </div>
            <div className="field-row">
              <Field label="신청 부서" required error={fieldErrors.dept}>
                <select value={form.dept} onChange={(e) => set('dept', e.target.value)}>
                  <option value="">고르세요</option>
                  {DEPTS.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label="신청자"
                required
                hint="이름 대신 직책도 됩니다"
                error={fieldErrors.applicant_label}
              >
                <input
                  value={form.applicant_label}
                  onChange={(e) => set('applicant_label', e.target.value)}
                  placeholder="정산 담당자"
                />
              </Field>
              <Field label="연락처" hint="선택" error={fieldErrors.contact}>
                <input
                  value={form.contact}
                  onChange={(e) => set('contact', e.target.value)}
                  placeholder="사내 메신저 아이디 등"
                />
              </Field>
            </div>
          </section>

          <section className="card card-boxed">
            <div className="card-head">
              <h2 className="card-title">무엇이 막혀 있나요</h2>
            </div>

            <Field label="한 줄로" required hint="이것만 있으면 낼 수 있습니다" error={fieldErrors.title}>
              <input
                value={form.title}
                onChange={(e) => set('title', e.target.value)}
                placeholder="매주 채널 정산서를 손으로 붙입니다"
                maxLength={80}
              />
            </Field>

            {!similarHidden && (
              <SimilarNotice
                hits={similar}
                tone="apply"
                onDismiss={() => setSimilarHidden(true)}
                /* 이미 적으신 것을 손들기 칸에 그대로 채워 드린다. 다시
                   적으라고 하면 그 자리에서 그만두신다. */
                draft={form}
              />
            )}

            <Field
              label="무엇이 병목인가요"
              hint="어느 대목에서 시간이 가장 많이 드는지 · 빈칸이어도 냅니다"
              error={fieldErrors.bottleneck}
              count={[form.bottleneck.length, 1000]}
            >
              <textarea
                rows={4}
                value={form.bottleneck}
                onChange={(e) => set('bottleneck', e.target.value)}
                placeholder="채널마다 정산서 양식이 달라서, 컬럼 순서를 맞추는 데만 한 시간이 넘게 걸립니다."
              />
            </Field>

            <Field
              label="그래서 지금 무슨 일이 생기나요"
              hint="실제로 있었던 일이 있으면 가장 좋습니다 · 빈칸이어도 냅니다"
              error={fieldErrors.problem}
              count={[form.problem.length, 1500]}
            >
              <textarea
                rows={4}
                value={form.problem}
                onChange={(e) => set('problem', e.target.value)}
                placeholder="지난주에는 파일 맨 아래 합계 줄을 같이 붙여서 매출이 두 배로 나왔는데, 화요일에야 발견했습니다."
              />
            </Field>

            <Field
              label="이렇게 되면 좋겠다"
              hint="선택. 바라는 모습이 있으면 적어 주세요"
              error={fieldErrors.wish}
              count={[form.wish.length, 1000]}
            >
              <textarea
                rows={3}
                value={form.wish}
                onChange={(e) => set('wish', e.target.value)}
                placeholder="파일만 올리면 하나로 합쳐진 표가 나왔으면 합니다."
              />
            </Field>

            <Field
              label="틀리면 무슨 일이 생기나요"
              hint="선택. 무엇을 먼저 할지 정할 때 이 답이 가장 큽니다"
              error={fieldErrors.impact_if_wrong}
            >
              <textarea
                rows={2}
                value={form.impact_if_wrong}
                onChange={(e) => set('impact_if_wrong', e.target.value)}
                placeholder="대표 보고에 들어가는 숫자라, 틀리면 정정 공시까지 갑니다."
              />
            </Field>
          </section>

          <section className="card card-boxed">
            <div className="card-head">
              <h2 className="card-title">지금 얼마나 드나요</h2>
            </div>
            <div className="field-row">
              <Field label="한 번에 몇 분" hint="분 단위" error={fieldErrors.current_minutes}>
                <input
                  inputMode="numeric"
                  value={form.current_minutes}
                  onChange={(e) => set('current_minutes', e.target.value)}
                  placeholder="90"
                />
              </Field>
              <Field label="몇 명이" error={fieldErrors.current_people}>
                <input
                  inputMode="numeric"
                  value={form.current_people}
                  onChange={(e) => set('current_people', e.target.value)}
                  placeholder="1"
                />
              </Field>
              <Field label="얼마나 자주" error={fieldErrors.current_frequency}>
                <select
                  value={form.current_frequency}
                  onChange={(e) => set('current_frequency', e.target.value)}
                >
                  <option value="">고르세요</option>
                  {FREQUENCIES.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </section>


          <button type="submit" className="btn-primary btn-block" disabled={submitting}>
            {submitting ? '접수하는 중…' : '신청서 내기'}
          </button>
        </form>

        <aside className="stack">
          <section className="card">
            <div className="card-head">
              <h2 className="card-title">접수된 신청서</h2>
              {data && <span className="card-note">{num(data.summary.total)}건</span>}
            </div>

            {error && <p className="card-note">{error}</p>}

            {!error && items.length === 0 && (
              <div className="empty">
                <div className="empty-title">아직 없습니다</div>
              </div>
            )}

            {items.length > 0 && (
              <>
                {data.summary.overdue > 0 && (
                  <div className="notice notice-warn" style={{ marginBottom: 10 }}>
                    하루가 지나도록 열람하지 않은 신청서 {data.summary.overdue}건
                  </div>
                )}
                <ul className="app-list">
                  {items.slice(0, 12).map((a) => (
                    <li key={a.id} className="app-item">
                      <div className="app-item-top">
                        <span className="badge badge-neutral">{a.dept}</span>
                        <span className={`badge ${statusTone(a.status)}`}>{a.status}</span>
                        <span className="spacer" />
                        <a className="mono card-note" href={`/track?no=${a.ticket_no}`} title="진행 상황 보기">
                          {a.ticket_no}
                        </a>
                      </div>
                      <div className="app-item-title">{a.title}</div>
                      <div className="card-note">
                        {ago(a.created_at)}
                        {a.annual_hours != null && ` · 연 ${num(a.annual_hours, 1)}시간`}
                        {a.current_minutes != null && ` · 1회 ${duration(a.current_minutes * 60)}`}
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        </aside>
      </div>
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
