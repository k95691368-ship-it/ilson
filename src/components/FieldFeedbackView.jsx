import { useState } from 'react'
import { api } from '../api/client.ts'
import { useApi } from '../hooks/useApi.js'
import { safeJson } from '../../shared/override.js'
import { FEEDBACK_KINDS, FEEDBACK_VERDICTS, QUALITY_VERDICTS, NONUSE_STATES, NONUSE_REASONS, qualitySummary } from '../../shared/fieldFeedback.js'

const today = () => new Date().toISOString().slice(0, 10)
const options = (labels) => Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)
const fields = (form) => Object.fromEntries(new FormData(form).entries())
function ProductSelect({ products }) {
  return <label>AI 제품<select name="productId" required><option value="">선택해주세요</option>{products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
}
function Submit({ children, busy }) { return <button className="ol-primary" type="submit" disabled={busy}>{busy ? '저장 중…' : children}</button> }

function Followup({ item, manager, busy, onSubmit, onOpenCluster }) {
  return <section className="field-followup" aria-label="후속 검토">
    <div className="field-caption"><strong>{item.source_kind === 'quality_sample' ? '점검에서 발견한 문제' : '미해결 피드백 재검토'}</strong><span>{item.status === 'resolved' ? '후속 검토 완료' : '후속 검토 대기'}</span></div>
    <p className="field-prewrap">{item.reason}</p>
    {item.evidence_refs && <p className="field-muted">근거: {Array.isArray(item.evidence_refs) ? item.evidence_refs.join(' · ') : item.evidence_refs}</p>}
    <p className="field-muted">연결된 문제: {item.cluster_id || '배정 대기'} · 원 사건 {item.event_id}</p>
    {item.cluster_id && onOpenCluster && <button className="ol-text-button" type="button" onClick={() => onOpenCluster(item.cluster_id)}>연결된 반복 문제 보기</button>}
    {item.status === 'resolved' ? <p className="field-status">처리 근거: {item.resolution} · {item.resolved_by}</p> : manager && <details className="field-details"><summary>후속 검토 처리</summary><form className="field-form" onSubmit={event => onSubmit(event, 'resolve_followup', { followupId: item.id })}>
      <label>처리 결과와 확인 근거<textarea name="resolution" required maxLength={2000} rows={3} /></label>
      <p className="field-muted">이 기록은 후속 검토의 처리 결과입니다. 원래 승인 판단이나 직원의 미해결 답변은 바꾸지 않습니다.</p>
      <Submit busy={busy}>후속 검토 완료</Submit>
    </form></details>}
  </section>
}

export default function FieldFeedbackView({ mode, role, products, onCapture, onOpenCluster, onOpenEvent }) {
  const [pages, setPages] = useState({ role, cursors: [''] })
  const [batchPages, setBatchPages] = useState({ role, cursors: [''] })
  const pageCursors = pages.role === role ? pages.cursors : ['']
  const batchCursors = batchPages.role === role ? batchPages.cursors : ['']
  const cursor = mode === 'feedback' ? pageCursors.at(-1) : ''
  const batchCursor = mode === 'quality' ? batchCursors.at(-1) : ''
  const { data, error, loading, reload } = useApi(`/feedback?role=${encodeURIComponent(role)}${cursor ? `&caseCursor=${encodeURIComponent(cursor)}` : ''}${batchCursor ? `&batchCursor=${encodeURIComponent(batchCursor)}` : ''}`)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState(null)
  const [selected, setSelected] = useState('')
  async function save(payload, form) {
    if (busy) return
    setBusy(true); setStatus(null)
    try {
      const result = await api.post('/feedback', { ...payload, role })
      form?.reset()
      if (payload.action === 'create_sample') {
        setSelected(result.id)
        setBatchPages({ role, cursors: [''] })
      }
      setStatus({ text: '기록을 저장했습니다.', error: false })
      await reload()
    } catch (err) { setStatus({ text: err.message, error: true }) }
    finally { setBusy(false) }
  }
  function submit(event, action, extra = {}) {
    event.preventDefault()
    const form = event.currentTarget
    return save({ ...fields(form), action, ...extra }, form)
  }
  const batch = data?.batches.find(b => b.id === selected) ?? data?.batches[0]
  const samples = data?.samples.filter(s => s.batch_id === batch?.id) ?? []
  const summary = qualitySummary(samples)
  const pendingFollowups = (data?.followups ?? []).filter(item => item.status === 'open' && (mode === 'feedback' ? item.source_kind === 'feedback' : item.source_kind === 'quality_sample') && !(mode === 'feedback' ? data.cases.some(entry => entry.followups?.some(followup => followup.id === item.id)) : samples.some(sample => sample.followup?.id === item.id)))
  return <section className="ol-page field-workspace" data-clarity-mask="true">
    <header className="ol-page-intro"><div>
      <h1>{mode === 'feedback' ? '내 피드백' : '현장 점검'}</h1></div>
      <button className="ol-secondary" onClick={reload} disabled={loading}>새로고침</button>
    </header>
    {error && <p role="alert" className="field-error">{error}</p>}
    {status && <p role={status.error ? 'alert' : 'status'} className={status.error ? 'field-error' : 'field-status'}>{status.text}</p>}
    {loading && !data && <p role="status">기록을 불러오는 중입니다.</p>}
    {data && mode === 'feedback' && <>
      <div className="field-caption"><span>읽지 않은 안내 <strong>{data.unread}건</strong></span><span>{data.manager ? '담당자 권한 · 피드백' : '내가 남긴 피드백'} · {pageCursors.length}페이지 · 최신 기록부터 표시</span></div>
      {!data.cases.length && (pageCursors.length > 1 ? <p className="field-muted">이 페이지에 피드백이 없습니다.</p> : <div className="ol-panel field-empty"><h2>피드백이 없습니다.</h2><p>수정·거절·이관 사건의 처리 안내가 표시됩니다. 작성자 미확인 시연 기록은 제외됩니다.</p><button className="ol-primary" onClick={onCapture}>판단 기록하기</button></div>)}
      {data.cases.map(item => <article className="ol-panel field-case" key={item.id}>
        <header><span className="ol-eyebrow">{item.product_name} · {item.is_mine ? '내 피드백' : '담당 피드백'}</span><h2>{item.reason_detail}</h2><small>사건 {item.event_id}</small></header>
        {onOpenEvent && <button className="ol-text-button" type="button" onClick={() => onOpenEvent(item.event_id)}>원 사건 보기</button>}
        {!item.updates.length && <p className="field-muted">아직 담당자 안내가 없습니다.</p>}
        <ol className="feedback-history">{item.updates.map(update => <li key={update.id}>
          <div className="field-caption"><strong>{FEEDBACK_KINDS[update.kind]}</strong><span>{update.actor_label} · {update.created_at}</span></div>
          <p className="field-prewrap">{update.body}</p>
          {update.effective_on && <p className="field-muted">담당자가 기록한 적용일: {update.effective_on}</p>}
          {item.is_mine && !update.seen_at && <button className="ol-text-button" disabled={busy} onClick={() => save({ action: 'read_update', updateId: update.id })}>새 안내 · 읽음으로 표시</button>}
          {update.verdict && <p className="field-status">제보자 확인: {FEEDBACK_VERDICTS[update.verdict]}{update.note && ` — ${update.note}`}</p>}
          {item.is_mine && update.kind === 'applied' && (!update.responded_at || update.verdict === 'untested') && <form className="field-form" onSubmit={e => submit(e, 'confirm_update', { updateId: update.id })}>
            <label>현장에서 다시 확인한 결과<select name="verdict" required defaultValue=""><option value="" disabled>확인 결과를 선택해주세요</option>{options(FEEDBACK_VERDICTS)}</select></label>
            <label>추가 설명 <span className="field-muted">· 아직 불편한 경우 필수</span><textarea name="note" maxLength={1000} rows={2} /></label>
            <Submit busy={busy}>재확인 남기기</Submit>
          </form>}
        </li>)}</ol>
        {(item.followups ?? []).map(followup => <Followup key={followup.id} item={followup} manager={data.manager} busy={busy} onSubmit={submit} onOpenCluster={onOpenCluster} />)}
        {data.manager && <details className="field-details"><summary>담당자 안내 작성</summary><form className="field-form" onSubmit={e => { e.preventDefault(); const form = e.currentTarget; save({ ...fields(form), action: 'publish_update', caseId: item.id, confirmedApplied: new FormData(form).get('confirmedApplied') === 'on' }, form) }}>
          <label>안내 종류<select name="kind">{options(FEEDBACK_KINDS)}</select></label>
          <label>처리 내용<textarea name="message" required maxLength={2000} rows={3} /></label>
          <label>적용일 <span className="field-muted">· 개선 적용 안내에만 필수</span><input name="effectiveOn" type="date" max={today()} /></label>
          <label className="field-check"><input name="confirmedApplied" type="checkbox" />개선 적용 안내라면 실제 적용을 확인했습니다.</label>
          <p className="field-muted">사이트 안에서만 안내합니다. 이 기록이 외부 시스템을 배포하거나 변경하지는 않습니다.</p>
          <Submit busy={busy}>안내 등록</Submit>
        </form></details>}
      </article>)}
    </>}
    {mode === 'feedback' && (pageCursors.length > 1 || data?.casePage?.hasMore) && <nav className="field-caption" aria-label="피드백 페이지">
      <button className="ol-secondary" disabled={busy || loading || pageCursors.length === 1} onClick={() => setPages({ role, cursors: pageCursors.slice(0, -1) })}>이전 페이지</button>
      <span className="field-muted">{pageCursors.length}페이지{!data?.casePage?.hasMore && ' · 마지막'}</span>
      <button className="ol-secondary" disabled={busy || loading || !data?.casePage?.hasMore} onClick={() => setPages({ role, cursors: [...pageCursors, data.casePage.nextCursor] })}>다음 페이지</button>
    </nav>}
    {mode === 'quality' && (batchCursors.length > 1 || data?.batchPage?.hasMore) && <nav className="field-caption" aria-label="점검 묶음 페이지">
      <button className="ol-secondary" disabled={busy || loading || batchCursors.length === 1} onClick={() => setBatchPages({ role, cursors: batchCursors.slice(0, -1) })}>이전 묶음 페이지</button>
      <span className="field-muted">점검 묶음 {batchCursors.length}페이지{!data?.batchPage?.hasMore && ' · 마지막'}</span>
      <button className="ol-secondary" disabled={busy || loading || !data?.batchPage?.hasMore} onClick={() => setBatchPages({ role, cursors: [...batchCursors, data.batchPage.nextCursor] })}>다음 묶음 페이지</button>
    </nav>}
    {data && mode === 'quality' && <>
      {data.reviewer ? <>
        <section className="ol-panel"><h2>승인 사건 표본 점검</h2><p className="field-muted">사이트에 저장된 승인 사건 중 아직 추출하지 않은 사건을 무작위로 선택합니다. 전체 AI 호출을 수집한 것이 아니므로 서비스 전체의 오류율로 해석할 수 없습니다.</p>
          <form className="field-form field-form-grid" onSubmit={e => submit(e, 'create_sample')}>
            <ProductSelect products={products} /><label>시작일<input name="startDate" type="date" required max={today()} /></label>
            <label>종료일<input name="endDate" type="date" required max={today()} defaultValue={today()} /></label>
            <label>요청 표본 수<input name="size" type="number" min="1" max="30" defaultValue="5" required /></label>
            <Submit busy={busy}>표본 추출</Submit>
          </form>
        </section>
        {batch && <section className="ol-panel"><label className="field-batch-picker">점검 묶음<select value={batch.id} onChange={e => setSelected(e.target.value)}>{data.batches.map(b => <option key={b.id} value={b.id}>{b.product_name} · {b.start_at} ~ {b.end_at} · {b.id}</option>)}</select></label>
          <div className="field-metrics"><div><span>추출 당시 대상</span><strong>{batch.eligible_count}건</strong></div><div><span>추출 / 요청</span><strong>{batch.sample_size} / {batch.requested_size}건</strong></div><div><span>점검한 표본</span><strong>{summary.reviewed}건</strong></div><div><span>문제 / 근거 부족</span><strong>{summary.issues} / {summary.insufficient}건</strong></div></div>
          <p className="field-muted">중복 추출은 제외합니다. 추출 당시의 답변·모델·정책 기록을 보존하며 원래 승인 판단은 덮어쓰지 않습니다.</p>
          {samples.map(item => <article className="field-sample" key={item.id}><h3>사건 {item.event_id}</h3><dl className="field-snapshot"><div><dt>AI 답변</dt><dd>{item.snapshot.ai_decision}</dd></div><div><dt>직원 판단</dt><dd>{item.snapshot.human_decision}</dd></div><div><dt>모델 / 프롬프트</dt><dd>{item.snapshot.model_version || '미기록'} / {item.snapshot.prompt_version || '미기록'}</dd></div><div><dt>정책 근거</dt><dd>{safeJson(item.snapshot.policy_refs_json, []).join(' · ') || '미기록'}</dd></div><div><dt>원 사건 시각</dt><dd>{item.snapshot.occurred_at || '미기록'} (UTC)</dd></div></dl>
            {item.verdict && <div className="field-status"><strong>{QUALITY_VERDICTS[item.verdict]}</strong><p>{item.reason}</p><p>근거: {item.evidence_refs || '근거 부족으로 미기록'} · {item.reviewed_by} · {item.reviewed_at} (UTC)</p></div>}
            {(item.review_history?.length ?? 0) > 1 && <details className="field-details"><summary>점검 이력 {item.review_history.length}회</summary><ol className="feedback-history">{item.review_history.map(review => <li key={review.revision}><strong>{QUALITY_VERDICTS[review.verdict]}</strong><p className="field-prewrap">{review.reason}</p><p>근거: {review.evidence_refs || '근거 부족으로 미기록'}</p><small>{review.reviewed_by} · {review.reviewed_at} (UTC)</small></li>)}</ol></details>}
            {item.verdict === 'insufficient' && <p className="field-muted">근거를 보완해 다시 점검할 수 있습니다. 이전 판정과 추출 당시 원문은 그대로 보존됩니다.</p>}
            {(!item.verdict || item.verdict === 'insufficient') && <form className="field-form" onSubmit={e => submit(e, 'review_sample', { itemId: item.id })}>
              <label>점검 결과<select name="verdict" required defaultValue=""><option value="" disabled>점검 결과를 선택해주세요</option>{options(QUALITY_VERDICTS)}</select></label><label>판정 이유<textarea name="reason" required maxLength={2000} rows={2} /></label>
              <label>확인한 근거 <span className="field-muted">· 근거 부족 판정 외 필수</span><input name="evidenceRefs" maxLength={1000} /></label>
              <Submit busy={busy}>{item.verdict === 'insufficient' ? '근거 보완 후 재점검' : '점검 확정'}</Submit>
            </form>}
            {item.followup && <Followup item={item.followup} manager={data.manager} busy={busy} onSubmit={submit} onOpenCluster={onOpenCluster} />}
          </article>)}
        </section>}
        {!batch && <p className="field-muted">아직 추출한 표본이 없습니다.</p>}
      </> : <p className="field-status">승인 사건 점검은 운영·제품·모델·정책·감사 담당자가 수행합니다. 현재 역할에서는 아래에 사용 의견을 남기실 수 있습니다.</p>}
      <section className="ol-panel"><h2>사용하지 않는 이유</h2><p className="field-muted">사용 중단을 자동으로 추적하지 않습니다. 직접 남긴 의견만 저장하며 비밀번호·개인정보·고객 원문은 입력하지 마십시오.</p>
        <form className="field-form field-form-grid" onSubmit={e => submit(e, 'record_nonuse')}><ProductSelect products={products} />
          <label>사용 상태<select name="usageState">{options(NONUSE_STATES)}</select></label><label>이유<select name="reason">{options(NONUSE_REASONS)}</select></label>
          <label>해당 날짜<input name="occurredOn" type="date" required max={today()} defaultValue={today()} /></label>
          <label className="field-full">설명 <span className="field-muted">· 기타 선택 시 필수</span><textarea name="note" maxLength={1000} rows={2} /></label><Submit busy={busy}>사용 의견 남기기</Submit>
        </form>
        {data.nonuse.length > 0 && <details className="field-details"><summary>내가 남긴 의견 {data.nonuse.length}건</summary><ul className="field-report-list">{data.nonuse.map(r => <li key={r.id}><strong>{r.product_name}</strong> · {NONUSE_STATES[r.usage_state]} · {NONUSE_REASONS[r.reason]}<p>{r.occurred_on} {r.note}</p></li>)}</ul></details>}
      </section>
      {(data.manager || data.reviewer) && <section className="ol-panel"><h2>자발적 응답 현황</h2><p className="field-muted">전체 기간의 응답 건수입니다. 동일인의 여러 의견이 포함될 수 있으며, 사용자 수나 실제 사용 중단율이 아닙니다.</p>{data.nonuseSummary.length ? <ul className="field-report-list">{data.nonuseSummary.map((r,i) => <li key={i}>{r.product_name} · {NONUSE_STATES[r.usage_state]} · {NONUSE_REASONS[r.reason]} <strong>{r.reports}건</strong></li>)}</ul> : <p>아직 응답이 없습니다.</p>}</section>}
    </>}
    {data?.manager && pendingFollowups.length > 0 && <section className="ol-panel"><h2>남아 있는 후속 검토</h2><p className="field-muted">최근 표시 범위 밖의 원 기록도 후속 검토가 열려 있으면 여기에서 확인합니다.</p>{pendingFollowups.map(item => <Followup key={item.id} item={item} manager busy={busy} onSubmit={submit} onOpenCluster={onOpenCluster} />)}</section>}
  </section>
}
