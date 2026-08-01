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
const TrackPage = lazy(() => import('./pages/TrackPage.jsx'))
const LogPage = lazy(() => import('./pages/LogPage.jsx'))
const RecordPage = lazy(() => import('./pages/RecordPage.jsx'))
const DeptPage = lazy(() => import('./pages/DeptPage.jsx'))
const ToolsPage = lazy(() => import('./pages/ToolsPage.jsx'))
const HonestyPage = lazy(() => import('./pages/HonestyPage.jsx'))
const ComparePage = lazy(() => import('./pages/ComparePage.jsx'))
const NotFoundPage = lazy(() => import('./pages/NotFoundPage.jsx'))

// 목차와 꼬리말 없이 여는 화면들.
//
// /t/:slug, /track — 부서 담당자가 여는 자리다. 제작 과정도 상단 목차도
// 보일 이유가 없다. 자기 일만 하면 된다.
// /record/:id — 종이에 인쇄하거나 PDF로 저장할 문서다. 목차와 꼬리말이
// 같이 인쇄되면 서류가 아니라 웹페이지 출력물이 된다.
function useBareLayout() {
  const path = useLocation().pathname
  return path.startsWith('/t/') || path === '/track' || path.startsWith('/record/')
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
            {/* 단계가 아니라 여덟 단계를 가로로 훑는 화면이라 목차와 분리해 둔다. */}
            <NavLink
              to="/tools"
              className={({ isActive }) => `topbar-link${isActive ? ' active' : ''}`}
            >
              넘긴 뒤
            </NavLink>
            <NavLink
              to="/honesty"
              className={({ isActive }) => `topbar-link${isActive ? ' active' : ''}`}
            >
              못 한 것
            </NavLink>
            <NavLink
              to="/log"
              className={({ isActive }) => `topbar-link${isActive ? ' active' : ''}`}
            >
              기록
            </NavLink>
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
            <Route path="/track" element={<TrackPage />} />
            <Route path="/log" element={<LogPage />} />
            <Route path="/record/:id" element={<RecordPage />} />
            <Route path="/dept/:dept" element={<DeptPage />} />
            <Route path="/tools" element={<ToolsPage />} />
            <Route path="/honesty" element={<HonestyPage />} />
            <Route path="/compare" element={<ComparePage />} />
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
              <div className="footer-title">여기에 마법은 없습니다</div>
              <p className="footer-text">
                파일을 읽고 합치고 검산하는 일은 전부 <strong>정해진 규칙</strong>이 합니다.
                같은 파일을 넣으면 언제나 같은 결과가 나오고, 어느 숫자든 눌러서 원본
                파일의 몇 번째 줄에서 왔는지까지 되짚을 수 있습니다.
              </p>
            </div>
          </div>
          <div className="footer-bottom">
            <span>Cloudflare Pages Functions · D1 · R2 · 외부 서비스 호출 없음</span>
            <span>가상의 회사·부서·데이터입니다. 실존하지 않습니다.</span>
          </div>
        </footer>
      )}
    </div>
  )
}
