// 담당자가 신청서에 되묻고, 부서가 답한다.
//
// 지금까지는 한 방향이었다. 부서가 적어 내면 담당자가 읽고 혼자 판정한다.
// 그런데 신청서는 자주 애매하다. "정산서를 합쳐 주세요"라고만 적혀 있으면
// 채널이 몇 갠지, 양식이 매달 바뀌는지, 지금은 누가 어떻게 하는지를 모른
// 채로 판정해야 한다.
//
// 그러면 담당자는 둘 중 하나를 한다. 짐작으로 판정하거나 보류로 미룬다.
// 짐작은 틀리고 보류는 영영 안 풀린다. 물어볼 데가 없어서 생기는 일이다.
//
// 표를 새로 만들지 않고 결정 기록에 얹는다. 되묻는 일은 실제로 결정이다 —
// "정보가 부족해서 판정을 미루고 물었다"는 것 자체가 남길 값어치가 있고,
// 몇 달 뒤 "왜 이 건이 삼 주나 걸렸지"에 답하는 것도 이 기록이다.

export const ASK_KIND = '질문'
export const ANSWER_KIND = '답변'

// 되묻는 말이 이만큼은 돼야 한다.
//
// "?" 한 글자를 던져 놓고 답을 기다리면 부서는 무엇을 답해야 할지 모른다.
// 물을 거면 무엇이 궁금한지 적어야 한다.
export const MIN_ASK = 10
export const MIN_ANSWER = 2

// 결정 기록 줄을 주고받은 말로 바꾼다.
//
// 결정 기록에는 판정·반려·합의 같은 것도 같이 들어 있다. 그중 주고받은
// 것만 골라낸다.
export function toThread(rows) {
  const msgs = (rows ?? [])
    .filter((r) => r.link_kind === ASK_KIND || r.link_kind === ANSWER_KIND)
    .map((r) => ({
      id: r.id,
      side: r.link_kind === ASK_KIND ? '담당자' : '부서',
      author: r.title,
      body: r.what,
      // 질문에는 "왜 묻는지"가 붙는다. 왜 묻는지를 같이 보여 줘야 부서가
      // 무엇을 답해야 하는지 안다.
      note: r.link_kind === ASK_KIND ? r.why : null,
      answersId: r.link_kind === ANSWER_KIND ? r.link_id : null,
      at: r.created_at,
    }))
    .sort((a, b) => String(a.at).localeCompare(String(b.at)))

  const answered = new Set(msgs.filter((m) => m.answersId).map((m) => m.answersId))

  return msgs.map((m) => ({
    ...m,
    // 아직 답 못 받은 질문. 이것이 몇 개냐가 "이 신청서가 왜 멈춰 있나"의 답이다.
    waiting: m.side === '담당자' && !answered.has(m.id),
  }))
}

// 아직 답을 기다리는 질문만.
export function openQuestions(thread) {
  return (thread ?? []).filter((m) => m.waiting)
}

// 이 신청서가 지금 누구 차례인가.
//
// 접수함에서 "답을 기다리는 중"과 "내가 볼 차례"를 갈라야 한다. 부서 답을
// 기다리는 건을 내 할 일로 세면 접수함이 늘 밀려 있는 것처럼 보인다.
export function whoseTurn(thread) {
  const open = openQuestions(thread)
  if (open.length > 0) return '부서'
  return '담당자'
}

// 되묻는 말이 쓸 만한지.
export function validateAsk({ question, why, author }) {
  const fields = {}
  const q = String(question ?? '').trim()
  const w = String(why ?? '').trim()
  const a = String(author ?? '').trim()

  if (q.length < MIN_ASK) {
    fields.question = `무엇이 궁금한지 적어주세요. (${MIN_ASK}자 이상)`
  }
  // 왜 묻는지를 안 적으면 부서는 "이걸 왜 물어보지" 하고 대충 답한다.
  // 판정에 무엇이 걸려 있는지 알면 답이 달라진다.
  if (w.length < MIN_ASK) {
    fields.why = `이걸 알아야 무엇을 정할 수 있는지 적어주세요. (${MIN_ASK}자 이상)`
  }
  if (!a) fields.author = '누가 묻는지 적어주세요.'
  return fields
}

export function validateAnswer({ answer, author }) {
  const fields = {}
  const b = String(answer ?? '').trim()
  const a = String(author ?? '').trim()
  if (b.length < MIN_ANSWER) fields.answer = '답을 적어주세요.'
  // 로그인이 없어서 계정으로 증명할 수 없다. 대신 스스로 밝히게 한다.
  // 증명은 아니지만 몇 달 뒤 "이건 누가 답한 거지"에 답할 수는 있다.
  if (!a) fields.author = '누가 답하시는지 적어주세요.'
  return fields
}

// 접수함에 적을 한 줄.
export function turnLabel(thread) {
  const open = openQuestions(thread)
  if (open.length === 0) return null
  return open.length === 1
    ? '부서 답을 기다리는 중'
    : `부서 답을 기다리는 중 (${open.length}건)`
}
