import { useEffect, useRef } from 'react'

// 단축키가 있다는 것을 알려 주는 자리.
//
// 숨어 있는 단축키는 없는 것과 같다. 만들어 놓고 아무도 모르면 만든 사람만
// 쓴다. 그래서 화면 구석에 항상 "단축키 ?" 를 띄워 두고, 눌러도 열리고
// 물음표를 쳐도 열리게 한다.
export default function HotkeyHelp({ open, onClose, keys }) {
  const panelRef = useRef(null)
  const closeRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined

    const previous = document.activeElement
    closeRef.current?.focus()

    function keepFocusInside(e) {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }
      if (e.key !== 'Tab') return

      const focusable = panelRef.current?.querySelectorAll(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
      if (!focusable?.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', keepFocusInside)
    return () => {
      document.removeEventListener('keydown', keepFocusInside)
      previous?.focus?.()
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="hotkey-backdrop"
      onMouseDown={(e) => {
        if (e.currentTarget === e.target) onClose()
      }}
    >
      <div
        ref={panelRef}
        className="hotkey-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="hotkey-title"
      >
        <div className="card-head">
          <h2 className="card-title" id="hotkey-title">단축키</h2>
          <span className="spacer" />
          <button ref={closeRef} type="button" className="btn-ghost btn-sm" onClick={onClose}>
            닫기
          </button>
        </div>
        <dl className="hotkey-list">
          {keys.map((k) => (
            <div key={k.keys}>
              <dt>
                {k.keys.split(' ').map((one) => (
                  <kbd key={one}>{one}</kbd>
                ))}
              </dt>
              <dd>{k.what}</dd>
            </div>
          ))}
        </dl>
        <p className="card-note hotkey-foot">
          글을 적고 있을 때는 단축키가 듣지 않습니다. 판정 근거를 적다가 j를 쳤는데 다음 신청서로
          넘어가면 쓰던 것이 날아가니까요.
        </p>
      </div>
    </div>
  )
}
