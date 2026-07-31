import { Suspense, lazy } from 'react'
import { Routes, Route, NavLink, Link, useLocation } from 'react-router-dom'
import ThemeToggle from './components/ThemeToggle.jsx'
import { STAGES } from './lib/stages.js'

const FlowPage = lazy(() => import('./pages/FlowPage.jsx'))
const ApplyPage = lazy(() => import('./pages/ApplyPage.jsx'))
const ReviewPage = lazy(() => import('./pages/ReviewPage.jsx'))
const AgreementPage = lazy(() => import('./pages/AgreementPage.jsx'))
const BuildPage = lazy(() => import('./pages/BuildPage.jsx'))
const BetaPage = lazy(() => import('./pages/BetaPage.jsx'))
const ManualPage = lazy(() => import('./pages/ManualPage.jsx'))
const DeployPage = lazy(() => import('./pages/DeployPage.jsx'))
const ResultPage = lazy(() => import('./pages/ResultPage.jsx'))
const ToolPage = lazy(() => import('./pages/ToolPage.jsx'))
const NotFoundPage = lazy(() => import('./pages/NotFoundPage.jsx'))

// 인수인계된 도구(/t/:slug)는 현업 담당자가 여는 화면이다. 제작 과정도 상단
// 목차도 보일 이유가 없다 — 파일을 넣고 결과를 받으면 된다. 그래서 이 경로에서는
// 셸을 지운다.
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
          <Link to="/" className="topbar-brand">
            <span className="topbar-logo" aria-hidden="true">
              일
            </span>
            일손
            <span className="topbar-brand-sub">부서 병목을 도구로 바꾸는 여덟 단계</span>
          </Link>

          <nav className="topbar-nav" aria-label="진행 단계">
            {STAGES.map((s) => (
              <NavLink
                key={s.key}
                to={s.path}
                className={({ isActive }) => `topbar-link${isActive ? ' active' : ''}`}
              >
                <span className="topbar-link-no" aria-hidden="true">
                  {s.no}
                </span>
                {s.label}
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
            <Route path="/" element={<FlowPage />} />
            <Route path="/apply" element={<ApplyPage />} />
            <Route path="/review" element={<ReviewPage />} />
            <Route path="/agreement" element={<AgreementPage />} />
            <Route path="/build" element={<BuildPage />} />
            <Route path="/beta" element={<BetaPage />} />
            <Route path="/manual" element={<ManualPage />} />
            <Route path="/deploy" element={<DeployPage />} />
            <Route path="/result" element={<ResultPage />} />
            <Route path="/t/:slug" element={<ToolPage />} />
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
                각 부서가 병목을 신청서로 적어 내면, AX 담당자가 검토하고 협의해 도구로 만들고,
                베타 테스트를 거쳐 사용법서와 함께 넘기고, 기준선 대비 성과를 정리하기까지의
                과정 전체입니다.
              </p>
            </div>
            <div className="footer-col">
              <div className="footer-title">여덟 단계</div>
              <p className="footer-text">
                {STAGES.map((s) => `${s.no} ${s.label}`).join(' · ')}
              </p>
            </div>
            <div className="footer-col">
              <div className="footer-title">AI를 쓰는 자리</div>
              <p className="footer-text">
                초안 작성과 분류를 돕습니다. 우선순위·반려·합격 기준·성과 정의 등
                <strong> 확정은 사람이 합니다.</strong> 화면에서 AI 초안과 사람의 결정이 구분됩니다.
              </p>
            </div>
          </div>
          <div className="footer-bottom">
            <span>Claude Opus 5 · Cloudflare Pages Functions · D1 · R2</span>
            <span>가상의 회사·부서·데이터입니다. 실존하지 않습니다.</span>
          </div>
        </footer>
      )}
    </div>
  )
}
