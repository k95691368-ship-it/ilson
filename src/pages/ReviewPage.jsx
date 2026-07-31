import StageHeader, { Planned } from '../components/StageHeader.jsx'

export default function ReviewPage() {
  return (
    <div className="stack">
      <StageHeader stageKey="review" />

      <Planned
        title="여기에 들어갈 것"
        items={[
          '접수함 — 부서별 신청서 목록, 접수 후 경과 시간',
          '신청서 열람 — 부서가 적어 낸 내용과 첨부 파일을 그대로',
          '우선순위 판단 — 임팩트 × 난이도, 무엇을 먼저 할지와 그 근거',
          '판정: 수용 / 반려 / 보류 — 반려는 이유와 대안을 반드시 함께',
          '"못 만듭니다" 화면 — 무엇이 범위 밖인지, 대신 무엇을 해 줄 수 있는지',
          'AI 초안 도움 — 신청 내용 요약과 유사 신청 병합 후보(초안)',
        ]}
      />
    </div>
  )
}
