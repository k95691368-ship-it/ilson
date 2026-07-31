import { Link } from 'react-router-dom'
import { STAGES } from '../lib/stages.js'

// 첫 화면. 여덟 단계가 한 장에 보인다.
//
// 기능 목록을 늘어놓지 않는 이유는, 이 포트폴리오가 보여주려는 것이 "어떤
// 기능이 있는가"가 아니라 "부서의 병목이 도구가 되어 돌아가기까지 무슨 일이
// 있었는가"이기 때문이다. 그래서 첫 화면은 목차이자 순서다.
export default function FlowPage() {
  return (
    <div className="stack">
      <header className="page-head">
        <span className="page-eyebrow">AX 실행 기록</span>
        <h1>부서의 병목이 도구가 되기까지</h1>
        <p className="page-sub">
          각 부서가 병목을 신청서로 적어 냅니다. AX 담당자가 열람하고, 무엇을 먼저 할지 정하고,
          못 만드는 것은 이유와 함께 반려합니다. 부서와 협의해 합격 기준을 먼저 정하고,
          만들고, 실제 담당자가 써 보고, 사용법서와 함께 넘긴 뒤, 처음에 재 둔 기준선과
          비교해 성과를 정리합니다.
        </p>
      </header>

      <ol className="flow-list">
        {STAGES.map((s) => (
          <li key={s.key}>
            <Link to={s.path} className="flow-card">
              <span className="flow-no">{s.no}</span>
              <span className="flow-body">
                <span className="flow-title">{s.title}</span>
                <span className="flow-owner">{s.owner}</span>
                <span className="flow-summary">{s.summary}</span>
              </span>
              <span className="flow-go" aria-hidden="true">
                →
              </span>
            </Link>
          </li>
        ))}
      </ol>

      <section className="card">
        <div className="card-title">이 과정에서 AI가 앉는 자리</div>
        <p className="card-note" style={{ marginBottom: 12 }}>
          AI는 초안을 만들고 분류를 돕습니다. 무엇을 먼저 할지, 무엇을 반려할지, 무엇을 통과로
          볼지, 성과를 어떻게 셀지는 <strong>사람이 정합니다.</strong> 화면에서 두 가지가 구분됩니다.
        </p>
        <div className="grid-2">
          <div className="draft">
            <span className="origin-label origin-ai">◇ AI 초안</span>
            <div className="item-body">
              보라 점선. 사람이 승인하기 전에는 다음 단계로 내려가지 않습니다.
            </div>
          </div>
          <div className="decided">
            <span className="origin-label origin-human">◆ 사람의 결정</span>
            <div className="item-body">
              실선. 근거와 대안이 함께 남습니다.
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
