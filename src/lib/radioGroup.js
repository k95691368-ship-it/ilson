const NEXT_KEYS = new Set(['ArrowRight', 'ArrowDown'])
const PREVIOUS_KEYS = new Set(['ArrowLeft', 'ArrowUp'])

// 버튼으로 만든 단일 선택 묶음도 기본 radio처럼 화살표 키로 이동한다.
// role만 radio로 바꾸고 이 동작을 빼면 보조기기에는 radio인데 키보드로는
// radio답게 쓸 수 없는 컨트롤이 된다.
export function handleRadioGroupKeyDown(event) {
  const isMove =
    NEXT_KEYS.has(event.key) ||
    PREVIOUS_KEYS.has(event.key) ||
    event.key === 'Home' ||
    event.key === 'End'

  if (!isMove) return

  const radios = [...event.currentTarget.querySelectorAll('[role="radio"]')].filter(
    (radio) => !radio.disabled && radio.getAttribute('aria-disabled') !== 'true'
  )
  if (radios.length === 0) return

  const focused = event.target.closest?.('[role="radio"]')
  const current = Math.max(0, radios.indexOf(focused))
  let next = current

  if (NEXT_KEYS.has(event.key)) next = (current + 1) % radios.length
  if (PREVIOUS_KEYS.has(event.key)) next = (current - 1 + radios.length) % radios.length
  if (event.key === 'Home') next = 0
  if (event.key === 'End') next = radios.length - 1

  event.preventDefault()
  radios[next].focus()
  radios[next].click()
}
