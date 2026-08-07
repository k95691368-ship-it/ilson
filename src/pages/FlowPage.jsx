import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { STAGES } from '../lib/stages.js'
import { useApi } from '../hooks/useApi.js'
import { ago, num } from '../lib/format.js'
import { buildTodo, todoSummary, NOTHING_CHECKED } from '../../shared/todo.js'
import { provenanceLine, provenanceDetail } from '../../shared/provenance.js'
import {
  TRY_STEPS,
  TRY_TERMS,
  RESET_NOTE,
  VISITOR_NOTE,
  EMPTY_INVITE,
  DEEP_NOTE,
  isEmptySite,
  resetLabel,
  visitorLabel,
  deepLabel,
} from '../../shared/tryit.js'
import { api } from '../api/client.js'
import { useToast } from '../context/ToastContext.jsx'
import { readableWhy } from '../../shared/notice.js'
import { DEPTS } from '../../shared/depts.js'
import { nextStep, tourProgress } from '../../shared/tour.js'

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

      {/* 보러 온 사람에게 눌러도 된다고 말한다.
          이 사이트에는 로그인이 없어서 처음 온 사람도 판정하고 반려할 수
          있는데, 그 사실을 아무 데도 안 적어 뒀다. 화면이 전부 "담당자가
          자기 일을 하는 중"으로 쓰여 있어서 보러 온 사람은 읽기만 하고
          나간다. 할 수 있게 만들어 놓고 할 수 있다고 말을 안 한 것이다. */}
      <TryIt provenance={data?.provenance} counts={data?.counts} />

      {data && data.counts.total > 0 && (
        <Todo overview={data} reports={reports} codes={codes} tools={tools} stalls={stalls} joins={joins} signoffs={signoffs} />
      )}

      {data && data.counts.total > 0 && <Overview data={data} />}

      {/* 예시를 넣은 다음 무엇을 눌러야 하는가.
          앞 회차에서 "예시 여덟 건 넣기"를 놨더니, 눌러 보면 접수함에 여덟
          건이 들어오고 거기서 끝이었다. 나머지 일곱 단계는 비어 있는데
          무엇을 해야 채워지는지가 아무 데도 없었다. 한 칸씩 밀어 준다. */}
      {data && <NextStep overview={data} />}

      <div className="row-between" style={{ marginTop: 4 }}>
        <h2 style={{ margin: 0 }}>여덟 단계</h2>
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
          <span className="card-title">부서별로 보기</span>
          <span className="card-note">이름을 누르면 그 부서와 있었던 일 전부</span>
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

// 다음에 할 것 한 가지.
//
// 담당자용 할 일 목록(Todo)과 다른 것이다. 저쪽은 "지금 문제가 되는 것"을
// 급한 순서로 올린다 — 금액이 틀리는 것, 사람이 기다리는 것. 이쪽은
// **아무 문제가 없어도** 다음 단계로 한 칸 밀어 준다.
//
// 보러 오신 분에게 필요한 것은 문제 목록이 아니라 길이다. 예시를 넣고 나면
// 접수함에 여덟 건이 쌓이는데, 그다음 일곱 단계를 무엇으로 채우는지가
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
          여덟 단계 중 {p.done}칸까지 왔습니다
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

// 직접 눌러 보시라고 초대한다.
//
// 초대하면서 두 가지를 같이 준다 — 누른 것이 기록에 남는다는 사실과,
// 되돌리는 법. 앞엣것을 숨기면 나중에 알았을 때 속은 기분이 들고,
// 뒤엣것이 없으면 망칠까 봐 아무도 안 누른다.
function TryIt({ provenance, counts }) {
  const empty = isEmptySite(counts)
  // 비어 있으면 접어 두지 않는다. 접어 두면 "무엇을 해볼 수 있나"를 눌러야
  // 채우는 자리가 나오는데, 화면에 아무것도 없는 상태에서 그걸 누를 이유를
  // 아무도 모른다.
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [visitors, setVisitors] = useState(null)
  // 만져 본 것까지 몇 건인가. 안전한 치우기가 못 지우는 쪽이다.
  const [touched, setTouched] = useState(0)
  const toast = useToast()
  const demoCount = provenance?.demo ?? 0

  // 펼칠 때만 센다. 첫 화면은 이미 일곱 곳을 두드리고 있어서 하나 더
  // 늘리면 열릴 때마다 그만큼 느려진다.
  //
  // 이 훅이 아래 "아무것도 없을 때" 분기 **뒤에** 있었다. 그러면 신청서가
  // 없을 때는 훅이 안 불리고 생기면 불린다 — 리액트는 렌더마다 훅 개수가
  // 같아야 하므로, 예시를 넣어 개수가 0에서 8로 바뀌는 순간 첫 화면이
  // 통째로 깨질 수 있다. 조건 앞으로 올린다.
  useEffect(() => {
    if (!open || visitors != null) return
    api
      .get('/demo/visitors')
      .then((r) => {
        setVisitors(r.count ?? 0)
        setTouched(r.touched ?? 0)
      })
      .catch(() => setVisitors(0))
  }, [open, visitors])

  async function seed() {
    setBusy(true)
    try {
      const r = await api.post('/demo/seed', {})
      toast.success(`예시 신청서 ${r.added}건을 넣었습니다.`)
      // 숫자가 화면 곳곳에 걸려 있어서 다시 읽는 편이 확실하다.
      window.location.reload()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setBusy(false)
    }
  }

  // 아무것도 없을 때는 초대문 대신 채우는 자리를 보여 준다.
  //
  // 원래 초대문의 첫 항목은 "접수함에서 아무거나 골라 판정해 보세요"다.
  // 접수함이 비어 있으면 그건 빈 방으로 안내하는 말이 된다.
  if (empty) {
    return (
      <section className="tryit tryit-empty">
        <div className="tryit-head">
          <span className="badge badge-accent">보러 오신 분께</span>
          <strong className="tryit-title">{EMPTY_INVITE.title}</strong>
        </div>
        <p className="tryit-sub">{EMPTY_INVITE.why}</p>

        <div className="tryit-empty-actions">
          {EMPTY_INVITE.actions.map((a) =>
            a.key === 'seed' ? (
              <div key={a.key} className="tryit-empty-action">
                <button
                  type="button"
                  className="btn-primary btn-sm"
                  onClick={seed}
                  disabled={busy}
                >
                  {busy ? '넣는 중…' : a.label}
                </button>
                <div className="tryit-what">{a.what}</div>
                <div className="tryit-note">{a.note}</div>
              </div>
            ) : (
              <div key={a.key} className="tryit-empty-action">
                <Link to={a.to} className="btn-ghost btn-sm">
                  {a.label}
                </Link>
                <div className="tryit-what">{a.what}</div>
                <div className="tryit-note">{a.note}</div>
              </div>
            )
          )}
        </div>

        {/* 넣기 전에 밝힌다. 넣고 나서 알면 속은 기분이 든다. */}
        <ul className="tryit-terms">
          {EMPTY_INVITE.terms.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </section>
    )
  }


  async function reset() {
    setBusy(true)
    try {
      // 지우고 다시 심는다. 지우기만 하면 다음 사람은 빈 화면을 본다.
      if (demoCount > 0) await api.remove('/demo/seed')
      const r = await api.post('/demo/seed', {})
      toast.success(`시연 신청서 ${r.added}건을 처음 상태로 되돌렸습니다.`)
      // 숫자가 화면 곳곳에 걸려 있어서 다시 읽는 편이 확실하다.
      window.location.reload()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="tryit">
      <div className="tryit-head">
        <span className="badge badge-accent">보러 오신 분께</span>
        <strong className="tryit-title">읽기만 하지 마시고 직접 눌러 보셔도 됩니다</strong>
        <span className="spacer" />
        <button type="button" className="btn-ghost btn-sm" onClick={() => setOpen((v) => !v)}>
          {open ? '접기' : '무엇을 해볼 수 있나'}
        </button>
      </div>

      <p className="tryit-sub">
        로그인이 없습니다. 판정도, 반려도, 도구 실행도 지금 그대로 하실 수 있습니다.
      </p>

      {open && (
        <>
          <ol className="tryit-list">
            {TRY_STEPS.map((s) => (
              <li key={s.key}>
                <Link to={s.to} className="tryit-label">
                  {s.label}
                </Link>
                <div className="tryit-what">{s.what}</div>
                <div className="tryit-note">{s.note}</div>
              </li>
            ))}
          </ol>

          <ul className="tryit-terms">
            {TRY_TERMS.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>

          <div className="tryit-reset">
            <div className="tryit-reset-text">
              <strong>{RESET_NOTE.does}</strong>
              <div className="card-note">{RESET_NOTE.keeps}</div>
              <div className="card-note">{RESET_NOTE.why}</div>
            </div>
            <button type="button" className="btn-primary btn-sm" onClick={reset} disabled={busy}>
              {busy ? '되돌리는 중…' : resetLabel(demoCount)}
            </button>
          </div>

          {/* 보러 오신 분들이 시험 삼아 낸 것.
              위 되돌리기는 시연 시드만 건드린다. 그것만 있으면 면접관이
              낸 신청서가 영영 쌓여서, 첫 화면이 "하루 넘게 못 본 신청서
              20건"을 띄우게 된다. 초대한 결과가 초대한 화면을 망친다. */}
          {visitorLabel(visitors) && (
            <div className="tryit-reset">
              <div className="tryit-reset-text">
                <strong>{VISITOR_NOTE.rule}</strong>
                <div className="card-note">{VISITOR_NOTE.why}</div>
              </div>
              <button
                type="button"
                className="btn-ghost btn-sm"
                disabled={busy}
                onClick={async () => {
                  setBusy(true)
                  try {
                    const r = await api.remove('/demo/visitors')
                    toast.success(r.message)
                    window.location.reload()
                  } catch (err) {
                    toast.error(err.message)
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                {visitorLabel(visitors)}
              </button>
            </div>
          )}

          {/* 위 단추가 못 지우는 쪽.
              위쪽은 "낸 뒤로 아무 일도 안 일어난 것"만 지운다. 그런데 이
              화면은 판정해 보시라고 권한다 — **권한 대로 하신 흔적이 정확히
              위 규칙이 못 지우는 자료다.** 읽기만 하고 나간 분의 흔적은
              지워지는데 눌러 보신 분의 흔적만 영영 남았다. */}
          {deepLabel(touched) && (
            <div className="tryit-reset">
              <div className="tryit-reset-text">
                <strong>{DEEP_NOTE.rule}</strong>
                <div className="card-note">{DEEP_NOTE.why}</div>
                <div className="card-note">{DEEP_NOTE.warn}</div>
              </div>
              <button
                type="button"
                className="btn-ghost btn-sm"
                disabled={busy}
                onClick={async () => {
                  setBusy(true)
                  try {
                    const r = await api.remove('/demo/visitors', {
                      deep: true,
                      confirm: DEEP_NOTE.confirm,
                    })
                    toast.success(r.message)
                    window.location.reload()
                  } catch (err) {
                    toast.error(err.message)
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                {deepLabel(touched)}
              </button>
            </div>
          )}
        </>
      )}
    </section>
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
