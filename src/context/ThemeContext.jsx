// 이 파일은 Provider 컴포넌트와 useTheme 훅을 함께 내보낸다.
// 검사 도구는 "한 파일에 컴포넌트만 두라"고 경고하지만(.oxlintrc.json에서 꺼 뒀다),
// 둘을 갈라 놓으면 쓰는 쪽에서 매번 두 파일을 불러와야 한다. 실제 손해는 개발 중
// 화면 즉시 반영이 한 번 더 도는 것뿐이라 나눠서 얻는 것보다 잃는 게 크다.

import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { resolveTheme, nextTheme, readStoredTheme, writeStoredTheme } from '../lib/theme.js'

const ThemeContext = createContext(null)

export function ThemeProvider({ children }) {
  // 첫 그림을 그리기 전에 저장된 값을 읽는다. 나중에 읽으면 밝은 화면이
  // 한 번 번쩍였다가 어두워진다.
  const [stored, setStored] = useState(() =>
    typeof window === 'undefined' ? null : readStoredTheme(window.localStorage)
  )

  const theme = resolveTheme(stored)

  useEffect(() => {
    const root = document.documentElement
    root.setAttribute('data-theme', theme)
    // 스크롤바나 기본 입력창처럼 브라우저가 그리는 부분도 함께 바뀌게 알린다.
    root.style.colorScheme = theme
  }, [theme])

  const value = useMemo(
    () => ({
      theme,
      chosen: stored !== null,
      toggle: () => {
        const next = nextTheme(theme)
        setStored(next)
        writeStoredTheme(window.localStorage, next)
      },
    }),
    [theme, stored]
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme는 ThemeProvider 안에서만 쓸 수 있습니다.')
  return ctx
}
