import StageHeader, { Planned } from '../components/StageHeader.jsx'

export default function ResultPage() {
  return (
    <div className="stack">
      <StageHeader stageKey="result" />

      <Planned
        title="여기에 들어갈 것"
        items={[
          '기준선 대비 — 3단계에서 봉인한 실측값과 지금 걸리는 시간',
          '차감한 뒤의 숫자 — 사람이 확인하는 시간, 다시 하는 시간, 만드는 데 든 공수, 운영 비용을 뺀다',
          '계산식 공개 — 어떻게 그 숫자가 나왔는지 항상 펼쳐져 있다',
          '오류 감소 — 손으로 할 때 나던 실수가 몇 건에서 몇 건이 되었는지',
          '이 숫자를 의심해보세요 — 표본이 적다 / 계절 영향 / 공수 과소계상 등 스스로 반박',
          '부서가 확인한 것 — 담당자가 실제로 그렇다고 확인했는지',
          '다음 할 일 — 이 과정에서 새로 발견된 병목',
        ]}
      />
    </div>
  )
}
