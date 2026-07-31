import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'

const ToastContext = createContext(null)

let counter = 0

export function ToastProvider({ children }) {
  const [items, setItems] = useState([])
  const timers = useRef(new Map())

  const dismiss = useCallback((id) => {
    setItems((list) => list.filter((t) => t.id !== id))
    const timer = timers.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timers.current.delete(id)
    }
  }, [])

  const push = useCallback(
    (message, tone, ms) => {
      if (!message) return null
      const id = ++counter
      setItems((list) => [...list, { id, tone, message: String(message) }])
      timers.current.set(id, setTimeout(() => dismiss(id), ms))
      return id
    },
    [dismiss]
  )

  const value = useMemo(
    () => ({
      // 오류는 더 오래 띄운다. 읽는 데 시간이 걸리고, 놓치면 무엇이 잘못됐는지 모른다.
      error: (msg) => push(msg, 'error', 6000),
      success: (msg) => push(msg, 'success', 3500),
      info: (msg) => push(msg, 'info', 3500),
      dismiss,
    }),
    [push, dismiss]
  )

  const errors = items.filter((t) => t.tone === 'error')
  const notices = items.filter((t) => t.tone !== 'error')

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-viewport">
        {/* 오류는 하던 일을 멈추게 하는 내용이라 화면 낭독기가 즉시 읽어야 하고,
            안내는 하던 일을 끊지 않도록 순서를 기다려 읽어야 한다.
            한 영역에 섞으면 둘 중 하나가 잘못된 방식으로 읽힌다. */}
        <div role="alert" aria-live="assertive">
          {errors.map((t) => (
            <Toast key={t.id} toast={t} onDismiss={dismiss} />
          ))}
        </div>
        <div role="status" aria-live="polite">
          {notices.map((t) => (
            <Toast key={t.id} toast={t} onDismiss={dismiss} />
          ))}
        </div>
      </div>
    </ToastContext.Provider>
  )
}

function Toast({ toast, onDismiss }) {
  return (
    <button
      type="button"
      className={`toast toast-${toast.tone}`}
      onClick={() => onDismiss(toast.id)}
      title="눌러서 닫기"
    >
      {toast.tone === 'error' && <span className="sr-only">오류: </span>}
      {toast.message}
    </button>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast는 ToastProvider 안에서만 쓸 수 있습니다.')
  return ctx
}
