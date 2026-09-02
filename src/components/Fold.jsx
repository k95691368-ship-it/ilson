// 접는 자리를 한 부품으로 모은다.
//
// 화면을 재 봤더니 조건부로 뜨는 자리가 390개인데 접는 자리는 9개였다.
// 그래서 첫 화면이 5,670px, 도구 화면이 7,000px, 조회 화면이 7,700px 다 —
// 노트북 화면 여덟 개 높이가 한 장이다. "빡빡하다"는 글자가 붙어 있다는
// 뜻이 아니라 어디서 끊어 읽을지를 읽는 사람이 매번 정해야 한다는 뜻이었다.
//
// 접기에는 규칙이 둘 있다.
//
// **하나. 숫자 없는 접기는 삭제와 구분이 안 된다.**
// 접힌 줄에 "N건"이 없으면 그 안에 무엇이 몇 개 있는지 알 수 없고, 그러면
// 이 사이트가 파는 "기록이 끊기지 않는다"가 눈으로 깨진다. 그래서 count 를
// 안 주면 접지 않고 그냥 펼친다 — 접을 자격이 없는 것이다.
//
// **둘. 급한 것은 접지 않는다.**
// 금액이 틀린다는 신고, 되돌릴 수 없는 길의 경고, 지금 막고 있는 것.
// rank 로 받아서 3 이상이면 접기를 거부한다. 무게는 shared/urgency.js 가
// 한 벌로 정한다 — 화면마다 다르게 판단하면 어느 화면에서는 접히고 어느
// 화면에서는 안 접힌다.
import { NEVER_FOLD } from '../../shared/urgency.js'

export default function Fold({
  label,
  count,
  note,
  rank = 1,
  open = false,
  children,
  className = '',
}) {
  const n = count == null || count === '' ? null : Number(count)
  const countable = Number.isFinite(n)

  // 접을 자격이 없는 경우. 펼친 채로 둔다 — 숨기는 것보다 긴 편이 낫다.
  if (!countable || rank >= NEVER_FOLD) {
    return (
      <section className={`fold fold-open ${className}`.trim()}>
        <div className="card-head">
          <h2 className="card-title">{label}</h2>
          {countable && <span className="fold-count">{n}건</span>}
          {note && (
            <>
              <span className="spacer" />
              <span className="card-note">{note}</span>
            </>
          )}
        </div>
        {children}
      </section>
    )
  }

  // 0건이면 접을 것도 없다. 줄 하나로 두고 끝낸다.
  if (n === 0) return null

  return (
    <details className={`card fold ${className}`.trim()} open={open}>
      <summary className="card-head">
        <h2 className="card-title">{label}</h2>
        <span className="fold-count">{n}건</span>
        {note && (
          <>
            <span className="spacer" />
            <span className="card-note">{note}</span>
          </>
        )}
      </summary>
      {children}
    </details>
  )
}
