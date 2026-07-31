import StageHeader, { Planned } from '../components/StageHeader.jsx'

export default function AgreementPage() {
  return (
    <div className="stack">
      <StageHeader stageKey="agreement" />

      <Planned
        title="여기에 들어갈 것"
        items={[
          '협의 회의록 — 부서와 무슨 이야기를 했는지',
          '합의 사항 — 무엇을 만들고 무엇은 만들지 않기로 했는지',
          '요구 충돌과 판정 — 부서마다 원하는 것이 부딪히는 지점, 내가 무엇을 택했고 왜인지',
          '합격 기준 — 만들기 전에 정한다. 무엇을 통과로 볼 것인가',
          '기준선 실측 — 신청서에 적힌 체감 시간이 아니라, 실제로 3회 재서 봉인한 값',
          '범위 밖 선언 — 이번에 다루지 않을 것을 미리 적는다',
          'AI 초안 도움 — 회의록에서 요구·제약·미결 추출(원문 인용 필수, 채택은 사람)',
        ]}
      />
    </div>
  )
}
