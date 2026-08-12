// 목록을 화면에서 자른다.
//
// 화면 파일에 `.map(` 이 198곳인데 `.slice(` 는 19곳이었다. 열에 아홉은
// 서버가 보낸 것을 하나도 안 자르고 전부 편다. 그래서 화면 길이를 정하는
// 것이 레이아웃이 아니라 functions/api 의 LIMIT 값이었다 — 500·400·200·40…
//
// 서버 LIMIT 을 줄이는 것으로는 못 고친다. 그건 "몇 개까지 알고 있나"이고,
// 지금 문제는 "몇 개까지 한 번에 보여 주나"다. 그 둘은 다른 값이다.
// 자르는 자리를 화면으로 옮긴다.
//
// 자르되 **숨기지 않는다.** 나머지는 접힌 줄 뒤에 그대로 있고, 그 줄에
// 몇 건이 더 있는지 적는다. 숫자 없는 접기는 삭제와 구분이 안 된다.
import { NEVER_FOLD } from '../../shared/urgency.js'

export default function Capped({
  items = [],
  show = 5,
  render,
  keyOf = (_, i) => i,
  // 접힐 쪽에 이 무게 이상인 것이 있으면 그것부터 위로 올린다. 급한 것이
  // 스무 번째에 있다고 안 보이면 안 된다.
  rankOf = () => 1,
  label = '나머지',
  as: Tag = 'div',
  className = '',
}) {
  const list = items ?? []
  if (list.length === 0) return null

  // 급한 것을 앞으로. 같은 무게 안에서는 원래 순서를 지킨다 —
  // 정렬을 새로 하면 서버가 정해 둔 순서(오래된 것 먼저 같은)가 무너진다.
  const ordered =
    list.length > show
      ? [...list].sort((a, b) => (rankOf(b) >= NEVER_FOLD ? 1 : 0) - (rankOf(a) >= NEVER_FOLD ? 1 : 0))
      : list

  const head = ordered.slice(0, show)
  const tail = ordered.slice(show)

  return (
    <>
      <Tag className={className}>{head.map((it, i) => render(it, i, keyOf(it, i)))}</Tag>
      {tail.length > 0 && (
        <details className="disclose capped-more">
          <summary>
            {label} {tail.length}건 더 보기
          </summary>
          <Tag className={className}>
            {tail.map((it, i) => render(it, show + i, keyOf(it, show + i)))}
          </Tag>
        </details>
      )}
    </>
  )
}
