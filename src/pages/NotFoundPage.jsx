import { Link } from 'react-router-dom'

export default function NotFoundPage() {
  return (
    <div className="notfound">
      <h1>여기에는 아무것도 없습니다</h1>
      <p className="page-sub" style={{ margin: '0 auto 20px' }}>
        주소가 바뀌었거나, 아직 만들지 않은 화면입니다.
      </p>
      <Link to="/" className="btn-nav">
        작업대로 돌아가기
      </Link>
    </div>
  )
}
