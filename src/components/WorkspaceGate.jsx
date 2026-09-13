import { useEffect, useState } from 'react'
import { ensureWorkspace, readWorkspace } from '../api/client.js'

export default function WorkspaceGate({ children }) {
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let alive = true
    readWorkspace().then(state => { if (alive && (!state.enabled || state.active)) setReady(true) }).catch(err => { if (alive) setError(err.message) })
    return () => { alive = false }
  }, [])
  async function start() {
    if (busy) return
    setBusy(true); setError('')
    try { await ensureWorkspace(); setReady(true) }
    catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }
  if (ready) return children
  return <main className="workspace-intro">
    <a className="workspace-wordmark" href="/" aria-label="일손 소개">일손</a>
    <section><p>신청에서 현장 운영까지.</p><h1>업무의 변화에<br />기록을 남깁니다.</h1>
      <p>일손은 업무 신청·검토·제작·성과를 연결합니다.<br />OverrideLoop에서는 AI 판단의 수정 사건과 개선 실험을 기록합니다.</p>
      <button className="btn-primary" type="button" onClick={start} disabled={busy}>{busy ? '체험 공간을 여는 중…' : '개인 체험 시작'}</button>
      <p className="workspace-note">버튼을 누르면 7일간 사용하는 별도 공간이 생성됩니다.<br />가상 자료로 체험하며 외부 AI와 실제 배포 시스템은 실행하지 않습니다.</p>
      {error && <p role="alert">{error}</p>}
    </section>
  </main>
}
