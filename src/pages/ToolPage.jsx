import { useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useApi } from '../hooks/useApi.js'
import { useToast } from '../context/ToastContext.jsx'
import { api } from '../api/client.js'
import { krw, num, ms, ago } from '../lib/format.js'
import { runPipeline, QUARANTINE_REASONS } from '../../shared/pipeline.js'

// 부서에 넘긴 도구.
//
// 여기에는 제작 과정도 상단 목차도 없다. 현업 담당자는 이 도구가 어떻게
// 만들어졌는지 알 필요가 없고, 파일을 넣고 결과를 받으면 된다.
//
// 계산은 이 브라우저에서 돈다. 파일이 서버로 올라가지 않는다.
export default function ToolPage() {
  const { slug } = useParams()
  const { data, error, loading, reload } = useApi(`/tools/${slug}`)
  const toast = useToast()
  const [result, setResult] = useState(null)
  const [running, setRunning] = useState(false)
  const fileInput = useRef(null)

  async function run(fileList) {
    const picked = [...fileList]
    if (picked.length === 0) return

    const tooBig = picked.find((f) => f.size > (data.limits.maxFileMb ?? 10) * 1024 * 1024)
    if (tooBig) {
      toast.error(`${tooBig.name}이 너무 큽니다. 하나당 ${data.limits.maxFileMb}MB까지입니다.`)
      return
    }

    setRunning(true)
    try {
      const files = await Promise.all(
        picked.map(async (f) => ({ name: f.name, buffer: await f.arrayBuffer() }))
      )
      const r = await runPipeline({ files })
      setResult(r)

      await api.post(`/tools/${slug}`, {
        files: r.files.map((f) => ({ name: f.name, channel: f.channel, rowsOut: f.rowsOut })),
        rows_out: r.rows.length,
        quarantined: r.quarantine.length,
        duration_ms: r.stats.durationMs,
      })

      toast.success(`${num(r.rows.length)}줄을 합쳤습니다.`)
      await reload()
    } catch (err) {
      toast.error(err.message)
      await api
        .post(`/tools/${slug}`, { ok: false, fail_reason: err.message })
        .catch(() => {})
    } finally {
      setRunning(false)
    }
  }

  function download() {
    if (!result) return
    const header = [
      '날짜', '주차', '채널', '상품코드', '상품명', '수량', '반품수량',
      '총매출', '할인', '반품액', '순매출', '수수료', '원가', '물류비', '광고비', '기여이익',
      '원본파일', '원본시트', '원본줄',
    ]
    const rows = result.rows.map((r) => [
      r.date, r.iso_week, r.channel, r.sku, r.sku_name, r.qty, r.return_qty,
      r.gross_krw, r.discount_krw, r.return_krw, r.net_revenue_krw, r.commission_krw,
      r.cogs_krw, r.logistics_krw, r.ad_krw, r.contribution_krw,
      r.source.file, r.source.sheet ?? '', r.source.rowNo,
    ])
    // 엑셀이 UTF-8을 알아보게 앞에 표시를 붙인다. 없으면 한글이 깨진다.
    const csv =
      '﻿' +
      [header, ...rows]
        .map((row) => row.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','))
        .join('\r\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `정산통합_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (loading && !data) return <div className="page-loading">불러오는 중…</div>

  if (error) {
    return (
      <div className="empty">
        <div className="empty-title">이 주소에는 도구가 없습니다</div>
        <div className="empty-sub">{error}</div>
      </div>
    )
  }

  if (data?.rolledBack) {
    return (
      <div className="notice notice-warn">
        <div className="notice-title">{data.title} — 잠시 내려가 있습니다</div>
        <p>{data.message}</p>
        {data.reason && <p className="card-note">사유: {data.reason}</p>}
      </div>
    )
  }

  if (!data) return null

  return (
    <div className="stack">
      <header className="page-head">
        <h1>{data.title}</h1>
        {data.manual?.intro && <p className="page-sub">{data.manual.intro}</p>}
      </header>

      {data.manual?.when_to_run && (
        <div className="notice notice-info">
          <div className="notice-title">언제 돌리나요</div>
          <p>{data.manual.when_to_run}</p>
        </div>
      )}

      <section className="card">
        <div
          className="dropzone"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            run(e.dataTransfer.files)
          }}
        >
          <input
            ref={fileInput}
            type="file"
            multiple
            className="sr-only"
            accept=".csv,.xlsx,.xls,.txt"
            onChange={(e) => {
              run(e.target.files)
              e.target.value = ''
            }}
          />
          <button
            type="button"
            className="btn-primary"
            onClick={() => fileInput.current?.click()}
            disabled={running || data.limits.remainingToday <= 0}
          >
            {running ? '합치는 중…' : '정산서 파일 넣기'}
          </button>
          <span className="card-note">또는 여기로 끌어다 놓으세요</span>
        </div>

        <div className="tool-limits">
          <span>
            오늘 남은 실행 <strong>{data.limits.remainingToday}</strong> / {data.limits.dailyLimit}회
          </span>
          <span>파일 하나당 {data.limits.maxFileMb}MB까지</span>
          <span>계산은 이 브라우저에서 돕니다 — 파일이 서버로 가지 않습니다</span>
        </div>
      </section>

      {result && (
        <>
          <section className="stat-row">
            <Tile label="합친 줄" value={num(result.rows.length)} />
            <Tile
              label="검토할 줄"
              value={num(result.quarantine.length)}
              tone={result.quarantine.length > 0 ? 'warn' : undefined}
            />
            <Tile label="걸린 시간" value={ms(result.stats.durationMs)} />
            {result.totals?.all && (
              <Tile label="기여이익" value={krw(result.totals.all.contribution_krw)} />
            )}
          </section>

          {result.quarantine.length > 0 && (
            <div className="notice notice-warn">
              <div className="notice-title">처리하지 못한 줄이 {result.quarantine.length}개 있습니다</div>
              <p>
                버리지 않았습니다. 아래에 무엇이 왜 남았는지 있습니다. 이대로 내려받으면 이 줄들의
                금액은 빠집니다.
              </p>
            </div>
          )}

          <section className="card">
            <div className="card-head">
              <span className="card-title">채널별 결과</span>
              <button type="button" className="btn-primary btn-sm" onClick={download}>
                엑셀로 내려받기
              </button>
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
                    <th className="num">기여이익</th>
                  </tr>
                </thead>
                <tbody>
                  {result.totals.byChannel.map((t) => (
                    <tr key={t.channel}>
                      <td>{t.channel}</td>
                      <td className="num">{num(t.rows)}</td>
                      <td className="num">{num(t.qty)}</td>
                      <td className="num">{krw(t.net_revenue_krw)}</td>
                      <td className="num">{krw(t.commission_krw)}</td>
                      <td className="num">{krw(t.contribution_krw)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {result.quarantine.length > 0 && (
            <section className="card">
              <div className="card-title">검토할 줄</div>
              <div className="table-wrap" style={{ maxHeight: 300, marginTop: 8 }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>이유</th>
                      <th>파일</th>
                      <th>시트</th>
                      <th className="num">줄</th>
                      <th>내용</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.quarantine.slice(0, 60).map((q, i) => (
                      <tr key={i}>
                        <td>{QUARANTINE_REASONS[q.reason] ?? q.reason}</td>
                        <td>{q.source.file.replace(/^\d+_/, '')}</td>
                        <td>{q.source.sheet || '—'}</td>
                        <td className="num">{q.source.rowNo}</td>
                        <td className="mono">{(q.raw ?? []).slice(0, 5).join(' | ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="card-note" style={{ marginTop: 8 }}>
                무엇을 해야 하는지는 사용법서를 보세요. 모르겠으면{' '}
                {data.manual?.contact ?? '담당자'}에게 문의하세요.
              </p>
            </section>
          )}
        </>
      )}

      {data.manual?.what_to_do_after && (
        <section className="card">
          <div className="card-title">결과를 어떻게 쓰나요</div>
          <p className="card-note">{data.manual.what_to_do_after}</p>
        </section>
      )}

      <footer className="tool-foot">
        <span>
          {data.handedTo.dept} {data.handedTo.person}에게 {ago(data.handedAt)} 넘긴 도구입니다.
        </span>
        {data.manual?.contact && <span>막혔을 때 — {data.manual.contact}</span>}
        {data.recent.length > 0 && (
          <span>
            최근 {data.recent.length}번 실행 · 마지막 {ago(data.recent[0].used_at)}
          </span>
        )}
      </footer>
    </div>
  )
}

function Tile({ label, value, tone }) {
  return (
    <div className="stat-tile">
      <div className="stat-label">{label}</div>
      <div
        className="stat-value"
        style={tone === 'warn' ? { color: 'var(--warning-text)' } : undefined}
      >
        {value}
      </div>
    </div>
  )
}
