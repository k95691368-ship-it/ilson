import { useEffect, useMemo, useRef, useState } from 'react'
import StageHeader from '../components/StageHeader.jsx'
import { useApi } from '../hooks/useApi.js'
import { useToast } from '../context/ToastContext.jsx'
import { api } from '../api/client.js'
import { krw, num, ms, ago } from '../lib/format.js'
import { runPipeline, QUARANTINE_REASONS } from '../../shared/pipeline.js'
import { SKUS } from '../../shared/master.js'

// 시연용 파일 다섯 장이 여기 박혀 있었다. 카드도 버튼도 실물 파일도 지웠다.
// 이 화면은 이제 넣은 파일만 처리한다.

export default function BuildPage() {
  const { data: list } = useApi('/applications')
  const [selectedId, setSelectedId] = useState(null)

  const targets = useMemo(
    () => (list?.items ?? []).filter((a) => ['수용', '진행중', '완료'].includes(a.status)),
    [list]
  )

  useEffect(() => {
    if (!selectedId && targets.length > 0) setSelectedId(targets[0].id)
  }, [targets, selectedId])

  return (
    <div className="stack">
      <StageHeader stageKey="build" />

      {targets.length === 0 ? (
        <div className="empty">
          <div className="empty-title">만들 과제가 없습니다</div>
          <div className="empty-sub">2단계에서 수용한 신청서가 여기로 넘어옵니다.</div>
        </div>
      ) : (
        <>
          <div className="chip-row">
            {targets.map((a) => (
              <button
                key={a.id}
                type="button"
                className={`chip${selectedId === a.id ? ' on' : ''}`}
                onClick={() => setSelectedId(a.id)}
              >
                {a.dept} · {a.title.slice(0, 22)}
                {a.title.length > 22 && '…'}
              </button>
            ))}
          </div>
          {selectedId && <Build id={selectedId} />}
        </>
      )}
    </div>
  )
}

function Build({ id }) {
  const { data, error, loading, reload } = useApi(`/applications/${id}/build?rows=1`)
  const toast = useToast()
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState('')
  const [selectedRow, setSelectedRow] = useState(null)
  const fileInput = useRef(null)

  // 사람이 알려 준 상품코드를 합치기 규칙에 넘긴다.
  // 이게 "한 번 알려 주면 다음부터 자동"의 실체다.
  const aliasMap = useMemo(
    () => Object.fromEntries((data?.aliases ?? []).map((a) => [a.external_code, a.canonical_code])),
    [data]
  )

  async function runWith(files) {
    setRunning(true)
    setProgress('파일을 읽는 중…')
    try {
      const result = await runPipeline({ files, aliases: aliasMap })
      setProgress('결과를 기록하는 중…')

      await api.post(`/applications/${id}/build`, {
        kind: 'run',
        files: result.files,
        rows: result.rows,
        quarantine: result.quarantine,
        totals: result.totals,
        duplicate_suspects: result.stats.duplicateSuspects,
        duration_ms: result.stats.durationMs,
      })

      toast.success(
        `${num(result.rows.length)}줄을 합쳤습니다. ${num(result.quarantine.length)}줄은 검토함으로 뺐습니다.`
      )
      setSelectedRow(null)
      await reload()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setRunning(false)
      setProgress('')
    }
  }

  async function runUploaded(fileList) {
    const files = await Promise.all(
      [...fileList].map(async (f) => ({ name: f.name, buffer: await f.arrayBuffer() }))
    )
    if (files.length === 0) return
    await runWith(files)
  }

  if (loading && !data) return <div className="page-loading">불러오는 중…</div>
  if (error) return <div className="notice notice-danger">{error}</div>
  if (!data) return null

  const latest = data.runs[0] ?? null

  return (
    <div className="stack">
      <section className="card">
        <div className="card-head">
          <span className="card-title">파일을 넣으면 합칩니다</span>
          <span className="badge badge-success">계산은 이 브라우저에서 돕니다</span>
        </div>

        <div className="row" style={{ marginTop: 12 }}>
          <input
            ref={fileInput}
            type="file"
            multiple
            className="sr-only"
            accept=".csv,.xlsx,.xls,.txt"
            onChange={(e) => {
              runUploaded(e.target.files)
              e.target.value = ''
            }}
          />
          <button
            type="button"
            className="btn-primary"
            onClick={() => fileInput.current?.click()}
            disabled={running}
          >
            {running ? progress || '돌리는 중…' : '파일 넣기'}
          </button>
          {data.aliases.length > 0 && (
            <span className="card-note">
              알려 준 상품코드 {data.aliases.length}개가 이번 실행에 적용됩니다
            </span>
          )}
        </div>
      </section>

      {latest && (
        <>
          <section className="stat-row">
            <Tile label="합친 줄" value={num(latest.rows_out)} note={`${data.runs.length}번째 실행`} />
            <Tile
              label="검토함"
              value={num(latest.quarantined)}
              note="버리지 않고 사람이 본다"
              tone={latest.quarantined > 0 ? 'warn' : undefined}
            />
            <Tile
              label="걸린 시간"
              value={ms(latest.duration_ms)}
              note="브라우저에서 계산"
            />
            <Tile
              label="바깥에 물어본 횟수"
              value="0"
              note="AI도 외부 서비스도 부르지 않음"
            />
            {latest.totals?.all && (
              <Tile
                label="기여이익"
                value={krw(latest.totals.all.contribution_krw)}
                note={`순매출 ${krw(latest.totals.all.net_revenue_krw)}`}
              />
            )}
          </section>

          {latest.totals?.byChannel && (
            <section className="card">
              <div className="card-head">
                <span className="card-title">채널별</span>
              </div>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>채널</th>
                      <th className="num">줄</th>
                      <th className="num">수량</th>
                      <th className="num">순매출</th>
                      <th className="num">수수료</th>
                      <th className="num">정산서상 수수료</th>
                      <th className="num">기여이익</th>
                    </tr>
                  </thead>
                  <tbody>
                    {latest.totals.byChannel.map((t) => {
                      const gap = t.reported_commission_krw
                        ? t.reported_commission_krw - t.commission_krw
                        : null
                      return (
                        <tr key={t.channel}>
                          <td>{t.channel}</td>
                          <td className="num">{num(t.rows)}</td>
                          <td className="num">{num(t.qty)}</td>
                          <td className="num">{krw(t.net_revenue_krw)}</td>
                          <td className="num">{krw(t.commission_krw)}</td>
                          <td className="num">
                            {t.reported_commission_krw ? krw(t.reported_commission_krw) : '—'}
                            {gap != null && Math.abs(gap) > 1000 && (
                              <span
                                className={`badge ${gap > 0 ? 'badge-danger' : 'badge-neutral'}`}
                                style={{ marginLeft: 6 }}
                              >
                                {gap > 0 ? '+' : ''}
                                {krw(gap)}
                              </span>
                            )}
                          </td>
                          <td className="num">{krw(t.contribution_krw)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <Quarantine data={data} id={id} onDone={reload} toast={toast} />

          <section className="card">
            <div className="card-head">
              <span className="card-title">합친 결과</span>
            </div>
            <div className="grid-side">
              <div className="table-wrap" style={{ maxHeight: 460 }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>날짜</th>
                      <th>채널</th>
                      <th>상품</th>
                      <th className="num">수량</th>
                      <th className="num">순매출</th>
                      <th className="num">기여이익</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.slice(0, 120).map((r) => (
                      /* 줄을 눌러야 원본을 되짚는데, 누를 수 있다는 표시가
                         커서 모양뿐이었고 키보드로는 아예 못 열었다. 이
                         사이트가 내내 자랑하는 기능이 마우스 쓰는 사람만
                         쓸 수 있었던 것이다.
                         줄 전체를 누르는 편이 손이 덜 가니 그건 남기고,
                         초점을 받아 엔터·스페이스로도 열리게 한다. */
                      <tr
                        key={r.id}
                        className={`clickable${selectedRow?.id === r.id ? ' selected' : ''}`}
                        tabIndex={0}
                        aria-label={`${r.date} ${r.channel} ${r.sku_name} — 이 줄이 어디서 왔는지 보기`}
                        onClick={() => setSelectedRow(r)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            setSelectedRow(r)
                          }
                        }}
                      >
                        <td>{r.date}</td>
                        <td>{r.channel}</td>
                        <td>
                          {r.sku_name}
                          {r.return_qty > 0 && (
                            <span className="badge badge-warning" style={{ marginLeft: 5 }}>
                              반품
                            </span>
                          )}
                          {r.has_duplicate === 1 && (
                            <span className="badge badge-neutral" style={{ marginLeft: 5 }}>
                              같은 줄 있음
                            </span>
                          )}
                        </td>
                        <td className="num">{num(r.qty)}</td>
                        <td className="num">{krw(r.net_revenue_krw)}</td>
                        <td className="num">{krw(r.contribution_krw)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <Lineage row={selectedRow} />
            </div>
            {data.rows.length > 120 && (
              <p className="card-note" style={{ marginTop: 8 }}>
                전체 {num(data.rows.length)}줄 중 처음 120줄만 보여주고 있습니다.
              </p>
            )}
          </section>

          <section className="card">
            <div className="card-title">실행 기록</div>
            <div className="table-wrap" style={{ marginTop: 8 }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>회차</th>
                    <th className="num">합친 줄</th>
                    <th className="num">검토함</th>
                    <th className="num">걸린 시간</th>
                    <th>언제</th>
                  </tr>
                </thead>
                <tbody>
                  {data.runs.map((r) => (
                    <tr key={r.id}>
                      <td>{r.seq}</td>
                      <td className="num">{num(r.rows_out)}</td>
                      <td className="num">{num(r.quarantined)}</td>
                      <td className="num">{ms(r.duration_ms)}</td>
                      <td>{ago(r.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  )
}

// ── 검토함 ──────────────────────────────────────────────────
function Quarantine({ data, id, onDone, toast }) {
  const [teaching, setTeaching] = useState({})

  const groups = useMemo(() => {
    const m = new Map()
    for (const q of data.quarantine) {
      if (!m.has(q.reason)) m.set(q.reason, [])
      m.get(q.reason).push(q)
    }
    return [...m.entries()]
  }, [data.quarantine])

  if (data.quarantine.length === 0) return null

  // 모르는 상품코드는 코드별로 묶는다. 같은 코드가 열 줄이면 열 번 물을 이유가 없다.
  const unknownByCode = new Map()
  for (const q of data.quarantine) {
    if (q.reason !== 'unknown_sku' || !q.external_code) continue
    if (!unknownByCode.has(q.external_code)) {
      unknownByCode.set(q.external_code, { ...q, count: 0 })
    }
    unknownByCode.get(q.external_code).count += 1
  }

  return (
    <section className="card">
      <div className="card-head">
        <span className="card-title">처리하지 못한 줄 {num(data.quarantine.length)}개</span>
      </div>

      {unknownByCode.size > 0 && (
        <>
          <h4>어느 상품인지 알려주시면 다음부터 자동으로 처리됩니다</h4>
          <div className="stack-sm" style={{ marginBottom: 16 }}>
            {[...unknownByCode.values()].map((q) => (
              <div key={q.external_code} className="teach-row">
                <div className="teach-info">
                  <code>{q.external_code}</code>
                  <strong>{q.product_name || '(상품명 없음)'}</strong>
                  <span className="card-note">{q.source_file} · {q.count}줄</span>
                </div>
                <select
                  value={teaching[q.external_code] ?? ''}
                  onChange={(e) =>
                    setTeaching({ ...teaching, [q.external_code]: e.target.value })
                  }
                >
                  <option value="">어느 상품인가요</option>
                  {SKUS.map((s) => (
                    <option key={s.canonical_code} value={s.canonical_code}>
                      {s.name_ko} ({s.canonical_code})
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  disabled={!teaching[q.external_code]}
                  onClick={async () => {
                    try {
                      await api.post(`/applications/${id}/build`, {
                        kind: 'alias',
                        external_code: q.external_code,
                        canonical_code: teaching[q.external_code],
                        product_name: q.product_name,
                      })
                      toast.success('기억했습니다. 다시 돌리면 이 줄은 자동으로 처리됩니다.')
                      await onDone()
                    } catch (err) {
                      toast.error(err.message)
                    }
                  }}
                >
                  기억시키기
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="stack-sm">
        {groups.map(([reason, items]) => (
          <details key={reason} className="disclose">
            <summary>
              {QUARANTINE_REASONS[reason] ?? reason} — {num(items.length)}줄
            </summary>
            <div className="disclose-body">
              {items[0].note && <p className="card-note">{items[0].note}</p>}
              <div className="table-wrap" style={{ maxHeight: 220 }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>파일</th>
                      <th>시트</th>
                      <th className="num">줄</th>
                      <th>내용</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.slice(0, 40).map((q) => (
                      <tr key={q.id}>
                        <td>{q.source_file.replace(/^\d+_/, '')}</td>
                        <td>{q.source_sheet || '—'}</td>
                        <td className="num">{q.source_row_no}</td>
                        <td className="mono">{(q.raw ?? []).slice(0, 6).join(' | ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </details>
        ))}
      </div>
    </section>
  )
}

// ── 되짚기 ──────────────────────────────────────────────────
function Lineage({ row }) {
  if (!row) {
    return (
      <div className="card-flat">
        <div className="card-note">
          왼쪽 표에서 한 줄을 누르면, 그 숫자가 원본 파일의 몇 번째 줄에서 왔고 어떤 단계를 거쳐
          이 값이 됐는지 여기 나옵니다.
        </div>
      </div>
    )
  }

  return (
    <div className="card-flat lineage">
      <div className="card-title">이 숫자가 온 길</div>

      <div className="lineage-source">
        <div className="card-note">원본</div>
        <strong>{row.source_file}</strong>
        <div className="card-note">
          {row.source_sheet ? `${row.source_sheet} 시트 · ` : ''}
          {row.source_row_no}번째 줄
        </div>
      </div>

      <ol className="lineage-steps">
        {(row.trace ?? []).map((t, i) => (
          <li key={i}>
            <span className="lineage-step">{t.step}</span>
            <span className="lineage-value">{t.value}</span>
          </li>
        ))}
      </ol>

      <dl className="kv" style={{ marginTop: 12 }}>
        <dt>총매출</dt>
        <dd>{krw(row.gross_krw)}</dd>
        <dt>− 할인</dt>
        <dd>{krw(row.discount_krw)}</dd>
        <dt>− 반품</dt>
        <dd>{krw(row.return_krw)}</dd>
        <dt>= 순매출</dt>
        <dd>
          <strong>{krw(row.net_revenue_krw)}</strong>
        </dd>
        <dt>− 수수료</dt>
        <dd>{krw(row.commission_krw)}</dd>
        <dt>− 원가</dt>
        <dd>{krw(row.cogs_krw)}</dd>
        <dt>− 물류</dt>
        <dd>{krw(row.logistics_krw)}</dd>
        <dt>− 광고</dt>
        <dd>{krw(row.ad_krw)}</dd>
        <dt>= 기여이익</dt>
        <dd>
          <strong>{krw(row.contribution_krw)}</strong>
        </dd>
      </dl>

      {row.duplicate_of && (
        <div className="notice notice-warn" style={{ marginTop: 10 }}>
          {row.duplicate_of} 줄과 내용이 같습니다. 진짜 중복일 수도, 같은 상품을 두 번 산 것일
          수도 있어 지우지 않고 표시만 했습니다.
        </div>
      )}
    </div>
  )
}

function Tile({ label, value, note, tone }) {
  return (
    <div className="stat-tile">
      <div className="stat-label">{label}</div>
      <div
        className="stat-value"
        style={tone === 'warn' ? { color: 'var(--warning-text)' } : undefined}
      >
        {value}
      </div>
      <div className="stat-note">{note}</div>
    </div>
  )
}
