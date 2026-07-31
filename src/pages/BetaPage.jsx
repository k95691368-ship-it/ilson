import StageHeader, { Planned } from '../components/StageHeader.jsx'

export default function BetaPage() {
  return (
    <div className="stack">
      <StageHeader stageKey="beta" />

      <Planned
        title="여기에 들어갈 것"
        items={[
          '테스트 대상 — 누가(어느 부서 담당자가) 무엇으로 얼마나 써 봤는지',
          '합격 기준 대비 판정 — 3단계에서 정한 기준을 항목별로 통과/실패',
          '발견된 문제 — 유형별로 묶어서. 몇 건이 어떤 이유로 틀렸는지',
          '현업 피드백 — 담당자가 실제로 한 말 그대로',
          '재작업 루프 — 1차 실패 → 무엇을 고쳤나 → 2차 → … 반복 횟수가 보인다',
          '회귀 확인 — 고치면서 이전에 되던 것이 깨지지 않았는지',
          '최종 판정 — 통과해야만 다음 단계(사용법서·배포)로 간다',
        ]}
      />
    </div>
  )
}
