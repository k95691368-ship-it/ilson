import { Link } from 'react-router-dom'
import { STAGES } from '../lib/stages.js'
import { useApi } from '../hooks/useApi.js'
import { ago, num } from '../lib/format.js'
import { buildTodo, todoSummary, NOTHING_CHECKED } from '../../shared/todo.js'

// 첫 화면. 여덟 단계가 한 장에 보이고, 그 위에 지금 이 조직에 무슨 일이
// 일어나고 있는지가 숫자로 얹힌다.
//
// 목차만 있으면 "그래서 뭐가 어떻게 됐는데"에 답하지 못한다. 몇 건이 들어왔고,
// 어디서 막혀 있고, 얼마나 걸려서 넘어가는지가 보여야 기록을 담당하는
// 사이트라는 말이 실감난다.
export default function FlowPage() {
  const { data } = useApi('/overview')
  // 화면마다 "여기 볼 것이 있습니다"를 자기 안에서만 말한다. 그래서
  // 담당자가 아침에 앉으면 여섯 화면을 돌아다녀야 오늘 뭘 할지 안다.
  // 그러면 안 돌아다닌다 — 늘 열던 한 화면만 열고 나머지는 쌓인다.
  const { data: reports } = useApi('/reports')
  const { data: codes } = useApi('/codes')
  const { data: tools } = useApi('/tools')
  const { data: stalls } = useApi('/stalls')
  const { data: joins } = useApi('/joins')
  const { data: signoffs } = useApi('/signoffs')

  return (
    <div className="stack">
      <header className="page-head">
        <span className="page-eyebrow">AX 실행 기록</span>
        <h1>부서의 병목이 도구가 되기까지</h1>
        <p className="page-sub">
          각 부서가 병목을 신청서로 적어 냅니다. AX 담당자가 열람하고, 무엇을 먼저 할지 정하고,
          못 만드는 것은 이유와 함께 반려합니다. 부서와 협의해 합격 기준을 먼저 정하고,
          만들고, 실제 담당자가 써 보고, 사용법서와 함께 넘긴 뒤, 처음에 재 둔 기준선과
          비교해 성과를 정리합니다. 그 과정 전체가 신청서 한 건 아래 기록으로 남습니다.
        </p>
      </header>

      {data && data.counts.total > 0 && (
        <Todo overview={data} reports={reports} codes={codes} tools={tools} stalls={stalls} joins={joins} signoffs={signoffs} />
      )}

      {data && data.counts.total > 0 && <Overview data={data} />}

      <div className="row-between" style={{ marginTop: 4 }}>
        <h2 style={{ margin: 0 }}>여덟 단계</h2>
        <Link to="/track" className="btn-ghost btn-sm">
          접수번호로 내 신청서 찾기
        </Link>
      </div>

      <ol className="flow-list">
        {STAGES.map((s) => {
          // 목차 이름에서 띄어쓰기만 빼면 현황의 단계 이름과 같아진다.
          const here = data?.byStage?.[s.label.replace(/\s/g, '')] ?? 0
          return (
            <li key={s.key}>
              <Link to={s.path} className="flow-card">
                <span className="flow-no">{s.no}</span>
                <span className="flow-body">
                  <span className="flow-title">
                    {s.title}
                    {here > 0 && <span className="flow-count">{here}건 머물러 있음</span>}
                  </span>
                  <span className="flow-owner">{s.owner}</span>
                  <span className="flow-summary">{s.summary}</span>
                </span>
                <span className="flow-go" aria-hidden="true">
                  →
                </span>
              </Link>
            </li>
          )
        })}
      </ol>

      {data?.tools?.list?.length > 0 && (
        <section className="card">
          <div className="card-head">
            <span className="card-title">부서에 넘긴 도구</span>
            <span className="card-note">
              넘긴 뒤 {num(data.tools.totalRuns)}번 쓰였습니다
            </span>
          </div>
          <div className="chip-row">
            {data.tools.list.map((t) => (
              <Link key={t.slug} to={`/t/${t.slug}`} className="chip">
                {t.dept} · {t.title.slice(0, 24)}
                {t.title.length > 24 && '…'}
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="card">
        <div className="card-title">여기에 마법은 없습니다</div>
        <p className="card-note" style={{ marginBottom: 12 }}>
          파일을 읽고 합치고 검산하는 일은 전부 <strong>정해진 규칙</strong>이 합니다. 외부 서비스를
          한 번도 부르지 않습니다. 같은 파일을 넣으면 언제나 같은 결과가 나오고, 어느 숫자든 눌러서
          원본 파일의 몇 번째 줄에서 왔는지까지 되짚을 수 있습니다.
        </p>
        <div className="grid-2">
          <div className="decided">
            <span className="origin-label origin-human">◆ 사람이 정하는 것</span>
            <div className="item-body">
              무엇을 먼저 할지, 무엇을 반려할지, 부딪히는 요구 중 무엇을 택할지, 무엇을 통과로
              볼지, 성과를 어떻게 셀지.
            </div>
          </div>
          <div className="card-flat">
            <span className="origin-label">◇ 규칙이 하는 것</span>
            <div className="item-body">
              파일 읽기, 컬럼 맞추기, 상품코드 통일, 통화 환산, 계산, 검산, 합격 기준 채점.
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

// 지금 무엇을 해야 하는가.
//
// 아무거나 다 올리지 않는다. 스무 개가 올라온 목록은 아무것도 안 올라온
// 것과 같다. 그리고 순서가 틀리면 더 나쁘다 — 숫자가 틀리는 일보다
// 사용법서 쓰는 일이 위에 있으면 그 목록은 쓸모가 없다.
function Todo({ overview, reports, codes, tools, stalls, joins, signoffs }) {
  const items = buildTodo({ overview, reports, codes, tools, stalls, joins, signoffs })
  const s = todoSummary(items)

  if (items.length === 0) {
    return (
      <section className="todo todo-clear">
        <div className="todo-head">
          <span className="todo-title">지금 손볼 것이 없습니다</span>
        </div>
        {/* "할 일이 없습니다"로 끝내면 정말 없는 것인지 못 세고 있는
            것인지 모른다. 무엇을 보고 없다고 하는지 밝힌다. */}
        <p className="card-note">
          {NOTHING_CHECKED.join(' · ')} — 이 {NOTHING_CHECKED.length}가지를 보고 드리는 말씀입니다.
        </p>
      </section>
    )
  }

  return (
    <section className="todo">
      <div className="todo-head">
        <span className="todo-title">지금 손볼 것 {s.total}가지</span>
        <span className="spacer" />
        {s.money > 0 && <span className="badge badge-danger">금액에 걸리는 것 {s.money}</span>}
        {s.waiting > 0 && <span className="badge badge-warning">사람이 기다리는 것 {s.waiting}</span>}
      </div>

      <ol className="todo-list">
        {items.map((i) => (
          <li key={i.key} className={`todo-item kind-${i.kind}`}>
            <div className="todo-item-top">
              <span className={`badge ${i.kind === '금액' ? 'badge-danger' : i.kind === '대기' ? 'badge-warning' : 'badge-neutral'}`}>
                {i.kind}
              </span>
              <span className="todo-item-title">{i.title}</span>
            </div>
            {/* 이유 없이 시키면 아무도 안 한다. */}
            <p className="todo-why">{i.why}</p>
            <Link to={i.to} className="btn-ghost btn-sm">
              {i.cta}
            </Link>
          </li>
        ))}
      </ol>
    </section>
  )
}

function Overview({ data }) {
  const c = data.counts

  return (
    <>
      <section className="stat-row">
        <Tile label="들어온 신청서" value={num(c.total)} note={`부서 ${data.byDept.length}곳`} />
        <Tile
          label="아직 안 본 것"
          value={num(c.waiting)}
          note={c.stale > 0 ? `그중 ${c.stale}건은 하루 넘음` : '밀린 것 없음'}
          tone={c.stale > 0 ? 'warn' : undefined}
        />
        <Tile
          label="반려"
          value={data.refuseRate != null ? `${data.refuseRate}%` : '—'}
          note={`${c.refused}건 · 이유와 대안을 함께 보냈습니다`}
        />
        <Tile
          label="부서에 넘김"
          value={num(data.tools.handedOver)}
          note={
            data.tools.totalRuns > 0
              ? `넘긴 뒤 ${num(data.tools.totalRuns)}번 쓰임`
              : '아직 쓰인 기록 없음'
          }
        />
        <Tile
          label="접수 → 인수인계"
          value={data.lead.medianDays != null ? `${data.lead.medianDays}일` : '—'}
          note={data.lead.count > 0 ? `${data.lead.count}건의 중앙값` : '아직 넘긴 것 없음'}
        />
      </section>

      <div className="grid-side">
        <section className="card">
          <div className="card-head">
            <span className="card-title">어디서 막혀 있나</span>
            <span className="card-note">병목은 신청서에만 있는 게 아닙니다</span>
          </div>
          <StageBars byStage={data.byStage} total={c.total} />
        </section>

        <div className="stack">
          {data.byDept.length > 0 && (
            <section className="card">
              <div className="card-head">
                <span className="card-title">부서별</span>
                <span className="card-note">이름을 누르면 그 부서와 있었던 일 전부</span>
              </div>
              <div className="table-wrap" style={{ marginTop: 8 }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>부서</th>
                      <th className="num">낸 것</th>
                      <th className="num">반려</th>
                      <th className="num">완료</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byDept.map((d) => (
                      <tr key={d.dept}>
                        <td>
                          <Link to={`/dept/${encodeURIComponent(d.dept)}`}>{d.dept}</Link>
                        </td>
                        <td className="num">{d.total}</td>
                        <td className="num">{d.refused || '—'}</td>
                        <td className="num">{d.done || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {data.refuseMix.length > 0 && (
            <section className="card">
              <div className="card-title">무엇을 못 만든다고 했나</div>
              <p className="card-note" style={{ margin: '4px 0 8px' }}>
                반려가 0이면 오히려 아무 판단도 하지 않았다는 뜻입니다.
              </p>
              <ul className="refuse-mix">
                {data.refuseMix.map((r) => (
                  <li key={r.code}>
                    <span>{r.label}</span>
                    <strong>{r.n}건</strong>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>

      {data.recentDecisions.length > 0 && (
        <section className="card">
          <div className="card-head">
            <span className="card-title">최근 결정</span>
            {data.unrequestedCount > 0 && (
              <span className="card-note">
                요청받지 않았는데 먼저 제안한 것 {data.unrequestedCount}건
              </span>
            )}
          </div>
          <div className="stack-sm">
            {data.recentDecisions.slice(0, 4).map((d) => (
              <div key={d.id} className={d.actor === 'ai' ? 'draft' : 'decided'}>
                <span
                  className={`origin-label ${d.actor === 'ai' ? 'origin-ai' : 'origin-human'}`}
                >
                  ◆ {d.stage} · {ago(d.created_at)}
                  {d.unrequested === 1 && ' · 먼저 제안'}
                </span>
                <div className="item-body" style={{ fontSize: 14, fontWeight: 700 }}>
                  {d.title}
                </div>
                <div className="decision-why">
                  <strong>왜</strong> {d.why}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  )
}

// 반려·보류는 단계가 아니다. 여덟 단계를 지나가다 빠진 자리다.
// 막대에는 같이 그리되(어디로 빠졌는지 보여야 한다), 세는 문장에서는
// 갈라 적는다.
const OFF_STAGE = ['반려', '보류']

const STAGE_ORDER = [
  '신청서',
  '검토',
  '협의안',
  '제작',
  '베타테스트',
  '사용법서',
  '배포',
  '성과',
  '반려',
  '보류',
]

function StageBars({ byStage, total }) {
  const rows = STAGE_ORDER.filter((s) => (byStage[s] ?? 0) > 0)
  const inStages = STAGE_ORDER.filter((s) => !OFF_STAGE.includes(s)).reduce(
    (n, s) => n + (byStage[s] ?? 0),
    0
  )
  const max = Math.max(...rows.map((s) => byStage[s]), 1)

  return (
    <div className="stage-bars">
      {rows.map((s) => {
        const n = byStage[s]
        const tone = s === '반려' ? 'refused' : s === '보류' ? 'held' : ''
        return (
          <div key={s} className={`stage-bar ${tone}`}>
            <span className="stage-bar-label">{s}</span>
            <span className="stage-bar-track">
              <span className="stage-bar-fill" style={{ width: `${(n / max) * 100}%` }} />
            </span>
            <span className="stage-bar-value">{n}</span>
          </div>
        )
      })}
      {/* 여덟 단계에 있는 것만 센다.
          전체 건수를 그대로 적으면 반려·보류처럼 단계에 없는 것까지
          여덟 단계에 있는 것처럼 읽힌다. 막대 합과 이 숫자가 안 맞는다. */}
      <p className="card-note" style={{ marginTop: 8 }}>
        {inStages}건이 여덟 단계 위에 있습니다
        {total > inStages && ` · 나머지 ${total - inStages}건은 반려·보류처럼 단계 밖입니다`}.
      </p>
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
