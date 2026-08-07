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

// 부서가 **먼저** 묻는 것.
//
// 여기가 오랫동안 한쪽으로만 열려 있었다. 담당자는 묻고 부서는 답할 수만
// 있었다. 그런데 화면은 부서에게 물어보라고 시키고 있었다 —
// 조회 화면의 뒤로 밀린 안내가 "납득이 안 되시면 아래 되묻기로 물어봐
// 주세요"라고 적어 두고, 순서 안내는 "급하시면 알려주세요 — 그것도 판단
// 재료입니다"라고 적어 뒀다. 둘 다 갈 데가 없었다.
//
// 그리고 더 나빴던 것: 담당자가 먼저 물어본 적이 없으면 그 칸 자체가
// 화면에서 사라졌다. 뒤로 밀린 부서는 **대개 그 경우**다. 말을 걸고 싶은
// 사람에게만 말 걸 자리가 없었던 것이다.
export const DEPT_ASK_KIND = '부서질문'
export const STAFF_REPLY_KIND = '담당자답'

const QUESTION_KINDS = [ASK_KIND, DEPT_ASK_KIND]
const REPLY_KINDS = [ANSWER_KIND, STAFF_REPLY_KIND]
const THREAD_KINDS = [...QUESTION_KINDS, ...REPLY_KINDS]

// 누가 쓴 줄인가. 묻는 쪽과 답하는 쪽이 종류마다 다르다.
function sideOf(kind) {
  if (kind === ASK_KIND || kind === STAFF_REPLY_KIND) return '담당자'
  return '부서'
}

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
    .filter((r) => THREAD_KINDS.includes(r.link_kind))
    .map((r) => ({
      id: r.id,
      kind: r.link_kind,
      side: sideOf(r.link_kind),
      // 물은 쪽인가 답한 쪽인가. 화면이 "답하기" 칸을 어디에 그릴지 고른다.
      asking: QUESTION_KINDS.includes(r.link_kind),
      author: r.title,
      body: r.what,
      // 질문에는 "왜 묻는지"가 붙는다. 왜 묻는지를 같이 보여 줘야 상대가
      // 무엇을 답해야 하는지 안다.
      note: QUESTION_KINDS.includes(r.link_kind) ? r.why : null,
      answersId: REPLY_KINDS.includes(r.link_kind) ? r.link_id : null,
      at: r.created_at,
    }))
    .sort((a, b) => String(a.at).localeCompare(String(b.at)))

  const answered = new Set(msgs.filter((m) => m.answersId).map((m) => m.answersId))

  return msgs.map((m) => ({
    ...m,
    // 아직 답 못 받은 질문. 이것이 몇 개냐가 "이 신청서가 왜 멈춰 있나"의 답이다.
    waiting: m.asking && !answered.has(m.id),
  }))
}

// 아직 답을 기다리는 질문만. 누구를 기다리는지는 따로 가른다.
export function openQuestions(thread) {
  return (thread ?? []).filter((m) => m.waiting)
}

// 부서 답을 기다리는 것 — 담당자가 물은 것.
export function waitingOnDept(thread) {
  return openQuestions(thread).filter((m) => m.side === '담당자')
}

// 담당자 답을 기다리는 것 — 부서가 물은 것.
//
// 이쪽이 더 급하다. 부서는 로그인이 없어서 다시 조회 화면을 열어 보는 것
// 말고는 재촉할 길이 없다. 담당자가 안 보면 그냥 잊힌다.
export function waitingOnStaff(thread) {
  return openQuestions(thread).filter((m) => m.side === '부서')
}

// 이 신청서가 지금 누구 차례인가.
//
// 접수함에서 "답을 기다리는 중"과 "내가 볼 차례"를 갈라야 한다. 부서 답을
// 기다리는 건을 내 할 일로 세면 접수함이 늘 밀려 있는 것처럼 보인다.
export function whoseTurn(thread) {
  // 부서가 물은 것이 있으면 그게 먼저다. 담당자가 물어 놓고 부서 답을
  // 기다리는 중이어도, 부서 질문이 와 있으면 공은 담당자에게 있다.
  if (waitingOnStaff(thread).length > 0) return '담당자'
  if (waitingOnDept(thread).length > 0) return '부서'
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
  // 부서가 물어 온 것을 먼저 적는다. 담당자가 봐야 움직이는 쪽이다.
  const mine = waitingOnStaff(thread)
  if (mine.length > 0) {
    return mine.length === 1 ? '부서가 물어봤습니다' : `부서가 물어봤습니다 (${mine.length}건)`
  }
  const theirs = waitingOnDept(thread)
  if (theirs.length === 0) return null
  return theirs.length === 1
    ? '부서 답을 기다리는 중'
    : `부서 답을 기다리는 중 (${theirs.length}건)`
}

// 부서가 물을 때도 무엇을 묻는지는 적어야 한다. 다만 "이걸 알아야 무엇을
// 정할 수 있는지"는 안 받는다 — 그건 판정하는 사람의 말이다. 부서에게
// 그걸 적으라고 하면 물어보려다 만다.
export function validateDeptAsk({ question, author }) {
  const fields = {}
  const q = String(question ?? '').trim()
  const a = String(author ?? '').trim()
  if (q.length < MIN_ASK) {
    fields.question = `무엇이 궁금한지 적어주세요. (${MIN_ASK}자 이상)`
  }
  // 로그인이 없어서 계정으로 증명할 수 없다. 대신 스스로 밝히게 한다.
  if (!a) fields.author = '누가 묻는지 적어주세요.'
  return fields
}
