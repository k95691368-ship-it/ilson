import { Link } from 'react-router-dom'

export default function NotFoundPage() {
  return (
    <div className="notfound">
      <h1>페이지를 찾을 수 없습니다</h1>
      <p className="page-sub" style={{ margin: '0 auto 20px' }}>
        주소를 확인해 주세요.
      </p>
      <Link to="/" className="btn-nav">
        작업대로 돌아가기
      </Link>
    </div>
  )
}
