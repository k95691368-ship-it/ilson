import { useTheme } from '../context/ThemeContext.jsx'
import { toggleLabel } from '../lib/theme.js'

export default function ThemeToggle() {
  const { theme, toggle } = useTheme()
  const label = toggleLabel(theme)

  return (
    <button type="button" className="theme-toggle" onClick={toggle} title={label}>
      {/* 아이콘은 장식이라 화면 낭독기에서 읽히지 않게 하고,
          대신 버튼 자체의 설명으로 무엇이 되는지를 말해 준다. */}
      <span aria-hidden="true">{theme === 'dark' ? '☀' : '☾'}</span>
      <span className="sr-only">{label}</span>
    </button>
  )
}
