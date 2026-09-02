import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { trackPageView } from '../lib/analytics.js'

const TITLES = {
  '/': '반복 업무를 실제 도구로',
  '/apply': '병목 해결 신청서',
  '/review': '신청서 검토와 판정',
  '/agreement': '협의안과 합격 기준',
  '/build': '제작 과정',
  '/beta': '베타 테스트 결과',
  '/result': '성과 정리',
  '/priority': '먼저 할 것',
  '/stall': '막힌 곳',
  '/tools': '넘긴 뒤',
  '/codes': '알려 준 코드',
  '/log': '결정 기록',
  '/honesty': '못 한 것',
  '/built': '기술 구현',
  '/track': '접수번호 조회',
  '/compare': '신청서 비교',
  '/bug': '버그 신고',
}

export function titleForPath(pathname) {
  if (TITLES[pathname]) return TITLES[pathname]
  if (pathname.startsWith('/t/')) return '부서 도구'
  if (pathname.startsWith('/record/')) return '신청 기록 문서'
  if (pathname.startsWith('/dept/')) return '부서별 기록'
  return '찾을 수 없는 화면'
}

// 화면이 바뀔 때마다 방문 기록을 보낸다.
//
// 이 사이트는 주소가 바뀌어도 브라우저가 새 문서를 받아오지 않는다(화면을
// 라우트 단위로 갈아 끼운다). 그래서 <head> 의 태그는 처음 한 번만 돌고,
// 그 뒤로는 검토를 하든 도구를 돌리든 애널리틱스에 아무것도 안 남는다.
// 첫 화면 하나만 계속 세는 셈이다.
//
// 라우터가 주소를 바꾸는 것을 여기서 듣고 직접 보낸다. 첫 화면도 여기서
// 보낸다 — <head> 에서는 send_page_view 를 꺼 두었다. 켜 두면 태그가 주소
// 표시줄 그대로(접수번호가 든 채로) 한 번 먼저 보내 버린다.
export default function PageViewTracker() {
  const { pathname } = useLocation()
  const title = titleForPath(pathname)

  useEffect(() => {
    trackPageView(pathname)
    document.title = `${title} — 일손`

    // SPA에서도 새 문서로 이동한 것처럼 본문 제목부터 읽게 한다.
    // preventScroll로 브라우저의 갑작스러운 점프는 막고, 실제 스크롤 위치는
    // 링크 이동을 처리하는 라우터와 사용자의 조작에 맡긴다.
    document.getElementById('main')?.focus({ preventScroll: true })
  }, [pathname, title])

  return (
    <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {title} 화면
    </span>
  )
}
