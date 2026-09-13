import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ensureWorkspace, resetWorkspace } from '../api/client.js'
import '../journey.css'
import { DRAFT_KEY } from '../lib/draft.js'

export default function DemoWorkspaceBar() {
  const [state, setState] = useState(null)
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let alive = true
    ensureWorkspace().then(value => { if (alive) setState(value) }).catch(err => { if (alive) setError(err.message) })
    const onReset = event => { if (event.key === 'ilson:workspace-reset') window.location.reload() }
    window.addEventListener('storage', onReset)
    return () => { alive = false; window.removeEventListener('storage', onReset) }
  }, [])
  async function reset() {
    setBusy(true); setError('')
    try {
      await resetWorkspace()
      // Remove only this application's draft/identity cache, not unrelated browser data.
      try {
        for (let index = localStorage.length - 1; index >= 0; index--) {
          const key = localStorage.key(index)
          if (key?.startsWith('ilson:') || key === 'override-role' || key === DRAFT_KEY) localStorage.removeItem(key)
        }
        localStorage.setItem('ilson:workspace-reset', String(Date.now()))
      } catch { /* Browser storage can be disabled; the server reset still succeeded. */ }
      window.location.assign('/journey')
    } catch (err) { setError(err.message); setBusy(false) }
  }
  if (!error && !state?.enabled) return null
  return <aside className="demo-space-bar" aria-label="개인 체험 공간">
    <span>개인 체험 공간 · 같은 브라우저에서 7일간 사용</span>
    <span>다른 방문자·운영 데이터와 분리됩니다.</span>
    <Link to="/journey">통합 이력</Link>
    {!confirm && <button type="button" onClick={() => setConfirm(true)} disabled={!state?.active}>내 체험 초기화</button>}
    {confirm && <div className="demo-space-confirm"><p>이 공간의 신청·판정·실험 기록을 모두 지우고 가상 신청서 3건으로 다시 시작합니다. 복구할 수 없습니다.</p>
      <button type="button" onClick={() => setConfirm(false)} disabled={busy}>취소</button><button type="button" onClick={reset} disabled={busy}>{busy ? '초기화 중…' : '내 기록 삭제하고 다시 시작'}</button></div>}
    {error && <span role="alert">{error}</span>}
  </aside>
}
