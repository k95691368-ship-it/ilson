// 창 안에 초점을 가두는 규칙 (순수 함수 — 단위 테스트 대상).
//
// 창이 떠 있는데 탭을 계속 누르면 초점이 뒤에 있는 화면으로 빠져나간다. 화면을
// 보지 못하는 사람에게는 창이 닫힌 것처럼 느껴지고, 보이지 않는 곳을 조작하게
// 된다. 그래서 마지막에서 탭을 누르면 처음으로, 처음에서 시프트+탭을 누르면
// 마지막으로 돌려보낸다.

// 브라우저가 탭으로 옮겨 갈 수 있는 요소들
export const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

// 돌려보낼 자리를 고른다. 그대로 두어도 되면 null.
// activeIndex가 -1이면 초점이 목록 밖(창 자체)에 있다는 뜻이다.
export function wrapFocusIndex(count, activeIndex, shiftKey) {
  if (count <= 0) return null
  if (shiftKey) {
    // 처음이거나 목록 밖이면 마지막으로 돌아간다.
    return activeIndex <= 0 ? count - 1 : null
  }
  // 마지막이면 처음으로 돌아간다.
  return activeIndex === count - 1 ? 0 : null
}

// 창이 열릴 때 초점을 어디에 둘지. 안에 옮길 곳이 없으면 창 자체(-1).
export function initialFocusIndex(count) {
  return count > 0 ? 0 : -1
}
