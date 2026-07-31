import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import {
  resolveTheme,
  nextTheme,
  readStoredTheme,
  writeStoredTheme,
} from '../lib/theme.js'

const ThemeContext = createContext(null)

const DARK_QUERY = '(prefers-color-scheme: dark)'

export function ThemeProvider({ children }) {
  // 고른 값이 있으면 그것을, 없으면 기기 설정을 따른다.
  const [stored, setStored] = useState(() =>
    typeof window === 'undefined' ? null : readStoredTheme(window.localStorage)
  )
  const [prefersDark, setPrefersDark] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia?.(DARK_QUERY).matches === true
  )

  // 아직 고르지 않은 사람은 기기 설정이 바뀌면 따라 바뀐다.
  useEffect(() => {
    const mq = window.matchMedia?.(DARK_QUERY)
    if (!mq) return undefined
    const onChange = (e) => setPrefersDark(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const theme = resolveTheme(stored, prefersDark)

  useEffect(() => {
    const root = document.documentElement
    root.setAttribute('data-theme', theme)
    // 스크롤바·기본 위젯도 함께 바뀌도록 브라우저에 알린다.
    root.style.colorScheme = theme
  }, [theme])

  const value = useMemo(
    () => ({
      theme,
      // 고른 값이 없으면 기기 설정을 따르고 있다는 뜻이다.
      followsSystem: stored === null,
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
