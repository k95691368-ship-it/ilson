import { useEffect } from 'react'

// 손을 마우스로 옮기지 않고 접수함을 넘긴다.
//
// 검토 화면은 하루 종일 쓰는 자리다. 신청서 하나 보고 판정하고 다음 것으로
// 넘어가는 일을 반복하는데, 그때마다 왼쪽 목록으로 마우스를 옮겨 클릭하는
// 것이 전부 손해다.
//
// 가장 조심할 것은 **적고 있는 중에 튀어나오지 않는 것**이다. 판정 근거를
// 적다가 'j'를 쳤는데 다음 신청서로 넘어가면, 쓰던 것이 날아간다. 그런 일이
// 한 번만 생겨도 사람은 이 화면을 다시 믿지 않는다.

function isTyping(el) {
  if (!el) return false
  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (el.isContentEditable) return true
  return false
}

// 조합키가 눌린 것은 브라우저·운영체제 단축키다. 우리가 가로채면 안 된다.
// Ctrl+F로 찾기를 하려던 사람에게 우리 검색창이 뜨면 그건 고장이다.
function hasModifier(e) {
  return e.ctrlKey || e.metaKey || e.altKey
}

/**
 * @param {Record<string, (e: KeyboardEvent) => void>} map 키 → 할 일
 * @param {{enabled?: boolean, allowWhileTyping?: string[]}} options
 *        allowWhileTyping 에 적은 키는 입력칸 안에서도 듣는다 (Escape 같은 것)
 */
export function useHotkeys(map, { enabled = true, allowWhileTyping = ['Escape'] } = {}) {
  useEffect(() => {
    if (!enabled) return

    function onKey(e) {
      if (hasModifier(e)) return

      const typing = isTyping(e.target)
      if (typing && !allowWhileTyping.includes(e.key)) return

      const fn = map[e.key]
      if (!fn) return

      // 브라우저 기본 동작을 막는다. '/'는 파이어폭스에서 빠른 찾기를 열고,
      // 화살표는 화면을 스크롤한다. 둘 다 우리 것과 겹친다.
      e.preventDefault()
      fn(e)
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
}
