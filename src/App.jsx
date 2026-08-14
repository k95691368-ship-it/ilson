import { Suspense, lazy, useEffect } from 'react'
import { Routes, Route, NavLink, Link, useLocation } from 'react-router-dom'
import ThemeToggle from './components/ThemeToggle.jsx'
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

  return (
    <div className="app-shell">
      {/* 주소가 바뀌어도 새 문서를 안 받아오므로, 화면 이동을 여기서 듣고
          직접 보낸다. 열쇠(접수번호·도구 주소·신청서 id)는 가려서 보낸다. */}
      <PageViewTracker />
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
            <span className="topbar-brand-sub">부서 병목을 도구로 바꾸는 여섯 단계</span>
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

            {/* 여섯 단계 밖의 칸은 이것 하나다. 나머지 가로로 훑는 화면들은
                꼬리말에 있다 — 목차에 열네 칸을 한꺼번에 내밀면 처음 온
                사람은 어디부터 눌러야 할지 모른다.
                버그 신고만 목차에 두는 이유: 이 사이트가 이상하게 굴 때
                말할 데가 여태 없었다. 부서가 낸 일만 받고 자기 버그는 안
                받으면, 다른 화면에서 하는 "못 한 것을 숨기지 않는다"가
                안쪽에서 먼저 깨진다. 그리고 이상한 것을 본 사람은 그 자리에서
                말할 수 있어야 한다 — 꼬리말까지 내려가면 그냥 닫는다. */}
            <NavLink
              to="/bug"
              className={({ isActive }) => `topbar-link${isActive ? ' active' : ''}`}
            >
              <span className="topbar-link-no" aria-hidden="true">
                0
              </span>
              버그 신고
            </NavLink>
          </nav>

          <div className="topbar-right">
            {/* 여기 여섯 칸이 더 있었다 — 먼저 할 것·막힌 곳·주간·넘긴 뒤·
                못 한 것·기록. 전부 뺐다.
                셋(먼저 할 것·막힌 곳·주간)은 첫 화면 할 일 목록이 이미
                같은 것을 말하고 있었다. 나머지 셋은 화면은 남기고 링크만
                제 자리로 옮겼다 — 넘긴 뒤는 배포 단계에서, 못 한 것과
                기록은 첫 화면에서 간다. 목차 옆에 늘어놓을수록 처음 온
                사람은 어디부터 눌러야 할지 모른다. */}
            <NavLink
              to="/built"
              className={({ isActive }) => `topbar-link built-link${isActive ? ' active' : ''}`}
            >
              기술 구현 보러가기
            </NavLink>
            <ThemeToggle />
          </div>
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
              <div className="footer-title">일손 (ILSON)</div>
              <p className="footer-text">
                각 부서가 병목을 신청서로 적어 내면, AX 담당자가 검토하고 협의해 도구로 만들고,
                베타 테스트를 거쳐 성과를 정리하기까지의 과정 전체입니다.
              </p>
            </div>
            <div className="footer-col">
              <div className="footer-title">여섯 단계</div>
              <p className="footer-text">
                {STAGES.map((s) => `${s.no} ${s.label}`).join(' · ')}
              </p>
            </div>
            {/* 여섯 단계를 세로로 내려가는 것이 아니라 **가로로 훑는** 화면들.
                목차에 같이 걸어 뒀다가 뺐다 — 처음 온 사람에게 열네 칸을 한꺼번에
                내밀면 어디부터 눌러야 할지 모른다.
                그렇다고 링크를 아예 없애면 안 된다. 이 화면들로 가는 다른 길은
                첫 화면 할 일 목록뿐인데, 그건 **할 일이 있을 때만** 뜬다. 지금처럼
                신청서가 없는 상태에서는 아무 데서도 못 간다. 이 저장소에서 제일
                자주 난 사고가 바로 그것이다 — 만들어는 뒀는데 아무도 못 가는 것.
                꼬리말은 늘 있고, 목차와 자리를 다투지 않는다. */}
            <div className="footer-col">
              <div className="footer-title">가로로 훑어보기</div>
              <p className="footer-text">
                {CROSSCUT.map((c, i) => (
                  <span key={c.to}>
                    {i > 0 && ' · '}
                    <Link to={c.to}>{c.label}</Link>
                  </span>
                ))}
              </p>
            </div>
          </div>
          <div className="footer-bottom">
            {/* 여기가 아무것도 밖으로 안 부른다고 적고 있었다. 사실이 아니었다 —
                글꼴을 CDN 에서 받아 오고 있었고, 이제 방문 통계도 보낸다.
                판정·계산·금액에 외부를 안 부른다는 것이 원래 하려던 말이라
                그 말만 남기고 나머지는 있는 대로 적는다. */}
            <span>
              Cloudflare Pages Functions · D1 · 판정과 계산은 외부 호출 없음 (글꼴·방문 통계 제외)
            </span>
            <span>가상의 회사·부서·데이터입니다. 실존하지 않습니다.</span>
          </div>
        </footer>
      )}
    </div>
  )
}
