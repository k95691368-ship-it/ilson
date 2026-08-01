import { Link } from 'react-router-dom'
import { useApi } from '../hooks/useApi.js'
import { num } from '../lib/format.js'
import { compareWeeks, MIN_FOR_TREND } from '../../shared/weekly.js'

// 주 단위로 묶어 본 것.
//
// 담당자가 위에 보고할 때 쓰는 화면이다. 지금은 접수함 목록을 눈으로 세어
// 문장을 만들어야 하는데, 매주 하는 일이라 그것부터가 병목이다.
//
// 이 화면에서 가장 조심한 것은 적은 표본으로 추세인 척하지 않는 것이다.
// 두 건이 세 건이 된 것을 "50% 증가"라고 적으면 거짓말에 가깝다.
export default function WeeklyPage() {
  const { data, error, loading } = useApi('/weekly')

  if (error) return <div className="notice notice-danger">{error}</div>
  if (loading && !data) return <div className="page-loading">불러오는 중…</div>
  if (!data) return null

  const max = Math.max(1, ...data.weeks.map((w) => Math.max(w.arrived, w.decided)))

  return (
    <div className="stack">
      <header className="page-head">
        <span className="page-eyebrow">주간</span>
        <h1>이번 주에 무엇이 들어왔나</h1>
        <p className="page-sub">
          접수함이 한 줄로 늘어서 있으면 이번 주에 뭐가 들어왔는지, 지난주보다 늘었는지를 볼 수가
          없습니다. 주 단위로 묶었습니다. <strong>보고할 때 그대로 읽으시라고</strong> 문장도
          만들어 뒀습니다.
        </p>
      </header>

      {/* 보고할 때 필요한 것은 표가 아니라 문장이다. 표를 보고 문장을
          만드는 일을 매주 하게 하지 않는다. */}
      {data.line && (
        <section className="weekly-line">
          <span className="weekly-line-label">그대로 읽으시면 됩니다</span>
          <p>{data.line}</p>
        </section>
      )}

      <section className="card">
        <div className="card-head">
          <span className="card-title">주별로 들어온 것과 판정한 것</span>
          <span className="card-note">
            들어온 주와 판정한 주는 따로 셉니다 — 지난주 것을 이번 주에 판정했으면 각각 그 주에
            들어갑니다
          </span>
        </div>

        <ul className="weekly-bars">
          {data.weeks.map((w, i) => {
            const prev = data.weeks[i + 1]
            const cmp = compareWeeks(w.arrived, prev?.arrived)
            return (
              <li key={w.key} className={i === 0 ? 'now' : ''}>
                <div className="weekly-head">
                  <span className="weekly-when">{w.relative ?? w.label}</span>
                  <span className="card-note">{w.label}</span>
                  <span className="spacer" />
                  {w.stillOpen > 0 && (
                    <span className="badge badge-warning">아직 {w.stillOpen}건 판정 전</span>
                  )}
                  {w.refused > 0 && <span className="badge badge-neutral">반려 {w.refused}</span>}
                </div>

                <div className="weekly-row">
                  <span className="weekly-key">들어온 것</span>
                  <div className="weekly-bar">
                    <span
                      className="in"
                      style={{ width: `${(w.arrived / max) * 100}%` }}
                      aria-hidden="true"
                    />
                  </div>
                  <strong>{w.arrived}</strong>
                </div>
                <div className="weekly-row">
                  <span className="weekly-key">판정한 것</span>
                  <div className="weekly-bar">
                    <span
                      className="out"
                      style={{ width: `${(w.decided / max) * 100}%` }}
                      aria-hidden="true"
                    />
                  </div>
                  <strong>{w.decided}</strong>
                </div>

                {Object.keys(w.byDept).length > 0 && (
                  <div className="row weekly-depts">
                    {Object.entries(w.byDept)
                      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'))
                      .map(([dept, n]) => (
                        <Link key={dept} to={`/dept/${encodeURIComponent(dept)}`} className="chip">
                          {dept}
                          <span className="chip-count">{n}</span>
                        </Link>
                      ))}
                    {w.hours > 0 && (
                      <span className="card-note">
                        연 {num(w.hours, 0)}시간어치
                        {w.hoursMissing > 0 && ` (소요 미기재 ${w.hoursMissing}건 제외)`}
                      </span>
                    )}
                  </div>
                )}

                {/* 적은 표본으로 추세인 척하지 않는다. */}
                {cmp.text && (
                  <div className={`weekly-cmp${cmp.enough ? '' : ' weak'}`}>{cmp.text}</div>
                )}
              </li>
            )
          })}
        </ul>

        <p className="card-note weekly-foot">
          한 주에 {MIN_FOR_TREND}건이 안 되면 늘었다 줄었다를 말하지 않습니다. 두 건이 세 건이 된
          것은 누가 그 주에 휴가를 갔느냐로 갈리는 차이라, 그걸 추세라고 부르면 거짓말에
          가깝습니다.
          {data.capped && ' 최근 500건까지만 세었습니다 — 그보다 오래된 주는 비어 보일 수 있습니다.'}
        </p>
      </section>

      <section className="card">
        <div className="card-head">
          <span className="card-title">어느 부서가 많이 내나</span>
          <span className="card-note">전체 {num(data.total)}건 기준</span>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>부서</th>
                <th className="num">낸 것</th>
                <th className="num">아직 판정 전</th>
                <th className="num">반려</th>
                <th className="num">연 환산 시간</th>
              </tr>
            </thead>
            <tbody>
              {data.depts.map((d) => (
                <tr key={d.dept}>
                  <td>
                    <Link to={`/dept/${encodeURIComponent(d.dept)}`}>{d.dept}</Link>
                  </td>
                  <td className="num">{num(d.total)}</td>
                  <td className="num">
                    {d.open > 0 ? <strong>{num(d.open)}</strong> : <span className="card-note">—</span>}
                  </td>
                  <td className="num">
                    {d.refused > 0 ? num(d.refused) : <span className="card-note">—</span>}
                  </td>
                  <td className="num">{d.hours > 0 ? `${num(d.hours, 0)}시간` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="card-note" style={{ marginTop: 10 }}>
          많이 내는 부서가 문제가 많은 부서는 아닙니다. 이 창구를 알고 쓰는 부서일 뿐일 수도
          있습니다. 한 건도 안 낸 부서가 있으면 그건 병목이 없어서가 아니라 여기를 모르기
          때문일 가능성이 큽니다.
        </p>
      </section>
    </div>
  )
}
