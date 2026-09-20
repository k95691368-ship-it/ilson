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
  return <div className="workspace-intro" aria-busy={busy}>
    <header className="workspace-entry-header">
      <a className="workspace-wordmark" href="/" aria-label="OverrideLoop 운영판"><span aria-hidden="true">IL</span>OverrideLoop</a>
      <span className="workspace-entry-context">{intro ? '개인 체험' : '접근 확인'}</span>
    </header>
    <main className="workspace-entry-main">
      <section className={`workspace-entry-panel${intro ? '' : ' workspace-entry-locked'}`} aria-labelledby="workspace-entry-title">
        <div className="workspace-entry-primary">
          {loading && <span className="workspace-entry-loading" aria-hidden="true" />}
          <h1 id="workspace-entry-title">{intro ? '개인 체험' : loading ? '접근 상태를 확인하고 있습니다.' : '접근 권한을 다시 확인해 주세요.'}</h1>
          {intro ? <>
            <p className="workspace-entry-summary">가상 자료로 업무 신청·검토와 AI 운영 기능을 확인합니다.</p>
            <div className="workspace-entry-actions">
              <button className="btn-primary" type="button" onClick={() => check(true)} disabled={busy}>{busy ? '체험 공간을 여는 중…' : '개인 체험 시작'}</button>
              {message && <p className="workspace-entry-alert" role="alert">{message}</p>}
            </div>
          </> : <>
            {!loading && <>
              <p className="workspace-entry-summary">인증이 만료되거나 접근 권한이 바뀌어 이전 자료를 숨겼습니다. 인증된 계정으로 다시 접속한 뒤 권한을 확인해주세요.</p>
              <div className="workspace-entry-actions">
                <button className="btn-primary" type="button" onClick={() => check()} disabled={busy}>{busy ? '접근 확인 중…' : '접근 다시 확인'}</button>
              </div>
              <p className="workspace-note">전송 중이던 요청은 이미 저장됐을 수 있습니다. 접근이 복구되면 기록을 확인해주세요.<br />도구·베타의 미확인 기록은 이 탭에서 원래 계정이나 체험 공간으로 돌아왔을 때 다시 확인할 수 있습니다.</p>
            </>}
            {message && <p className="workspace-entry-alert" role="alert">{message}</p>}
          </>}
        </div>
        {intro && <aside className="workspace-entry-info" aria-label="체험 공간 안내">
          <h2>체험 공간 안내</h2>
          <dl className="workspace-entry-facts">
            <div><dt>자료</dt><dd>가상 신청서 3건</dd></div>
            <div><dt>공간</dt><dd>다른 방문자와 분리된 공간</dd></div>
            <div><dt>보관</dt><dd>생성된 자료는 7일 후 만료</dd></div>
          </dl>
          <p className="workspace-note">외부 AI 호출이나 실제 배포는 실행하지 않습니다.</p>
        </aside>}
      </section>
    </main>
  </div>
}
