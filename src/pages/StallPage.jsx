import { Link } from 'react-router-dom'
import { useApi } from '../hooks/useApi.js'
import { dateLabel } from '../lib/format.js'
import { MIN_SAMPLE } from '../../shared/stall.js'

// 지금 어디서 멈춰 있나.
//
// 첫 화면은 "어느 단계에 몇 건"까지 센다. 그런데 그 건이 거기 사흘 있었는지
// 3주 있었는지는 아무 데도 안 나온다. 그래서 오래 걸린 건일수록 조용하다 —
// 목록 아래로 내려가고, 아무도 안 물어보고, 부서는 조용히 포기한다.
//
// 이 화면을 만들면서 가장 조심한 것은 **잔소리가 되지 않는 것**이다. 늦었다는
// 말만 늘어놓으면 두 번째부터는 안 본다. 그래서 두 가지를 지켰다.
//   ① 누구를 기다리는 중인지 같이 적는다. 부서가 아직 안 써 본 것을 담당자가
//      자기 잘못으로 받게 두지 않는다.
//   ② 줄마다 "그래서 무엇을 하면 되는지"와 그리로 가는 링크를 붙인다.

function StallRow({ s }) {
  const cls = ['stall-row', s.level === '많이 늦음' ? 'bad' : 'warn', s.mine ? 'mine' : 'theirs']
  return (
    <li className={cls.join(' ')}>
      <div className="stall-head">
        <span className="stall-days">
          {s.days}일<span className="stall-days-unit">째</span>
        </span>
        <div className="stall-who">
          <span className="stall-stage">{s.stage}</span>
          <span className={`badge ${s.mine ? 'badge-warning' : 'badge-neutral'}`}>
            {s.waitingLabel}
          </span>
        </div>
        <span className="spacer" />
        <span className="card-note">
          {s.limit}일이면 넘어가던 단계입니다 · {dateLabel(new Date(s.since).toISOString())}부터
        </span>
      </div>

      <div className="stall-body">
        <Link to={`/record/${s.id}`} className="stall-title">
          {s.title}
        </Link>
        <span className="card-note">
          {s.ticket_no} · {s.dept} · 지금 {s.status}
        </span>
      </div>

      <p className="stall-stuck">{s.stuck}</p>
      {/* 늦었다는 말만 있고 할 일이 없으면 이 화면은 잔소리다. */}
      <div className="stall-next">
        <p>{s.next}</p>
        <Link to={s.to} className="btn btn-ghost btn-sm">
          {s.act}
        </Link>
      </div>
    </li>
  )
}

export default function StallPage() {
  const { data, error, loading } = useApi('/stalls')

  if (error) return <div className="notice notice-danger">{error}</div>
  if (loading && !data) return <div className="page-loading">불러오는 중…</div>
  if (!data) return null

  const mine = data.stalls.filter((s) => s.mine)
  const theirs = data.stalls.filter((s) => !s.mine)
  const maxTypical = Math.max(1, ...data.typical.map((t) => t.median ?? 0))

  return (
    <div className="stack">
      <header className="page-head">
        <span className="page-eyebrow">막힌 곳</span>
        <h1>지금 어디서 멈춰 있나</h1>
        <p className="page-sub">
          이 사이트는 부서의 병목을 없애는 곳입니다. 그런데 정작 신청서 한 건이{' '}
          <strong>여기서 얼마나 오래 걸려 있는지</strong>는 세지 않고 있었습니다. 오래 걸린 건일수록
          목록 아래로 내려가서 조용해집니다. 단계마다 잣대를 따로 두고 셌습니다 — 검토가 사흘이면
          늦은 것이고, 제작이 사흘이면 늦은 것이 아닙니다.
        </p>
      </header>

      <section className="stall-line">
        <span className="stall-line-label">한 줄로 말하면</span>
        <p>{data.line}</p>
      </section>

      {mine.length > 0 && (
        <section className="card">
          <div className="card-head">
            <span className="card-title">제가 움직여야 풀리는 것 {mine.length}건</span>
            <span className="card-note">부서 답을 기다리는 건보다 위에 둡니다</span>
          </div>
          <ul className="stall-list">
            {mine.map((s) => (
              <StallRow key={s.id} s={s} />
            ))}
          </ul>
        </section>
      )}

      {theirs.length > 0 && (
        <section className="card">
          <div className="card-head">
            <span className="card-title">부서 답을 기다리는 것 {theirs.length}건</span>
            <span className="card-note">
              제 잘못은 아니지만, 오래 기다리기만 한 것은 제 몫으로 올라옵니다
            </span>
          </div>
          <ul className="stall-list">
            {theirs.map((s) => (
              <StallRow key={s.id} s={s} />
            ))}
          </ul>
        </section>
      )}

      {data.stalls.length === 0 && data.summary.moving > 0 && (
        <section className="card stall-clear">
          <strong>늦어지고 있는 신청서가 없습니다.</strong>
          <p className="card-note">
            진행 중인 {data.summary.moving}건이 모두 각 단계의 보통 기간 안에 있습니다.
          </p>
        </section>
      )}

      <section className="card">
        <div className="card-head">
          <span className="card-title">단계마다 보통 며칠 걸리나</span>
          <span className="card-note">
            끝난 구간만 셉니다 — 아직 안 끝난 것을 세면 오래 걸리는 단계일수록 짧아 보입니다
          </span>
        </div>
        <ul className="stall-typical">
          {data.typical.map((t) => (
            <li key={t.stage} className={t.enough ? '' : 'thin'}>
              <span className="stall-typical-name">{t.stage}</span>
              <div className="stall-typical-bar">
                {t.enough && (
                  <span
                    style={{ width: `${((t.median ?? 0) / maxTypical) * 100}%` }}
                    aria-hidden="true"
                  />
                )}
              </div>
              {/* 표본이 모자라면 숫자를 아예 안 준다. 한 건 보고 "보통 2일"이라고
                  하면 그 다음부터 이 화면의 숫자를 아무도 안 믿는다. */}
              <span className="stall-typical-val">
                {t.enough ? `${t.median}일` : `아직 ${MIN_SAMPLE}건 미만`}
              </span>
              <span className="card-note">기준 {t.limit}일 · 표본 {t.n}건</span>
            </li>
          ))}
        </ul>
      </section>

      {data.onTrack.length > 0 && (
        <section className="card">
          <div className="card-head">
            <span className="card-title">제때 가고 있는 것 {data.onTrack.length}건</span>
            <span className="card-note">문제가 없다는 것도 알려 드립니다</span>
          </div>
          <ul className="stall-ok">
            {data.onTrack.map((s) => (
              <li key={s.id}>
                <Link to={`/record/${s.id}`}>{s.title}</Link>
                <span className="card-note">
                  {s.dept} · {s.stage} {s.days}일째{s.held ? ' (미뤄 두신 것)' : ''}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
