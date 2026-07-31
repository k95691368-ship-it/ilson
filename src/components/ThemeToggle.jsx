import { useTheme } from '../context/ThemeContext.jsx'
import { toggleLabel } from '../lib/theme.js'

// 밝은 화면 / 어두운 화면 전환.
//
// 아이콘만으로는 무엇을 하는 버튼인지 화면을 읽어 주는 도구가 알 수 없으므로,
// 눌렀을 때 무엇이 되는지를 설명으로 붙인다.
export default function ThemeToggle({ className = '' }) {
  const { theme, toggle } = useTheme()
  const label = toggleLabel(theme)

  return (
    <button
      type="button"
      className={`theme-toggle ${className}`.trim()}
      onClick={toggle}
      aria-label={label}
      title={label}
    >
      <span aria-hidden="true">{theme === 'dark' ? '☀︎' : '☾'}</span>
    </button>
  )
}
