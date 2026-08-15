// 밝은 화면 / 어두운 화면을 정하는 규칙. 순수 함수라 테스트하기 쉽다.
//
// 규칙은 하나다. 사용자가 직접 고른 것이 있으면 언제나 그것을 따르고,
// 고른 적이 없으면 어두운 화면으로 시작한다.
//
// 기기 설정을 따르지 않는 이유: 이 사이트는 표와 기록을 오래 들여다보는
// 화면이고 어두운 배경을 전제로 색 대비를 맞췄다. 대신 토글을 상단에 항상
// 보이게 두고, 한 번 고르면 그 선택을 기억한다.

const THEME_KEY = 'ilson-theme'
const THEMES = ['light', 'dark']

function isTheme(value) {
  return THEMES.includes(value)
}

export function resolveTheme(stored) {
  return isTheme(stored) ? stored : 'dark'
}

export function nextTheme(current) {
  return current === 'dark' ? 'light' : 'dark'
}

function themeLabel(theme) {
  return theme === 'dark' ? '어두운 화면' : '밝은 화면'
}

// 버튼 설명은 "지금 무엇인가"가 아니라 "누르면 무엇이 되는가"여야 한다.
export function toggleLabel(current) {
  return `${themeLabel(nextTheme(current))}으로 바꾸기`
}

// 저장소를 쓸 수 없는 환경(사생활 보호 모드 등)에서도 죽지 않는다.
export function readStoredTheme(storage) {
  try {
    const value = storage?.getItem(THEME_KEY)
    return isTheme(value) ? value : null
  } catch {
    return null
  }
}

export function writeStoredTheme(storage, theme) {
  try {
    storage?.setItem(THEME_KEY, theme)
    return true
  } catch {
    return false
  }
}
