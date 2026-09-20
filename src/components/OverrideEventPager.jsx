export default function OverrideEventPager({ listing, label = '판단 사건 페이지' }) {
  if (!listing.hasPrevious && !listing.page?.hasMore) return null
  return <nav className="field-caption" aria-label={label}>
    <button className="ol-secondary" type="button" disabled={listing.loading || !listing.hasPrevious} onClick={listing.previous}>이전 사건 페이지</button>
    <span className="field-muted">{listing.pageNumber}페이지 · {listing.loading ? '불러오는 중입니다.' : listing.page?.hasMore ? '오래된 사건은 다음 페이지에서 확인하세요.' : '마지막 사건 페이지입니다.'}</span>
    <button className="ol-secondary" type="button" disabled={listing.loading || !listing.page?.hasMore} onClick={listing.next}>다음 사건 페이지</button>
  </nav>
}
