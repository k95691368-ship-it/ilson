// 부서가 짚은 것에서 "자주 묻는 것" 초안을 뽑는다.
//
// 지금 자주 묻는 것은 사용법서를 쓴 사람이 손으로 적는다. 그런데 **쓴 사람은
// 자기가 무엇을 자주 묻히는지 모른다.** 다 아는 사람이 "이건 물어보겠지"를
// 상상해서 적는 것이라, 실제로 오는 질문과 겹치는 일이 별로 없다.
//
// 진짜 자주 묻는 것은 이미 여기 다 있다 — 부서가 사용법서에서 모르겠다고
// 짚어 준 것들. 같은 자리에서 두 번 이상 막혔다면 그건 다음 사람도 막힌다.
//
// **문장은 자동으로 고쳐 쓰지 않는다.** 짚은 원문과 담당자가 다시 쓴 문장을
// 그대로 칸에 채워 주고, 다듬는 것은 사람이 한다. 규칙으로 "어떻게 말할지"
// 까지 만들면 어색한 한국어가 나오고, 그걸 부서가 읽는다. 규칙이 할 수
// 있는 것은 **무엇을 올릴지 고르는 것**까지다.

import { corpusOf, similarity, SIMILAR_THRESHOLD } from './similar.js'

// 물린 제안을 다시 안 띄우기 위한 표시.
export const FAQ_DISMISS_KIND = '자주묻는것물림'

// 몇 번 짚혀야 올릴 값어치가 있나.
//
// 한 번 짚힌 것을 다 올리면 자주 묻는 것이 스무 줄이 되고, 그러면 아무도
// 안 읽는다. 두 번 막혔다는 것은 다음 사람도 막힌다는 뜻이다.
export const WORTH_ASKING = 2

// 답이 있어야 올린다.
//
// 담당자가 아직 다시 쓰지 않은 것은 답을 모르는 것이다. 답 없는 질문을
// 자주 묻는 것에 올리면 그 목록을 못 믿게 된다.
export function hasAnswer(flag) {
  return Boolean(flag?.fix?.body)
}

// 이미 자주 묻는 것에 있는 이야기인가.
//
// 담당자가 손으로 적어 둔 것과 겹치는 제안을 또 띄우면, 목록에 같은 이야기가
// 두 줄이 된다. shared/similar.js의 겹침 재기를 그대로 쓴다 — 신청서가
// 겹치는지 보는 것과 같은 일이다.
export function alreadyThere(text, faqs, { threshold = SIMILAR_THRESHOLD } = {}) {
  const list = (faqs ?? []).map((f) => ({
    id: f.id,
    title: f.question,
    bottleneck: f.answer,
    problem: '',
  }))
  if (list.length === 0) return null

  const draft = { title: text, bottleneck: '', problem: '' }
  const corpus = corpusOf([draft, ...list])
  let best = null
  for (const item of list) {
    const s = similarity(draft, item, corpus)
    if (s.score >= threshold && (!best || s.score > best.score)) {
      best = { id: item.id, question: item.title, score: s.score }
    }
  }
  return best
}

// 무엇을 올리자고 제안할 것인가.
//
// 자리(대목) 단위로 묶는다. 같은 자리에서 세 사람이 막혔으면 세 줄이 아니라
// 한 줄이다 — 자주 묻는 것에 비슷한 질문 세 개가 나란히 있으면 읽는 사람은
// 무엇이 다른지 찾느라 셋 다 읽게 된다.
export function faqDrafts({ sections, faqs, dismissed } = {}) {
  const skip = new Set(dismissed ?? [])
  const out = []

  for (const sec of sections ?? []) {
    const answered = (sec.flags ?? []).filter(hasAnswer)
    if (answered.length < WORTH_ASKING) continue

    // 가장 마지막에 답한 것을 답으로 쓴다. 앞의 답은 그 뒤에 또 짚혔다는
    // 뜻이라 부족했던 것이다.
    const latest = answered[answered.length - 1]
    const key = `${sec.key}:${latest.id}`
    if (skip.has(key)) continue

    // 질문 칸에는 짚은 원문을 그대로 넣는다. 여러 사람이 짚었으면 가장
    // 짧은 것을 고른다 — 짧은 쪽이 대개 군더더기가 없다.
    const question = [...answered].sort((a, b) => a.body.length - b.body.length)[0].body
    const dup = alreadyThere(question, faqs)

    out.push({
      key,
      section: sec.key,
      label: sec.label,
      askedBy: answered.length,
      question,
      answer: latest.fix.body,
      // 겹치는 것이 있으면 감추지 않고 같이 보여 준다. 담당자가 보고
      // 판단할 일이지, 규칙이 대신 지울 일이 아니다.
      duplicateOf: dup,
      why: `${sec.label} 대목에서 ${answered.length}분이 막히셨고, 담당자가 답을 적어 두셨습니다.`,
    })
  }

  // 많이 막힌 자리가 먼저다.
  out.sort((a, b) => b.askedBy - a.askedBy || a.key.localeCompare(b.key))
  return out
}

export function draftLine(drafts) {
  const n = (drafts ?? []).length
  if (n === 0) return null
  const dups = (drafts ?? []).filter((d) => d.duplicateOf).length
  const parts = [`부서가 여러 번 막힌 자리 ${n}가지를 자주 묻는 것에 올리실 수 있습니다.`]
  if (dups > 0) {
    parts.push(`그중 ${dups}가지는 이미 적어 두신 것과 비슷합니다 — 보시고 판단해주세요.`)
  }
  return parts.join(' ')
}
