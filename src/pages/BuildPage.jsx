import { useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from 'react'
import { Link } from 'react-router-dom'
import StageHeader from '../components/StageHeader.jsx'
import { useApi } from '../hooks/useApi.js'
import { useToast } from '../context/ToastContext.jsx'
import { api } from '../api/client.ts'
import { krw, num, ms, ago } from '../lib/format.js'
import { runPipeline, QUARANTINE_REASONS } from '../../shared/pipeline.js'
import { SKUS } from '../../shared/master.js'
import { readLocalFiles } from '../lib/readFiles.js'
import { buildRunPayload } from '../../shared/buildPayload.js'
import SourceReferences, { SourceFile } from '../components/SourceReference.jsx'
import { getAccessSession, subscribeAccessSession } from '../lib/accessSession.js'
import { useActionLifetime } from '../hooks/useActionLifetime.js'

// 시연용 파일 다섯 장이 여기 박혀 있었다. 카드도 버튼도 실물 파일도 지웠다.
// 이 화면은 이제 넣은 파일만 처리한다.

export default function BuildPage() {
  const session = useSyncExternalStore(subscribeAccessSession, getAccessSession, getAccessSession)
  const { data: list } = useApi('/applications')
  const [selectedId, setSelectedId] = useState(null)
  const [, redraw] = useReducer(value => value + 1, 0)
  // The current access lifetime owns only projected calculation metadata, never
  // file buffers/raw cells. Switching applications can restore an uncertain run.
  const pendingRuns = useMemo(() => ({ session, records: new Map() }), [session])
  const hasUnconfirmed = [...pendingRuns.records.values()].some(record => !record.receipt)
  useEffect(() => {
    if (!hasUnconfirmed) return
    const warn = event => {
      if (pendingRuns.session !== getAccessSession()) return
      event.preventDefault(); event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [hasUnconfirmed, pendingRuns])

  const targets = useMemo(
    () => (list?.items ?? []).filter((a) => ['수용', '진행중', '완료'].includes(a.status)),
    [list]
  )

  useEffect(() => {
    if (!selectedId && targets.length > 0) setSelectedId(targets[0].id)
  }, [targets, selectedId])

  return (
    <div className="stack">
      <StageHeader stageKey="build" />

      {targets.length === 0 ? (
        <div className="empty">
          <div className="empty-title">만들 과제가 없습니다</div>
          <div className="empty-sub">2단계에서 수용한 신청서가 여기로 넘어옵니다.</div>
        </div>
      ) : (
        <>
          <div className="chip-row">
            {targets.map((a) => (
              <button
                key={a.id}
                type="button"
                className={`chip${selectedId === a.id ? ' on' : ''}`}
                aria-pressed={selectedId === a.id}
                onClick={() => setSelectedId(a.id)}
              >
                {a.dept} · {a.title.slice(0, 22)}
                {a.title.length > 22 && '…'}
              </button>
            ))}
          </div>
          {selectedId && <Build key={selectedId} id={selectedId} session={session} pendingRuns={pendingRuns} redrawParent={redraw} />}
        </>
      )}
    </div>
  )
}

function freezeBuildPayload(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeBuildPayload(child)
    Object.freeze(value)
  }
  return value
}

function isBuildRunReceipt(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && value.ok === true
    && typeof value.run_id === 'string' && /^run_[a-f0-9]{20}$/.test(value.run_id)
    && Number.isSafeInteger(value.seq) && value.seq > 0)
}

const BUILD_RUN_RETRY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

function Build({ id, session, pendingRuns, redrawParent }) {
  const { data, error, errorStatus, loading, reload } = useApi(`/applications/${id}/build?rows=1`)
  const toast = useToast()
  const [, redraw] = useReducer(value => value + 1, 0)
  const view = useMemo(() => ({ id, session, pendingRuns, running: false, saving: false, progress: '', denied: '' }), [id, session, pendingRuns])
  const capture = useActionLifetime(view)
  const [selectedRow, setSelectedRow] = useState(null)
  const fileInput = useRef(null)
  const deniedRead = [401, 403, 404, 410].includes(errorStatus)
  if (deniedRead) view.denied = error || '접근 권한과 저장 이력을 다시 확인해주세요.'
  const current = active => active() && getAccessSession() === view.session
    && view.pendingRuns.session === view.session && view.session.status === 'active' && !view.denied
  const record = view.pendingRuns.records.get(view.id)
  const setRecord = next => {
    if (next) view.pendingRuns.records.set(view.id, next)
    else view.pendingRuns.records.delete(view.id)
    redrawParent()
  }
  useEffect(() => {
    if (deniedRead && pendingRuns.records.delete(id)) redrawParent()
  }, [deniedRead, pendingRuns, id, redrawParent])

  // 사람이 알려 준 상품코드를 합치기 규칙에 넘긴다.
  // 이게 "한 번 알려 주면 다음부터 자동"의 실체다.
  const aliasMap = useMemo(
    () => Object.fromEntries((data?.aliases ?? []).map((a) => [a.external_code, a.canonical_code])),
    [data]
  )

  async function saveRun(recordToSave, active = capture()) {
    if (!current(active) || view.saving || view.denied || recordToSave.receipt
      || view.pendingRuns.records.get(view.id)?.payload !== recordToSave.payload) return
    // The body intent, not the client's 30-minute transport key, identifies this
    // run. Do not replay past the server receipt window or after clock reversal.
    // This conservative browser-clock guard is not permanent exactly-once storage.
    const age = Date.now() - recordToSave.createdAt
    if (recordToSave.retryBlocked || !Number.isFinite(age) || age < 0 || age >= BUILD_RUN_RETRY_WINDOW_MS) {
      setRecord({ ...recordToSave, retryBlocked: true, error: '재시도 확인 기간이 지났거나 브라우저 시간이 바뀌었습니다. 저장 이력을 확인해주세요.', status: 0 })
      return
    }
    view.saving = true
    setRecord({ ...recordToSave, error: '', status: 0 })
    redraw()
    try {
      const receipt = await api.post(`/applications/${view.id}/build`, recordToSave.payload, { validateResponse: isBuildRunReceipt })
      if (!current(active)) return
      setRecord({ ...recordToSave, receipt, error: '', status: 0 })
      toast.success('제작 실행 기록을 저장했습니다.')
      setSelectedRow(null)
    } catch (err) {
      if (!current(active)) return
      if ([401, 403, 404, 410].includes(err.status)) {
        setRecord(null)
        view.denied = err.message || '접근 권한과 저장 이력을 다시 확인해주세요.'
      } else setRecord({ ...recordToSave, error: err.message, status: err.status, code: err.code })
      toast.error(err.message)
      return
    } finally {
      view.saving = false
      if (current(active)) redraw()
    }
    // The receipt is final even when its follow-up GET fails.
    if (current(active)) await reload()
  }

  async function runUploaded(fileList) {
    const active = capture()
    if (!current(active) || view.running || view.saving || view.denied || error || !data
      || (view.pendingRuns.records.get(view.id) && !view.pendingRuns.records.get(view.id).receipt)) return
    const picked = Array.from(fileList ?? [])
    if (!picked.length) return
    view.running = true
    view.progress = '파일을 읽는 중…'
    redraw()
    try {
      const files = await readLocalFiles(picked)
      if (!current(active)) return
      if (files.length === 0) return
      view.progress = '계산하는 중…'; redraw()
      const result = await runPipeline({ files, aliases: aliasMap })
      if (!current(active)) return
      const payload = freezeBuildPayload({ ...buildRunPayload(result), run_id: crypto.randomUUID(), run_scope: view.session.scope })
      const next = { payload, createdAt: Date.now(), fileCount: picked.length, receipt: null, error: '', status: 0 }
      setRecord(next)
      view.progress = '결과를 기록하는 중…'; redraw()
      await saveRun(next, active)
    } catch (error) { if (current(active)) toast.error(error.message) }
    finally { view.running = false; view.progress = ''; if (current(active)) redraw() }
  }

  if (loading && !data) return <div className="page-loading">불러오는 중…</div>
  if (view.denied) return <div className="notice notice-danger" role="alert"><p>{view.denied}</p><p>계산 결과를 숨겼습니다. 권한과 저장 이력을 다시 확인해주세요.</p></div>
  if (error && !data) return <div className="notice notice-danger">{error}</div>
  if (!data) return null

  const latest = data.runs[0] ?? null

  return (
    <div className="stack">
      {error && <div className="notice notice-warn" role="status">
        <p>{error} 기존 기록을 표시하고 있습니다. 확인된 저장 결과는 유지됩니다.</p>
        <button type="button" className="btn-ghost btn-sm" disabled={loading} onClick={reload}>최신 제작 기록 다시 읽기</button>
      </div>}
      <section className="card">
        <div className="card-head">
          <h2 className="card-title">파일을 넣으면 합칩니다</h2>
          <span className="badge badge-success">계산은 이 브라우저에서 돕니다</span>
        </div>

        <div className="row" style={{ marginTop: 12 }}>
          <input
            ref={fileInput}
            type="file"
            multiple
            className="sr-only"
            aria-label="합칠 파일 선택"
            accept=".csv,.xlsx,.xls,.txt"
            onChange={(e) => {
              runUploaded(e.target.files)
              e.target.value = ''
            }}
          />
          <button
            type="button"
            className="btn-primary"
            onClick={() => fileInput.current?.click()}
            disabled={view.running || view.saving || Boolean(record && !record.receipt) || Boolean(error) || session.status !== 'active'}
          >
            {view.running ? view.progress || '돌리는 중…' : '파일 넣기'}
          </button>
          {data.aliases.length > 0 && (
            <span className="card-note">
              현재 조회한 상품코드 {data.aliases.length}개로 계산합니다
            </span>
          )}
        </div>
      </section>

      {record && <section className="card" aria-label="이번 계산의 저장 상태">
        <h2 className="card-title">{record.receipt ? '실행 기록 저장 확인' : '계산 결과 · 저장 확인 전'}</h2>
        <p>입력 파일 {num(record.fileCount)}개 · 결과 {num(record.payload.rows.length)}줄 · 검토함 {num(record.payload.quarantine.length)}줄 · 계산 {ms(record.payload.duration_ms)}</p>
        {record.receipt ? <p role="status">{record.receipt.seq}차 실행 · 기록 {record.receipt.run_id}</p>
          : <p className="card-note">이 계산 결과를 그대로 다시 저장합니다. 파일을 다시 읽거나 계산하지 않습니다. 이 화면을 벗어나거나 새로고침하면 보관 중인 결과가 사라집니다.</p>}
        <SourceReferences files={record.payload.files} localOnly={!record.receipt} />
        <details className="disclose"><summary>계산 결과 미리보기</summary>
          <div className="table-wrap"><table className="data-table"><caption className="sr-only">저장할 정산 계산 결과</caption>
            <thead><tr><th scope="col">상품</th><th scope="col">순매출</th><th scope="col">원본</th></tr></thead>
            <tbody>{record.payload.rows.slice(0, 20).map((row, index) => <tr key={index}><td>{row.sku_name || row.sku}</td><td>{krw(row.net_revenue_krw)}</td><td><SourceFile source={row.source} /> · {row.source.sheet || '시트 없음'} · {row.source.rowNo}번째 줄</td></tr>)}</tbody>
          </table></div><p className="card-note">처음 20줄만 표시합니다. 전체 계산 결과와 원본 참조는 동일한 저장 요청에 보관되어 있습니다.</p>
        </details>
        {record.error && <div className="notice notice-warn" role="alert"><p>{record.error}</p>
          {record.status === 413 && <p>한 번에 저장할 수 있는 범위를 넘었습니다. 파일을 나누어 계산해주세요. 결과를 자동으로 잘라 저장하지 않습니다.</p>}
          {record.status === 409 && <p>실행 내용이나 저장 상태가 충돌했습니다. 저장 이력을 확인한 뒤 같은 계산으로 재시도할 수 있습니다. 새 실행 번호를 자동으로 만들지 않습니다.</p>}
        </div>}
        {!record.receipt && <><div className="row">
          <button type="button" className="btn-primary" disabled={view.saving || view.running || record.status === 413 || record.retryBlocked} onClick={() => saveRun(record)}>{view.saving ? '저장 확인 중…' : '같은 계산 결과 저장 다시 시도'}</button>
          <button type="button" className="btn-ghost" disabled={loading || view.saving || view.running} onClick={reload}>저장 이력 다시 확인</button>
        </div>
          <details className="disclose"><summary>이 결과 대신 새로 계산하기</summary>
            <p>미확인 결과가 이미 저장됐을 수 있고 새 실행은 중복될 수 있습니다. 보관을 끝내도 서버 저장이 취소되거나 삭제되지 않습니다.</p>
            <button type="button" className="btn-ghost" disabled={view.saving || view.running} onClick={() => setRecord(null)}>현재 결과 보관을 끝내고 새 파일 선택</button>
          </details>
        </>}
      </section>}

      {latest && (
        <>
          <SourceReferences files={latest.files} localOnly={false} />
          <section className="stat-row">
            <Tile label="합친 줄" value={num(latest.rows_out)} note={`${data.runs.length}번째 실행`} />
            <Tile
              label="검토함"
              value={num(latest.quarantined)}
              note="버리지 않고 사람이 본다"
              tone={latest.quarantined > 0 ? 'warn' : undefined}
            />
            <Tile
              label="걸린 시간"
              value={ms(latest.duration_ms)}
              note="브라우저에서 계산"
            />
            <Tile
              label="바깥에 물어본 횟수"
              value="0"
              note="AI도 외부 서비스도 부르지 않음"
            />
            {latest.totals?.all && (
              <Tile
                label="기여이익"
                value={krw(latest.totals.all.contribution_krw)}
                note={`순매출 ${krw(latest.totals.all.net_revenue_krw)}`}
              />
            )}
          </section>

          {latest.totals?.byChannel && (
            <section className="card">
              <div className="card-head">
                <h3 className="card-title">채널별</h3>
              </div>
              <div className="table-wrap">
                <table className="data-table">
                  <caption className="sr-only">제작 결과의 채널별 집계</caption>
                  <thead>
                    <tr>
                      <th scope="col">채널</th>
                      <th scope="col" className="num">줄</th>
                      <th scope="col" className="num">수량</th>
                      <th scope="col" className="num">순매출</th>
                      <th scope="col" className="num">수수료</th>
                      <th scope="col" className="num">정산서상 수수료</th>
                      <th scope="col" className="num">기여이익</th>
                    </tr>
                  </thead>
                  <tbody>
                    {latest.totals.byChannel.map((t) => {
                      const gap = t.reported_commission_krw
                        ? t.reported_commission_krw - t.commission_krw
                        : null
                      return (
                        <tr key={t.channel}>
                          <td>{t.channel}</td>
                          <td className="num">{num(t.rows)}</td>
                          <td className="num">{num(t.qty)}</td>
                          <td className="num">{krw(t.net_revenue_krw)}</td>
                          <td className="num">{krw(t.commission_krw)}</td>
                          <td className="num">
                            {t.reported_commission_krw ? krw(t.reported_commission_krw) : '—'}
                            {gap != null && Math.abs(gap) > 1000 && (
                              <span
                                className={`badge ${gap > 0 ? 'badge-danger' : 'badge-neutral'}`}
                                style={{ marginLeft: 6 }}
                              >
                                {gap > 0 ? '+' : ''}
                                {krw(gap)}
                              </span>
                            )}
                          </td>
                          <td className="num">{krw(t.contribution_krw)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <Quarantine data={data} id={id} onDone={reload} toast={toast} />

          <section className="card">
            <div className="card-head">
              <h3 className="card-title">합친 결과</h3>
            </div>
            <div className="grid-side">
              <div className="table-wrap" style={{ maxHeight: 460 }}>
                <table className="data-table">
                  <caption className="sr-only">합친 정산 결과와 원본 추적 정보</caption>
                  <thead>
                    <tr>
                      <th scope="col">날짜</th>
                      <th scope="col">채널</th>
                      <th scope="col">상품</th>
                      <th scope="col" className="num">수량</th>
                      <th scope="col" className="num">순매출</th>
                      <th scope="col" className="num">기여이익</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.slice(0, 120).map((r) => (
                      /* 줄을 눌러야 원본을 되짚는데, 누를 수 있다는 표시가
                         커서 모양뿐이었고 키보드로는 아예 못 열었다. 이
                         사이트가 내내 자랑하는 기능이 마우스 쓰는 사람만
                         쓸 수 있었던 것이다.
                         줄 전체를 누르는 편이 손이 덜 가니 그건 남기고,
                         초점을 받아 엔터·스페이스로도 열리게 한다. */
                      <tr
                        key={r.id}
                        className={`clickable${selectedRow?.id === r.id ? ' selected' : ''}`}
                        tabIndex={0}
                        aria-label={`${r.date} ${r.channel} ${r.sku_name} — 이 줄이 어디서 왔는지 보기`}
                        onClick={() => setSelectedRow(r)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            setSelectedRow(r)
                          }
                        }}
                      >
                        <td>{r.date}</td>
                        <td>{r.channel}</td>
                        <td>
                          {r.sku_name}
                          {r.return_qty > 0 && (
                            <span className="badge badge-warning" style={{ marginLeft: 5 }}>
                              반품
                            </span>
                          )}
                          {r.has_duplicate === 1 && (
                            <span className="badge badge-neutral" style={{ marginLeft: 5 }}>
                              같은 줄 있음
                            </span>
                          )}
                        </td>
                        <td className="num">{num(r.qty)}</td>
                        <td className="num">{krw(r.net_revenue_krw)}</td>
                        <td className="num">{krw(r.contribution_krw)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <Lineage row={selectedRow} />
            </div>
            {data.rows.length > 120 && (
              <p className="card-note" style={{ marginTop: 8 }}>
                전체 {num(data.rows.length)}줄 중 처음 120줄만 보여주고 있습니다.
              </p>
            )}
          </section>

          <section className="card">
            <h2 className="card-title">실행 기록</h2>
            <div className="table-wrap" style={{ marginTop: 8 }}>
              <table className="data-table">
                <caption className="sr-only">정산 도구 실행 기록</caption>
                <thead>
                  <tr>
                    <th scope="col">회차</th>
                    <th scope="col" className="num">합친 줄</th>
                    <th scope="col" className="num">검토함</th>
                    <th scope="col" className="num">걸린 시간</th>
                    <th scope="col">언제</th>
                  </tr>
                </thead>
                <tbody>
                  {data.runs.map((r) => (
                    <tr key={r.id}>
                      <td>{r.seq}</td>
                      <td className="num">{num(r.rows_out)}</td>
                      <td className="num">{num(r.quarantined)}</td>
                      <td className="num">{ms(r.duration_ms)}</td>
                      <td>{ago(r.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  )
}

// ── 검토함 ──────────────────────────────────────────────────
const EMPTY_TEACHING = { canonicalCode: '', saving: false, done: null, error: '', fields: {}, conflict: false }

function isBuildAliasResult(value, command) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.ok !== true
    || value.external_code !== command.external_code.trim() || value.canonical_code !== command.canonical_code
    || typeof value.already !== 'boolean'
    || (value.product_name !== undefined && (typeof value.product_name !== 'string' || !value.product_name.trim()))
    || (value.teacher !== undefined && typeof value.teacher !== 'string')) return false
  // A legacy no-op can lack a name/author; a newly written lesson cannot.
  return value.already || (typeof value.product_name === 'string' && typeof value.teacher === 'string' && Boolean(value.teacher.trim()))
}

function Quarantine({ data, id, onDone, toast }) {
  const session = useSyncExternalStore(subscribeAccessSession, getAccessSession, getAccessSession)
  const [, redraw] = useReducer(value => value + 1, 0)
  const lifetime = useRef(null)
  const runId = data.runs[0]?.id
  // Reloading the same run retains confirmed lessons. A new run, application or
  // access lifetime cannot inherit drafts/completions or a late old response.
  if (!lifetime.current || lifetime.current.id !== id || lifetime.current.runId !== runId || lifetime.current.session !== session) {
    lifetime.current = { id, runId, session, states: new Map() }
  }
  const view = lifetime.current
  view.data = data
  const capture = useActionLifetime(view)
  const current = () => lifetime.current === view && getAccessSession() === session && session.status === 'active'
  const update = (code, change) => {
    if (!current()) return
    view.states.set(code, { ...(view.states.get(code) ?? EMPTY_TEACHING), ...change })
    redraw()
  }

  async function teach(q) {
    if (!current()) return
    const state = view.states.get(q.external_code) ?? EMPTY_TEACHING
    if (state.saving || state.done || !state.canonicalCode) return
    const active = capture()
    const command = { kind: 'alias', external_code: q.external_code, canonical_code: state.canonicalCode }
    // The synchronous Map lock also covers two clicks before React re-renders.
    update(q.external_code, { saving: true, error: '', fields: {}, conflict: false })
    try {
      const result = await api.post(`/applications/${id}/build`, command, { validateResponse: value => isBuildAliasResult(value, command) })
      if (!active() || !current()) return
      update(q.external_code, { saving: false, done: result, confirmedFrom: view.data })
      toast.success(result.already ? '같은 상품으로 저장된 기록을 확인했습니다.' : '상품 연결을 저장했습니다.')
    } catch (error) {
      if (!active() || !current()) return
      update(q.external_code, { saving: false, error: error.message, fields: error.fields ?? {}, conflict: error.code === 'CODE_BUILD_ALIAS_CONFLICT' })
      toast.error(error.message)
      return
    }
    // A later read failure must not turn a confirmed write into a retryable one.
    // useApi keeps data only for transient errors; permission denials remove it.
    try { await onDone() } catch {
      if (!active() || !current()) return
      update(q.external_code, { error: '상품 연결은 저장됐지만 최신 제작 기록을 불러오지 못했습니다.' })
    }
  }

  const groups = useMemo(() => {
    const m = new Map()
    for (const q of data.quarantine) {
      if (!m.has(q.reason)) m.set(q.reason, [])
      m.get(q.reason).push(q)
    }
    return [...m.entries()]
  }, [data.quarantine])

  if (data.quarantine.length === 0) return null

  // 모르는 상품코드는 코드별로 묶는다. 같은 코드가 열 줄이면 열 번 물을 이유가 없다.
  const unknownByCode = new Map()
  for (const q of data.quarantine) {
    if (q.reason !== 'unknown_sku' || !q.external_code) continue
    if (!unknownByCode.has(q.external_code)) {
      unknownByCode.set(q.external_code, { ...q, count: 0 })
    }
    unknownByCode.get(q.external_code).count += 1
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2 className="card-title">처리하지 못한 줄 {num(data.quarantine.length)}개</h2>
      </div>

      {unknownByCode.size > 0 && (
        <>
          <h3>상품 연결은 다음 실행부터 적용됩니다</h3>
          <div className="stack-sm" style={{ marginBottom: 16 }}>
            {[...unknownByCode.values()].map((q) => {
              const state = view.states.get(q.external_code) ?? EMPTY_TEACHING
              const selectedSku = SKUS.find(sku => sku.canonical_code === state.canonicalCode)
              // A replayed receipt proves the earlier write, not today's mapping.
              // Only a fresh read after confirmation describes the current alias.
              const refreshed = state.done && data !== state.confirmedFrom
              const currentAlias = refreshed ? data.aliases.find(alias => alias.external_code === state.done.external_code) : null
              const changed = refreshed && currentAlias?.canonical_code !== state.done.canonical_code
              return (
              <div key={q.external_code} className="teach-row">
                <div className="teach-info">
                  <code>{q.external_code}</code>
                  <strong>{q.product_name || '(상품명 없음)'}</strong>
                  <span className="card-note">예: <SourceFile source={storedSource(q)} /> · 전체 {q.count}줄</span>
                </div>
                {state.done ? <div className="teach-info" role="status">
                  <strong>{state.done.already ? '같은 상품으로 저장된 기록을 확인했습니다.' : '상품 연결을 저장했습니다.'}</strong>
                  <span>저장 당시: {state.done.product_name ?? selectedSku?.name_ko ?? state.done.canonical_code} ({state.done.canonical_code})</span>
                  {!refreshed ? <p className="card-note">최신 연결 확인 전입니다. 저장 당시 기록이며 현재 연결을 보증하지 않습니다.</p>
                    : currentAlias ? <p className="card-note">현재 조회: {SKUS.find(sku => sku.canonical_code === currentAlias.canonical_code)?.name_ko ?? currentAlias.canonical_code} ({currentAlias.canonical_code})</p>
                      : <p className="card-note">현재 조회에서 이 코드의 연결을 확인하지 못했습니다.</p>}
                  {changed && <p className="card-note">저장 당시와 현재 조회 결과가 다릅니다. <Link to="/codes">기존 코드 확인·정정</Link></p>}
                  <p className="card-note">연결을 다시 조회한 뒤 새로 실행하면 반영됩니다. 현재 결과는 바뀌지 않고 다른 오류가 있는 줄은 계속 격리됩니다.</p>
                  {state.done.teacher && <p className="card-note">기록된 작성자: {state.done.teacher}</p>}
                </div> : <><select
                  value={state.canonicalCode}
                  aria-label={`${q.external_code}에 해당하는 상품`}
                  disabled={state.saving || session.status !== 'active'}
                  aria-invalid={Boolean(state.fields.canonical_code)}
                  onChange={event => update(q.external_code, { canonicalCode: event.target.value, error: '', fields: {}, conflict: false })}
                >
                  <option value="">어느 상품인가요</option>
                  {SKUS.map((s) => (
                    <option key={s.canonical_code} value={s.canonical_code}>
                      {s.name_ko} ({s.canonical_code})
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  disabled={!state.canonicalCode || state.saving || session.status !== 'active'}
                  onClick={() => teach(q)}
                >
                  {state.saving ? '저장 중…' : '기억시키기'}
                </button></>}
                {state.error && <div role="alert" className="card-note">
                  <p>{state.error}</p>
                  {[...new Set(Object.values(state.fields).filter(value => typeof value === 'string' && value.trim()))].map(message => <p key={message}>{message}</p>)}
                  {state.conflict && <Link to="/codes">기존 코드 확인·정정</Link>}
                </div>}
              </div>
            )})}
          </div>
        </>
      )}

      <div className="stack-sm">
        {groups.map(([reason, items]) => (
          <details key={reason} className="disclose">
            <summary>
              {QUARANTINE_REASONS[reason] ?? reason} — {num(items.length)}줄
            </summary>
            <div className="disclose-body">
              {items[0].note && <p className="card-note">{items[0].note}</p>}
              <div className="table-wrap" style={{ maxHeight: 220 }}>
                <table className="data-table">
                  <caption className="sr-only">격리 사유별 원본 줄</caption>
                  <thead>
                    <tr>
                      <th scope="col">파일</th>
                      <th scope="col">시트</th>
                      <th scope="col" className="num">줄</th>
                      <th scope="col">내용</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.slice(0, 40).map((q) => (
                      <tr key={q.id}>
                        <td><SourceFile source={storedSource(q)} /></td>
                        <td>{q.source_sheet || '—'}</td>
                        <td className="num">{q.source_row_no > 0 ? q.source_row_no : '파일 전체'}</td>
                        <td className="mono">{q.raw?.length ? q.raw.slice(0, 6).join(' | ') : '원본 파일에서 확인'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </details>
        ))}
      </div>
    </section>
  )
}

// ── 되짚기 ──────────────────────────────────────────────────
function Lineage({ row }) {
  if (!row) {
    return (
      <div className="card-flat">
        <div className="card-note">
          왼쪽 표에서 한 줄을 누르면, 그 숫자가 원본 파일의 몇 번째 줄에서 왔고 어떤 단계를 거쳐
          이 값이 됐는지 여기 나옵니다.
        </div>
      </div>
    )
  }

  return (
    <div className="card-flat lineage">
      <h3 className="card-title">이 숫자가 온 길</h3>

      <div className="lineage-source">
        <div className="card-note">원본</div>
        <strong><SourceFile source={storedSource(row)} /></strong>
        {row.source_sha256 ? <details><summary>원본 지문 보기</summary><code>{row.source_sha256}</code></details> : <p className="card-note">이전 기록에는 원본 지문이 없어 동명 파일의 내용을 구별할 수 없습니다.</p>}
        <div className="card-note">
          {row.source_sheet ? `${row.source_sheet} 시트 · ` : ''}
          {row.source_row_no}번째 줄
        </div>
      </div>

      <ol className="lineage-steps">
        {(row.trace ?? []).map((t, i) => (
          <li key={i}>
            <span className="lineage-step">{t.step}</span>
            <span className="lineage-value">{t.value}</span>
          </li>
        ))}
      </ol>

      <dl className="kv" style={{ marginTop: 12 }}>
        <dt>총매출</dt>
        <dd>{krw(row.gross_krw)}</dd>
        <dt>− 할인</dt>
        <dd>{krw(row.discount_krw)}</dd>
        <dt>− 반품</dt>
        <dd>{krw(row.return_krw)}</dd>
        <dt>= 순매출</dt>
        <dd>
          <strong>{krw(row.net_revenue_krw)}</strong>
        </dd>
        <dt>− 수수료</dt>
        <dd>{krw(row.commission_krw)}</dd>
        <dt>− 원가</dt>
        <dd>{krw(row.cogs_krw)}</dd>
        <dt>− 물류</dt>
        <dd>{krw(row.logistics_krw)}</dd>
        <dt>− 광고</dt>
        <dd>{krw(row.ad_krw)}</dd>
        <dt>= 기여이익</dt>
        <dd>
          <strong>{krw(row.contribution_krw)}</strong>
        </dd>
      </dl>

      {(row.duplicate_of || row.duplicate_source) && (
        <div className="notice notice-warn" style={{ marginTop: 10 }}>
          {row.duplicate_source
            ? <p><SourceFile source={row.duplicate_source} />{row.duplicate_source.sheet ? ` · ${row.duplicate_source.sheet}` : ''} · {row.duplicate_source.rowNo}번째 줄과 내용이 같습니다. 별도 주문일 수 있어 삭제하지 않았습니다.</p>
            : <p>{row.duplicate_of} 줄과 내용이 같습니다. 별도 주문일 수 있어 삭제하지 않았습니다.</p>}
          {row.duplicate_source?.sha256
            ? <details><summary>중복 의심 원본 지문 보기</summary><code>{row.duplicate_source.sha256}</code></details>
            : <p className="card-note">이전 기록에는 중복 의심 원본의 지문이 없습니다.</p>}
        </div>
      )}
    </div>
  )
}

function storedSource(row) {
  return { file: row.source_file, sha256: row.source_sha256, ambiguousName: row.source_ambiguous_name }
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
      <div className="stat-note">{note}</div>
    </div>
  )
}
