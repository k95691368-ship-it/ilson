// Download is assembled in the browser. Original file bytes and cell previews
// are not required to identify the normalized result's source.
export function settlementCsv(rows) {
  const header = [
    '날짜', '주차', '채널', '상품코드', '상품명', '수량', '반품수량',
    '총매출', '할인', '반품액', '순매출', '수수료', '원가', '물류비', '광고비', '기여이익',
    '원본파일', '원본시트', '원본줄', '원본SHA256',
    '중복의심원본파일', '중복의심원본시트', '중복의심원본줄', '중복의심원본SHA256',
  ]
  const data = rows.map(r => [
    r.date, r.iso_week, r.channel, r.sku, r.sku_name, r.qty, r.return_qty,
    r.gross_krw, r.discount_krw, r.return_krw, r.net_revenue_krw, r.commission_krw,
    r.cogs_krw, r.logistics_krw, r.ad_krw, r.contribution_krw,
    r.source.file, r.source.sheet ?? '', r.source.rowNo, r.source.sha256 ?? '',
    r.duplicate_of?.file, r.duplicate_of?.sheet, r.duplicate_of?.rowNo, r.duplicate_of?.sha256,
  ])
  return '\uFEFF' + [header, ...data]
    .map(row => row.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\r\n')
}
