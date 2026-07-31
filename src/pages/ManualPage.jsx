import { useEffect, useMemo, useState } from 'react'
import StageHeader from '../components/StageHeader.jsx'
import { useApi } from '../hooks/useApi.js'
import { useToast } from '../context/ToastContext.jsx'
import { api } from '../api/client.js'
import { ago } from '../lib/format.js'

export default function ManualPage() {
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
      <StageHeader stageKey="manual" />

      {targets.length === 0 ? (
        <div className="empty">
          <div className="empty-title">사용법서를 쓸 도구가 없습니다</div>
          <div className="empty-sub">4단계에서 만든 것이 여기로 넘어옵니다.</div>
        </div>
      ) : (
        <>
          <div className="chip-row no-print">
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
          {selectedId && <Manual id={selectedId} />}
        </>
      )}
    </div>
  )
}

const EMPTY = {
  title: '',
  intro: '',
  when_to_run: '',
  what_to_do_after: '',
  contact: '',
  notes: '',
}

function Manual({ id }) {
  const { data, error, loading, reload } = useApi(`/applications/${id}/manual`)
  const toast = useToast()
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!data) return
    setForm(
      data.manual
        ? {
            title: data.manual.title ?? '',
            intro: data.manual.intro ?? '',
            when_to_run: data.manual.when_to_run ?? '',
            what_to_do_after: data.manual.what_to_do_after ?? '',
            contact: data.manual.contact ?? '',
            notes: data.manual.notes ?? '',
          }
        : { ...EMPTY, title: `${data.application.title} — 사용법` }
    )
  }, [data])

  async function save() {
    setSaving(true)
    try {
      await api.put(`/applications/${id}/manual`, form)
      toast.success('저장했습니다.')
      await reload()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading && !data) return <div className="page-loading">불러오는 중…</div>
  if (error) return <div className="notice notice-danger">{error}</div>
  if (!data) return null

  const a = data.auto

  return (
    <div className="stack">
      {!data.betaPassed && (
        <div className="notice notice-warn no-print">
          <div className="notice-title">아직 베타 테스트를 통과하지 않았습니다</div>
          <p>
            사용법서를 미리 써 두는 것은 괜찮습니다. 다만 통과하기 전에는 부서에 넘기지 마세요.
          </p>
        </div>
      )}

      <section className="card no-print">
        <div className="card-head">
          <span className="card-title">내가 써야 하는 것</span>
          <span className="card-note">코드가 알 수 없는 것들입니다</span>
        </div>

        <Field label="제목">
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </Field>
        <Field label="이 도구가 무엇인가" hint="한 문단">
          <textarea
            rows={2}
            value={form.intro}
            onChange={(e) => setForm({ ...form, intro: e.target.value })}
            placeholder="채널 다섯 곳의 정산서를 하나로 합쳐 채널별 순매출과 기여이익을 냅니다."
          />
        </Field>
        <Field label="언제 돌리나" hint="넘기기 전에 반드시 채워야 합니다">
          <textarea
            rows={2}
            value={form.when_to_run}
            onChange={(e) => setForm({ ...form, when_to_run: e.target.value })}
            placeholder="매주 월요일 아침, 채널 다섯 곳 정산서가 모두 도착한 뒤에 돌립니다."
          />
        </Field>
        <Field label="결과를 어떻게 쓰나" hint="넘기기 전에 반드시 채워야 합니다">
          <textarea
            rows={2}
            value={form.what_to_do_after}
            onChange={(e) => setForm({ ...form, what_to_do_after: e.target.value })}
            placeholder="내려받은 표를 주간 보고 서식에 붙입니다. 검토함에 남은 게 있으면 먼저 처리하세요."
          />
        </Field>
        <Field label="막혔을 때 누구에게" hint="넘기기 전에 반드시 채워야 합니다">
          <input
            value={form.contact}
            onChange={(e) => setForm({ ...form, contact: e.target.value })}
            placeholder="AX 담당자 · 사내 메신저 ax01"
          />
        </Field>
        <Field label="그 밖에 알아야 할 것" hint="선택">
          <textarea
            rows={2}
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </Field>

        <div className="row">
          <button type="button" className="btn-primary" onClick={save} disabled={saving}>
            {saving ? '저장하는 중…' : '저장'}
          </button>
          <button
            type="button"
            className="btn-ghost"
            onClick={async () => {
              try {
                await api.post(`/applications/${id}/manual`, { kind: 'publish' })
                toast.success('사용법서를 확정했습니다.')
                await reload()
              } catch (err) {
                toast.error(err.message)
              }
            }}
          >
            확정하기
          </button>
          <button type="button" className="btn-ghost" onClick={() => window.print()}>
            인쇄 · PDF로 저장
          </button>
          {data.manual?.published_at && (
            <span className="badge badge-success">{ago(data.manual.published_at)} 확정됨</span>
          )}
        </div>
      </section>

      <Faq data={data} id={id} toast={toast} onDone={reload} />

      {/* ── 실제 문서 ── */}
      <article className="manual-doc">
        <h1>{form.title || '사용법'}</h1>
        {form.intro && <p className="manual-intro">{form.intro}</p>}

        {form.when_to_run && (
          <>
            <h2>언제 돌리나요</h2>
            <p>{form.when_to_run}</p>
          </>
        )}

        <h2>이 도구가 받는 파일</h2>
        <p className="card-note">
          파일 이름은 상관없습니다. 아래 컬럼이 들어 있으면 어느 채널인지 알아봅니다.
        </p>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>채널</th>
                <th>이 컬럼이 있으면 알아봅니다</th>
                <th>통화</th>
              </tr>
            </thead>
            <tbody>
              {a.inputs.map((i) => (
                <tr key={i.channel}>
                  <td>{i.channel}</td>
                  <td className="mono">{i.tellBy.join(', ')}</td>
                  <td>{i.currency}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h2>쓰는 법</h2>
        <ol className="manual-steps">
          <li>
            <strong>배포 화면을 엽니다.</strong> 담당자가 알려 준 주소로 들어갑니다.
          </li>
          <li>
            <strong>정산서 파일을 넣습니다.</strong> 한 번에 여러 개를 넣어도 됩니다. 같은 파일을
            실수로 두 번 넣어도 한 번만 셉니다.
          </li>
          <li>
            <strong>결과를 확인합니다.</strong> 채널별 순매출과 기여이익이 나옵니다. 숫자를 누르면
            그 값이 원본 파일의 몇 번째 줄에서 왔는지 볼 수 있습니다.
          </li>
          <li>
            <strong>검토함을 봅니다.</strong> 처리하지 못한 줄이 있으면 여기 모입니다. 아래
            &apos;검토함에 뜨면&apos;을 보세요.
          </li>
          <li>
            <strong>내려받습니다.</strong> {form.what_to_do_after || '결과 표를 내려받아 사용합니다.'}
          </li>
        </ol>

        <h2>안에서 무슨 일이 일어나나요</h2>
        <p className="card-note">{a.generatedNote}</p>
        <ol className="manual-steps">
          {a.steps.map((s) => (
            <li key={s.title}>
              <strong>{s.title}</strong>
              <div>{s.body}</div>
            </li>
          ))}
        </ol>

        <h2>검토함에 뜨면</h2>
        <p className="card-note">
          처리하지 못한 줄은 버리지 않고 검토함에 모읍니다. 조용히 버리면 합계가 조용히
          틀리기 때문입니다.
        </p>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>이렇게 뜨면</th>
                <th>무슨 뜻인가요</th>
                <th>어떻게 하나요</th>
              </tr>
            </thead>
            <tbody>
              {a.quarantine.map((q) => (
                <tr key={q.reason}>
                  <td>
                    <strong>{q.label}</strong>
                  </td>
                  <td>{q.what}</td>
                  <td>{q.todo}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h2>이 도구가 보장하지 않는 것</h2>
        <p className="card-note">처음부터 적어 둡니다. 나중에 다투지 않기 위해서입니다.</p>
        <ul className="manual-list">
          {a.notGuaranteed.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>

        {data.faq.length > 0 && (
          <>
            <h2>자주 묻는 것</h2>
            <p className="card-note">
              지어낸 질문이 아니라 베타 테스트에서 실제로 나온 질문입니다.
            </p>
            <dl className="manual-faq">
              {data.faq.map((f) => (
                <div key={f.id}>
                  <dt>{f.question}</dt>
                  <dd>{f.answer}</dd>
                </div>
              ))}
            </dl>
          </>
        )}

        {form.notes && (
          <>
            <h2>그 밖에</h2>
            <p>{form.notes}</p>
          </>
        )}

        <h2>막혔을 때</h2>
        <p>{form.contact || '(아직 적지 않았습니다)'}</p>

        {data.stakeholders.length > 0 && (
          <p className="card-note">
            이 도구에 얽힌 사람들 —{' '}
            {data.stakeholders.map((s) => `${s.dept} ${s.person_label}`).join(', ')}
          </p>
        )}

        <hr />
        <p className="card-note">
          받는 파일 형식, 처리 단계, 검토함 안내는 실제로 도는 코드에서 그대로 뽑았습니다.
          규칙이 바뀌면 이 문서도 같이 바뀝니다.
          {data.manual?.updated_at && ` · 마지막 수정 ${ago(data.manual.updated_at)}`}
        </p>
      </article>
    </div>
  )
}

function Faq({ data, id, toast, onDone }) {
  const [draft, setDraft] = useState({})

  return (
    <section className="card no-print">
      <div className="card-head">
        <span className="card-title">자주 묻는 것</span>
        <span className="card-note">베타에서 실제로 나온 말로 채웁니다</span>
      </div>

      {data.faq.length > 0 && (
        <div className="stack-sm" style={{ marginBottom: 14 }}>
          {data.faq.map((f) => (
            <div key={f.id} className="decided">
              <div className="item-body">
                <strong>{f.question}</strong>
              </div>
              <div className="card-note" style={{ marginTop: 4 }}>
                {f.answer}
              </div>
              <div className="item-actions">
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  onClick={async () => {
                    try {
                      await api.remove(`/applications/${id}/manual`, { id: f.id })
                      await onDone()
                    } catch (err) {
                      toast.error(err.message)
                    }
                  }}
                >
                  빼기
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {data.unusedFeedback.length === 0 ? (
        <p className="card-note">
          베타 테스트에서 남은 말이 없습니다. 5단계에서 현업이 한 말을 남기면 여기로 옵니다.
        </p>
      ) : (
        <>
          <h4>아직 답을 안 적은 말 {data.unusedFeedback.length}개</h4>
          <div className="stack-sm">
            {data.unusedFeedback.map((f) => (
              <div key={f.id} className="draft">
                <div className="row" style={{ marginBottom: 4 }}>
                  <span className="badge badge-neutral">{f.dept}</span>
                  <span className="badge badge-accent">{f.kind}</span>
                  <span className="card-note">{f.person_label}</span>
                </div>
                <div className="item-body">{f.body}</div>
                <textarea
                  rows={2}
                  value={draft[f.id] ?? ''}
                  onChange={(e) => setDraft({ ...draft, [f.id]: e.target.value })}
                  placeholder="이 말에 대한 답 — 사용법서에 그대로 실립니다"
                  style={{ width: '100%', marginTop: 8 }}
                />
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  style={{ marginTop: 6 }}
                  disabled={!draft[f.id]?.trim()}
                  onClick={async () => {
                    try {
                      await api.post(`/applications/${id}/manual`, {
                        kind: 'faq',
                        question: f.body,
                        answer: draft[f.id],
                        from_feedback_id: f.id,
                      })
                      setDraft({ ...draft, [f.id]: '' })
                      toast.success('사용법서에 넣었습니다.')
                      await onDone()
                    } catch (err) {
                      toast.error(err.message)
                    }
                  }}
                >
                  자주 묻는 것에 넣기
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  )
}

function Field({ label, hint, children }) {
  return (
    <div className="field">
      <label className="field-label">
        {label}
        {hint && <span className="field-hint">{hint}</span>}
      </label>
      {children}
    </div>
  )
}
