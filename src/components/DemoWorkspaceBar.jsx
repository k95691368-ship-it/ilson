import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { readWorkspace, resetWorkspace } from '../api/client.js'
import '../journey.css'
import { clearDraft, DRAFT_KEY } from '../lib/draft.js'
import { getAccessSession } from '../lib/accessSession.js'

export default function DemoWorkspaceBar() {
  const [state, setState] = useState(null)
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let alive = true
    readWorkspace().then(value => { if (alive) setState(value) }).catch(err => { if (alive) setError(err.message) })
    const onReset = event => { if (event.key === 'ilson:workspace-reset') window.location.reload() }
    window.addEventListener('storage', onReset)
    return () => { alive = false; window.removeEventListener('storage', onReset) }
  }, [])
  async function reset() {
    const scope = getAccessSession().scope
    setBusy(true); setError('')
    try {
      await resetWorkspace()
      // Remove only this application's draft/identity cache, not unrelated browser data.
      try {
        clearDraft(localStorage, scope)
        for (let index = localStorage.length - 1; index >= 0; index--) {
          const key = localStorage.key(index)
          // Names for another verified account are not part of this demo reset.
          if (key?.startsWith('ilson:who:v2:') && (!scope || !key.startsWith(`ilson:who:v2:${scope}:`))) continue
          if (key?.startsWith('ilson:') || key === 'override-role' || key === DRAFT_KEY) localStorage.removeItem(key)
        }
        localStorage.setItem('ilson:workspace-reset', String(Date.now()))
      } catch { /* Browser storage can be disabled; the server reset still succeeded. */ }
      window.location.assign('/journey')
    } catch (err) { setError(err.message); setBusy(false) }
  }
  if (!error && !state?.enabled) return null
  return <aside className="demo-space-bar" aria-label="개인 체험 공간">
    <span>개인 체험 · 가상 자료 · 7일 보관</span>
    <Link to="/journey">통합 이력</Link>
    {!confirm && <button type="button" onClick={() => setConfirm(true)} disabled={!state?.active}>내 체험 초기화</button>}
    {confirm && <div className="demo-space-confirm"><p>이 공간의 신청·판정·실험 기록을 모두 지우고 가상 신청서 3건으로 다시 시작합니다. 복구할 수 없습니다.</p>
      <button type="button" onClick={() => setConfirm(false)} disabled={busy}>취소</button><button type="button" onClick={reset} disabled={busy}>{busy ? '초기화 중…' : '내 기록 삭제하고 다시 시작'}</button></div>}
    {error && <span role="alert">{error}</span>}
  </aside>
}
