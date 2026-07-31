import { Suspense, lazy } from 'react'
import { Routes, Route, NavLink, Link, useLocation } from 'react-router-dom'
import ThemeToggle from './components/ThemeToggle.jsx'
import { getView, orderedNav } from './lib/view.js'

const DeskPage = lazy(() => import('./pages/DeskPage.jsx'))
const RequestPage = lazy(() => import('./pages/RequestPage.jsx'))
const ToolPage = lazy(() => import('./pages/ToolPage.jsx'))
const MetricsPage = lazy(() => import('./pages/MetricsPage.jsx'))
const QualityPage = lazy(() => import('./pages/QualityPage.jsx'))
const DecisionLogPage = lazy(() => import('./pages/DecisionLogPage.jsx'))
const HonestyPage = lazy(() => import('./pages/HonestyPage.jsx'))
const NotFoundPage = lazy(() => import('./pages/NotFoundPage.jsx'))

const view = getView()
const nav = orderedNav(view)

// 인수인계된 도구(/t/:slug)는 현업 담당자가 열 화면이다. 제작 과정도 상단 탭도
// 보일 이유가 없다 — 드롭존과 실행 버튼만 있으면 된다. 그래서 이 경로에서는
// 상단바를 지운다.
function useBareLayout() {
  return useLocation().pathname.startsWith('/t/')
}

export default function App() {
  const bare = useBareLayout()

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        본문으로 건너뛰기
      </a>

      {!bare && (
        <header className="topbar">
          <Link to={view.home} className="topbar-brand">
            <span className="topbar-logo" aria-hidden="true">
              일
            </span>
            일손
            <span className="topbar-brand-sub">사내 반복업무 인수인계</span>
          </Link>

          <nav className="topbar-nav" aria-label="주요 화면">
            {nav.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => `topbar-link${isActive ? ' active' : ''}`}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="topbar-right">
            <ThemeToggle />
          </div>
        </header>
      )}

      <main className={bare ? 'app-main app-main-bare' : 'app-main'} id="main">
        <Suspense fallback={<div className="page-loading">불러오는 중…</div>}>
          <Routes>
            <Route path="/" element={<DeskPage />} />
            <Route path="/req/:id" element={<RequestPage />} />
            <Route path="/req/:id/:stage" element={<RequestPage />} />
            <Route path="/t/:slug" element={<ToolPage />} />
            <Route path="/metrics" element={<MetricsPage />} />
            <Route path="/quality" element={<QualityPage />} />
            <Route path="/log" element={<DecisionLogPage />} />
            <Route path="/honesty" element={<HonestyPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </Suspense>
      </main>

      {!bare && (
        <footer className="app-footer">
          <div className="footer-grid">
            <div className="footer-col">
              <div className="footer-title">일손 (ILSON)</div>
              <p className="footer-text">
                현업의 불평 한 줄을 받아 부서와 회의하고, AI와 함께 도구로 만들어,
                합격 기준을 통과시킨 뒤 인수인계하는 과정 전체를 운영하는 작업대입니다.
              </p>
            </div>
            <div className="footer-col">
              <div className="footer-title">사람이 하는 일</div>
              <p className="footer-text">
                우선순위 판단 · 부서 회의 · 요구 충돌 판정 · 기준선 실측 ·
                블록 승인 · 합격 기준 정의 · 성과 지표 정의 · 인수인계 승인
              </p>
            </div>
            <div className="footer-col">
              <div className="footer-title">AI가 하는 일</div>
              <p className="footer-text">
                회의 질문지 초안 · 회의록에서 요구 추출 · 충돌 후보 탐지 ·
                실행 계획 초안 · 잔여 컬럼 매핑 · 수리 제안 · 서술 채점.
                <strong> 확정은 하지 않습니다.</strong>
              </p>
            </div>
          </div>
          <div className="footer-bottom">
            <span>Claude Opus 5 · Cloudflare Pages Functions · D1 · R2</span>
            <Link to="/honesty" className="footer-link">
              이 포트폴리오가 증명하지 못하는 것
            </Link>
          </div>
        </footer>
      )}
    </div>
  )
}
