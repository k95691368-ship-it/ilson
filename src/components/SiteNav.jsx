import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'

const LINKS = [
  ['/', 'AI 운영'], ['/apply', '신청'], ['/review', '검토'],
  ['/agreement', '협의'], ['/build', '제작'], ['/beta', '베타'],
  ['/result', '성과'],
]

export default function SiteNav() {
  const [expanded, setExpanded] = useState(false)
  const toggleRef = useRef(null)
  const location = useLocation()
  useEffect(() => { setExpanded(false) }, [location.pathname])

  return (
    <header className="site-nav" onKeyDown={(event) => {
      if (event.key === 'Escape' && expanded) {
        setExpanded(false)
        toggleRef.current?.focus()
      }
    }}>
      <div className="site-nav-inner">
        <Link className="site-mark" to="/" aria-label="OverrideLoop 운영판">
          <svg viewBox="0 0 28 28" width="22" height="22" fill="none" aria-hidden="true">
            <path d="M7 5v18M16 5v18h7" stroke="currentColor" strokeWidth="3" />
          </svg>
          <strong>OverrideLoop</strong>
        </Link>
        <nav className={`site-nav-links${expanded ? ' is-open' : ''}`} id="site-navigation" aria-label="전체 사이트">
          {LINKS.map(([path, label]) => (
            <NavLink key={path} to={path} end className={({ isActive }) => isActive ? 'is-current' : ''} onClick={() => setExpanded(false)}>{label}</NavLink>
          ))}
        </nav>
        <Link className="site-nav-search" to="/track" aria-label="접수번호 조회">
          <svg viewBox="0 0 24 24" width="19" height="19" fill="none" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" strokeWidth="1.4" /><path d="m16 16 5 5" stroke="currentColor" strokeWidth="1.4" /></svg>
        </Link>
        <button ref={toggleRef} className="site-nav-toggle" type="button" aria-label={expanded ? '메뉴 닫기' : '메뉴 열기'} aria-expanded={expanded} aria-controls="site-navigation" onClick={() => setExpanded(!expanded)}>
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true"><path d={expanded ? 'M6 6l12 12M6 18L18 6' : 'M4 8h16M4 16h16'} stroke="currentColor" strokeWidth="1.4" /></svg>
        </button>
      </div>
    </header>
  )
}
