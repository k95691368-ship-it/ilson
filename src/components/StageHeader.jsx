import { STAGES, STAGE_BY_KEY } from '../lib/stages.js'

// 단계 화면의 머리. 여덟 화면이 같은 모양으로 시작하게 한다.
//
// owner를 크게 적는 이유: 이 포트폴리오에서 가장 흐려지기 쉬운 것이
// "누가 한 일인가"다. 신청서는 부서가 쓰고 나머지는 담당자가 한다는 것이
// 화면마다 보여야 한다.
export default function StageHeader({ stageKey, children }) {
  const stage = STAGE_BY_KEY[stageKey]
  if (!stage) return null

  return (
    <header className="stage-head">
      <div className="stage-head-top">
        <div className="stage-head-text">
          <h1>{stage.title}</h1>
        </div>
        <span className="stage-context">{stage.no} / {STAGES.length} · {stage.owner}</span>
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
