// 4단계 — 제작 기록.
//
// 합치는 계산은 브라우저에서 돈다. 여기는 "무엇이 나왔는가"를 기록으로 남기고,
// 사람이 알려 준 상품코드를 저장하는 자리다.
//
// 파일이 서버로 올라오지 않는 이유가 둘이다. 정산 자료를 굳이 밖으로 내보낼
// 이유가 없고, 올리고 기다리는 시간이 없어 결과가 즉시 나온다.

import { jsonResponse, jsonError, failUnexpected } from '../../../_lib/http.ts'
import { saveBuildAlias } from '../../../_lib/buildAlias.ts'
import { saveBuildRun } from '../../../_lib/buildRun.ts'
import { decodeBuildTrace, decodeBuildQuarantine } from '../../../../shared/buildRecordSource.js'

async function findApplication(env, id) {
  return env.DB.prepare(
    'SELECT id, ticket_no, dept, title, status FROM application WHERE id = ? OR ticket_no = ?'
  )
    .bind(id, id)
    .first()
}

export async function onRequestGet({ env, data: requestData, params, request }) {
  env = requestData?.requestEnv ?? env
  const app = await findApplication(env, params.id)
  if (!app) return jsonError('그런 신청서가 없습니다.', 404)

  const url = new URL(request.url)
  const wantRows = url.searchParams.get('rows') === '1'

  try {
    const { results: runs } = await env.DB.prepare(
      `SELECT id, seq, files_json, rows_out, quarantined, duplicate_suspects,
              duration_ms, totals_json, ran_where, note, created_at
       FROM build_run WHERE application_id = ? ORDER BY seq DESC LIMIT 20`
    )
      .bind(app.id)
      .all()

    const latest = runs[0] ?? null
    let rows = []
    let quarantine = []

    if (latest) {
      const [rowsRes, quarantineRes] = await Promise.all([
        wantRows
          ? env.DB.prepare('SELECT * FROM build_row WHERE run_id = ? ORDER BY row_no')
              .bind(latest.id)
              .all()
          : Promise.resolve({ results: [] }),
        env.DB.prepare(
          'SELECT * FROM build_quarantine WHERE run_id = ? ORDER BY reason, source_file, source_row_no'
        )
          .bind(latest.id)
          .all(),
      ])
      rows = rowsRes.results.map((r) => ({ ...r, ...decodeBuildTrace(r.trace_json) }))
      quarantine = quarantineRes.results.map((q) => ({ ...q, ...decodeBuildQuarantine(q.raw_json) }))
    }

    const { results: aliases } = await env.DB.prepare(
      'SELECT * FROM sku_alias ORDER BY created_at DESC'
    ).all()

    return jsonResponse({
      application: app,
      runs: runs.map((r) => ({
        ...r,
        files: safeParse(r.files_json, []),
        totals: safeParse(r.totals_json, null),
      })),
      rows,
      quarantine,
      aliases,
    })
  } catch (error) {
    return failUnexpected(error, '제작 기록을 불러오지 못했습니다.')
  }
}

export async function onRequestPost({ env, data: requestData, params, request }) {
  env = requestData?.requestEnv ?? env
  const app = await findApplication(env, params.id)
  if (!app) return jsonError('그런 신청서가 없습니다.', 404)

  let body
  try {
    body = await request.json()
  } catch {
    return jsonError('요청 형식이 올바르지 않습니다.', 400)
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return jsonError('요청 형식이 올바르지 않습니다.', 400)

  // 사람이 상품코드를 알려 주는 경우.
  if (body.kind === 'alias') {
    return saveBuildAlias(env, app.id, body, request.headers.get('X-Idempotency-Key'))
  }

  // 실행 결과를 기록으로 남기는 경우.
  if (body.kind !== 'run') return jsonError('무엇을 저장할지 알 수 없습니다.', 400)
  return saveBuildRun(env, app.id, body, request.headers.get('X-Idempotency-Key'))
}

function safeParse(text, fallback) {
  try {
    return text ? JSON.parse(text) : fallback
  } catch {
    return fallback
  }
}
