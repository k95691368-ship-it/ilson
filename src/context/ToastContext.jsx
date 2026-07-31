import { createContext, useContext, useState, useCallback, useMemo, useRef } from 'react'

const ToastContext = createContext(null)

let idCounter = 0

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const timers = useRef({})

  const remove = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id))
    const timer = timers.current[id]
    if (timer) {
      clearTimeout(timer)
      delete timers.current[id]
    }
  }, [])

  const show = useCallback(
    (message, type, duration) => {
      if (!message) return
      const id = ++idCounter
      setToasts((list) => [...list, { id, message: String(message), type }])
      timers.current[id] = setTimeout(() => remove(id), duration)
      return id
    },
    [remove]
  )

  const value = useMemo(
    () => ({
      success: (message, duration = 3500) => show(message, 'success', duration),
      error: (message, duration = 5000) => show(message, 'error', duration),
      info: (message, duration = 3500) => show(message, 'info', duration),
    }),
    [show]
  )

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* 오류는 하던 일을 멈추게 하는 내용이라 즉시 읽어 주고(assertive),
          안내는 하던 일을 끊지 않도록 순서를 기다려 읽어 준다(polite).
          한 영역에 섞으면 둘 중 하나가 잘못된 방식으로 읽힌다. */}
      <div className="toast-viewport">
        <div role="alert" aria-live="assertive" aria-atomic="false">
          {toasts
            .filter((t) => t.type === 'error')
            .map((t) => (
              <button
                key={t.id}
                type="button"
                className={`toast toast-${t.type}`}
                onClick={() => remove(t.id)}
              >
                <span className="sr-only">오류: </span>
                {t.message}
              </button>
            ))}
        </div>
        <div role="status" aria-live="polite" aria-atomic="false">
          {toasts
            .filter((t) => t.type !== 'error')
            .map((t) => (
              <button
                key={t.id}
                type="button"
                className={`toast toast-${t.type}`}
                onClick={() => remove(t.id)}
              >
                {t.message}
              </button>
            ))}
        </div>
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}
