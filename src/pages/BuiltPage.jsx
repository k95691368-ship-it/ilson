import { useState } from 'react'
import { Link } from 'react-router-dom'
import { PLAIN, TECH, techFacts } from '../../shared/about.js'
import { inlineParts } from '../lib/inline.js'
import { useApi } from '../hooks/useApi.js'

// 본문에 달린 강조·코드 표시를 화면 요소로 바꾼다. 안 하면 별표와 백틱이
// 그대로 보인다.
function Body({ text, className = 'built-body' }) {
  return (
    <p className={className}>
      {inlineParts(text).map((part, i) =>
        typeof part === 'string' ? (
          part
        ) : part.kind === 'code' ? (
          <code key={i}>{part.text}</code>
        ) : (
          <strong key={i}>{part.text}</strong>
        )
      )}
    </p>
  )
}

// 기술 구현 보러가기.
//
// 두 사람이 이 화면을 연다.
//
//   ① 코딩을 모르는 사람. 이 사이트가 **무슨 문제를 푸는지** 알고 싶다.
//      기술 용어를 쓰면 그 자리에서 닫는다.
//   ② 코딩을 아는 사람. 무슨 문제를 푸는지는 첫 화면에서 이미 봤고,
//      **어떻게 만들었는지**가 궁금하다. 쉬운 말로만 쓰면 얕아 보인다.
//
// 한 글로 둘을 만족시키려 하면 둘 다 놓친다. 그래서 칸을 나눈다. 같은 것을
// 두 번 말하는 것이 아니라 **다른 질문에 답한다.**
export default function BuiltPage() {
  // 처음 온 사람이 기본값이다. 코딩 아는 사람은 탭 하나를 더 누를 수 있다.
  const [tab, setTab] = useState('plain')
  const { data } = useApi('/built')
  const facts = techFacts(data?.counts)

  return (
    <div className="stack">
      <header className="page-head">
        <span className="page-eyebrow">기술 구현 보러가기</span>
        <h1>무엇을 만들었고, 어떻게 만들었나</h1>
      </header>

      <div className="built-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'plain'}
          className={`built-tab${tab === 'plain' ? ' on' : ''}`}
          onClick={() => setTab('plain')}
        >
          무슨 문제를 푸나
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'tech'}
          className={`built-tab${tab === 'tech' ? ' on' : ''}`}
          onClick={() => setTab('tech')}
        >
          어떻게 만들었나
        </button>
      </div>

      {tab === 'plain' ? <Plain /> : <Tech facts={facts} />}
    </div>
  )
}

// ── 코딩을 몰라도 읽히는 쪽 ─────────────────────────────────
function Plain() {
  return (
    <>
      <section className="card built-lead">
        <h2>{PLAIN.headline}</h2>
        <p>{PLAIN.intro}</p>
      </section>

      <section className="card">
        <div className="card-head">
          <span className="card-title">여섯 단계</span>
        </div>
        <ol className="built-stages">
          {PLAIN.stages.map((s) => (
            <li key={s.n}>
              <span className="built-stage-n">{s.n}</span>
              <div>
                <strong>{s.title}</strong>
                <Body text={s.body} className="" />
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="card">
        <div className="card-head">
          <span className="card-title">다른 관리 도구와 다른 점</span>
        </div>
        <div className="built-points">
          {PLAIN.points.map((p) => (
            <div key={p.title} className="built-point">
              <strong>{p.title}</strong>
              <Body text={p.body} className="" />
            </div>
          ))}
        </div>
      </section>

      <section className="card built-cta">
        <p>
          읽기만 하지 마시고 직접 눌러 보셔도 됩니다. 로그인이 없습니다 —
          판정도, 반려도, 도구 실행도 지금 그대로 하실 수 있습니다.
        </p>
        <div className="row">
          <Link to="/review" className="btn-primary btn-sm">
            신청서 판정해 보기
          </Link>
          <Link to="/honesty" className="btn-ghost btn-sm">
            못 한 것부터 보기
          </Link>
        </div>
      </section>
    </>
  )
}

// ── 코딩 하시는 분용 ────────────────────────────────────────
function Tech({ facts }) {
  return (
    <>
      <section className="card built-lead">
        <h2>{TECH.headline}</h2>
        {/* 숫자는 서버에서 실제로 센 값만 쓴다. 화면에서 지어내면 이
            문서 자체가 이 사이트가 하지 말라는 것을 한다. */}
        {facts.length > 0 && (
          <ul className="built-facts">
            {facts.map((f) => (
              <li key={f.k}>
                <span className="card-note">{f.k}</span>
                <strong>{f.v}</strong>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <span className="card-title">스택</span>
        </div>
        <dl className="built-stack">
          {TECH.stack.map((s) => (
            <div key={s.k}>
              <dt>{s.k}</dt>
              <dd>{s.v}</dd>
            </div>
          ))}
        </dl>
      </section>

      {TECH.sections.map((s) => (
        <section key={s.title} className="card">
          <div className="card-head">
            <span className="card-title">{s.title}</span>
          </div>
          <Body text={s.body} />
        </section>
      ))}

      {/* LLM 이야기는 반드시 물어보는 것이라 따로 세워 둔다. */}
      <section className="card built-llm">
        <div className="card-head">
          <span className="card-title">{TECH.llm.title}</span>
        </div>

        <div className="built-llm-half">
          <strong>{TECH.llm.inProduct.title}</strong>
          <Body text={TECH.llm.inProduct.body} />
          <Body text={TECH.llm.inProduct.why} className="built-body built-why" />
        </div>

        <div className="built-llm-half">
          <strong>{TECH.llm.inBuilding.title}</strong>
          <Body text={TECH.llm.inBuilding.body} />
          <ul className="built-how">
            {TECH.llm.inBuilding.how.map((h) => (
              <li key={h}>
                <Body text={h} className="" />
              </li>
            ))}
          </ul>
          <Body text={TECH.llm.inBuilding.note} className="card-note built-body" />
        </div>
      </section>

      <section className="card built-cta">
        <p>
          코드는 전부 공개되어 있습니다. 이 화면에 적은 것이 실제로 그렇게
          되어 있는지 직접 확인하실 수 있습니다.
        </p>
        <div className="row">
          <a
            href="https://github.com/k95691368-ship-it/ilson"
            className="btn-primary btn-sm"
            target="_blank"
            rel="noreferrer"
          >
            저장소 열기
          </a>
          <Link to="/log" className="btn-ghost btn-sm">
            결정 기록 보기
          </Link>
        </div>
      </section>
    </>
  )
}
