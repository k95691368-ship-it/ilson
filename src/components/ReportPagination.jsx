export default function ReportPagination({ feed }) {
  const { data, error, changed, denied, loading, shown } = feed
  return <div className="stack-sm" aria-label="신고 목록 탐색">
    {error && <div className="notice notice-danger" role="alert">
      <p>{error}</p>
      {changed && <p>목록이 바뀌었습니다. 이전 페이지의 원문을 숨겼습니다. 첫 페이지에서 다시 확인해주세요.</p>}
      {data && <p>아래 원문은 마지막 조회 결과입니다. 다시 조회하기 전에는 처리할 수 없습니다.</p>}
      {!denied && <button type="button" className="btn-ghost btn-sm" disabled={loading} onClick={changed ? feed.first : feed.retry}>
        {changed ? '첫 페이지 다시 확인' : '신고 목록 다시 조회'}
      </button>}
    </div>}
    {loading && <p className="card-note" role="status">신고 목록을 불러오는 중…</p>}
    {data && <>
      <p className="card-note">현재 페이지 원문 {shown}건 · 전체 신고 {data.page.total}건 · {data.page.number} / {Math.max(1, data.page.totalPages)}페이지</p>
      <div className="row" role="navigation" aria-label="신고 페이지">
        <button type="button" className="btn-ghost btn-sm" disabled={feed.locked || !data.page.hasPrevious} onClick={feed.previous}>이전 페이지</button>
        <button type="button" className="btn-ghost btn-sm" disabled={feed.locked || !data.page.hasMore || data.page.number >= 10000} onClick={feed.next}>다음 페이지</button>
        <button type="button" className="btn-ghost btn-sm" disabled={loading || denied} onClick={feed.first}>첫 페이지 다시 확인</button>
      </div>
      {data.page.total === 0 ? <p className="card-note">아직 들어온 신고가 없습니다.</p>
        : shown === 0 && <p className="card-note">이 페이지에는 신고 원문이 없습니다. 첫 페이지에서 다시 확인해주세요.</p>}
    </>}
  </div>
}
