import { useRef, useState } from 'react'
import StageHeader from '../components/StageHeader.jsx'
import { useApi } from '../hooks/useApi.js'
import { api } from '../api/client.js'
import { useToast } from '../context/ToastContext.jsx'
import { ago, duration, num } from '../lib/format.js'
import { peekFile, formatBytes } from '../lib/filePeek.js'

const DEPTS = ['재무', '마케팅', '영업', 'SCM', '운영', '인사', '기타']
const FREQUENCIES = ['하루 여러 번', '매일', '주 2~3회', '주 1회', '격주', '매월', '분기', '비정기']
const MAX_FILES = 5

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

export default function ApplyPage() {
  const { data, error, reload } = useApi('/applications')
  const toast = useToast()

  const [form, setForm] = useState(EMPTY)
  const [fieldErrors, setFieldErrors] = useState({})
  const [files, setFiles] = useState([])
  const [peeks, setPeeks] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const [receipt, setReceipt] = useState(null)
  const fileInput = useRef(null)

  function set(key, value) {
    setForm((f) => ({ ...f, [key]: value }))
    if (fieldErrors[key]) setFieldErrors((e) => ({ ...e, [key]: undefined }))
  }

  async function addFiles(list) {
    const picked = [...list].slice(0, MAX_FILES - files.length)
    if (picked.length === 0) return
    setFiles((prev) => [...prev, ...picked])
    const results = await Promise.all(picked.map((f) => peekFile(f)))
    setPeeks((prev) => [...prev, ...results])
  }

  function removeFile(index) {
    setFiles((prev) => prev.filter((_, i) => i !== index))
    setPeeks((prev) => prev.filter((_, i) => i !== index))
  }

  async function submit(e) {
    e.preventDefault()
    setSubmitting(true)
    setFieldErrors({})

    const body = new FormData()
    Object.entries(form).forEach(([k, v]) => body.append(k, v))
    files.forEach((f) => body.append('files', f))

    try {
      const json = await api.form('/applications', body)
      setReceipt(json)
      setForm(EMPTY)
      setFiles([])
      setPeeks([])
      if (json.failed_files?.length) {
        toast.error(`파일 ${json.failed_files.length}개가 올라가지 않았습니다.`)
      } else {
        toast.success(`접수됐습니다. 접수번호 ${json.ticket_no}`)
      }
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
            {receipt.saved_files?.length > 0 && (
              <p className="card-note">첨부 {receipt.saved_files.length}개 저장됨</p>
            )}
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
          <section className="card">
            <div className="card-head">
              <span className="card-title">누가 신청하나요</span>
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

          <section className="card">
            <div className="card-head">
              <span className="card-title">무엇이 막혀 있나요</span>
            </div>

            <Field label="한 줄로" required hint="이것만 있으면 낼 수 있습니다" error={fieldErrors.title}>
              <input
                value={form.title}
                onChange={(e) => set('title', e.target.value)}
                placeholder="매주 채널 정산서를 손으로 붙입니다"
                maxLength={80}
              />
            </Field>

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

          <section className="card">
            <div className="card-head">
              <span className="card-title">지금 얼마나 드나요</span>
              <span className="card-note">나중에 성과를 재는 기준이 됩니다</span>
            </div>
            <p className="card-note" style={{ marginBottom: 12 }}>
              정확하지 않아도 됩니다. 이 값은 <strong>체감</strong>으로 기록되고, 협의 단계에서
              실제로 재서 다시 확정합니다. 만든 사람이 나중에 기억으로 적은 숫자는 근거가 되지
              못하기 때문입니다.
            </p>
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

          <section className="card">
            <div className="card-head">
              <span className="card-title">지금 다루고 계신 파일</span>
              <span className="card-note">
                {files.length}/{MAX_FILES}
              </span>
            </div>
            <p className="card-note" style={{ marginBottom: 12 }}>
              말로 설명하는 것보다 실제 파일 하나가 정확합니다. 올리시면{' '}
              <strong>브라우저에서 바로</strong> 구조를 읽어 보여드립니다. 서버로 보내기 전이고,
              AI도 부르지 않습니다.
            </p>

            <div
              className="dropzone"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault()
                addFiles(e.dataTransfer.files)
              }}
            >
              <input
                ref={fileInput}
                type="file"
                multiple
                className="sr-only"
                accept=".csv,.xlsx,.xls,.txt,.json,.pdf,.png,.jpg,.jpeg"
                onChange={(e) => {
                  addFiles(e.target.files)
                  e.target.value = ''
                }}
              />
              <button
                type="button"
                className="btn-ghost"
                onClick={() => fileInput.current?.click()}
                disabled={files.length >= MAX_FILES}
              >
                파일 고르기
              </button>
              <span className="card-note">또는 여기로 끌어다 놓으세요 · 하나당 10MB까지</span>
            </div>

            {peeks.length > 0 && (
              <div className="stack-sm" style={{ marginTop: 12 }}>
                {peeks.map((p, i) => (
                  <FilePeek key={`${p.name}-${i}`} peek={p} onRemove={() => removeFile(i)} />
                ))}
              </div>
            )}
          </section>

          <button type="submit" className="btn-primary btn-block" disabled={submitting}>
            {submitting ? '접수하는 중…' : '신청서 내기'}
          </button>
        </form>

        <aside className="stack">
          <section className="card">
            <div className="card-head">
              <span className="card-title">접수된 신청서</span>
              {data && <span className="card-note">{num(data.summary.total)}건</span>}
            </div>

            {error && <p className="card-note">{error}</p>}

            {!error && items.length === 0 && (
              <div className="empty">
                <div className="empty-title">아직 없습니다</div>
                <div className="empty-sub">첫 신청서를 내 보세요.</div>
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
                        {a.file_count > 0 && ` · 첨부 ${a.file_count}`}
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

function Field({ label, required, hint, error, count, children }) {
  return (
    <div className={`field${error ? ' has-error' : ''}`}>
      <label className="field-label">
        {label}
        {required && <span className="field-required"> *</span>}
        {hint && <span className="field-hint">{hint}</span>}
      </label>
      {children}
      <div className="field-foot">
        {error && <span className="field-error">{error}</span>}
        {count && (
          <span className="field-count">
            {count[0]}/{count[1]}
          </span>
        )}
      </div>
    </div>
  )
}

function FilePeek({ peek, onRemove }) {
  return (
    <div className="peek">
      <div className="peek-top">
        <strong className="peek-name">{peek.name}</strong>
        <span className="card-note">{formatBytes(peek.size)}</span>
        {peek.encoding && (
          <span className={`badge ${peek.encodingSuspect ? 'badge-warning' : 'badge-neutral'}`}>
            {peek.encoding}
          </span>
        )}
        <span className="spacer" />
        <button type="button" className="btn-ghost btn-sm" onClick={onRemove}>
          빼기
        </button>
      </div>

      {peek.encoding === 'CP949(EUC-KR)' && (
        <p className="peek-note">
          UTF-8이 아니라 CP949로 저장된 파일입니다. 그냥 열면 한글이 깨지는 파일인데, 여기서는
          제대로 읽었습니다.
        </p>
      )}
      {peek.note && <p className="peek-note">{peek.note}</p>}

      {peek.headers && (
        <>
          <div className="peek-meta">
            컬럼 {peek.headers.length}개 · 구분자 <code>{peek.delimiter}</code> · 약{' '}
            {num(peek.estimatedRows)}행{peek.rowsAreEstimate && ' (추정)'}
          </div>
          <div className="table-wrap peek-table">
            <table className="data-table">
              <thead>
                <tr>
                  {peek.headers.map((h, i) => (
                    <th key={i}>{h || <span className="card-note">(빈 헤더)</span>}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {peek.sampleRows?.map((row, ri) => (
                  <tr key={ri}>
                    {peek.headers.map((_, ci) => (
                      <td key={ci}>{row[ci] ?? ''}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
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
