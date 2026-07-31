import StageHeader, { Planned } from '../components/StageHeader.jsx'

export default function ManualPage() {
  return (
    <div className="stack">
      <StageHeader stageKey="manual" />

      <Planned
        title="여기에 들어갈 것"
        items={[
          '쓰는 법 — 파일을 어디서 받아 어디에 넣고 결과를 어떻게 쓰는지, 화면 그대로',
          '이럴 때는 이렇게 — 처리 안 된 행이 나왔을 때 / 파일 양식이 바뀌었을 때',
          '하면 안 되는 것 — 이 도구가 보장하지 않는 것',
          '담당자와 연락처 — 막혔을 때 누구에게',
          '자주 묻는 것 — 베타 테스트에서 실제로 나온 질문으로 채운다',
          '내려받기 — 부서가 자기 폴더에 보관할 수 있게 PDF로',
          'AI 초안 도움 — 제작 기록과 베타 피드백에서 사용법서 초안 생성(검수는 사람)',
        ]}
      />
    </div>
  )
}
