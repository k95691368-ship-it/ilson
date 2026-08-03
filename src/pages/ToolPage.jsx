import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useApi } from '../hooks/useApi.js'
import { validateUnclear, SECTION_BY_KEY } from '../../shared/unclear.js'
import { validateAccept, validateReject, proxyNote } from '../../shared/accept.js'
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
  // 대목마다 무슨 표시를 붙일지. 짚고 나서 아무 표시가 없으면
  // "말해 봐야 소용없다"가 되고, 그 뒤로는 아무도 안 짚는다.
  // 누가 돌렸는가.
  //
  // 이걸 안 보내면 서버가 인수인계 받은 사람 이름으로 기록한다. 그래서 세
  // 사람이 써도 실행 기록이 전부 한 이름이 되고, "지금까지 한 분만 쓰고
  // 계십니다"라는 경보가 **늘 켜져 있었다.** 늘 켜진 경보는 경보가 아니다.
  //
  // 계정을 만들라고 하지는 않는다. 이 브라우저에 기억해 두고 다음부터는
  // 안 묻는다.
  const [whoRan, setWhoRan] = useState('')
  const [notes, setNotes] = useState({})
  const loadNotes = useCallback(() => {
    api
      .get(`/tools/${encodeURIComponent(slug)}/unclear`)
      .then((r) => setNotes(r.notes ?? {}))
      .catch(() => {})
  }, [slug])
  useEffect(() => {
    loadNotes()
  }, [loadNotes])

  // 이 브라우저에서 이 도구를 돌린 사람. 한 번 적으면 다음부터 안 묻는다.
  useEffect(() => {
    if (whoRan) return
    let saved = null
    try {
      saved = window.localStorage.getItem(`ilson:who:${slug}`)
    } catch {
      // 사생활 보호 모드면 저장소를 못 쓴다. 그때는 매번 적으시게 된다.
    }
    setWhoRan(saved || data?.handedTo?.person || '')
  }, [slug, data, whoRan])
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
        actor_label: whoRan,
      })

      toast.success(`${num(r.rows.length)}줄을 합쳤습니다.`)
      await reload()
    } catch (err) {
      toast.error(err.message)
      await api
        .post(`/tools/${slug}`, { ok: false, fail_reason: err.message, actor_label: whoRan })
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
        <Unclear slug={slug} section="intro" notes={notes} reload={loadNotes} />
      </header>

      {data.manual?.when_to_run && (
        <div className="notice notice-info">
          <div className="notice-title">언제 돌리나요</div>
          <p>{data.manual.when_to_run}</p>
          <Unclear slug={slug} section="when_to_run" notes={notes} reload={loadNotes} />
        </div>
      )}

      {/* 넘겨받은 것을 부서가 직접 확인하는 자리.
          이게 없어서 부서 사람은 조회 화면에서 "받았다고 눌러주세요"를 읽고
          여기 왔다가 누를 것을 못 찾았다. 그동안 담당자가 부서 사람 이름을
          대신 타이핑해 넣고 있었다. */}
      <AcceptBox slug={slug} />

      {/* 누가 돌렸는지 남긴다. 이게 없으면 실행 기록이 전부 한 이름이 되고,
          "한 분만 쓰고 계십니다" 경보가 늘 켜져 있게 된다. */}
      <div className="who-ran">
        <label>
          <span>돌리시는 분</span>
          <input
            value={whoRan}
            onChange={(e) => {
              setWhoRan(e.target.value)
              try {
                window.localStorage.setItem(`ilson:who:${slug}`, e.target.value)
              } catch {
                // 저장소를 못 써도 이번 실행에는 실려 간다.
              }
            }}
            placeholder={data.handedTo?.person ?? '성함'}
          />
        </label>
        <span className="card-note">
          실행 기록에 남습니다. 여러 분이 나눠 쓰시는지를 이걸로 압니다 — 한 분만 쓰고 계시면
          그분이 자리를 비울 때 멈추기 때문입니다.
        </span>
      </div>

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
              <Unclear slug={slug} section="quarantine" notes={notes} reload={loadNotes} />
            </section>
          )}
        </>
      )}

      {data.manual?.what_to_do_after && (
        <section className="card">
          <div className="card-title">결과를 어떻게 쓰나요</div>
          <p className="card-note">{data.manual.what_to_do_after}</p>
          <Unclear slug={slug} section="what_to_do_after" notes={notes} reload={loadNotes} />
        </section>
      )}

      {/* 어떤 파일을 올리는지, 막혔을 때 누구에게 연락하는지도 짚을 수
          있어야 한다. 여기가 실제로 막히는 자리다. */}
      <section className="card unclear-rest">
        <div className="card-title">사용법서에서 모르겠는 데가 있으신가요</div>
        <p className="card-note">
          쓴 사람은 다 압니다. 모르는 데가 어디인지는 실제로 읽는 분만 아십니다. 짚어 주시면 그
          대목을 다시 씁니다 — 다음 분이 같은 데서 막히지 않게요.
        </p>
        <Unclear slug={slug} section="upload" notes={notes} reload={loadNotes} />
        <Unclear slug={slug} section="contact" notes={notes} reload={loadNotes} />
      </section>

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

// 이 대목이 모르겠다고 짚는 자리.
//
// 막힌 자리에서 바로 짚을 수 있어야 한다. 사용법서 화면을 따로 열어야
// 짚을 수 있으면, 막힌 순간에 짚지 못하고 그냥 전화를 건다.
//
// 이름은 안 받는다. 모르겠다고 말하는 일에 이름을 붙이라고 하면, 모르는
// 것을 밝히는 것 자체가 부담이 되어 아무도 안 짚는다.
function Unclear({ slug, section, notes, reload }) {
  const [open, setOpen] = useState(false)
  const [body, setBody] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)

  const spec = SECTION_BY_KEY[section]
  const note = notes?.[section] ?? null

  async function send(e) {
    e.preventDefault()
    const bad = validateUnclear({ section, body })
    if (bad.body) {
      setError(bad.body)
      return
    }
    setBusy(true)
    try {
      const r = await api.post(`/tools/${encodeURIComponent(slug)}/unclear`, { section, body })
      setDone(r.message)
      setOpen(false)
      setBody('')
      reload()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="unclear">
      {/* 담당자가 이미 다시 쓴 대목이면 그 말이 여기 붙는다. */}
      {note && <p className={`unclear-note unclear-${note.tone}`}>{note.text}</p>}
      {done && <p className="unclear-note unclear-thanks">{done}</p>}

      {open ? (
        <form className="unclear-form" onSubmit={send}>
          <label>
            <span>{spec?.label} — 무엇이 모르겠으신가요</span>
            <textarea
              rows={2}
              value={body}
              onChange={(e) => {
                setBody(e.target.value)
                setError(null)
              }}
              placeholder={spec?.hint}
            />
          </label>
          {error && <em className="field-error">{error}</em>}
          <small className="card-note">성함은 안 여쭙습니다. 적어주신 내용만 담당자에게 갑니다.</small>
          <div className="row">
            <button type="submit" className="btn-primary btn-sm" disabled={busy}>
              {busy ? '보내는 중…' : '보내기'}
            </button>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setOpen(false)}>
              그만두기
            </button>
          </div>
        </form>
      ) : (
        !done && (
          <button type="button" className="unclear-ask" onClick={() => setOpen(true)}>
            {spec?.label} — 여기 모르겠습니다
          </button>
        )
      )}
    </div>
  )
}

// 넘겨받은 것을 부서가 직접 확인하는 자리.
//
// 이 사이트는 "넘겼다고 받은 것이 아니다"를 여러 화면에서 되풀이한다.
// 그런데 그 확인을 누르는 자리가 담당자 화면에만 있었다. 부서 사람은
// 조회 화면에서 "받았다고 눌러주세요"를 읽고 여기 왔다가 누를 것을
// 못 찾았다. 시키는 일을 하러 왔다가 막다른 화면에서 끝난다.
//
// **"받았습니다" 버튼만 두지 않는다.** 그건 도장 찍기다. 안 맞을 때 말할
// 자리가 없으면 부서는 그냥 안 누르고, 담당자는 왜 안 누르는지 모른다.
function AcceptBox({ slug }) {
  const { data, reload } = useApi(`/tools/${slug}/accept`)
  const toast = useToast()
  const [by, setBy] = useState('')
  const [mode, setMode] = useState(null)
  const [reason, setReason] = useState('')
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)

  if (!data) return null
  const s = data.state
  if (!s.canAccept && s.status !== '부서가 확인함') return null

  async function send(kind) {
    const bad = kind === 'reject' ? validateReject({ by, reason }) : validateAccept({ by })
    setErrors(bad)
    if (Object.keys(bad).length > 0) return
    setBusy(true)
    try {
      const r = await api.post(`/tools/${slug}/accept`, { kind, by, reason })
      toast.success(r.message)
      setMode(null)
      setReason('')
      reload()
    } catch (err) {
      setErrors({ by: err.message })
    } finally {
      setBusy(false)
    }
  }

  if (s.status === '부서가 확인함') {
    return (
      <p className="accept-done">
        {s.by}님이 {ago(s.at)} 받았다고 확인해주셨습니다.
      </p>
    )
  }

  return (
    <section className={`accept-box${s.proxy ? ' proxy' : ''}`}>
      <div className="accept-head">
        <strong>이걸 받으셨습니까</strong>
        <span className="card-note">
          {data.handedTo.dept} {data.handedTo.person}에게 {ago(data.handedTo.at)} 넘겨드렸습니다.
        </span>
      </div>

      {/* 담당자가 대신 눌러 둔 것은 부서 확인이 아니다. 그렇게 적는다. */}
      {s.proxy && <p className="accept-proxy">{proxyNote(s)}</p>}

      {s.rejects.length > 0 && (
        <p className="accept-proxy">
          앞서 <strong>{s.rejects[s.rejects.length - 1].by}</strong>님이 못 쓰겠다고 알려주셨습니다 —
          &ldquo;{s.rejects[s.rejects.length - 1].what}&rdquo;. 고쳐졌으면 다시 확인해주세요.
        </p>
      )}

      <p className="card-note">
        한 번 돌려 보시고 판단해주세요. <strong>안 맞으면 안 맞는다고 해주셔야</strong> 고칠 수
        있습니다. 그냥 두시면 저희는 잘 쓰고 계신 줄 압니다.
      </p>

      <label className="accept-name">
        <span>받으시는 분</span>
        <input value={by} onChange={(e) => setBy(e.target.value)} placeholder={data.handedTo.person} />
        {errors.by && <em className="field-error">{errors.by}</em>}
      </label>

      {mode === 'reject' ? (
        <div className="accept-reject">
          <label>
            <span>무엇이 안 맞습니까</span>
            <textarea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="광고비 칸이 비어서 옵니다. 그것만 채워지면 쓸 수 있습니다."
            />
            {errors.reason && <em className="field-error">{errors.reason}</em>}
            <small className="card-note">이 한 줄이면 고칠 수 있습니다.</small>
          </label>
          <div className="row">
            <button type="button" className="btn-danger btn-sm" disabled={busy} onClick={() => send('reject')}>
              {busy ? '보내는 중…' : '이대로는 못 쓰겠습니다'}
            </button>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setMode(null)}>
              그만두기
            </button>
          </div>
        </div>
      ) : (
        <div className="row">
          <button type="button" className="btn-primary" disabled={busy} onClick={() => send('accept')}>
            {busy ? '남기는 중…' : '받았습니다'}
          </button>
          <button type="button" className="btn-ghost" onClick={() => setMode('reject')}>
            이대로는 못 쓰겠습니다
          </button>
        </div>
      )}
    </section>
  )
}
