// 밀려난 줄을 부서가 되돌려 알려준다.
//
// 도구가 처리 못 한 줄을 화면에 보여 주기는 한다. 그런데 보여 주기만 하고
// 고칠 길이 없었다. 부서는 그 줄이 뭔지 아는데 — 매일 그 일을 하니까 —
// 말할 데가 없어서 결국 그 줄만 따로 손으로 처리한다. 그러면 자동화한 보람이
// 반으로 준다.
//
// 특히 "우리 목록에 없는 상품코드"는 부서가 한 줄만 알려주면 끝난다.
// 채널이 붙인 코드와 우리 표준코드를 이어 주면 다음 실행부터 저절로 풀린다.
//
// 그런데 밀려난 이유가 다 같지 않다. 어떤 것은 알려줘도 안 풀리고, 어떤
// 것은 애초에 밀려나는 게 맞다. 아무 줄에나 "알려주기" 버튼을 달면 부서는
// 알려줘도 안 풀리는 것을 알려주고 나서 "말해도 소용없네"가 된다.

import { SKU_BY_CODE, SKUS } from './master.js'

// 밀려난 이유마다 부서가 할 수 있는 일이 다르다.
const RESOLUTION = {
  unknown_sku: {
    kind: 'teach',
    title: '이 코드가 어느 상품인지 알려주실 수 있습니다',
    body: '채널이 붙인 코드라 저희 목록에 없습니다. 어느 상품인지 한 번만 알려주시면 다음부터는 저절로 처리됩니다.',
  },
  no_sku: {
    kind: 'fix_source',
    title: '원본에 상품코드가 비어 있습니다',
    body: '알려주셔도 어느 줄인지 짚을 수가 없습니다. 원본 파일에서 그 줄의 상품코드를 채워 다시 올려주세요.',
  },
  bad_date: {
    kind: 'fix_source',
    title: '날짜를 알아볼 수 없습니다',
    body: '원본의 날짜 칸이 비었거나 모양이 다릅니다. 그 줄을 고쳐 다시 올려주세요.',
  },
  bad_amount: {
    kind: 'fix_source',
    title: '금액을 숫자로 읽을 수 없습니다',
    body: '글자가 섞여 있거나 칸이 비었습니다. 원본을 고쳐 다시 올려주세요.',
  },
  out_of_period: {
    kind: 'expected',
    title: '이건 밀려나는 것이 맞습니다',
    body: '정산 기간 밖의 줄입니다. 이번 달 정산에 넣으면 지난달 숫자가 이번 달에 섞입니다. 일부러 빼 둡니다.',
  },
  empty_row: {
    kind: 'expected',
    title: '이건 밀려나는 것이 맞습니다',
    body: '빈 줄입니다. 넣을 것이 없습니다.',
  },
  total_row: {
    kind: 'expected',
    title: '이건 밀려나는 것이 맞습니다',
    body: '합계 줄입니다. 이걸 넣으면 같은 금액을 두 번 세게 됩니다.',
  },
  unknown_channel: {
    kind: 'ask_staff',
    title: '어느 채널 양식인지 모르겠습니다',
    body: '저희가 아는 양식이 아닙니다. 담당자에게 알려주세요 — 양식을 보고 규칙을 더해야 합니다.',
  },
  missing_columns: {
    kind: 'ask_staff',
    title: '꼭 있어야 할 칸이 없습니다',
    body: '양식이 바뀐 것 같습니다. 담당자에게 알려주세요.',
  },
}

// 부서가 알려줘서 풀 수 있는 것만.
export function resolutionFor(reason) {
  return (
    RESOLUTION[reason] ?? {
      kind: 'ask_staff',
      title: '왜 밀려났는지 모르겠습니다',
      body: '담당자에게 알려주세요.',
    }
  )
}

// 밀려난 줄을 이유별로 묶고, 각각 무엇을 할 수 있는지 붙인다.
//
// 60줄이 한 이유로 밀려난 것과 60줄이 제각각 밀려난 것은 완전히 다른
// 상황이다. 줄 단위로만 보여 주면 그 차이가 안 보인다.
export function groupQuarantine(rows, labels = {}) {
  const map = new Map()
  for (const q of rows ?? []) {
    if (!map.has(q.reason)) {
      map.set(q.reason, {
        reason: q.reason,
        label: labels[q.reason] ?? q.reason,
        ...resolutionFor(q.reason),
        rows: [],
        codes: new Set(),
      })
    }
    const g = map.get(q.reason)
    g.rows.push(q)
    if (q.externalCode) g.codes.add(q.externalCode)
  }

  return [...map.values()]
    .map((g) => ({
      ...g,
      // 같은 코드가 스무 줄에 걸쳐 있으면 알려줄 것은 스무 번이 아니라
      // 한 번이다. 그걸 앞에 적어 줘야 부서가 엄두를 낸다.
      codes: [...g.codes].sort(),
      count: g.rows.length,
    }))
    .sort((a, b) => {
      // 알려주면 풀리는 것을 맨 위로. 밀려나는 게 맞는 것은 맨 아래로.
      const order = { teach: 0, fix_source: 1, ask_staff: 2, expected: 3 }
      return order[a.kind] - order[b.kind] || b.count - a.count
    })
}

// 우리 표준 상품 목록. 부서가 고를 수 있게 화면에 내려보낸다.
export function catalog() {
  return SKUS.map((s) => ({ code: s.canonical_code, name: s.name_ko }))
}

export function validateTeach({ externalCode, canonicalCode, teacher }) {
  const fields = {}
  const ext = String(externalCode ?? '').trim()
  const canon = String(canonicalCode ?? '').trim().toUpperCase()

  if (!ext) fields.externalCode = '어느 코드인지 알려주세요.'
  if (!canon) {
    fields.canonicalCode = '어느 상품인지 골라주세요.'
  } else if (!SKU_BY_CODE[canon]) {
    // 없는 코드로 이어 두면 다음 실행에서 그 줄이 또 밀려나거나, 더
    // 나쁘게는 엉뚱한 상품 매출로 잡힌다.
    fields.canonicalCode = '저희 목록에 없는 상품코드입니다. 목록에서 골라주세요.'
  }
  if (ext && canon && ext.toUpperCase() === canon) {
    fields.externalCode = '같은 코드끼리는 이어 둘 것이 없습니다.'
  }
  if (!String(teacher ?? '').trim()) fields.teacher = '누가 알려주시는지 적어주세요.'
  return fields
}

// 알려준 것이 실제로 무엇을 푸는가.
//
// "고맙습니다"만 하고 끝내면 부서는 자기가 한 일이 뭘 바꿨는지 모른다.
// 몇 줄이 풀리는지 그 자리에서 세어 준다.
export function affectedRows(quarantineRows, externalCode) {
  return (quarantineRows ?? []).filter(
    (q) => q.reason === 'unknown_sku' && q.externalCode === externalCode
  ).length
}
