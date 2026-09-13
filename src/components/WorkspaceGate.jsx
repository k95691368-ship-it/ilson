import { useEffect, useState } from 'react'
import { ensureWorkspace } from '../api/client.js'

export default function WorkspaceGate({ children }) {
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let alive = true
    setError('')
    ensureWorkspace().then(() => { if (alive) setReady(true) }).catch(err => { if (alive) setError(err.message) })
    return () => { alive = false }
  }, [attempt])
  if (ready) return children
  return <main className="page-loading" aria-live="polite">{error ? <><p role="alert">{error}</p><button className="btn-primary" onClick={() => setAttempt(value => value + 1)}>다시 시도</button></> : '개인 체험 공간을 준비하는 중…'}</main>
}
