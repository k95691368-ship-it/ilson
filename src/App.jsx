import { Suspense, lazy, useEffect } from 'react'
import { Routes, Route, NavLink, Link, useLocation } from 'react-router-dom'
import PageViewTracker from './components/PageViewTracker.jsx'
import { STAGES } from './lib/stages.js'

const FlowPage = lazy(() => import('./pages/FlowPage.jsx'))
const ApplyPage = lazy(() => import('./pages/ApplyPage.jsx'))
const ReviewPage = lazy(() => import('./pages/ReviewPage.jsx'))
const AgreementPage = lazy(() => import('./pages/AgreementPage.jsx'))
const BuildPage = lazy(() => import('./pages/BuildPage.jsx'))
const BetaPage = lazy(() => import('./pages/BetaPage.jsx'))
const ResultPage = lazy(() => import('./pages/ResultPage.jsx'))
const ToolPage = lazy(() => import('./pages/ToolPage.jsx'))
const TrackPage = lazy(() => import('./pages/TrackPage.jsx'))
const LogPage = lazy(() => import('./pages/LogPage.jsx'))
const RecordPage = lazy(() => import('./pages/RecordPage.jsx'))
const DeptPage = lazy(() => import('./pages/DeptPage.jsx'))
const ToolsPage = lazy(() => import('./pages/ToolsPage.jsx'))
const HonestyPage = lazy(() => import('./pages/HonestyPage.jsx'))
const ComparePage = lazy(() => import('./pages/ComparePage.jsx'))
const CodesPage = lazy(() => import('./pages/CodesPage.jsx'))
const StallPage = lazy(() => import('./pages/StallPage.jsx'))
const PriorityPage = lazy(() => import('./pages/PriorityPage.jsx'))
const BuiltPage = lazy(() => import('./pages/BuiltPage.jsx'))
const BugPage = lazy(() => import('./pages/BugPage.jsx'))
const NotFoundPage = lazy(() => import('./pages/NotFoundPage.jsx'))

// 여섯 단계 어디에도 안 들어가는 화면들. 단계를 가로로 지르며 본다.
//
// 순서는 담당자가 하루를 시작하는 순서다 — 무엇을 먼저 할지 정하고, 멈춘
// 것을 보고, 넘긴 것이 잘 도는지 보고, 그다음 기록과 못 한 것을 본다.
// 부서용 두 개(접수번호 조회)는 맨 뒤에 둔다.
export const CROSSCUT = [
  { to: '/priority', label: '먼저 할 것', note: '무엇부터 할지 정하는 자리' },
  { to: '/stall', label: '막힌 곳', note: '어느 단계에서 멈춰 있나' },
  { to: '/tools', label: '넘긴 뒤', note: '부서에 넘긴 도구가 실제로 쓰이나' },
  { to: '/codes', label: '알려 준 코드', note: '부서가 이어 둔 상품코드' },
  { to: '/log', label: '결정 기록', note: '무엇을 왜 그렇게 정했나' },
  { to: '/honesty', label: '못 한 것', note: '안 되는 것과 증명 못 한 것' },
  { to: '/built', label: '기술 구현', note: '무엇을 어떻게 만들었나' },
  { to: '/track', label: '접수번호 조회', note: '부서가 자기 신청서를 보는 자리' },
  { to: '/bug', label: '버그 신고', note: '사용 중 발견한 문제를 알리는 자리' },
]

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

// 인쇄할 때는 접힌 것을 전부 편다.
//
// 기록 문서(/record)·조회 화면은 **종이가 결과물**이다. 파일 머리에
// 그렇게 적혀 있고, 화면에도 "인쇄하거나 그대로 붙여 넣으실 수 있습니다"라고
// 적어 뒀다. 그런데 접기를 넣으면 접힌 것이 그대로 인쇄된다 — 그 종이에는
// 없는 것이 되고, 받은 사람은 그런 것이 있었는지도 모른다.
//
// CSS 의 @media print 만으로는 브라우저마다 다르게 군다. 인쇄 직전에 실제로
// open 을 달았다가 끝나면 원래대로 되돌린다.
function usePrintUnfold() {
  useEffect(() => {
    let opened = []
    const before = () => {
      opened = [...document.querySelectorAll('details:not([open])')]
      for (const d of opened) d.open = true
    }
    const after = () => {
      for (const d of opened) d.open = false
      opened = []
    }
    window.addEventListener('beforeprint', before)
    window.addEventListener('afterprint', after)
    return () => {
      window.removeEventListener('beforeprint', before)
      window.removeEventListener('afterprint', after)
    }
  }, [])
}

export default function App() {
  const bare = useBareLayout()
  usePrintUnfold()

  const navClass = ({ isActive }) => `topbar-link${isActive ? ' active' : ''}`

  return (
    <div className={`app-shell${bare ? ' app-shell-bare' : ''}`}>
      {/* 주소가 바뀌어도 새 문서를 안 받아오므로, 화면 이동을 여기서 듣고
          직접 보낸다. 열쇠(접수번호·도구 주소·신청서 id)는 가려서 보낸다. */}
      <PageViewTracker />
      <a className="skip-link" href="#main">
        본문으로 건너뛰기
      </a>

      {!bare && (
        <header className="topbar">
          <div className="topbar-inner">
            <Link to="/" className="topbar-brand">
              <span className="topbar-logo" aria-hidden="true">
                IL
              </span>
              <span className="topbar-brand-copy">
                <strong>일손</strong>
                <span className="topbar-brand-sub">업무 자동화 포트폴리오</span>
              </span>
            </Link>

            <nav className="topbar-nav" aria-label="여섯 단계">
              {STAGES.map((s) => (
                <NavLink key={s.key} to={s.path} className={navClass}>
                  <span className="topbar-link-no" aria-hidden="true">
                    {s.no}
                  </span>
                  <span className="topbar-link-copy">
                    <strong>{s.label}</strong>
                  </span>
                </NavLink>
              ))}
            </nav>

            <div className="topbar-right">
              <NavLink
                to="/track"
                className={({ isActive }) => `portal-link${isActive ? ' active' : ''}`}
                aria-label="접수번호 조회"
              >
                접수 조회
              </NavLink>
            </div>
          </div>
        </header>
      )}

      {bare && (
        <header className="barebar">
          <Link to="/" className="barebar-brand" aria-label="일손 운영 홈으로">
            <span aria-hidden="true">IL</span>
            <strong>일손</strong>
          </Link>
          <span className="barebar-context">부서 전용 화면</span>
          <span className="spacer" />
          <Link to="/" className="barebar-back">전체 과정 보기 →</Link>
        </header>
      )}

      {/* 클레어티가 화면을 녹화한다. 부서 담당자가 여는 세 화면은 통째로
          가린다 — 접수번호 조회, 넘겨받은 도구, 기록 문서.
          도구 화면이 특히 그렇다. 이 사이트는 "파일이 서버로 가지 않습니다"를
          내세우는데, 넣은 파일의 계산 결과가 뜬 화면을 녹화해 보내면 그
          약속이 뒷문으로 깨진다. 세 화면은 목차·꼬리말도 없이 여는 자리라
          bare 하나로 같이 잡힌다. */}
      <main
        className={bare ? 'app-main app-main-bare' : 'app-main'}
        id="main"
        tabIndex="-1"
        data-clarity-mask={bare ? 'true' : undefined}
      >
        <Suspense fallback={<div className="page-loading">불러오는 중…</div>}>
          <Routes>
            <Route path="/" element={<FlowPage />} />
            <Route path="/apply" element={<ApplyPage />} />
            <Route path="/review" element={<ReviewPage />} />
            <Route path="/agreement" element={<AgreementPage />} />
            <Route path="/build" element={<BuildPage />} />
            <Route path="/beta" element={<BetaPage />} />
            <Route path="/result" element={<ResultPage />} />
            <Route path="/t/:slug" element={<ToolPage />} />
            <Route path="/track" element={<TrackPage />} />
            <Route path="/log" element={<LogPage />} />
            <Route path="/record/:id" element={<RecordPage />} />
            <Route path="/dept/:dept" element={<DeptPage />} />
            <Route path="/tools" element={<ToolsPage />} />
            <Route path="/honesty" element={<HonestyPage />} />
            <Route path="/compare" element={<ComparePage />} />
            <Route path="/codes" element={<CodesPage />} />
            <Route path="/stall" element={<StallPage />} />
            <Route path="/priority" element={<PriorityPage />} />
            <Route path="/built" element={<BuiltPage />} />
            <Route path="/bug" element={<BugPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </Suspense>
      </main>

      {!bare && (
        <footer className="app-footer">
          <div className="footer-grid">
            <div className="footer-col">
              <h2 className="footer-title">일손 (ILSON)</h2>
              <p className="footer-text">
                현업의 반복 업무를 신청받아 검토하고 합의한 뒤, 실제 도구로 만들어
                효과까지 확인합니다.
              </p>
            </div>
            <nav className="footer-col" aria-labelledby="footer-stages-title">
              <h2 className="footer-title" id="footer-stages-title">여섯 단계</h2>
              <div className="footer-links">
                {STAGES.map((s, i) => (
                  <span key={s.key}>
                    {i > 0 && ' · '}
                    <Link to={s.path}>{s.no} {s.label}</Link>
                  </span>
                ))}
              </div>
            </nav>
            <nav className="footer-col" aria-labelledby="footer-crosscut-title">
              <h2 className="footer-title" id="footer-crosscut-title">운영 메뉴</h2>
              <div className="footer-links">
                {CROSSCUT.filter((c) => c.to !== '/bug').map((c, i) => (
                  <span key={c.to}>
                    {i > 0 && ' · '}
                    <Link to={c.to}>{c.label}</Link>
                  </span>
                ))}
                <span> · <Link to="/bug">버그 신고</Link></span>
              </div>
            </nav>
          </div>
          <div className="footer-bottom">
            <span>
              Cloudflare Pages Functions · D1 · 판정과 계산의 외부 AI 호출 0회
            </span>
            <span>가상의 회사·부서·데이터입니다. 실존하지 않습니다.</span>
          </div>
        </footer>
      )}
    </div>
  )
}
