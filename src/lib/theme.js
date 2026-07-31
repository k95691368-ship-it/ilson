// 밝은 화면 / 어두운 화면 결정 (순수 함수 — 단위 테스트 대상).
//
// 규칙: 사용자가 직접 고른 것이 있으면 언제나 그것을 따른다. 고른 것이 없으면
// 어두운 화면으로 시작한다.
//
// 앞선 프로젝트에서는 고르지 않은 사람에게 기기 설정을 따라 주었는데, 이 앱은
// 그렇게 하지 않는다. 종일 띄워 두고 표와 로그를 읽는 작업대이고, 어두운 배경을
// 전제로 대비를 맞춘 화면이 많아서 기본값을 하나로 고정하는 편이 낫다고 봤다.
// 대신 기기 설정이 밝음인 사람이 눈에 부담을 느낄 수 있으므로, 토글은 상단에
// 항상 보이는 자리에 두고 선택은 저장한다.

export const THEME_KEY = 'theme'
export const THEMES = ['light', 'dark']

export function isTheme(value) {
  return THEMES.includes(value)
}

// stored: 사용자가 고른 값(없으면 null), prefersDark: 기기 설정이 어두움인가
// prefersDark는 더 이상 기본값을 정하지 않지만, 인자를 지우면 호출부가 조용히
// 어긋날 수 있어 남겨 둔다.
export function resolveTheme(stored, _prefersDark) {
  if (isTheme(stored)) return stored
  return 'dark'
}

export function nextTheme(current) {
  return current === 'dark' ? 'light' : 'dark'
}

export function themeLabel(theme) {
  return theme === 'dark' ? '어두운 화면' : '밝은 화면'
}

// 다음에 누르면 무엇이 되는지를 버튼 설명으로 쓴다.
export function toggleLabel(current) {
  return `${themeLabel(nextTheme(current))}으로 바꾸기`
}

// 저장된 값을 읽는다. 브라우저 저장소를 쓸 수 없는 환경에서도 죽지 않는다.
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
