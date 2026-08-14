// 방문 기록을 구글 애널리틱스로 보낸다. 다만 주소를 그대로 보내지는 않는다.
//
// 이 사이트의 주소에는 **열쇠가 들어 있다.**
//
//   /track?no=AX-W34-64A   접수번호. 이 사이트에는 로그인이 없고, 이 번호
//                          하나가 그 신청서를 여는 유일한 열쇠다.
//   /t/settlement-1e1b33   넘겨받은 도구 주소. 아는 사람이 곧 쓸 수 있는 사람이다.
//   /record/app_9f2c…      신청서 한 건의 기록 문서.
//   /review?id=app_9f2c…   할 일 목록이 짚어 보낸 건.
//
// 애널리틱스 보고서는 주소를 그대로 목록으로 보여 준다. 손대지 않고 보내면
// **남의 신청서를 여는 열쇠가 구글 계정 화면에 줄줄이 쌓인다.** 이 사이트가
// "접수번호는 전화로 불러 줄 수 있어야 하지만 아무 데나 흘리면 안 되는 값"
// 이라고 다뤄 온 것과 정면으로 어긋난다.
//
// 그래서 id 자리를 이름으로 바꿔 보낸다. "어느 화면을 몇 번 봤는가"는 그대로
// 남고 "누구 것인지"는 빠진다 — 통계로 알고 싶은 것은 앞의 것이다.
//
// 물음표 뒤는 통째로 버린다. 지금 열쇠가 든 것은 `no` 하나지만, 나중에 누가
// 조회용 값을 하나 더 붙일 때 여기를 같이 고칠 것이라고 기대할 수 없다.
// 남기지 않는 쪽을 기본으로 둔다.
const MEASUREMENT_ID = 'G-CYR0Y4ZPPS'

// 이 앱이 주소에 넣는 값의 모양.
//
//   app_9f2c… dec_… bug_…   newId(prefix) 가 만든 것
//   AX-W34-64A               접수번호 (0/O·1/I/L 를 뺀 문자셋)
//   settlement-1e1b33        넘긴 도구의 slug
const PREFIXED = /^[a-z]+_[0-9a-f]{8,}$/i
const TICKET = /^AX-[A-Z0-9]{3}-[A-Z0-9]{3}$/i
const SLUGGED = /^[a-z0-9]+(-[a-z0-9]+)+$/i
const DIGITS = /^\d+$/

function looksLikeKey(segment) {
  return PREFIXED.test(segment) || TICKET.test(segment) || DIGITS.test(segment)
}

// 화면 이름표. 주소에서 열쇠를 뺀 모양이다.
//
//   /t/settlement-1e1b33  ->  /t/:slug
//   /record/app_9f2c…     ->  /record/:id
//   /dept/재무            ->  /dept/:dept
//
// 알려진 화면은 이름을 정해 두고, 그 밖의 것은 열쇠로 보이는 토막만 :id 로
// 바꾼다. 새 화면이 생겨도 여기를 고치지 않아 열쇠가 새는 일이 없게 한다.
const KNOWN = [
  [/^\/t\/[^/]+$/, '/t/:slug'],
  [/^\/record\/[^/]+$/, '/record/:id'],
  // 부서 이름은 사람을 특정하지 않지만 조직 안쪽 정보다. 어느 부서 화면을
  // 몇 번 봤는지까지 남의 계정에 쌓을 이유가 없다.
  [/^\/dept\/[^/]+$/, '/dept/:dept'],
]

export function redactPath(pathname) {
  const path = String(pathname || '/')
  for (const [pattern, label] of KNOWN) {
    if (pattern.test(path)) return label
  }
  return (
    path
      .split('/')
      .map((seg) => {
        if (looksLikeKey(seg)) return ':id'
        // 낱말-낱말 모양은 도구 slug 일 수 있다. 다만 첫 토막(화면 이름)은
        // 건드리지 않는다 — 그건 가려야 할 값이 아니다.
        return seg
      })
      .join('/') || '/'
  )
}

// 이 브라우저에서 태그가 살아 있는가.
//
// 광고 차단기가 gtag.js 를 막는 일이 흔하다. 그때 gtag 는 아예 없는 함수가
// 되므로, 부르기 전에 확인한다 — 통계 때문에 화면이 죽으면 안 된다.
function ready() {
  return typeof window !== 'undefined' && typeof window.gtag === 'function'
}

export function trackPageView(pathname) {
  if (!ready()) return
  const page_path = redactPath(pathname)
  window.gtag('event', 'page_view', {
    page_path,
    // 주소창 그대로가 아니라 가린 주소로 보낸다. page_location 을 비워 두면
    // 태그가 현재 주소를 스스로 채워 넣어, 가린 의미가 없어진다.
    page_location: `${window.location.origin}${page_path}`,
    page_title: document.title,
    send_to: MEASUREMENT_ID,
  })
}

export { MEASUREMENT_ID, SLUGGED }
