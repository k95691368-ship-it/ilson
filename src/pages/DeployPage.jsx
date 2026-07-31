import StageHeader, { Planned } from '../components/StageHeader.jsx'

export default function DeployPage() {
  return (
    <div className="stack">
      <StageHeader stageKey="deploy" />

      <Planned
        title="여기에 들어갈 것"
        items={[
          '실제로 동작하는 도구 — 여기서 파일을 넣으면 진짜로 돕니다',
          '인수인계 확인 — 누구에게 언제 넘겼는지, 부서 담당자가 받았다고 확인했는지',
          '사용 한도 — 하루 실행 횟수, 파일 크기 상한 (누가 봐도 알 수 있게 화면에)',
          '운영 현황 — 인수인계 후 몇 번 돌았는지, 실패는 몇 건인지',
          '문제가 생기면 — 부서가 바로 알릴 수 있는 자리',
          '버전 — 지금 도는 것이 몇 번째 판인지, 이전 판으로 되돌릴 수 있는지',
        ]}
      />
    </div>
  )
}
