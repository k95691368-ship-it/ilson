import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client.ts'
import { useActionLifetime } from '../hooks/useActionLifetime.js'
import { CRITERION_BY_KEY } from '../../shared/acceptance.ts'
import { HOURLY_WAGE_KRW } from '../../shared/outcome.js'
import { dateTimeLabel, duration, krw } from '../lib/format.js'
import Field from './Field.jsx'

function editDraft(previous, current, changes) {
  const draft = previous ?? { ...current, base: current, dirty: {}, conflicts: [] }
  return { ...draft, ...changes, dirty: { ...draft.dirty, ...Object.fromEntries(Object.keys(changes).map(key => [key, true])) },
    conflicts: draft.conflicts.filter(key => !Object.hasOwn(changes, key)) }
}

function mergeDraft(draft, latest) {
  if (!draft) return null
  const next = { ...draft, version: latest.version, base: latest, conflicts: [] }
  for (const key of Object.keys(latest).filter(key => key !== 'version')) {
    if (!draft.dirty[key]) next[key] = latest[key]
    else if (draft.base[key] !== latest[key] && draft[key] !== latest[key]) next.conflicts.push(key)
  }
  return next
}

function DraftConflicts({ draft, labels, choose }) {
  if (!draft?.conflicts.length) return null
  return <div className="notice notice-danger" role="alert">
    <p>같은 항목이 다른 곳에서도 변경되었습니다. 저장할 값을 선택해주세요.</p>
    {draft.conflicts.map(key => <div className="row" key={key}>
      <strong>{labels[key]}</strong>
      <button type="button" onClick={() => choose(key, draft[key])}>입력한 값 적용 ({String(draft[key])})</button>
      <button type="button" onClick={() => choose(key, draft.base[key])}>최신 값 유지 ({String(draft.base[key])})</button>
    </div>)}
  </div>
}

// Keep the existing compact page: these controls open only when requested.
// An uncertain write is retried with the same payload, never edited into a new one.
function useEvidenceWrite(id, refresh) {
  const capture = useActionLifetime(id)
  const lock = useRef(false)
  const retry = useRef(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState(null)
  const [message, setMessage] = useState('')

  async function reload() {
    if (lock.current) return null
    lock.current = true
    setBusy(true)
    const current = capture()
    try {
      const latest = await refresh()
      if (!current()) return null
      setProblem(null)
      setMessage('최신 기록을 불러왔습니다. 입력한 내용과 비교한 뒤 저장해주세요.')
      return latest
    } catch (error) {
      if (current()) setProblem({ message: error.message, refreshOnly: true })
      return null
    } finally {
      lock.current = false
      if (current()) setBusy(false)
    }
  }

  async function save(method, body, done) {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setProblem(null)
    setMessage('')
    const current = capture()
    let committed = false
    try {
      await api[method](`/applications/${id}/agreement`, body)
      committed = true
      retry.current = null
      if (!current()) return
      done?.()
      setMessage('저장했습니다.')
      await refresh()
    } catch (error) {
      if (!current()) return
      const uncertain = !committed && (!error.status || error.status >= 500)
      retry.current = uncertain ? { method, body, done } : null
      setProblem({
        message: committed ? '저장은 완료됐지만 최신 목록을 불러오지 못했습니다.' : error.message,
        fields: error.fields ?? {}, conflict: error.status === 409,
        uncertain, refreshOnly: committed,
      })
    } finally {
      lock.current = false
      if (current()) setBusy(false)
    }
  }

  return {
    busy, problem, message, save, reload,
    locked: busy || Boolean(problem?.uncertain || problem?.conflict || problem?.refreshOnly),
    retry: () => { if (retry.current) { const r = retry.current; return save(r.method, r.body, r.done) } },
  }
}

function WriteStatus({ write, onConflictRefresh }) {
  return <>
    {write.problem && <div className="notice notice-danger" role="alert">
      <p>{Object.values(write.problem.fields ?? {}).join(' ') || write.problem.message}</p>
      {write.problem.uncertain && <>
        <p>저장 여부가 확인될 때까지 같은 기록으로 다시 요청합니다.</p>
        <button type="button" disabled={write.busy} onClick={write.retry}>같은 기록 저장 확인</button>
      </>}
      {(write.problem.conflict || write.problem.refreshOnly) && <button type="button" disabled={write.busy}
        onClick={write.problem.conflict ? onConflictRefresh : write.reload}>최신 기록 확인</button>}
    </div>}
    {write.message && <p className="card-note" role="status">{write.message}</p>}
  </>
}

export default function AgreementEvidence({ id, data, refresh }) {
  return <>
    <details className="card card-boxed">
      <summary className="card-head"><h2 className="card-title">합격 기준</h2>
        <span className="card-note">확정 {data.criteria.filter(c => c.confirmed_at).length} / {data.criteria.length}</span>
      </summary>
      <div className="stack">
        {data.criteria.map(item => <Criterion key={item.id} id={id} item={item} refresh={refresh} />)}
        <NewCriterion id={id} sourceVersion={data.criteria_source_version} refresh={refresh} />
        {data.criteria.length > 0 && <Link to={`/track?no=${encodeURIComponent(data.application.ticket_no)}`}>부서에서 기준 확인하기 →</Link>}
      </div>
    </details>
    <Baseline id={id} data={data} refresh={refresh} />
  </>
}

function NewCriterion({ id, sourceVersion, refresh }) {
  const [form, setForm] = useState({ key: '', body: '', safety: false })
  const [version, setVersion] = useState(null)
  const write = useEvidenceWrite(id, refresh)
  const preset = CRITERION_BY_KEY[form.key]
  function edit(next) { setVersion(previous => previous ?? sourceVersion); setForm(next) }
  async function latest() { const next = await write.reload(); if (next) setVersion(next.criteria_source_version) }
  return <form className="stack" onSubmit={event => {
    event.preventDefault()
    if (write.locked) return
    write.save('post', { kind: 'criterion', check_key: form.key, body: preset?.body ?? form.body,
      is_required_safety: form.safety, expectedVersion: version ?? sourceVersion }, () => {
      setForm({ key: '', body: '', safety: false }); setVersion(null)
    })
  }}>
    <h3>기준 추가</h3>
    <WriteStatus write={write} onConflictRefresh={latest} />
    <fieldset disabled={write.locked} className="stack">
      <legend>통과 조건</legend>
      <Field label="판정 항목"><select value={form.key} onChange={event => {
        const chosen = CRITERION_BY_KEY[event.target.value]
        edit({ ...form, key: event.target.value, safety: chosen?.safetyDefault ?? false })
      }}>
        <option value="">직접 작성 · 사람이 판정</option>
        {Object.values(CRITERION_BY_KEY).map(c => <option value={c.key} key={c.key}>{c.body}</option>)}
      </select></Field>
      {preset ? <p>{preset.body} <span className="badge badge-neutral">{preset.kind === 'rule' ? '규칙 판정' : '사람 판정'}</span></p>
        : <Field label="합격 조건" required><textarea rows={2} maxLength={2000} value={form.body}
          onChange={event => edit({ ...form, body: event.target.value })} /></Field>}
      <label className="row"><input type="checkbox" checked={form.safety}
        onChange={event => edit({ ...form, safety: event.target.checked })} />필수 안전 기준</label>
      <p className="card-note">필수 안전 기준은 하나라도 불통과하면 인계할 수 없습니다. 추가한 기준은 별도로 확정합니다.</p>
      <div><button className="btn-primary" disabled={!sourceVersion || (!preset && !form.body.trim())}>기준 추가</button></div>
    </fieldset>
  </form>
}

function Criterion({ id, item, refresh }) {
  const [draft, setDraft] = useState(null)
  const write = useEvidenceWrite(id, refresh)
  const current = { safety: Boolean(item.is_required_safety), confirmed: Boolean(item.confirmed_at), version: item.edit_version }
  const value = draft ?? current
  function edit(next) { setDraft(previous => editDraft(previous, current, next)) }
  async function latest() {
    const next = await write.reload()
    const found = next?.criteria.find(c => c.id === item.id)
    if (found) setDraft(old => mergeDraft(old, { safety: Boolean(found.is_required_safety), confirmed: Boolean(found.confirmed_at), version: found.edit_version }))
  }
  return <form className="stack-sm disclose" aria-label={`${item.ord}. ${item.body}`} onSubmit={event => {
    event.preventDefault()
    if (write.locked || draft?.conflicts.length) return
    write.save('patch', { kind: 'criterion', id: item.id, confirmed: value.confirmed,
      is_required_safety: value.safety, expectedVersion: value.version }, () => setDraft(null))
  }}>
    <strong>{item.ord}. {item.body}</strong>
    <p className="card-note">현재 기록: {item.confirmed_at ? '확정' : '미확정'} · {item.is_required_safety ? '필수 안전' : '일반 기준'} · {item.check_kind === 'rule' ? '규칙 판정' : '사람 판정'}</p>
    <WriteStatus write={write} onConflictRefresh={latest} />
    <DraftConflicts draft={draft} labels={{ safety: '필수 안전 기준', confirmed: '시험 확정' }} choose={(key, chosen) => edit({ [key]: chosen })} />
    <fieldset disabled={write.locked} className="stack-sm">
      <legend>기준 상태</legend>
      <label className="row"><input type="checkbox" checked={value.safety} onChange={e => edit({ safety: e.target.checked })} />필수 안전 기준</label>
      <label className="row"><input type="checkbox" checked={value.confirmed} onChange={e => edit({ confirmed: e.target.checked })} />이 기준으로 시험하도록 확정</label>
      <div><button type="submit" className="btn-ghost" disabled={!draft || !value.version || Boolean(draft?.conflicts.length)}>기준 상태 저장</button></div>
    </fieldset>
  </form>
}

function Baseline({ id, data, refresh }) {
  const baseline = data.baseline
  const [measurement, setMeasurement] = useState({ seconds: '', errors: '0', note: '' })
  const [draft, setDraft] = useState(null)
  const record = useEvidenceWrite(id, refresh)
  const seal = useEvidenceWrite(id, refresh)
  const current = {
    people: String(baseline?.people ?? data.application.current_people ?? 1),
    wage: String(baseline?.hourly_wage_krw ?? HOURLY_WAGE_KRW),
    frequency: baseline?.frequency ?? data.application.current_frequency ?? '',
    version: data.baseline_source_version,
  }
  const values = draft ?? current
  function edit(changes) { setDraft(previous => editDraft(previous, current, changes)) }
  const locked = record.locked || seal.locked
  async function latest() {
    const next = await seal.reload()
    if (next) setDraft(old => mergeDraft(old, {
      people: String(next.baseline?.people ?? next.application.current_people ?? 1),
      wage: String(next.baseline?.hourly_wage_krw ?? HOURLY_WAGE_KRW),
      frequency: next.baseline?.frequency ?? next.application.current_frequency ?? '', version: next.baseline_source_version,
    }))
  }
  return <details className="card card-boxed">
    <summary className="card-head"><h2 className="card-title">기준선 실측</h2>
      <span className="card-note">{data.shadowRuns.length}회 기록 · {baseline ? '확정됨' : '미확정'}</span>
    </summary>
    <div className="stack">
      <p className="card-note">자동화 전 업무를 실제로 잰 시간을 입력합니다. 최소 3회 기록의 중앙값을 기준선으로 확정합니다.</p>
      {data.shadowRuns.length > 0 && <div className="table-wrap"><table className="data-table">
        <caption className="sr-only">자동화 전 실측 기록</caption>
        <thead><tr><th scope="col">회차</th><th scope="col">소요 시간</th><th scope="col">오류</th><th scope="col">메모</th></tr></thead>
        <tbody>{data.shadowRuns.map(run => <tr key={run.id}><td>{run.seq}</td><td>{run.total_seconds.toLocaleString('ko-KR')}초</td>
          <td>{run.error_count}건</td><td>{run.note || '—'}</td></tr>)}</tbody>
      </table></div>}
      <form className="stack" onSubmit={event => {
        event.preventDefault()
        if (locked) return
        record.save('post', { kind: 'shadow_run', total_seconds: measurement.seconds, error_count: measurement.errors, note: measurement.note }, () => {
          setMeasurement({ seconds: '', errors: '0', note: '' })
        })
      }}>
        <WriteStatus write={record} onConflictRefresh={record.reload} />
        <fieldset disabled={locked} className="form-grid"><legend>실측 기록 추가</legend>
          <Field label="소요 시간 (초)" required><input inputMode="numeric" value={measurement.seconds}
            onChange={e => setMeasurement({ ...measurement, seconds: e.target.value })} /></Field>
          <Field label="오류 건수" required><input inputMode="numeric" value={measurement.errors}
            onChange={e => setMeasurement({ ...measurement, errors: e.target.value })} /></Field>
          <div className="full"><Field label="측정 메모"><input maxLength={2000} value={measurement.note}
            placeholder="측정일과 업무 조건" onChange={e => setMeasurement({ ...measurement, note: e.target.value })} /></Field></div>
          <div className="full"><button className="btn-ghost" disabled={!measurement.seconds.trim()}>실측 기록 저장</button></div>
        </fieldset>
      </form>
      {baseline && <div className="notice notice-info">
        <strong>확정 기준선 {duration(baseline.median_seconds)} · 표본 {baseline.sample_n}회</strong>
        <p>{baseline.people}명 · 시급 {krw(baseline.hourly_wage_krw)} · {dateTimeLabel(baseline.sealed_at)}</p>
        <p className="card-note">다시 확정하면 기존 성과 확인은 이전 근거의 기록으로 남습니다.</p>
      </div>}
      <form className="stack" onSubmit={event => {
        event.preventDefault()
        if (locked || data.shadowRuns.length < 3 || draft?.conflicts.length) return
        seal.save('post', { kind: 'baseline', people: values.people, hourly_wage_krw: values.wage,
          frequency: values.frequency, expectedVersion: values.version }, () => setDraft(null))
      }}>
        <WriteStatus write={seal} onConflictRefresh={latest} />
        <DraftConflicts draft={draft} labels={{ people: '참여 인원', wage: '시간당 비용', frequency: '업무 주기' }} choose={(key, chosen) => edit({ [key]: chosen })} />
        <fieldset disabled={locked} className="form-grid"><legend>기준선 확정</legend>
          <Field label="참여 인원" required><input inputMode="numeric" value={values.people}
            onChange={e => edit({ people: e.target.value })} /></Field>
          <Field label="시간당 비용 (원)" required><input inputMode="decimal" value={values.wage}
            onChange={e => edit({ wage: e.target.value })} /></Field>
          <div className="full"><Field label="업무 주기"><input maxLength={100} value={values.frequency}
            onChange={e => edit({ frequency: e.target.value })} /></Field></div>
          <div className="full row"><button className="btn-primary" disabled={data.shadowRuns.length < 3 || !values.version || Boolean(draft?.conflicts.length)}>기준선 {baseline ? '다시 ' : ''}확정</button>
            {data.shadowRuns.length < 3 && <span className="card-note">실측 {3 - data.shadowRuns.length}회가 더 필요합니다.</span>}</div>
        </fieldset>
      </form>
    </div>
  </details>
}
