import StageHeader, { Planned } from '../components/StageHeader.jsx'

export default function BuildPage() {
  return (
    <div className="stack">
      <StageHeader stageKey="build" />

      <Planned
        title="여기에 들어갈 것"
        items={[
          '제작 계획 — 어떤 단계로 처리할 것인가 (AI 초안, 승인은 사람)',
          '실제 동작 — 부서가 올린 원본 파일을 넣고 결과가 나오는 과정',
          '막힌 지점과 해결 — 무엇이 안 됐고 어떻게 풀었는지. 매끄러운 성공담만 있으면 가짜다',
          '처리하지 못한 행 — 버리지 않고 따로 모아 사람이 보게 한다',
          '한 번 고친 것은 기억 — 같은 판단을 두 번 요구하지 않는다',
          '결과의 근거 — 숫자를 누르면 원본 파일의 어느 시트 몇 번째 행에서 왔는지',
          '제작 로그 — 무엇을 언제 만들었는지 (접수 → 제작 완료까지 걸린 시간)',
        ]}
      />
    </div>
  )
}
