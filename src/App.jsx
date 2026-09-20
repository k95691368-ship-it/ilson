import { Suspense, lazy, useEffect } from 'react'
import { Routes, Route, Link, Navigate, useLocation } from 'react-router-dom'
import PageViewTracker from './components/PageViewTracker.jsx'
import SiteNav from './components/SiteNav.jsx'
import DemoWorkspaceBar from './components/DemoWorkspaceBar.jsx'
import { DEPTS } from '../shared/depts.js'

const JourneyPage = lazy(() => import('./pages/JourneyPage.jsx'))
const OverridePage = lazy(() => import('./pages/OverridePage.jsx'))
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
  { to: '/journey', label: '통합 이력', note: '신청에서 운영 사건과 개선 실험까지' },
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

function useWorkspaceLayout() {
  const path = useLocation().pathname
  return path === '/' || path === '/override'
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
  const workspace = useWorkspaceLayout()
  const privateJourney = useLocation().pathname.startsWith('/journey')
  usePrintUnfold()

  return (
    <div className={`app-shell${bare ? ' app-shell-bare' : ''}${workspace ? ' app-shell-workspace' : ''}`}>
      {/* 주소가 바뀌어도 새 문서를 안 받아오므로, 화면 이동을 여기서 듣고
          직접 보낸다. 열쇠(접수번호·도구 주소·신청서 id)는 가려서 보낸다. */}
      <PageViewTracker />
      <a className="skip-link" href="#main" onClick={event => {
        // Keep a real anchor for modified clicks and non-JavaScript fallback.
        // Ordinary activation moves focus without replacing a workspace's
        // menu fragment or adding a second history entry for the same screen.
        if (event.defaultPrevented || event.button > 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
        const main = document.getElementById('main')
        if (!main) return
        event.preventDefault()
        main.focus({ preventScroll: true })
        main.scrollIntoView({ block: 'start', behavior: 'instant' })
      }}>
        본문으로 건너뛰기
      </a>

      {!bare && <SiteNav />}
      <DemoWorkspaceBar />

      {bare && !workspace && (
        <header className="barebar">
          <Link to="/" className="barebar-brand" aria-label="OverrideLoop 운영판">
            <span aria-hidden="true">IL</span>
            <strong>OverrideLoop</strong>
          </Link>
          <span className="spacer" />
          <Link to="/" className="barebar-back">운영판으로 →</Link>
        </header>
      )}

      {/* 클레어티가 화면을 녹화한다. 부서 담당자가 여는 세 화면은 통째로
          가린다 — 접수번호 조회, 넘겨받은 도구, 기록 문서.
          도구 화면이 특히 그렇다. 이 사이트는 "파일이 서버로 가지 않습니다"를
          내세우는데, 넣은 파일의 계산 결과가 뜬 화면을 녹화해 보내면 그
          약속이 뒷문으로 깨진다. 세 화면은 목차·꼬리말도 없이 여는 자리라
          bare 하나로 같이 잡힌다. */}
      <main
        className={workspace ? 'app-main app-main-workspace' : bare ? 'app-main app-main-bare' : 'app-main'}
        id="main"
        tabIndex="-1"
        data-clarity-mask={bare || privateJourney ? 'true' : undefined}
      >
        <Suspense fallback={<div className="page-loading">불러오는 중…</div>}>
          <Routes>
            <Route path="/" element={<OverridePage />} />
            <Route path="/override" element={<OverridePage />} />
            <Route path="/portfolio" element={<Navigate to="/" replace />} />
            <Route path="/journey" element={<JourneyPage />} />
            <Route path="/journey/:id" element={<JourneyPage />} />
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
          <details className="footer-menu">
            <summary>운영 메뉴</summary>
            <nav aria-label="운영 메뉴">
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
            <nav className="footer-departments" aria-label="부서별 기록">
              {DEPTS.map((dept) => (
                <Link key={dept} to={`/dept/${encodeURIComponent(dept)}`}>{dept}</Link>
              ))}
            </nav>
          </details>
        </footer>
      )}
    </div>
  )
}
