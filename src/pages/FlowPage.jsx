import { useState } from 'react'
import { Link } from 'react-router-dom'
import { STAGES } from '../lib/stages.js'
import { useApi } from '../hooks/useApi.js'
import { ago, num } from '../lib/format.js'
import { buildTodo, todoSummary, NOTHING_CHECKED } from '../../shared/todo.js'
import { URGENCY } from '../../shared/urgency.js'
import { provenanceLine, provenanceDetail } from '../../shared/provenance.js'
import { readableWhy } from '../../shared/notice.js'
import { DEPTS } from '../../shared/depts.js'
import { nextStep, tourProgress } from '../../shared/tour.js'

// 첫 화면. 여섯 단계가 한 장에 보이고, 그 위에 지금 이 조직에 무슨 일이
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
  const { data: reports, error: reportsErr } = useApi('/reports')
  const { data: codes, error: codesErr } = useApi('/codes')
  const { data: tools, error: toolsErr } = useApi('/tools')
  const { data: stalls, error: stallsErr } = useApi('/stalls')
  const { data: joins, error: joinsErr } = useApi('/joins')
  const { data: signoffs, error: signoffsErr } = useApi('/signoffs')

  // 못 불러온 것을 '없는 것'으로 세지 않는다.
  //
  // 할 일 목록은 이 일곱 곳에서 재료를 모은다. 그중 하나가 503을 내면
  // 그 갈래는 그냥 0건이 되고, 화면은 "지금 손볼 것이 없습니다 … 이
  // 11가지를 보고 드리는 말씀입니다"라고 적는다. 결과를 믿을 수 없다는
  // 신고가 세 건 그대로 있는 아침에도 그렇게 적는다.
  //
  // 담당자는 오늘 할 일이 없다고 읽고 그 화면들을 안 연다. 못 센 것을
  // 안 센 것처럼 말하는 것이 이 사이트가 제일 하면 안 되는 일이다.
  const missing = [
    ['신고', reportsErr],
    ['알려 준 코드', codesErr],
    ['넘긴 도구', toolsErr],
    ['막힌 곳', stallsErr],
    ['손든 부서', joinsErr],
    ['부서 서명', signoffsErr],
  ]
    .filter(([, err]) => err)
    .map(([name]) => name)

  return (
    <div className="stack">
      <header className="page-head home-hero">
        <span className="page-eyebrow">업무 자동화 포트폴리오</span>
        <h1>반복 업무를 실제 도구로.</h1>
        <p className="page-lede">
          현업이 겪는 반복 업무를 함께 정의하고, 작동하는 도구로 만든 뒤 실제 효과를 확인합니다.
        </p>
        <div className="page-head-actions">
          <Link to="/apply" className="btn-primary">반복 업무 신청하기</Link>
          <a href="#process" className="btn-ghost">과정 보기</a>
        </div>
      </header>

      {/* 예시를 넣은 다음 무엇을 눌러야 하는가.
          "예시 세 건 넣기"를 놨더니, 눌러 보면 접수함에 세
          건이 들어오고 거기서 끝이었다. 나머지 일곱 단계는 비어 있는데
          무엇을 해야 채워지는지가 아무 데도 없었다. 한 칸씩 밀어 준다.

          이 칸이 할 일 목록과 숫자판 **아래**에 있었다. 처음 온 사람이
          맨 위에서 만나는 것이 열일곱 종짜리 할 일 목록과 숫자 격자였고,
          정작 "다음에 이거 하나만 누르세요"는 그 밑에 깔려 있었다.
          읽는 순서를 가벼운 것부터로 바꾼다 — 눌러도 된다 → 다음 한 가지
          → 밀린 것 전부 → 숫자. */}
      {data && <NextStep overview={data} />}

      {data && data.counts.total > 0 && (
        <Todo
          overview={data}
          reports={reports}
          codes={codes}
          tools={tools}
          stalls={stalls}
          joins={joins}
          signoffs={signoffs}
          missing={missing}
        />
      )}

      {data && data.counts.total > 0 && <Overview data={data} />}

      {/* 여기서부터 화면의 성격이 바뀐다. 위는 "지금 무엇을 할까",
          아래는 "이 사이트가 무엇인가"다. 간격이 전부 같으면 아홉 덩어리가
          한 줄로 보여서 어디서 끊어 읽을지를 읽는 사람이 정해야 했다. */}
      <div className="row-between band-break" id="process">
        <h2 style={{ margin: 0 }}>여섯 단계</h2>
        <div className="row">
          {/* 넘긴 도구 화면은 아래 '부서에 넘긴 도구' 칸으로만 갈 수 있었는데,
              그 칸은 넘긴 것이 있어야 뜬다. 넘긴 것이 없을 때 "넘기면 어떻게
              되는지"를 보러 갈 길이 없었다. */}
          <Link to="/tools" className="btn-ghost btn-sm">
            넘긴 도구는 지금 어떻게 됐나
          </Link>
          <Link to="/track" className="btn-ghost btn-sm">
            접수번호로 내 신청서 찾기
          </Link>
        </div>
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

      {/* 부서별로 보는 화면으로 가는 문.
          이 화면 아래쪽에 "이름을 누르면 그 부서와 있었던 일 전부"라고 이미
          적혀 있는데, 그 약속이 **데이터가 있을 때만** 지켜지고 있었다.
          신청서가 없으면 /dept 로 가는 링크가 사이트 어디에도 없었다.
          담당자와 부서가 같은 사이트를 쓰는데, 부서 사람이 첫 화면에서 자기
          부서 이름을 못 찾으면 그런 화면이 있다는 것 자체를 모른다. */}
      <section className="card">
        <div className="card-head">
          <h2 className="card-title">부서별로 보기</h2>
        </div>
        <div className="chip-row">
          {DEPTS.map((d) => (
            <Link key={d} to={`/dept/${encodeURIComponent(d)}`} className="chip">
              {d}
              {data?.byDept?.find((x) => x.dept === d)?.total > 0 && (
                <span className="chip-count">
                  {data.byDept.find((x) => x.dept === d).total}
                </span>
              )}
            </Link>
          ))}
        </div>
      </section>

      {data?.tools?.list?.length > 0 && (
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">부서에 넘긴 도구</h2>
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

    </div>
  )
}

// 다음에 할 것 한 가지.
//
// 담당자용 할 일 목록(Todo)과 다른 것이다. 저쪽은 "지금 문제가 되는 것"을
// 급한 순서로 올린다 — 금액이 틀리는 것, 사람이 기다리는 것. 이쪽은
// **아무 문제가 없어도** 다음 단계로 한 칸 밀어 준다.
//
// 보러 오신 분에게 필요한 것은 문제 목록이 아니라 길이다. 예시를 넣고 나면
// 접수함에 신청서가 쌓이는데, 그다음 일곱 단계를 무엇으로 채우는지가
// 아무 데도 안 적혀 있었다.
//
// 한 가지만 말한다. 여덟 개를 한꺼번에 늘어놓으면 첫 번째도 안 누른다.
function NextStep({ overview }) {
  const step = nextStep(overview)
  const p = tourProgress(overview)
  if (!step) return null

  return (
    <section className="nextstep">
      <div className="nextstep-head">
        <span className="badge badge-neutral">다음은 이것</span>
        <strong className="nextstep-title">{step.label}</strong>
        <span className="spacer" />
        {/* 몇 칸 남았는지 안 보이면 끝이 없는 일처럼 느껴진다. */}
        <span className="card-note">
          여섯 단계 중 {p.done}칸까지 왔습니다
        </span>
      </div>

      <div className="nextstep-bar" aria-hidden="true">
        {Array.from({ length: p.total }, (_, i) => (
          <span key={i} className={`nextstep-tick${i < p.done ? ' on' : ''}`} />
        ))}
      </div>

      <p className="nextstep-what">{step.what}</p>
      {/* 그 화면이 무엇을 안 받아 주는지를 **미리** 말한다. 눌러 봤다가
          막히면 고장인 줄 안다. */}
      <p className="nextstep-need">{step.need}</p>
      <p className="nextstep-shows">{step.shows}</p>

      <Link to={step.where} className="btn-primary btn-sm">
        {step.stage} 화면으로
      </Link>
    </section>
  )
}

// 지금 무엇을 해야 하는가.
//
// 아무거나 다 올리지 않는다. 스무 개가 올라온 목록은 아무것도 안 올라온
// 것과 같다. 그리고 순서가 틀리면 더 나쁘다 — 숫자가 틀리는 일보다
// 사용법서 쓰는 일이 위에 있으면 그 목록은 쓸모가 없다.
function Todo({ overview, reports, codes, tools, stalls, joins, signoffs, missing = [] }) {
  const items = buildTodo({ overview, reports, codes, tools, stalls, joins, signoffs })
  const s = todoSummary(items)
  // 급한 것(금액·대기)은 펴 두고 '정리'만 접는다. 무게는 shared/urgency.js
  // 가 한 벌로 정한다 — 화면마다 따로 판단하면 어느 화면에서는 접히고
  // 어느 화면에서는 안 접힌다.
  const urgent = items.filter((i) => (i.rank ?? URGENCY[i.kind] ?? 1) >= 2)
  const later = items.filter((i) => (i.rank ?? URGENCY[i.kind] ?? 1) < 2)

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
        {missing.length > 0 && <MissingNote missing={missing} />}
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

      {missing.length > 0 && <MissingNote missing={missing} />}

      {/* 한 덩어리가 1,970px 이었다.
          shared/todo.js 가 최대 12건을 내보내고 이 자리가 그 12건을 전부
          폈다. 항목 하나가 약 138px 이라 노트북 화면 두 장 반이 이 목록
          하나다. 그런데 그 12건이 배지·제목·회색 두 줄·버튼으로 전부 같은
          모양이라, 금액 3건과 정리 3건이 모양으로 안 갈렸다.

          급한 것은 편 채로 두고 '정리' 갈래만 접는다. 정리는 정의부터가
          '나중에 문제가 될 것'이라 오늘 아침에 누를 것이 아니다.
          접힌 줄에 몇 건인지와 제목을 적으므로 없는 것이 되지는 않는다. */}
      <ol className="todo-list">
        {urgent.map((i) => (
          <TodoItem key={i.key} i={i} />
        ))}
      </ol>

      {later.length > 0 && (
        <details className="disclose todo-later">
          <summary>
            나중에 문제가 될 것 {later.length}가지 — {later.map((i) => i.title).join(' · ')}
          </summary>
          <ol className="todo-list">
            {later.map((i) => (
              <TodoItem key={i.key} i={i} />
            ))}
          </ol>
        </details>
      )}
    </section>
  )
}

function TodoItem({ i }) {
  return (
    <li className={`todo-item kind-${i.kind}`}>
      <div className="todo-item-top">
        <span
          className={`badge ${i.kind === '금액' ? 'badge-danger' : i.kind === '대기' ? 'badge-warning' : 'badge-neutral'}`}
        >
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
  )
}

// 못 센 것을 밝힌다.
//
// 할 일 목록은 일곱 곳에서 재료를 모은다. 하나가 503을 내면 그 갈래는
// 그냥 0건이 되고, 화면은 아무 일 없다는 얼굴을 한다. 세지 **못한** 것과
// 셌더니 **없는** 것은 다른 말인데 화면이 그 둘을 같게 말했다.
function MissingNote({ missing }) {
  return (
    <div className="notice notice-warn" style={{ marginTop: 12 }}>
      <div className="notice-title">
        이 중 {missing.length}가지는 지금 못 불러왔습니다 — {missing.join(' · ')}
      </div>
      <p className="card-note">
        못 세었다는 뜻이지 없다는 뜻이 아닙니다. 잠시 뒤 새로고침해 보시고, 계속 이러면 해당
        화면을 직접 열어 확인해 주세요.
      </p>
    </div>
  )
}


// 이 화면의 숫자가 무엇 위에 서 있는가.
//
// 첫 화면은 "접수 12건, 완료 1건" 같은 숫자를 크게 보여 주는데 그중 여덟
// 건은 시연을 위해 심은 것이다. 그 사실이 /review 한 군데에만 적혀 있었다.
// 그 화면을 안 열면 모른다.
//
// 감추지도, 과장해서 사과하지도 않는다. 심은 것은 심었다고 하고, 심은 것이
// 신청서 문장**뿐**이라는 것과 그 뒤는 실제로 돌아간 것이라는 사실을
// 같이 적는다. 안 그러면 "전부 꾸며 낸 화면"으로 읽힌다.
function Provenance({ p }) {
  const [open, setOpen] = useState(false)
  const line = provenanceLine(p)
  if (!line) return null
  const detail = provenanceDetail(p)

  return (
    <section className="provenance">
      <div className="provenance-head">
        <span className="badge badge-neutral">이 숫자의 출처</span>
        <span className="provenance-line">{line}</span>
        <span className="spacer" />
        <button type="button" className="btn-ghost btn-sm" onClick={() => setOpen((v) => !v)}>
          {open ? '접기' : '무엇이 심은 것인가'}
        </button>
      </div>

      {open && detail && (
        <dl className="provenance-detail">
          <dt>심어 둔 것</dt>
          <dd>{detail.seeded}</dd>
          <dt>실제로 돌아간 것</dt>
          <dd>{detail.real}</dd>
          <dt>원본 파일</dt>
          <dd>{detail.data}</dd>
          <dt>더 볼 곳</dt>
          <dd>
            <Link to={detail.where}>증명하지 못한 것</Link>
            <span className="card-note"> · 저장소의 {detail.doc}</span>
          </dd>
        </dl>
      )}
    </section>
  )
}

function Overview({ data }) {
  const c = data.counts

  return (
    <>
      {/* 이 숫자가 무엇 위에 서 있는지 먼저 말한다.
          숫자를 보여 준 다음에 각주로 다는 것과, 보여 주기 전에 말하는 것은
          다르다. 이 사이트가 파는 것이 기록인데 기록의 출처를 안 밝히면
          나머지 기록도 못 믿는다. */}
      <Provenance p={data.provenance} />

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
          // 이 타일이 "전부 대안을 함께 보냈다"고 단언하는 동안, 같은
          // 사이트의 /honesty는 "대안 없이 반려한 것 N건"이라고 반대로
          // 말하고 있었다. 한 사이트가 서로 다른 말을 하면 둘 다 못 믿는다.
          //
          // 세는 자리를 하나로 두고, 안 지킨 것이 있으면 그것부터 적는다.
          note={
            data.refusedWithoutAlternative > 0
              ? `${c.refused}건 · 그중 ${data.refusedWithoutAlternative}건은 대안 없이 반려`
              : `${c.refused}건 · 전부 이유와 대안을 함께 보냈습니다`
          }
          tone={data.refusedWithoutAlternative > 0 ? 'warn' : undefined}
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

      {/* 중앙값만 보이면 폭이 안 보인다.
          셋 다 열흘쯤 걸린 것과, 사흘짜리 하나에 스무날짜리 하나가 섞여
          중앙이 열흘인 것은 완전히 다른 이야기인데 화면에서는 같은 숫자다.
          서버는 최단·최장을 이미 계산해 내려보내는데 읽는 곳이 없었다.

          이 사이트는 다른 자리에서 "못 한 것을 숨기지 않는다"고 말한다.
          오래 걸린 건을 가려 놓고 그 말을 할 수는 없다. */}
      {data.lead.count > 1 && data.lead.fastest && data.lead.slowest && <LeadSpread lead={data.lead} />}

      <div className="grid-side">
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">어디서 막혀 있나</h2>
          </div>
          <StageBars byStage={data.byStage} total={c.total} />
        </section>

        <div className="stack">
          {data.byDept.length > 0 && (
            <section className="card">
              <div className="card-head">
                <h3 className="card-title">부서별</h3>
              </div>
              <div className="table-wrap" style={{ marginTop: 8 }}>
                <table className="data-table">
                  <caption className="sr-only">부서별 신청과 처리 현황</caption>
                  <thead>
                    <tr>
                      <th scope="col">부서</th>
                      <th scope="col" className="num">낸 것</th>
                      <th scope="col" className="num">반려</th>
                      <th scope="col" className="num">완료</th>
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
              <h3 className="card-title">무엇을 못 만든다고 했나</h3>
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
            <h2 className="card-title">최근 결정</h2>
            {data.unrequestedCount > 0 && (
              // 이 숫자는 최근 것이 아니라 전체다. 옆의 목록은 최근 네 건만
              // 보여주므로, 여기서 세는 범위가 다르다는 것을 링크로 분명히
              // 한다 — 눌러 보면 그 셋이 나온다.
              <Link to="/log?unrequested=1" className="card-note">
                요청받지 않았는데 먼저 제안한 것 {data.unrequestedCount}건 전체 보기
              </Link>
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
                {readableWhy(d.why) && (
                  <div className="decision-why">
                    <strong>왜</strong> {readableWhy(d.why)}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  )
}

// 반려·보류는 단계가 아니다. 여섯 단계를 지나가다 빠진 자리다.
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
      {/* 여섯 단계에 있는 것만 센다.
          전체 건수를 그대로 적으면 반려·보류처럼 단계에 없는 것까지
          여섯 단계에 있는 것처럼 읽힌다. 막대 합과 이 숫자가 안 맞는다. */}
      <p className="card-note" style={{ marginTop: 8 }}>
        {inStages}건이 여섯 단계 위에 있습니다
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

// 가장 빨랐던 것과 가장 오래 걸린 것.
//
// 숫자만 놓으면 "그래서 뭐" 로 끝난다. 어느 건이었는지까지 붙이고 그 기록으로
// 갈 수 있게 해야 "이건 왜 스무날이나 걸렸지"를 눌러 볼 수 있다.
function LeadSpread({ lead }) {
  const days = (n) => `${Math.round(n * 10) / 10}일`
  return (
    <section className="card lead-spread">
      <div className="card-head">
        <h2 className="card-title">가장 빨랐던 것과 가장 오래 걸린 것</h2>
      </div>
      <div className="lead-spread-row">
        <div className="lead-spread-one">
          <span className="badge badge-success">가장 빠름 {days(lead.fastest.days)}</span>
          <Link to={`/record/${lead.fastest.ticket_no}`} className="lead-spread-title">
            {lead.fastest.dept} · {lead.fastest.title}
          </Link>
        </div>
        <div className="lead-spread-one">
          <span className="badge badge-warning">가장 오래 {days(lead.slowest.days)}</span>
          <Link to={`/record/${lead.slowest.ticket_no}`} className="lead-spread-title">
            {lead.slowest.dept} · {lead.slowest.title}
          </Link>
        </div>
      </div>
      {/* 폭이 크면 그 사실을 말한다. 중앙값 하나로 뭉개면 "대체로 열흘"이
          되는데, 실제로 스무날 기다린 부서가 있으면 그건 사실이 아니다. */}
      {lead.slowest.days >= lead.fastest.days * 3 && lead.slowest.days - lead.fastest.days >= 3 && (
        <p className="card-note">
          가장 오래 걸린 것이 가장 빠른 것의 {Math.floor(lead.slowest.days / Math.max(1, lead.fastest.days))}배가
          넘습니다. 중앙값 하나로는 이 차이가 안 보입니다.
        </p>
      )}
    </section>
  )
}
