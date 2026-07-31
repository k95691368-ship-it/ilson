import { useParams, Link } from 'react-router-dom'

// 부서에 넘긴 도구가 열리는 화면.
//
// 여기에는 상단 목차도 제작 과정도 없다. 현업 담당자는 이 도구가 어떻게
// 만들어졌는지 알 필요가 없고, 파일을 넣고 결과를 받으면 된다. 그래서 셸을
// 지우고(App.jsx의 bare 레이아웃) 화면에 남기는 것은 셋뿐이다 —
// 넣는 자리, 실행, 내려받기.
export default function ToolPage() {
  const { slug } = useParams()

  return (
    <div className="stack">
      <header className="page-head">
        <span className="page-eyebrow">인수인계된 도구</span>
        <h1>{slug}</h1>
        <p className="page-sub">
          이 화면은 도구를 넘겨받은 부서 담당자가 여는 자리입니다. 제작 과정은 보이지 않습니다.
        </p>
      </header>

      <section className="planned">
        <div className="planned-title">여기에 들어갈 것</div>
        <ul className="planned-list">
          <li>파일 넣는 자리 — 이 도구가 받는 파일 형식을 그대로 안내</li>
          <li>실행과 결과 내려받기</li>
          <li>처리하지 못한 행 — 있으면 무엇이 왜 남았는지</li>
          <li>사용 한도 — 오늘 남은 실행 횟수, 파일 크기 상한</li>
          <li>막혔을 때 — 사용법서로 가는 길과 담당자 연락처</li>
        </ul>
      </section>

      <p className="card-note">
        <Link to="/deploy">← 배포 단계로 돌아가기</Link>
      </p>
    </div>
  )
}
