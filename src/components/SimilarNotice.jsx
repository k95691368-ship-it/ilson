import { Link } from 'react-router-dom'
import { reasonText } from '../../shared/similar.js'
import { ago, num } from '../lib/format.js'

// "이거 이미 들어와 있는데요"
//
// 부서 사람이 바뀌었거나, 낸 걸 잊었거나, 옆자리가 낸 걸 몰랐거나. 어느
// 쪽이든 결과는 같다 — 부서는 이미 있는 도구를 못 쓴 채 몇 주를 더 기다리고,
// 담당자는 같은 일을 두 번 검토한다.
//
// 겹친 낱말을 반드시 함께 보여 준다. "비슷합니다"라고만 하면 사람은 "뭐가
// 비슷한데"라고 생각하고 그냥 닫는다. "오프라인·오픈마켓·자사몰 같은 말이
// 겹칩니다"라고 하면 그 자리에서 맞는지 틀린지 판단할 수 있다.
//
// 막지 않는다. 비슷해 보인다고 신청을 못 하게 하면, 진짜 다른 건을 내려던
// 사람이 낼 데를 잃는다. 알려 주고 고르게 한다.
export default function SimilarNotice({ hits, tone = 'apply', onDismiss }) {
  if (!hits || hits.length === 0) return null

  const strongest = hits[0]
  const isApply = tone === 'apply'

  return (
    <section className={`similar ${strongest.same ? 'same' : ''}`}>
      <div className="similar-head">
        <span className="similar-title">
          {strongest.same
            ? isApply
              ? '이미 들어와 있는 것 같습니다'
              : '거의 같은 신청서가 이미 있습니다'
            : isApply
              ? '비슷한 신청서가 이미 있습니다'
              : '비슷한 신청서가 있습니다'}
        </span>
        <span className="spacer" />
        {onDismiss && (
          <button type="button" className="btn-ghost btn-sm" onClick={onDismiss}>
            닫기
          </button>
        )}
      </div>

      <p className="similar-lead">
        {isApply ? (
          <>
            같은 일이라면 아래 신청서를 보시면 어디까지 왔는지 알 수 있습니다. 이미 만들어 둔 것이
            있으면 기다리지 않고 바로 쓰실 수 있습니다. <strong>다른 일이라면 그냥 계속 적으세요</strong>
            {' '}— 막지 않습니다.
          </>
        ) : (
          <>
            판정하기 전에 보고 가세요. 같은 건이면 두 번 만들지 않아야 하고, 다른 건이면 어디가
            다른지가 판정 근거에 들어가야 합니다.
          </>
        )}
      </p>

      <ol className="similar-list">
        {hits.map((h) => (
          <li key={h.id ?? h.ticket_no}>
            <div className="similar-item-top">
              <span className={`badge ${h.same ? 'badge-warning' : 'badge-neutral'}`}>
                {Math.round(h.score * 100)}% 겹침
              </span>
              <span className="badge badge-neutral">{h.dept}</span>
              <span className={`badge ${statusTone(h.status)}`}>{h.status}</span>
              <span className="spacer" />
              <span className="card-note">{ago(h.created_at)}</span>
            </div>

            <div className="similar-item-title">{h.title}</div>

            {/* 왜 비슷하다고 봤는지. 이 줄이 없으면 아무도 이 경고를 안 믿는다. */}
            <div className="similar-why">{reasonText(h)}</div>

            <div className="similar-item-foot">
              <Link
                to={isApply ? `/track?no=${h.ticket_no}` : `/record/${h.id ?? h.ticket_no}`}
                className="btn-ghost btn-sm"
              >
                {isApply ? '어디까지 왔는지 보기' : '이 신청서 기록 전부'}
              </Link>
              <span className="mono card-note">{h.ticket_no}</span>
              {h.annual_hours != null && (
                <span className="card-note">
                  · 연 {num(h.annual_hours, 0)}시간짜리로 접수된 건입니다
                </span>
              )}
            </div>
          </li>
        ))}
      </ol>

      <p className="card-note similar-foot">
        낱말이 얼마나 겹치는지로 골라낸 것입니다. 여러 신청서에 다 나오는 말은 거의 세지 않고,
        몇 건에만 나오는 말이 겹칠 때만 의심합니다. AI가 판단한 것이 아니라 정해진 규칙입니다.
      </p>
    </section>
  )
}

function statusTone(status) {
  if (status === '수용' || status === '완료') return 'badge-success'
  if (status === '반려') return 'badge-danger'
  if (status === '보류') return 'badge-warning'
  return 'badge-neutral'
}
