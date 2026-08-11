import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import StageHeader from '../components/StageHeader.jsx'
import { useApi } from '../hooks/useApi.js'
import { useToast } from '../context/ToastContext.jsx'
import { api } from '../api/client.js'
import { ago } from '../lib/format.js'
import { validateFix, SECTION_BY_KEY } from '../../shared/unclear.js'

export default function ManualPage() {
  const { data: list } = useApi('/applications')
  // 할 일이 "어느 사용법서요"까지 실어 보낸다. 없으면 늘 첫 건 앞에
  // 떨어지고, 담당자는 칩을 하나씩 눌러 막힌 자리를 찾아야 한다.
  const [params] = useSearchParams()
  const wanted = params.get('id')
  const [selectedId, setSelectedId] = useState(null)

  const targets = useMemo(
    () => (list?.items ?? []).filter((a) => ['수용', '진행중', '완료'].includes(a.status)),
    [list]
  )

  useEffect(() => {
    if (selectedId || targets.length === 0) return
    // 주소로 온 건이 목록에 없으면(이미 처리했거나 상태가 바뀌었으면)
    // 첫 건으로 떨어진다 — 빈 화면을 보여 주는 것보다 낫다.
    const found = wanted && targets.find((a) => a.id === wanted)
    setSelectedId(found ? found.id : targets[0].id)
  }, [targets, selectedId, wanted])

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

      {/* 부서가 짚은 곳을 맨 위에 둔다. 아래 편집칸보다 먼저 봐야
          무엇을 고쳐 쓸지 알고 손을 댄다. */}
      <Unclear id={id} toast={toast} />

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
            {/* "숫자를 누르면 원본 줄을 볼 수 있습니다"라고 적혀 있었다.
                그 되짚기는 담당자용 제작 화면에만 있고, 부서가 여는 도구
                화면에는 없다. 사용법서를 읽고 눌러 본 사람은 아무 일도 안
                일어나는 것을 겪는다 — 숫자가 이상해서 근거를 찾으려던 바로
                그 순간에. 그리고 담당자에게 전화한다. 이 사이트가 없애려는
                그 전화다.
                내려받은 파일에는 원본파일·원본시트·원본줄 칸이 실제로
                들어 있으니, 할 수 있는 쪽으로 적는다. */}
            <strong>결과를 확인합니다.</strong> 채널별 순매출과 기여이익이 나옵니다. 어떤 숫자가
            어디서 왔는지 보시려면 결과를 내려받으세요 —{' '}
            <strong>원본파일·원본시트·원본줄</strong> 칸이 함께 들어 있습니다.
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

// ── 부서가 모르겠다고 짚은 곳 ────────────────────────────────
//
// 짚는 자리만 만들고 고치는 자리를 안 만들면, 짚기는 신고함이 되고 아무도
// 안 읽는다. 그러면 부서는 "말해 봐야 소용없다"를 배우고 그 뒤로는 짚지
// 않는다. 문서는 영영 그대로다.
//
// 여기 적는 문장은 도구 화면의 그 대목에 그대로 붙는다. 그래서 "고쳤음"
// 같은 말을 적으면 부서가 그걸 읽게 된다.
function Unclear({ id, toast }) {
  const { data, reload } = useApi(`/applications/${id}/unclear`)
  const [open, setOpen] = useState(null)
  const [form, setForm] = useState({ body: '', by: 'AX 담당자' })
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)

  if (!data) return null
  // 짚힌 것이 하나도 없으면 이 자리는 아무 말도 하지 않는다. 빈 목록을
  // 띄워 두면 화면만 길어진다.
  if (data.sections.length === 0) return null

  async function fix(flagId) {
    const bad = validateFix(form)
    setErrors(bad)
    if (Object.keys(bad).length > 0) return
    setBusy(true)
    try {
      const r = await api.post(`/applications/${id}/unclear`, { ...form, flag_id: flagId })
      toast.success(r.message)
      setOpen(null)
      setForm({ body: '', by: 'AX 담당자' })
      reload()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card no-print">
      <div className="card-head">
        <span className="card-title">부서가 모르겠다고 짚은 곳</span>
        {data.summary.mustFix > 0 && (
          <span className="badge badge-warning">{data.summary.mustFix}곳은 문서 문제</span>
        )}
        <span className="spacer" />
        <span className="card-note">여기 적는 문장이 도구 화면 그 대목에 그대로 붙습니다</span>
      </div>
      <p className="card-note">{data.line}</p>

      {/* 짚힌 것에서 자주 묻는 것 초안을 뽑아 제안한다.
          자주 묻는 것은 지금 사용법서를 쓴 사람이 손으로 적는데, 쓴 사람은
          자기가 무엇을 자주 묻히는지 모른다. 실제로 오는 질문은 이미
          여기 다 있다. */}
      {data.drafts?.length > 0 && (
        <div className="faq-drafts">
          <div className="faq-drafts-head">
            <strong>자주 묻는 것에 올리실 만한 것</strong>
            <span className="card-note">{data.draftLine}</span>
          </div>
          {data.drafts.map((d) => (
            <FaqDraft key={d.key} draft={d} id={id} toast={toast} reload={reload} />
          ))}
        </div>
      )}

      <ul className="unclear-list">
        {data.sections.map((sec) => (
          <li key={sec.key} className={sec.mustFix ? 'must' : ''}>
            <div className="unclear-sec">
              <strong>{SECTION_BY_KEY[sec.key]?.label ?? sec.key}</strong>
              <span className="card-note">
                {sec.open > 0 ? `${sec.open}분이 막히셨습니다` : '다시 썼습니다'}
                {sec.mustFix && ' — 두 분 이상이 같은 데서 막히셨으면 문서가 잘못 쓰인 것입니다'}
              </span>
            </div>

            <ul className="unclear-flags">
              {sec.flags.map((f) => (
                <li key={f.id} className={f.fix ? 'fixed' : ''}>
                  <p className="unclear-said">{f.body}</p>
                  <span className="card-note">{ago(f.at)}</span>

                  {f.fix ? (
                    <p className="unclear-fixed">
                      <strong>{f.fix.by}님이 다시 씀</strong> {f.fix.body}
                    </p>
                  ) : open === f.id ? (
                    <div className="unclear-fix-form">
                      <textarea
                        rows={2}
                        value={form.body}
                        onChange={(e) => setForm((v) => ({ ...v, body: e.target.value }))}
                        placeholder="어떻게 고치셨는지 — 이 문장이 부서 화면에 그대로 붙습니다"
                      />
                      {errors.body && <em className="field-error">{errors.body}</em>}
                      <div className="row">
                        <button type="button" className="btn-primary btn-sm" disabled={busy} onClick={() => fix(f.id)}>
                          {busy ? '남기는 중…' : '다시 썼다고 남기기'}
                        </button>
                        <button type="button" className="btn-ghost btn-sm" onClick={() => setOpen(null)}>
                          그만두기
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" className="btn-ghost btn-sm" onClick={() => setOpen(f.id)}>
                      이 대목 다시 썼습니다
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  )
}

// 짚힌 것에서 뽑은 자주 묻는 것 초안.
//
// 문장을 자동으로 고쳐 쓰지 않는다. 짚은 원문과 담당자가 다시 쓴 문장을
// 그대로 칸에 채워 주고, 다듬는 것은 사람이 한다. 규칙으로 "어떻게 말할지"
// 까지 만들면 어색한 한국어가 나오고, 그걸 부서가 읽는다.
function FaqDraft({ draft, id, toast, reload }) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ question: draft.question, answer: draft.answer })
  const [busy, setBusy] = useState(false)

  async function add() {
    setBusy(true)
    try {
      await api.post(`/applications/${id}/manual`, { kind: 'faq', ...form })
      toast.success('자주 묻는 것에 올렸습니다.')
      await dismiss(false)
    } catch (err) {
      toast.error(err.message)
      setBusy(false)
    }
  }

  // 올린 것도 물린 것도 다시 안 띄운다. 올린 뒤에 제안이 그대로 남아
  // 있으면 담당자가 두 번 올린다.
  async function dismiss(notify = true) {
    setBusy(true)
    try {
      await api.post(`/applications/${id}/unclear`, {
        kind: 'dismiss_faq',
        key: draft.key,
        by: 'AX 담당자',
        reason: notify ? '올리지 않기로 했다.' : '자주 묻는 것에 올렸다.',
      })
      if (notify) toast.info('이 제안은 다시 안 띄웁니다.')
      reload()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="faq-draft">
      <div className="faq-draft-head">
        <span className="badge badge-neutral">{draft.label}</span>
        <span className="card-note">{draft.askedBy}분이 막히셨습니다</span>
        {/* 겹치는 것이 있으면 감추지 않고 같이 보여준다. 담당자가 보고
            판단할 일이지, 규칙이 대신 지울 일이 아니다. */}
        {draft.duplicateOf && (
          <span className="badge badge-warning">이미 적어 두신 것과 비슷합니다</span>
        )}
      </div>

      {draft.duplicateOf && (
        <p className="faq-dup">이미 있는 것 — {draft.duplicateOf.question}</p>
      )}

      {open ? (
        <div className="faq-draft-form">
          <label>
            <span>질문</span>
            <input
              value={form.question}
              onChange={(e) => setForm((f) => ({ ...f, question: e.target.value }))}
            />
          </label>
          <label>
            <span>답</span>
            <textarea
              rows={3}
              value={form.answer}
              onChange={(e) => setForm((f) => ({ ...f, answer: e.target.value }))}
            />
          </label>
          <small className="card-note">
            부서가 적어 주신 말과 다시 쓰신 문장을 그대로 넣어 뒀습니다. 문장은 다듬어 주세요 —
            여기서 자동으로 고쳐 쓰지 않습니다.
          </small>
          <div className="row">
            <button type="button" className="btn-primary btn-sm" disabled={busy} onClick={add}>
              {busy ? '올리는 중…' : '자주 묻는 것에 올리기'}
            </button>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setOpen(false)}>
              그만두기
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="faq-draft-q">{draft.question}</p>
          <p className="faq-draft-a">{draft.answer}</p>
          <div className="row">
            <button type="button" className="btn-ghost btn-sm" onClick={() => setOpen(true)}>
              다듬어서 올리기
            </button>
            <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => dismiss()}>
              안 올립니다
            </button>
          </div>
        </>
      )}
    </div>
  )
}
