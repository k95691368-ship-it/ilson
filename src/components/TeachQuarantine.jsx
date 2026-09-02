import { useState } from 'react'
import { api } from '../api/client.js'
import { useToast } from '../context/ToastContext.jsx'
import { groupQuarantine, affectedRows, catalog } from '../../shared/teach.js'
import { QUARANTINE_REASONS } from '../../shared/pipeline.js'
import { num } from '../lib/format.js'
import Field from './Field.jsx'

// 밀려난 줄을 부서가 되돌려 알려준다.
//
// 처리 못 한 줄을 보여 주기는 했다. 그런데 보여 주기만 하고 고칠 길이
// 없었다. 부서는 그 줄이 뭔지 아는데 — 매일 그 일을 하니까 — 말할 데가
// 없어서 결국 그 줄만 따로 손으로 처리한다. 자동화한 보람이 반으로 준다.
//
// 아무 줄에나 "알려주기"를 달지 않는다. 알려줘도 안 풀리는 것을 알려주게
// 하면, 부서는 그 뒤로 아무것도 안 알려준다.
export default function TeachQuarantine({ slug, quarantine, onTaught }) {
  if (!quarantine || quarantine.length === 0) return null
  const groups = groupQuarantine(quarantine, QUARANTINE_REASONS)

  return (
    <section className="card teach">
      <div className="card-head">
        <h2 className="card-title">밀려난 줄 {num(quarantine.length)}개</h2>
      </div>

      <div className="teach-groups">
        {groups.map((g) => (
          <article key={g.reason} className={`teach-group kind-${g.kind}`}>
            <div className="teach-group-head">
              <span className="badge badge-neutral">{g.label}</span>
              <strong>{num(g.count)}줄</strong>
              {g.codes.length > 0 && (
                <span className="card-note">
                  코드 {g.codes.length}종
                  {/* 스무 줄에 걸쳐 있어도 알려줄 것은 한 번이다.
                      그걸 앞에 적어 줘야 부서가 엄두를 낸다. */}
                  {g.count > g.codes.length && ` — ${g.codes.length}번만 알려주시면 됩니다`}
                </span>
              )}
            </div>

            <div className="teach-group-title">{g.title}</div>
            <p className="teach-group-body">{g.body}</p>

            {g.kind === 'teach' && (
              <ul className="teach-codes">
                {g.codes.map((code) => (
                  <TeachOne
                    key={code}
                    slug={slug}
                    code={code}
                    rows={affectedRows(quarantine, code)}
                    sample={quarantine.find((q) => q.externalCode === code)}
                    onTaught={onTaught}
                  />
                ))}
              </ul>
            )}

            {g.kind !== 'teach' && g.rows.length > 0 && (
              <details className="teach-rows">
                <summary>어느 줄인지 보기</summary>
                <ul>
                  {g.rows.slice(0, 12).map((r, i) => (
                    <li key={i}>
                      <span className="card-note">
                        {r.source?.file}
                        {r.source?.sheet ? ` · ${r.source.sheet}` : ''} · {r.source?.rowNo}번째 줄
                      </span>
                      {r.raw && <span className="teach-raw">{r.raw.slice(0, 5).join(' | ')}</span>}
                    </li>
                  ))}
                </ul>
                {g.rows.length > 12 && (
                  <p className="card-note">앞 12줄만 보여드립니다.</p>
                )}
              </details>
            )}
          </article>
        ))}
      </div>
    </section>
  )
}

function TeachOne({ slug, code, rows, sample, onTaught }) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ canonicalCode: '', teacher: '', note: '' })
  const [fieldErrors, setFieldErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(null)

  const list = catalog()

  async function send(e) {
    e.preventDefault()
    setSaving(true)
    setFieldErrors({})
    try {
      const r = await api.post(`/tools/${slug}/teach`, {
        ...form,
        externalCode: code,
        channel: sample?.source?.channel ?? null,
        affected: rows,
      })
      setDone(r)
      setOpen(false)
      await onTaught?.()
    } catch (err) {
      if (err.fields) setFieldErrors(err.fields)
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (done) {
    return (
      <li className="teach-code done">
        <div className="row">
          <span className="badge badge-success">알려주셨습니다</span>
          <span className="mono">{code}</span>
          <span className="card-note">→ {done.productName ?? done.canonicalCode}</span>
        </div>
        <p className="card-note" style={{ marginTop: 5 }}>
          {done.already ? '이미 알고 있던 코드였습니다.' : done.next}
        </p>
      </li>
    )
  }

  return (
    <li className="teach-code">
      <div className="row">
        <span className="mono teach-code-name">{code}</span>
        <span className="card-note">
          이 코드로 {num(rows)}줄이 밀려났습니다
          {sample?.raw && ` · ${String(sample.raw.slice(0, 3).join(' | ')).slice(0, 46)}`}
        </span>
        <span className="spacer" />
        {!open && (
          <button type="button" className="btn-ghost btn-sm" onClick={() => setOpen(true)}>
            어느 상품인지 알려주기
          </button>
        )}
      </div>

      {open && (
        <form className="teach-form" onSubmit={send}>
          <Field label="어느 상품입니까" required error={fieldErrors.canonicalCode}>
            {/* 직접 적게 하지 않고 고르게 한다. 없는 코드로 이어 두면 그 줄이
                또 밀려나거나, 더 나쁘게는 엉뚱한 상품 매출로 잡힌다. */}
            <select
              value={form.canonicalCode}
              onChange={(e) => setForm((f) => ({ ...f, canonicalCode: e.target.value }))}
            >
              <option value="">골라주세요</option>
              {list.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name} ({s.code})
                </option>
              ))}
            </select>
          </Field>

          <Field label="누가 알려주십니까" required error={fieldErrors.teacher}>
            <input
              value={form.teacher}
              onChange={(e) => setForm((f) => ({ ...f, teacher: e.target.value }))}
              placeholder="정산 담당자"
              maxLength={60}
            />
          </Field>

          <div className="row">
            <button type="submit" className="btn-primary btn-sm" disabled={saving}>
              {saving ? '보내는 중…' : `알려주기 (${num(rows)}줄이 풀립니다)`}
            </button>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setOpen(false)}>
              그만두기
            </button>
          </div>
        </form>
      )}
    </li>
  )
}
