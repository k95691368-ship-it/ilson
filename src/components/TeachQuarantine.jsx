import { useMemo, useReducer, useRef, useSyncExternalStore } from 'react'
import { api } from '../api/client.ts'
import { useToast } from '../context/ToastContext.jsx'
import { groupQuarantine, catalog } from '../../shared/teach.js'
import { QUARANTINE_REASONS } from '../../shared/pipeline.js'
import { num } from '../lib/format.js'
import { indexTeachQuarantine } from '../lib/teachQuarantine.js'
import { getAccessSession, subscribeAccessSession } from '../lib/accessSession.js'
import { useActionLifetime } from '../hooks/useActionLifetime.js'
import Field from './Field.jsx'
import { SourceFile } from './SourceReference.jsx'

const PAGE_SIZE = 20
const CATALOG = catalog()
const EMPTY_STATE = { open: false, form: { canonicalCode: '', teacher: '', note: '' }, fieldErrors: {}, saving: false, done: null, refreshError: '' }

function readTeachingResult(value, canonicalCode) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.ok !== true
    || value.canonicalCode !== canonicalCode || typeof value.already !== 'boolean'
    || (value.productName !== undefined && typeof value.productName !== 'string')
    || (value.next !== undefined && typeof value.next !== 'string')) {
    throw new Error('저장 응답을 확인하지 못했습니다. 같은 내용으로 다시 시도해주세요.')
  }
  return { canonicalCode: value.canonicalCode, already: value.already, productName: value.productName, next: value.next }
}

// 밀려난 줄을 부서가 되돌려 알려준다.
//
// 처리 못 한 줄을 보여 주기는 했다. 그런데 보여 주기만 하고 고칠 길이
// 없었다. 부서는 그 줄이 뭔지 아는데 — 매일 그 일을 하니까 — 말할 데가
// 없어서 결국 그 줄만 따로 손으로 처리한다. 자동화한 보람이 반으로 준다.
//
// 아무 줄에나 "알려주기"를 달지 않는다. 알려줘도 안 풀리는 것을 알려주게
// 하면, 부서는 그 뒤로 아무것도 안 알려준다.
export default function TeachQuarantine({ slug, quarantine, onTaught }) {
  const session = useSyncExternalStore(subscribeAccessSession, getAccessSession, getAccessSession)
  const toast = useToast()
  const [, redraw] = useReducer(value => value + 1, 0)
  const lifetime = useRef(null)
  // Paging unmounts individual forms, not their calculation-local state.
  // A new result/tool/access lifetime discards every old form synchronously.
  if (!lifetime.current || lifetime.current.quarantine !== quarantine || lifetime.current.slug !== slug || lifetime.current.session !== session) {
    lifetime.current = { quarantine, slug, session, page: 0, query: '', states: new Map() }
  }
  const view = lifetime.current
  const capture = useActionLifetime(view)
  const { groups, byCode } = useMemo(() => ({
    groups: groupQuarantine(quarantine, QUARANTINE_REASONS),
    byCode: indexTeachQuarantine(quarantine),
  }), [quarantine])
  // Search only the already sorted code list, never the original rows. Code
  // identity stays exact; only the search term has surrounding whitespace removed.
  const visibleGroups = useMemo(() => {
    const query = view.query.trim()
    return groups.map(group => ({ ...group, visibleCodes: group.kind === 'teach' && query
      ? group.codes.filter(code => String(code).includes(query)) : group.codes }))
  }, [groups, view.query])
  const current = () => lifetime.current === view && getAccessSession() === session && session.status === 'active'
  const update = (code, change) => {
    if (!current()) return
    view.states.set(code, { ...(view.states.get(code) ?? EMPTY_STATE), ...change })
    redraw()
  }
  async function send(code, event) {
    event.preventDefault()
    if (!current()) return
    const state = view.states.get(code) ?? EMPTY_STATE
    if (state.saving || state.done) return
    const active = capture()
    const entry = byCode.get(code)
    const payload = { ...state.form, externalCode: code, channel: entry?.sample?.source?.channel ?? null, affected: entry?.affected ?? 0 }
    // Set the Map synchronously, before React renders or hashing/fetch starts.
    update(code, { saving: true, fieldErrors: {} })
    try {
      const response = await api.post(`/tools/${encodeURIComponent(slug)}/teach`, payload)
      if (!active() || !current()) return
      const done = readTeachingResult(response, payload.canonicalCode)
      update(code, { done, open: false, saving: false })
    } catch (error) {
      if (!active() || !current()) return
      update(code, { saving: false, fieldErrors: error.fields ?? {} })
      toast.error(error.message)
      return
    }
    // A failed refresh is not a failed write. Keep the completed state visible.
    try { await onTaught?.() } catch {
      if (!active() || !current()) return
      const message = '알려주신 내용은 저장됐지만 최신 상태를 다시 불러오지 못했습니다.'
      update(code, { refreshError: message })
      toast.error(message)
    }
  }
  if (session.status !== 'active') return null
  if (!quarantine || quarantine.length === 0) return null

  return (
    <section className="card teach">
      <div className="card-head">
        <h2 className="card-title">밀려난 줄 {num(quarantine.length)}개</h2>
      </div>

      <div className="teach-groups">
        {visibleGroups.map((g) => (
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
              <>
              {g.codes.length > PAGE_SIZE && <Field label="코드 찾기" hint="대소문자 구분 · 검색어 앞뒤 공백 제외">
                <input type="search" value={view.query} placeholder="코드 일부 입력" autoComplete="off"
                  onChange={event => { if (current()) { view.query = event.target.value; view.page = 0; redraw() } }} />
              </Field>}
              {g.codes.length > PAGE_SIZE && <p className="card-note">전체 코드 {num(g.codes.length)}종 · 일치 {num(g.visibleCodes.length)}종</p>}
              {g.visibleCodes.length === 0 && <p className="card-note" role="status">검색 조건에 맞는 코드가 없습니다.</p>}
              <ul className="teach-codes">
                {g.visibleCodes.slice(view.page * PAGE_SIZE, (view.page + 1) * PAGE_SIZE).map((code) => (
                  <TeachOne
                    key={code}
                    code={code}
                    rows={byCode.get(code)?.affected ?? 0}
                    sample={byCode.get(code)?.sample}
                    state={view.states.get(code) ?? EMPTY_STATE}
                    update={change => update(code, change)}
                    send={event => send(code, event)}
                  />
                ))}
              </ul>
              {g.codes.length > PAGE_SIZE && g.visibleCodes.length > 0 && <nav className="row" aria-label="격리 코드 페이지">
                <button type="button" className="btn-ghost btn-sm" disabled={view.page === 0}
                  onClick={() => { if (current()) { view.page = Math.max(0, view.page - 1); redraw() } }}>이전 코드 20개</button>
                <span className="card-note" role="status" aria-live="polite">코드 {num(view.page * PAGE_SIZE + 1)}–{num(Math.min((view.page + 1) * PAGE_SIZE, g.visibleCodes.length))} / {num(g.visibleCodes.length)}</span>
                <button type="button" className="btn-ghost btn-sm" disabled={(view.page + 1) * PAGE_SIZE >= g.visibleCodes.length}
                  onClick={() => { if (current()) { view.page = Math.min(Math.ceil(g.visibleCodes.length / PAGE_SIZE) - 1, view.page + 1); redraw() } }}>다음 코드 20개</button>
              </nav>}
              </>
            )}

            {g.kind !== 'teach' && g.rows.length > 0 && (
              <details className="teach-rows">
                <summary>어느 줄인지 보기</summary>
                <ul>
                  {g.rows.slice(0, 12).map((r, i) => (
                    <li key={i}>
                      <span className="card-note">
                        <SourceFile source={r.source} />
                        {r.source?.sheet ? ` · ${r.source.sheet}` : ''} · {r.source?.rowNo > 0 ? `${r.source.rowNo}번째 줄` : '파일 전체'}
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

function TeachOne({ code, rows, sample, state, update, send }) {
  const { open, form, fieldErrors, saving, done, refreshError } = state

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
        {refreshError && <p className="card-note" role="status">{refreshError}</p>}
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
          <button type="button" className="btn-ghost btn-sm" onClick={() => update({ open: true })}>
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
              disabled={saving}
              onChange={(e) => update({ form: { ...form, canonicalCode: e.target.value } })}
            >
              <option value="">골라주세요</option>
              {CATALOG.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name} ({s.code})
                </option>
              ))}
            </select>
          </Field>

          <Field label="누가 알려주십니까" required error={fieldErrors.teacher}>
            <input
              value={form.teacher}
              disabled={saving}
              onChange={(e) => update({ form: { ...form, teacher: e.target.value } })}
              placeholder="정산 담당자"
              maxLength={60}
            />
          </Field>

          <div className="row">
            <button type="submit" className="btn-primary btn-sm" disabled={saving}>
              {saving ? '보내는 중…' : `알려주기 (${num(rows)}줄이 풀립니다)`}
            </button>
            <button type="button" className="btn-ghost btn-sm" onClick={() => update({ open: false })}>
              그만두기
            </button>
          </div>
        </form>
      )}
    </li>
  )
}
