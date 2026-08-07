// "기술 구현 보러가기" 화면이 쓰는 숫자.
//
// 화면에 "테스트 1,000개"라고 손으로 적어 두면 그 숫자는 그날부터 낡는다.
// 그리고 이 사이트는 다른 자리에서 "숫자는 데이터에서 만들어지므로 잘
// 보이려고 손댈 수 없다"고 말한다. 자기 소개문에서만 손으로 적으면
// 그 말이 무너진다.
//
// 그렇다고 빌드 시점에 파일을 세는 것도 안 된다 — Workers 런타임에는
// 파일 시스템이 없다. 그래서 **셀 수 있는 것만 D1에서 세고**, 파일 개수처럼
// 런타임에 알 수 없는 것은 아예 안 보낸다. 화면은 값이 없으면 그 줄을
// 통째로 빼도록 되어 있다.

import { jsonResponse, jsonError } from '../_lib/http.js'

export async function onRequestGet({ env }) {
  try {
    // 실제로 만들어져 있는 표를 센다. 스키마가 부분 적용된 환경이면
    // 그만큼 적게 나오고, 그게 사실이다.
    const tables = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM sqlite_master
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf%'`
    ).first()

    return jsonResponse({
      counts: {
        tables: tables?.n ?? null,
        // 아래 셋은 런타임에 셀 수 없다. 빌드에 심는 방법도 있지만 그러면
        // 또 낡을 자리를 하나 더 만드는 것이라, 세지 못하는 것은 안 보낸다.
        tests: null,
        routes: null,
        pages: null,
        shared: null,
      },
    })
  } catch (err) {
    return jsonError(`세지 못했습니다. (${String(err.message).slice(0, 160)})`, 503)
  }
}
