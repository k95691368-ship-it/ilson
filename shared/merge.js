// 같은 건이라고 판정한 뒤에 실제로 묶는다.
//
// 나란히 놓고 견주는 화면을 만들면서 "같은 건 / 다른 건"을 판정하게 했다.
// 그런데 판정하고 나서 아무 일도 안 일어난다. 기록에만 남고, 부서는 여전히
// 자기 신청서가 접수 상태로 앉아 있는 것을 본다.
//
// 부서 입장에서 이건 최악이다. 이미 만들고 있는 것과 같은 일인데 그 사실을
// 모른 채 몇 주를 기다린다. 담당자는 판정했으니 끝났다고 생각하고, 부서는
// 아무 소식이 없다고 생각한다. 둘 다 상대가 뭘 하고 있는 줄 안다.
//
// 그래서 묶으면 실제로 상태가 바뀌게 한다. 그리고 그 이유가 부서 화면에
// 그대로 뜨게 한다.

export const MERGE_KIND = '병합'

// 어느 쪽을 남기고 어느 쪽을 묶을 것인가.
//
// 처음에는 "먼저 낸 쪽을 남긴다"로 만들었다. 틀렸다. 라이브에서 실제로
// 묶어 보니, 여섯 단계를 다 거쳐 도구까지 배포된 신청서가 접수만 된
// 신청서에 묶여 보류로 내려갔다. 먼저 낸 것이 그쪽이었기 때문이다.
// **해 놓은 일이 통째로 선반에 올라갔다.**
//
// 그래서 얼마나 나아갔는지를 먼저 본다. 진행이 앞선 쪽을 남긴다. 그쪽에
// 이미 회의록·합격 기준·베타 결과·사용법서가 붙어 있는데, 그걸 버리고
// 접수만 된 쪽을 주로 삼으면 그 전부를 다시 해야 한다.
//
// 진행이 같을 때만 먼저 낸 쪽을 남긴다.
const PROGRESS = ['반려', '보류', '접수', '검토중', '수용', '진행중', '완료']

function rank(status) {
  const i = PROGRESS.indexOf(status)
  // 모르는 상태는 가장 아래로. 아는 척하고 위로 올리면 진짜 진행된 것을
  // 밀어낸다.
  return i < 0 ? -1 : i
}

const DEAD = ['반려']

export function pickPrimary(a, b) {
  if (!a || !b) return { primary: a ?? b ?? null, merged: null, blocked: '견줄 것이 둘 다 있어야 합니다.' }
  if (a.id === b.id) return { primary: a, merged: null, blocked: '같은 신청서입니다.' }

  if (DEAD.includes(a.status) && DEAD.includes(b.status)) {
    return { primary: null, merged: null, blocked: '둘 다 반려된 신청서라 묶을 것이 없습니다.' }
  }

  // 더 나아간 쪽이 주다. 반려는 맨 아래라 살아 있는 쪽이 저절로 이긴다.
  const ra = rank(a.status)
  const rb = rank(b.status)
  if (ra !== rb) {
    const aWins = ra > rb
    return { primary: aWins ? a : b, merged: aWins ? b : a, blocked: null }
  }

  // 진행이 같으면 먼저 낸 쪽을 남긴다.
  const aFirst = String(a.created_at) <= String(b.created_at)
  return { primary: aFirst ? a : b, merged: aFirst ? b : a, blocked: null }
}

export function holdCondition(primary) {
  return `${primary.ticket_no}과 같은 건입니다. 그쪽이 배포되면 함께 쓰실 수 있습니다.`
}


// 잘못 묶었으면 풀 수 있어야 한다.
//
// 묶는 길만 내고 푸는 길을 안 내면, 한 번 잘못 누른 것을 되돌릴 방법이
// 없다. 그러면 담당자는 무서워서 아예 안 묶는다.
export const UNMERGE_KIND = '병합해제'

export function validateUnmerge({ why, author }) {
  const fields = {}
  if (String(why ?? '').trim().length < 5) {
    fields.why = '왜 푸시는지 적어주세요. 부서에게 두 번째로 말이 바뀌는 것이라 이유가 남아야 합니다.'
  }
  if (!String(author ?? '').trim()) fields.author = '누가 푸시는지 적어주세요.'
  return fields
}
