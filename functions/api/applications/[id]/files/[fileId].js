// 부서가 신청서에 올린 파일을 담당자가 본다.
//
// 지금까지 파일 이름만 보이고 열어 볼 수가 없었다. 담당자가 신청서를 검토하려면
// 그 파일을 봐야 하는데, 결국 "그 파일 메일로 보내 주세요"가 된다.
// 파일을 받아 두고 못 보게 하는 것은 안 받는 것보다 나쁘다.
//
// 두 가지를 준다.
//   ?preview=1  → 앞부분만 읽어 표로 보여 준다 (내려받지 않고 확인)
//   그 외        → 원본 그대로 내려받기

import { jsonResponse, jsonError } from '../../../../_lib/http.js'
import { readCsv, fileKind } from '../../../../../shared/csv.js'
import { readXlsx, toTable } from '../../../../../shared/xlsx.js'

const PREVIEW_ROWS = 12

async function findFile(env, appId, fileId) {
  return env.DB.prepare(
    `SELECT f.*, a.id AS app_id, a.ticket_no
     FROM application_file f
     JOIN application a ON a.id = f.application_id
     WHERE f.id = ? AND (a.id = ? OR a.ticket_no = ?)`
  )
    .bind(fileId, appId, appId)
    .first()
}

export async function onRequestGet({ env, params, request }) {
  const row = await findFile(env, params.id, params.fileId)
  if (!row) return jsonError('그런 파일이 없습니다.', 404)

  const url = new URL(request.url)
  const wantPreview = url.searchParams.get('preview') === '1'

  let object
  try {
    object = await env.SOURCES.get(row.r2_key)
  } catch (err) {
    return jsonError(`파일 보관함을 읽지 못했습니다. (${String(err.message).slice(0, 120)})`, 503)
  }
  if (!object) {
    return jsonError('파일이 보관함에 없습니다. 담당자에게 알려주세요.', 404)
  }

  // 미리보기 — 앞부분만 읽어 표로 만든다. 내려받아 열지 않고 확인할 수 있다.
  if (wantPreview) {
    const kind = fileKind(row.name)
    if (kind === 'other') {
      return jsonResponse({
        name: row.name,
        kind,
        note: '표 파일이 아니라 미리 보여드릴 수 없습니다. 내려받아 확인해주세요.',
      })
    }

    try {
      const buffer = await object.arrayBuffer()
      const tables = kind === 'csv' ? [readCsv(buffer)] : (await readXlsx(buffer)).map(toTable)

      return jsonResponse({
        name: row.name,
        kind,
        byteSize: row.byte_size,
        sheets: tables.map((t) => ({
          sheetName: t.sheetName,
          encoding: t.encoding ?? null,
          // 판별에 확신이 있었는지. 이걸 안 실어 보내서 화면이 인코딩
          // 이름만 보고 색을 추측했고, 제대로 읽어 낸 CP949에 노란 경고를
          // 붙이고 판별 못 한 것에 회색 중립을 붙이고 있었다. 정확히 반대다.
          // xlsx에는 없는 값이라 없으면 확신한 것으로 본다.
          encodingConfident: t.encodingConfident ?? true,
          headerRowNo: t.headerRowNo,
          header: t.header,
          rows: t.rows.slice(0, PREVIEW_ROWS).map((r) => ({ rowNo: r.rowNo, cells: r.cells })),
          totalRows: t.rows.length,
        })),
      })
    } catch (err) {
      return jsonResponse({
        name: row.name,
        kind,
        note: `파일을 열지 못했습니다: ${String(err.message).slice(0, 120)}`,
      })
    }
  }

  // 내려받기.
  //
  // 파일 이름에 한글이 흔해서 filename* 형식으로 함께 적는다. 이게 없으면
  // 브라우저마다 이름이 깨지거나 물음표로 바뀐다.
  const encoded = encodeURIComponent(row.name)
  return new Response(object.body, {
    headers: {
      'Content-Type': row.content_type || 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${encoded}"; filename*=UTF-8''${encoded}`,
      'Content-Length': String(row.byte_size),
      // 신청서 첨부는 사내 자료다. 중간 서버가 들고 있지 않게 한다.
      'Cache-Control': 'private, no-store',
    },
  })
}
