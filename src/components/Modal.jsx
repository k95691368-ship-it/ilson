import { useEffect, useRef } from 'react'
import { FOCUSABLE_SELECTOR, wrapFocusIndex, initialFocusIndex } from '../lib/focusTrap.js'

// 화면을 덮는 창.
//
// 지금까지 이 앱의 창들은 화면 위에 얹혀 있기만 했다. 탭을 누르면 초점이 뒤에
// 있는 화면으로 빠져나갔고, Esc로 닫히지 않았고, 닫은 뒤 초점이 어디로 가는지
// 알 수 없었다. 화면을 보지 못하는 사람에게는 창이 떠 있다는 사실 자체가
// 전달되지 않았다.
export default function Modal({ title, onClose, children, className = '' }) {
  const contentRef = useRef(null)
  const restoreRef = useRef(null)

  useEffect(() => {
    // 닫은 뒤 원래 있던 자리로 초점을 돌려주기 위해 기억해 둔다.
    restoreRef.current = document.activeElement
    const node = contentRef.current

    const focusables = () =>
      Array.from(node?.querySelectorAll(FOCUSABLE_SELECTOR) || []).filter(
        (el) => el.offsetParent !== null || el === document.activeElement
      )

    const items = focusables()
    const startIndex = initialFocusIndex(items.length)
    if (startIndex >= 0) items[startIndex].focus()
    else node?.focus()

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab') return

      const list = focusables()
      if (list.length === 0) {
        event.preventDefault()
        return
      }
      const target = wrapFocusIndex(list.length, list.indexOf(document.activeElement), event.shiftKey)
      if (target !== null) {
        event.preventDefault()
        list[target].focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    // 창이 떠 있는 동안 뒤 화면이 함께 스크롤되지 않게 한다.
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.body.style.overflow = previousOverflow
      restoreRef.current?.focus?.()
    }
  }, [onClose])

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        ref={contentRef}
        className={`modal-content ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}
