import { Link } from 'react-router-dom'
import { STAGES, STAGE_BY_KEY, nextStage, prevStage } from '../lib/stages.js'

// 단계 화면의 머리. 여덟 화면이 같은 모양으로 시작하게 한다.
//
// owner를 크게 적는 이유: 이 포트폴리오에서 가장 흐려지기 쉬운 것이
// "누가 한 일인가"다. 신청서는 부서가 쓰고 나머지는 담당자가 한다는 것이
// 화면마다 보여야 한다.
export default function StageHeader({ stageKey, children }) {
  const stage = STAGE_BY_KEY[stageKey]
  if (!stage) return null
  const prev = prevStage(stageKey)
  const next = nextStage(stageKey)

  return (
    <header className="stage-head">
      <div className="stage-kicker">
        <span>실행 흐름</span>
        <span>{stage.no} / {STAGES.length}</span>
      </div>
      <div className="stage-head-top">
        <span className="stage-no" aria-hidden="true">{String(stage.no).padStart(2, '0')}</span>
        <div className="stage-head-text">
          <h1>{stage.title}</h1>
          <p className="page-sub">{stage.summary}</p>
        </div>
      </div>

      <nav className="stage-progress" aria-label="여섯 단계 진행 위치">
        {STAGES.map((item) => (
          <Link
            key={item.key}
            to={item.path}
            className={`${item.no < stage.no ? 'done' : ''}${item.no === stage.no ? ' current' : ''}`}
            aria-current={item.no === stage.no ? 'step' : undefined}
            title={`${item.no}단계 ${item.label}`}
          >
            <span aria-hidden="true" />
            <small>{item.label}</small>
          </Link>
        ))}
      </nav>

      <div className="stage-head-meta">
        <span className="stage-owner">
          <span className="stage-owner-label">이 단계의 주인</span>
          {stage.owner}
        </span>
        <span className="spacer" />
        {prev && (
          <Link to={prev.path} className="stage-nav-link">
            ← {prev.no} {prev.label}
          </Link>
        )}
        {next && (
          <Link to={next.path} className="stage-nav-link">
            {next.no} {next.label} →
          </Link>
        )}
      </div>

      {children}
    </header>
  )
}

// 아직 채우지 않은 자리를 정직하게 표시한다.
// 여기에 무엇이 들어갈지를 적어 두면, 뼈대만으로도 전체 그림이 읽힌다.
export function Planned({ title, items }) {
  return (
    <section className="planned">
      <div className="planned-title">{title}</div>
      <ul className="planned-list">
        {items.map((it) => (
          <li key={it}>{it}</li>
        ))}
      </ul>
    </section>
  )
}
