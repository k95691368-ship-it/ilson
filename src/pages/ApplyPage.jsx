import StageHeader, { Planned } from '../components/StageHeader.jsx'

export default function ApplyPage() {
  return (
    <div className="stack">
      <StageHeader stageKey="apply" />

      <Planned
        title="여기에 들어갈 것"
        items={[
          '신청서 작성 폼 — 신청 부서 / 신청자 / 병목 이유 / 문제 상황 / 바라는 해결 방안',
          '현재 소요시간 입력 — 몇 명이 몇 분, 얼마나 자주. 8단계 성과의 기준선이 되는 값',
          '실제 파일 첨부 — 지금 손으로 다루고 있는 엑셀·CSV를 그대로 올린다',
          'AI 초안 도움 — 적어 낸 문장에서 부서·업무유형·반복 주기를 추정해 채워 준다(초안)',
          '접수 완료 화면 — 접수번호와 "언제까지 답을 받는지"',
          '내가 낸 신청서 목록 — 지금 어느 단계에 있는지',
        ]}
      />
    </div>
  )
}
