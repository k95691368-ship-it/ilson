import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useApi } from '../hooks/useApi.js'
import { api } from '../api/client.js'
import { dateTimeLabel } from '../lib/format.js'
import '../journey.css'

export default function JourneyPage() {
  const { id } = useParams()
  const list = useApi('/applications', { skip: Boolean(id) })
  const detail = useApi(id ? `/applications/${encodeURIComponent(id)}/journey` : null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const resource = id ? detail : list
  async function unlinkProduct(productId) {
    if (busy) return
    setBusy(true); setMessage('')
    try {
      await api.post(`/applications/${encodeURIComponent(id)}/journey`, { action: 'unlink', productId })
      await detail.reload()
      setMessage('연결만 해제했습니다. 제품과 운영 기록은 유지됩니다.')
    } catch (error) { setMessage(error.message) } finally { setBusy(false) }
  }
  async function linkProduct(event) {
    event.preventDefault()
    if (busy) return
    const productId = new FormData(event.currentTarget).get('productId')
    setBusy(true); setMessage('')
    try {
      await api.post(`/applications/${encodeURIComponent(id)}/journey`, { productId })
      await detail.reload()
      setMessage('운영 제품을 연결했습니다.')
    } catch (error) { setMessage(error.message) } finally { setBusy(false) }
  }
  return <div className="journey-page">
    <header><h1>통합 이력</h1>
      <p>기록이 없는 단계는 완료로 표시하지 않습니다.</p></header>
    {resource.loading && <p role="status">기록을 불러오는 중…</p>}
    {resource.error && <div role="alert"><p>{resource.error}</p><button className="btn-ghost" onClick={resource.reload}>다시 시도</button></div>}
    {!id && list.data && <ul className="journey-list">{list.data.items.map(app => <li key={app.id}>
      <Link to={`/journey/${encodeURIComponent(app.id)}`}><span>{app.ticket_no} · {app.dept}</span><h2>{app.title}</h2><span>{app.status} →</span></Link>
    </li>)}{!list.data.items.length && <li>신청서가 없습니다. <Link to="/apply">업무를 신청해 주세요.</Link></li>}</ul>}
    {id && detail.data && <JourneyDetail key={id} data={detail.data} busy={busy} message={message} onLink={linkProduct} onUnlink={unlinkProduct} />}
  </div>
}

function JourneyDetail({ data, busy, message, onLink, onUnlink }) {
  const connected = new Set(data.operations.products.map(p => p.id))
  const available = data.availableProducts.filter(p => !connected.has(p.id))
  return <>
    <div className="journey-context"><Link to="/journey">← 신청 목록</Link><h2>{data.application.title}</h2>
      <p>{data.application.ticket_no} · {data.application.dept}</p><Link to={`/record/${encodeURIComponent(data.application.id)}`}>전체 근거 문서 보기 →</Link></div>
    <section className="journey-connections" aria-labelledby="journey-products"><h2 id="journey-products">이 신청으로 운영하는 제품</h2>
      {data.operations.products.length ? <ul>{data.operations.products.map(p => <li key={p.id}>{p.name} · {p.owner_team} <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => onUnlink(p.id)} aria-label={`${p.name} 연결 해제`}>연결 해제</button></li>)}</ul> : <p>아직 연결된 제품이 없습니다. 아래에서 실제로 관련된 제품만 연결해 주세요.</p>}
      {available.length > 0 ? <form onSubmit={onLink}><label htmlFor="journey-product">운영 제품</label><select id="journey-product" name="productId" required disabled={busy}>
        <option value="">선택해 주세요</option>{available.map(p => <option key={p.id} value={p.id}>{p.name} · {p.owner_team}</option>)}
      </select><button className="btn-primary" disabled={busy}>{busy ? '연결 중…' : '신청과 연결'}</button></form> : <p><Link to="/override">OverrideLoop에서 운영 제품을 등록할 수 있습니다.</Link></p>}
      <p role="status">{message}</p>
    </section>
    <section aria-label="전체 진행 상태"><ul className="journey-stages">{Object.entries(data.done).map(([name, done]) => <li key={name}>{name}<span>{done ? '기록 있음' : '기록 없음'}</span></li>)}</ul></section>
    <section aria-labelledby="journey-timeline"><h2 id="journey-timeline">시간순 기록</h2><p>관련 제품이 공유하는 문제의 실험도 포함됩니다. 실험 전체 수치를 이 신청만의 성과로 합산하지 않습니다.</p>
      <ol className="journey-timeline">{data.entries.map(entry => <li key={entry.key}><div><span>{entry.kind}</span><time>{entry.at ? dateTimeLabel(entry.at) : '시각 기록 없음'}</time></div>
        <h3>{entry.title}</h3>{entry.detail && <p>{entry.detail}</p>}<Link to={entry.href}>관련 기록 보기 →</Link></li>)}</ol>
    </section>
  </>
}
