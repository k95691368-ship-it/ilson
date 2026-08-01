import { useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useApi } from '../hooks/useApi.js'
import ReportForm from '../components/ReportForm.jsx'
import TeachQuarantine from '../components/TeachQuarantine.jsx'
import { quotaState, nextFreeText, whatNow, checkFiles, WHY_LIMIT } from '../../shared/quota.js'
import { annotateRuns, summarizeRuns, usersOf } from '../../shared/history.js'
import { useToast } from '../context/ToastContext.jsx'
import { api } from '../api/client.js'
import { krw, num, ms, ago, dateTimeLabel } from '../lib/format.js'
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

    // 걸리는 것을 한꺼번에 짚어 준다. 하나만 말하면 고치고 나서 또 걸린다.
    const problems = checkFiles(picked, { maxFileMb: data.limits.maxFileMb })
    if (problems.length > 0) {
      toast.error(problems.join(' '))
      return
    }

    setRunning(true)
    try {
      const files = await Promise.all(
        picked.map(async (f) => ({ name: f.name, buffer: await f.arrayBuffer() }))
      )
      // 사람이 알려 준 상품코드를 함께 넘긴다. 이게 없으면 알려주고 나서도
      // 그대로 또 밀려나고, 부서는 그 뒤로 아무것도 안 알려준다.
      const r = await runPipeline({ files, aliases: data.aliases ?? {} })
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

        <Quota limits={data.limits} />
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

      {/* 지난주엔 어떤 파일로 돌렸는지 볼 데가 없었다. 그리고 목록만
          만들면 반쪽이다 — 스무 줄을 늘어놓아도 사람은 이상한 것을 못 찾는다. */}
      {data.recent?.length > 0 && <RunHistory runs={data.recent} />}

      {/* 밀려난 줄이 뭔지 아는 사람은 매일 그 일을 하는 부서 사람뿐이다.
          보여만 주고 고칠 길이 없으면 그 줄만 따로 손으로 처리하게 된다. */}
      {result?.quarantine?.length > 0 && (
        <TeachQuarantine slug={slug} quarantine={result.quarantine} onTaught={reload} />
      )}

      {/* 넘긴 뒤 들어온 신고가 이 사이트에서 가장 값진 기록이다.
          만들 때 놓친 것은 만든 사람이 못 찾는다 — 매일 그 일을 하는
          사람만 찾는다. */}
      <ReportForm slug={slug} />
    </div>
  )
}

// 언제 무엇으로 돌렸는가.
//
// 부서가 매주 정산을 돌린다. 그러다 "지난주엔 어떤 파일로 돌렸지"를 물을
// 일이 생긴다 — 숫자가 이상해서, 또는 누가 물어봐서. 답할 데가 없었다.
//
// 목록만 만들면 반쪽이다. 가장 흔한 사고는 파일 하나를 빠뜨리고 돌리는
// 것인데, 도구는 아무 불평 없이 돌고 결과는 그냥 좀 적을 뿐이다. 그래서
// 이번 실행이 지난번들과 얼마나 다른지를 시스템이 짚어 준다.
function RunHistory({ runs }) {
  const annotated = annotateRuns(runs)
  const s = summarizeRuns(annotated)
  const users = usersOf(runs)

  return (
    <section className="card">
      <div className="card-head">
        <span className="card-title">이 도구를 돌린 기록 {s.total}번</span>
        <span className="spacer" />
        {s.flagged > 0 && (
          <span className="badge badge-warning">살펴볼 것 {s.flagged}번</span>
        )}
        {s.failed > 0 && <span className="badge badge-danger">멈춘 것 {s.failed}번</span>}
      </div>

      <p className="card-note" style={{ marginBottom: 12 }}>
        합쳐서 {num(s.rows)}줄을 처리했고 {num(s.quarantined)}줄이 밀려났습니다.
        {users.length === 1
          ? ` 지금까지 ${users[0].who} 한 분만 쓰고 계십니다 — 자리를 비우시면 멈춥니다.`
          : ` ${users.length}분이 쓰고 계십니다.`}
      </p>

      <ol className="run-list">
        {annotated.map((r) => (
          <li key={r.id} className={r.flags.length > 0 ? 'flagged' : ''}>
            <div className="row" style={{ marginBottom: 4 }}>
              {r.ok ? (
                <span className="badge badge-success">{num(r.rows_out)}줄</span>
              ) : (
                <span className="badge badge-danger">멈춤</span>
              )}
              {r.quarantined > 0 && (
                <span className="badge badge-neutral">밀려남 {num(r.quarantined)}</span>
              )}
              <span className="card-note">{r.actor_label}</span>
              <span className="spacer" />
              <span className="card-note" title={dateTimeLabel(r.used_at)}>
                {ago(r.used_at)}
              </span>
            </div>

            {r.files.length > 0 && (
              <div className="run-files">
                {r.files.map((f, i) => (
                  <span key={i} className="run-file">
                    {f.name}
                  </span>
                ))}
              </div>
            )}

            {/* 이번 실행이 지난번들과 다른 대목. 이게 없으면 목록은
                그냥 지나간 일의 나열이다. */}
            {r.flags.map((f, i) => (
              <div key={i} className={`run-flag ${f.kind}`}>
                {f.text}
              </div>
            ))}
          </li>
        ))}
      </ol>
    </section>
  )
}

// 몇 번 더 쓸 수 있는가.
//
// 한도는 있었지만 걸리고 나서야 알 수 있었다. 부서 사람이 월요일 아침에
// 정산을 돌리다가 "더 못 쓴다"를 만나면 그날 할 일이 거기서 멈춘다.
//
// 문구도 틀려 있었다. "오늘 남은"이라고 적혀 있었지만 실제로는 최근
// 24시간 안에 몇 번 썼는지로 센다. 자정에 초기화되는 줄 알고 기다리면
// 헛기다린다.
//
// 넉넉할 때는 조용히 둔다. 늘 경고가 떠 있으면 아무도 안 읽는다.
function Quota({ limits }) {
  const state = quotaState({ remaining: limits.remainingToday, limit: limits.dailyLimit })
  const nextFree = nextFreeText(limits.nextFreeAt)
  const now = whatNow(state, nextFree)

  return (
    <div className={`tool-quota${state.loud ? ' loud' : ''}`}>
      <div className="tool-limits">
        <span>
          최근 {limits.windowHours ?? 24}시간 안에 <strong>{state.remaining}</strong> /{' '}
          {state.limit}회 남았습니다
        </span>
        <span>파일 하나당 {limits.maxFileMb}MB까지</span>
        <span>계산은 이 브라우저에서 돕니다 — 파일이 서버로 가지 않습니다</span>
      </div>

      {state.loud && (
        <div className="tool-quota-warn">
          <strong>{state.headline}</strong>
          {now ? <p>{now}</p> : nextFree ? <p>{nextFree}</p> : null}
          <p className="card-note">{WHY_LIMIT}</p>
        </div>
      )}
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
