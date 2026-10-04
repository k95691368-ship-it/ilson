// Download is assembled in the browser. Original file bytes and cell previews
// are not required to identify the normalized result's source.
// This CSV is for spreadsheet review, not a lossless machine interchange.
// OWASP recommends a tab inside the quoted field for formula-shaped Excel text:
// https://community.owasp.org/attacks/CSV_Injection
// The tab is part of the exported value; other spreadsheet/import modes differ.
// eslint-disable-next-line no-control-regex -- Leading controls must not hide a spreadsheet formula prefix.
const FORMULA_TEXT = /^[\s\u0000-\u001f\u007f]*[=+\-@＝＋－＠]/u

function csvCell(value) {
  let text = String(value ?? '')
  // Pipeline amounts/counts are numbers. Never turn a real negative amount into
  // text, and never change the original row/source when protecting its export.
  if (typeof value !== 'number' && (FORMULA_TEXT.test(text) || /^[\t\r\n]/.test(text))) text = '\t' + text
  return `"${text.replace(/"/g, '""')}"`
}

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
    .map(row => row.map(csvCell).join(','))
    .join('\r\n')
}
