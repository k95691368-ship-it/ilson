import { Fragment, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { ensureWorkspace, readAccessSession, readWorkspace } from '../api/client.js'
import { beginAccessCheck, completeAccessCheck, failAccessCheck, getAccessSession, subscribeAccessSession } from '../lib/accessSession.js'

export default function WorkspaceGate({ children }) {
  const access = useSyncExternalStore(subscribeAccessSession, getAccessSession, getAccessSession)
  const [entry, setEntry] = useState('loading')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const alive = useRef(false)
  const pending = useRef(null)
  const running = useRef(false)

  const check = useCallback(async (createWorkspace = false) => {
    if (running.current) return
    running.current = true
    pending.current?.abort()
    const controller = new AbortController()
    pending.current = controller
    const generation = beginAccessCheck()
    const current = () => alive.current && !controller.signal.aborted && getAccessSession().generation === generation
    setBusy(true)
    setError('')
    try {
      // Rechecking never silently creates a new visitor space. Creation is
      // reserved for the explicit personal-demo button below.
      const state = createWorkspace ? await ensureWorkspace({ fresh: true }) : await readWorkspace({ signal: controller.signal })
      if (!current()) return
      if (state.enabled && !state.active) {
        const message = state.expired ? '체험 공간이 만료됐습니다. 새 공간을 시작할 수 있습니다.' : ''
        failAccessCheck(generation, message)
        setEntry('intro')
        setError(message)
        return
      }
      const session = await readAccessSession(generation, { signal: controller.signal })
      if (!current()) return
      if (!completeAccessCheck(generation, session)) throw new Error('접근 확인 응답을 확인하지 못했습니다. 다시 시도해주세요.')
      setEntry('ready')
    } catch (err) {
      if (!current()) return
      const message = err.message || '접근 권한을 확인하지 못했습니다.'
      failAccessCheck(generation, message)
      setError(message)
      if (!createWorkspace) setEntry('locked')
    } finally {
      if (pending.current === controller) {
        running.current = false
        if (alive.current) setBusy(false)
      }
    }
  }, [])

  useEffect(() => {
    alive.current = true
    void check()
    return () => {
      alive.current = false
      pending.current?.abort()
      running.current = false
    }
  }, [check])

  // Remount the whole protected subtree, including forms, modals and toasts.
  // Scope-separated uncertain-save receipts live outside it and are retained.
  if (entry === 'ready' && access.status === 'active') return <Fragment key={access.generation}>{children}</Fragment>
  const intro = entry === 'intro'
  const loading = entry === 'loading'
  const message = error || access.error
  return <main className="workspace-intro" aria-busy={busy}>
    <a className="workspace-wordmark" href="/" aria-label="일손 소개">일손</a>
    <section>
      {intro ? <>
        <h1>일손 체험</h1>
        <button className="btn-primary" type="button" onClick={() => check(true)} disabled={busy}>{busy ? '체험 공간을 여는 중…' : '개인 체험 시작'}</button>
        <p className="workspace-note">다른 방문자와 분리된 공간에 가상 자료가 생성되며 7일 후 만료됩니다.<br />외부 AI 호출이나 실제 배포는 실행하지 않습니다.</p>
      </> : <>
        <p>일손 · 접근 확인</p>
        <h1>{loading ? '접근 상태를 확인하고 있습니다.' : '접근 권한을 다시 확인해 주세요.'}</h1>
        {!loading && <>
          <p>인증이 만료되거나 접근 권한이 바뀌어 이전 자료를 숨겼습니다. 인증된 계정으로 다시 접속한 뒤 권한을 확인해주세요.</p>
          <button className="btn-primary" type="button" onClick={() => check()} disabled={busy}>{busy ? '접근 확인 중…' : '접근 다시 확인'}</button>
          <p className="workspace-note">전송 중이던 요청은 이미 저장됐을 수 있습니다. 접근이 복구되면 기록을 확인해주세요.<br />도구·베타의 미확인 기록은 이 탭에서 원래 계정이나 체험 공간으로 돌아왔을 때 다시 확인할 수 있습니다.</p>
        </>}
      </>}
      {message && <p role="alert">{message}</p>}
    </section>
  </main>
}
