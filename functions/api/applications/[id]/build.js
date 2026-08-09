// 4단계 — 제작 기록.
//
// 합치는 계산은 브라우저에서 돈다. 여기는 "무엇이 나왔는가"를 기록으로 남기고,
// 사람이 알려 준 상품코드를 저장하는 자리다.
//
// 파일이 서버로 올라오지 않는 이유가 둘이다. 정산 자료를 굳이 밖으로 내보낼
// 이유가 없고, 올리고 기다리는 시간이 없어 결과가 즉시 나온다.

import { jsonResponse, jsonError, failFields } from '../../../_lib/http.js'
import { newId } from '../../../_lib/ids.js'
import { logDecision } from '../../../_lib/decisions.js'

// D1은 한 번에 보낼 수 있는 문장 수에 한계가 있다. 500줄씩 끊어 보낸다.
const CHUNK = 500

// 이 칸이 비면 저장 자체가 안 된다(스키마가 NOT NULL). 사람 말로 짚어 준다.
const ROW_REQUIRED = [
  ['date', '날짜'],
  ['iso_week', '주차'],
  ['sku', '상품코드'],
  ['channel', '채널'],
]

async function findApplication(env, id) {
  return env.DB.prepare(
    'SELECT id, ticket_no, dept, title, status FROM application WHERE id = ? OR ticket_no = ?'
  )
    .bind(id, id)
    .first()
}

export async function onRequestGet({ env, params, request }) {
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
      rows = rowsRes.results.map((r) => ({ ...r, trace: safeParse(r.trace_json, []) }))
      quarantine = quarantineRes.results.map((q) => ({ ...q, raw: safeParse(q.raw_json, []) }))
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
  } catch (err) {
    return jsonError(`제작 기록을 불러오지 못했습니다. (${String(err.message).slice(0, 160)})`, 503)
  }
}

export async function onRequestPost({ env, params, request }) {
  const app = await findApplication(env, params.id)
  if (!app) return jsonError('그런 신청서가 없습니다.', 404)

  let body
  try {
    body = await request.json()
  } catch {
    return jsonError('요청 형식이 올바르지 않습니다.', 400)
  }

  // 사람이 상품코드를 알려 주는 경우.
  if (body.kind === 'alias') {
    const external = String(body.external_code ?? '').trim()
    const canonical = String(body.canonical_code ?? '').trim()
    if (!external || !canonical) {
      return failFields({ canonical_code: '어느 상품인지 골라주세요.' })
    }
    try {
      await env.DB.prepare(
        `INSERT INTO sku_alias (external_code, canonical_code, channel, product_name, note, taught_by)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(external_code) DO UPDATE SET
           canonical_code = excluded.canonical_code,
           product_name = excluded.product_name,
           note = excluded.note,
           created_at = datetime('now')`
      )
        .bind(
          external,
          canonical,
          String(body.channel ?? '').trim() || null,
          String(body.product_name ?? '').trim() || null,
          String(body.note ?? '').trim() || null,
          String(body.taught_by ?? 'AX 담당자').trim()
        )
        .run()
      return jsonResponse({ ok: true, external_code: external, canonical_code: canonical }, 201)
    } catch (err) {
      return jsonError(`저장하지 못했습니다. (${String(err.message).slice(0, 160)})`, 500)
    }
  }

  // 실행 결과를 기록으로 남기는 경우.
  if (body.kind !== 'run') return jsonError('무엇을 저장할지 알 수 없습니다.', 400)

  const rows = Array.isArray(body.rows) ? body.rows : []
  const quarantine = Array.isArray(body.quarantine) ? body.quarantine : []
  if (rows.length === 0 && quarantine.length === 0) {
    return jsonError('저장할 결과가 없습니다.', 400)
  }

  // 줄을 넣기 전에 먼저 본다.
  //
  // 이 칸들이 비면 D1이 거절한다. 그런데 머리글은 이미 들어간 뒤라서 "2줄
  // 처리함"이라고 적힌 실행이 남고 정작 줄은 0개다. 화면은 그 머리글을 읽어
  // 처리 건수를 말하고, 숫자를 눌러 원본으로 되짚으려 하면 아무것도 없다.
  // 이 앱이 내내 하는 약속이 그 되짚기라서 이건 빈 표가 아니라 거짓말이다.
  const missing = []
  for (const [i, r] of rows.entries()) {
    for (const [key, label] of ROW_REQUIRED) {
      if (r?.[key] == null || r[key] === '') missing.push(`${i + 1}번째 줄의 ${label}`)
    }
  }
  for (const [i, q] of quarantine.entries()) {
    if (q?.reason == null || q.reason === '') missing.push(`${i + 1}번째 밀린 줄의 사유`)
  }
  if (missing.length > 0) {
    return failFields(
      missing.slice(0, 5),
      '비어 있는 칸이 있어 아무것도 저장하지 않았습니다. 반만 저장하면 처리했다고 적힌 채 되짚을 줄이 없는 기록이 남습니다.'
    )
  }

  const runId = newId('run')

  try {
    const seq =
      ((
        await env.DB.prepare('SELECT MAX(seq) AS n FROM build_run WHERE application_id = ?')
          .bind(app.id)
          .first()
      )?.n ?? 0) + 1

    await env.DB.prepare(
      `INSERT INTO build_run
         (id, application_id, seq, files_json, rows_out, quarantined, duplicate_suspects,
          duration_ms, totals_json, ran_where, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'browser', ?)`
    )
      .bind(
        runId,
        app.id,
        seq,
        JSON.stringify(body.files ?? []),
        rows.length,
        quarantine.length,
        Number(body.duplicate_suspects) || 0,
        Number(body.duration_ms) || null,
        JSON.stringify(body.totals ?? null),
        String(body.note ?? '').trim() || null
      )
      .run()

    // 줄이 많아 나눠 보낸다. 한 번에 전부 보내면 D1이 거절한다.
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK)
      await env.DB.batch(
        chunk.map((r, j) =>
          env.DB.prepare(
            `INSERT INTO build_row
               (id, run_id, row_no, date, iso_week, sku, sku_name, channel, qty, return_qty,
                src_currency, fx_rate, gross_krw, discount_krw, return_krw, net_revenue_krw,
                commission_krw, reported_commission_krw, cogs_krw, logistics_krw, ad_krw,
                contribution_krw, source_file, source_sheet, source_row_no, trace_json,
                has_duplicate, duplicate_of)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(
            newId('brw'),
            runId,
            i + j + 1,
            r.date,
            r.iso_week,
            r.sku,
            r.sku_name ?? null,
            r.channel,
            r.qty ?? 0,
            r.return_qty ?? 0,
            r.src_currency ?? 'KRW',
            r.fx_rate ?? 1,
            r.gross_krw ?? 0,
            r.discount_krw ?? 0,
            r.return_krw ?? 0,
            r.net_revenue_krw ?? 0,
            r.commission_krw ?? 0,
            r.reported_commission_krw ?? null,
            r.cogs_krw ?? 0,
            r.logistics_krw ?? 0,
            r.ad_krw ?? 0,
            r.contribution_krw ?? 0,
            r.source?.file ?? '',
            r.source?.sheet ?? null,
            r.source?.rowNo ?? 0,
            JSON.stringify(r.trace ?? []),
            r.has_duplicate ? 1 : 0,
            r.duplicate_of ? `${r.duplicate_of.file}:${r.duplicate_of.rowNo}` : null
          )
        )
      )
    }

    for (let i = 0; i < quarantine.length; i += CHUNK) {
      const chunk = quarantine.slice(i, i + CHUNK)
      await env.DB.batch(
        chunk.map((q) =>
          env.DB.prepare(
            `INSERT INTO build_quarantine
               (id, run_id, reason, source_file, source_sheet, source_row_no,
                external_code, product_name, raw_json, note)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(
            newId('bqr'),
            runId,
            q.reason,
            q.source?.file ?? '',
            q.source?.sheet ?? null,
            q.source?.rowNo ?? 0,
            q.externalCode ?? null,
            q.productName ?? null,
            JSON.stringify(q.raw ?? []),
            q.note ?? null
          )
        )
      )
    }

    // 첫 실행만 기록에 남긴다. 같은 파일을 다시 돌릴 때마다 로그가 쌓이면
    // 정작 중요한 결정이 묻힌다.
    if (seq === 1) {
      await logDecision(env, {
        applicationId: app.id,
        stage: '제작',
        title: '처음으로 다섯 장을 합쳐 봤다',
        what: `${rows.length}줄이 나왔고 ${quarantine.length}줄은 검토함으로 뺐다.`,
        why: '합계 줄과 모르는 상품코드를 조용히 버리면 합계가 조용히 틀린다. 버리지 않고 사람이 보게 한다.',
        linkKind: 'build_run',
        linkId: runId,
      }).catch(() => {})
    }

    await env.DB.prepare(
      "UPDATE application SET status = '진행중', updated_at = datetime('now') WHERE id = ? AND status = '수용'"
    )
      .bind(app.id)
      .run()
      .catch(() => {})

    return jsonResponse({ ok: true, run_id: runId, seq }, 201)
  } catch (err) {
    // 머리글은 들어갔는데 줄에서 엎어지면 "N줄 처리함"이라고 적힌 채 되짚을
    // 줄이 하나도 없는 실행이 남는다. 화면은 그 머리글을 읽으니 처리 건수는
    // 멀쩡해 보이고, 눌러 봐야 빈다 — 실제로 라이브에서 그런 실행이 하나
    // 생겼다. 못 끝냈으면 흔적을 거둔다. 실패는 화면에 남지 기록에 남지 않는다.
    for (const table of ['build_row', 'build_quarantine', 'build_run']) {
      await env.DB.prepare(
        `DELETE FROM ${table} WHERE ${table === 'build_run' ? 'id' : 'run_id'} = ?`
      )
        .bind(runId)
        .run()
        .catch(() => {})
    }
    return jsonError(`제작 기록을 저장하지 못했습니다. (${String(err.message).slice(0, 200)})`, 500)
  }
}

function safeParse(text, fallback) {
  try {
    return text ? JSON.parse(text) : fallback
  } catch {
    return fallback
  }
}
