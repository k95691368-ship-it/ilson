// 두 신청서를 나란히 놓고 어디가 같고 어디가 다른지 가른다.
//
// 중복 판정이 "이 둘이 비슷합니다"까지는 말해 준다. 그런데 담당자가 실제로
// 해야 하는 판단은 그다음이다 — 같은 건인가, 아니면 말만 비슷하고 다른
// 일인가. 그건 두 글을 번갈아 읽으면서 사람이 해야 한다.
//
// 번갈아 읽는 게 어렵다. 왼쪽을 읽고 오른쪽으로 옮기면 왼쪽이 기억에서
// 흐려지고, 다시 왼쪽을 보면 오른쪽이 흐려진다. 그래서 겹치는 말과 한쪽에만
// 있는 말을 미리 갈라서 보여 준다. 사람은 "다른 대목"만 읽으면 된다.

import { tokenParts, similarity, corpusOf } from './similar.js'

// 나란히 놓고 볼 칸.
//
// 소요시간·부서 같은 것은 글이 아니라 값이라 낱말을 가를 것이 없다.
// 그건 그냥 좌우로 놓고 다른지만 본다.
export const TEXT_FIELDS = [
  { key: 'title', label: '한 줄로' },
  { key: 'bottleneck', label: '무엇이 병목인가' },
  { key: 'problem', label: '그래서 무슨 일이 생기나' },
  { key: 'wish', label: '바라는 해결' },
  { key: 'impact_if_wrong', label: '틀리면' },
]

const VALUE_FIELDS = [
  { key: 'dept', label: '신청 부서' },
  { key: 'applicant_label', label: '적어 낸 사람' },
  { key: 'status', label: '지금 상태' },
  { key: 'current_minutes', label: '한 번에 드는 시간', unit: '분' },
  { key: 'current_people', label: '몇 명이', unit: '명' },
  { key: 'current_frequency', label: '얼마나 자주' },
]

// 한 칸을 갈라 본다. 양쪽에 다 있는 말 / 왼쪽에만 / 오른쪽에만.
//
// 조각(두 글자짜리)은 빼고 온전한 낱말만 보여 준다. 견줄 때는 조각이
// 필요하지만, 사람에게 "이 말이 다릅니다"라고 할 때 조각을 들이밀면
// 읽을 수가 없다.
export function splitField(aText, bText) {
  const a = tokenParts(aText)
  const b = tokenParts(bText)

  const both = []
  const onlyA = []
  const onlyB = []

  for (const w of a.words) (b.words.has(w) ? both : onlyA).push(w)
  for (const w of b.words) if (!a.words.has(w)) onlyB.push(w)

  const ko = (x, y) => x.localeCompare(y, 'ko')
  return { both: both.sort(ko), onlyA: onlyA.sort(ko), onlyB: onlyB.sort(ko) }
}

// 값이 다른 칸만 골라낸다.
//
// 같은 값을 좌우로 늘어놓는 것은 자리만 차지한다. 담당자가 보고 싶은 것은
// 다른 대목이다. 다만 "둘 다 비어 있음"은 다른 것이 아니다.
export function valueDiffs(a, b) {
  return VALUE_FIELDS.map((f) => {
    const av = a?.[f.key] ?? null
    const bv = b?.[f.key] ?? null
    const empty = (v) => v == null || v === ''
    return {
      ...f,
      a: av,
      b: bv,
      same: empty(av) && empty(bv) ? true : String(av) === String(bv),
      bothEmpty: empty(av) && empty(bv),
    }
  })
}

// 두 신청서를 견준 결과 전부.
//
// corpus(이미 들어와 있는 신청서 전부)를 같이 받는다. 점수를 낼 때
// "이 회사에서 흔한 말"을 알아야 하기 때문이다. 없으면 없는 대로 센다.
export function compare(a, b, others) {
  const corpus = corpusOf(others ?? [])
  const { score, shared } = similarity(a, b, corpus)

  const fields = TEXT_FIELDS.map((f) => {
    const aText = a?.[f.key] ?? ''
    const bText = b?.[f.key] ?? ''
    const split = splitField(aText, bText)
    return {
      ...f,
      aText,
      bText,
      ...split,
      // 한쪽만 적은 칸. "다르다"고 말하면 안 된다 — 안 적은 것뿐이다.
      onlyOneSide: Boolean(aText) !== Boolean(bText),
      bothEmpty: !aText && !bText,
    }
  })

  const values = valueDiffs(a, b)

  return {
    score,
    shared,
    fields,
    values,
    // 한눈에 볼 요약. 몇 군데가 겹치고 몇 군데가 다른가.
    summary: {
      sameValues: values.filter((v) => v.same && !v.bothEmpty).length,
      differentValues: values.filter((v) => !v.same).length,
      sharedWords: fields.reduce((s, f) => s + f.both.length, 0),
      onlyAWords: fields.reduce((s, f) => s + f.onlyA.length, 0),
      onlyBWords: fields.reduce((s, f) => s + f.onlyB.length, 0),
    },
  }
}

export const COMPARE_VERDICTS = ['같은 건', '다른 건']

// 판정에 붙일 설명. 화면과 기록이 같은 말을 쓰게 한다.
export const VERDICT_MEANING = {
  '같은 건':
    '두 신청서가 같은 병목을 말하고 있습니다. 하나로 합치고, 나중에 낸 쪽에는 먼저 낸 것이 어디까지 왔는지 알려 줍니다.',
  '다른 건':
    '말은 비슷하지만 다른 일입니다. 각각 따로 봅니다. 어디가 다른지를 근거에 적어 두면 다음에 또 걸렸을 때 다시 견주지 않아도 됩니다.',
}
