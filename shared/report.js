// 넘긴 도구가 이상할 때 부서가 말할 데.
//
// 도구를 넘기고 나면 그때부터가 진짜다. 그런데 부서가 돌려 보고 "이 숫자
// 좀 이상한데" 싶어도 말할 데가 없었다. 결국 담당자에게 메신저로 말하거나,
// 더 흔하게는 그냥 안 쓴다. 안 쓰는 이유는 아무 데도 안 남는다.
//
// 넘긴 뒤 들어온 신고가 이 사이트에서 가장 값진 기록이다. 만들 때 놓친
// 것은 만든 사람이 못 찾는다 — 매일 그 일을 하는 사람만 찾는다.

// 무엇이 이상한가.
//
// 자유롭게 적게만 하면 "이상해요" 한 줄이 온다. 그러면 담당자가 다시
// 물어야 하고 하루가 간다. 유형을 먼저 고르게 하면 그 유형에 필요한 것을
// 그 자리에서 물을 수 있다.
export const REPORT_KINDS = [
  {
    code: 'wrong_number',
    label: '숫자가 안 맞습니다',
    detail: '결과 금액이나 건수가 제가 아는 것과 다릅니다.',
    ask: '어느 숫자가 얼마로 나왔고, 맞는 값은 얼마인지 적어주세요.',
    severity: '높음',
  },
  {
    code: 'missing_rows',
    label: '있어야 할 줄이 빠졌습니다',
    detail: '원본에 있던 것이 결과에 안 보입니다.',
    ask: '어느 파일 몇 번째 줄인지, 또는 어떤 상품·채널인지 적어주세요.',
    severity: '높음',
  },
  {
    code: 'wont_run',
    label: '아예 안 돌아갑니다',
    detail: '파일을 넣었는데 오류가 나거나 결과가 안 나옵니다.',
    ask: '어떤 파일을 넣으셨고 화면에 무슨 말이 떴는지 적어주세요.',
    severity: '높음',
  },
  {
    code: 'quarantine',
    label: '밀려난 줄이 너무 많습니다',
    detail: '처리 못 한 줄이 많아서 결국 손으로 다시 해야 합니다.',
    ask: '어떤 줄이 밀려났는지, 그게 원래 어떤 것인지 적어주세요.',
    severity: '보통',
  },
  {
    code: 'hard_to_use',
    label: '쓰기가 불편합니다',
    detail: '돌아가긴 하는데 손이 많이 갑니다.',
    ask: '어느 대목에서 손이 가는지 적어주세요.',
    severity: '보통',
  },
  {
    code: 'other',
    label: '그 밖에',
    detail: '',
    ask: '무슨 일이 있었는지 적어주세요.',
    severity: '보통',
  },
]

export const REPORT_CODES = REPORT_KINDS.map((k) => k.code)
export const REPORT_BY_CODE = Object.fromEntries(REPORT_KINDS.map((k) => [k.code, k]))

// 숫자가 틀리는 종류는 급하다. 쓰기 불편한 것과 같은 줄에 세우면 안 된다.
export const URGENT_CODES = REPORT_KINDS.filter((k) => k.severity === '높음').map((k) => k.code)

export const REPORT_KIND = '신고'
export const REPORT_FIX = '신고처리'

const MIN_BODY = 10

export function validateReport({ code, body, reporter }) {
  const fields = {}
  if (!REPORT_CODES.includes(String(code ?? ''))) {
    fields.code = '무엇이 이상한지 골라주세요.'
  }
  const text = String(body ?? '').trim()
  if (text.length < MIN_BODY) {
    // "이상해요" 한 줄이 오면 담당자가 다시 물어야 하고 하루가 간다.
    fields.body = `무슨 일이 있었는지 조금만 더 적어주세요. (${MIN_BODY}자 이상)`
  }
  if (!String(reporter ?? '').trim()) {
    fields.reporter = '누가 겪으신 일인지 적어주세요.'
  }
  return fields
}

// 도구 주소 없이 제보할 때.
//
// 여태 신고하려면 넘겨받은 도구 주소(/t/…)를 알아야 했다. 그 주소를 아는
// 사람은 그 도구를 받은 부서뿐이고, 주소를 잃어버리면 말할 데가 없어진다.
// 그리고 아직 안 넘긴 것은 신고할 길이 아예 없다 — 만드는 중에 이상한 걸
// 본 사람이 가장 먼저 아는데도.
//
// 그래서 어느 기능인지를 목록에서 고르는 창구를 따로 둔다. 받는 규칙은
// 같다 — 두 벌로 만들면 한쪽만 고쳐지고 갈라진다.
export function validateFiledReport({ applicationId, code, body, reporter } = {}) {
  const fields = validateReport({ code, body, reporter })
  if (!String(applicationId ?? '').trim()) {
    fields.applicationId = '어느 기능에 대한 것인지 골라주세요.'
  }
  return fields
}

// 결정 기록 줄을 신고로 바꾼다.
export function toReports(rows) {
  const items = (rows ?? [])
    .filter((r) => r.link_kind === REPORT_KIND)
    .map((r) => {
      const kind = REPORT_BY_CODE[r.link_id] ?? REPORT_BY_CODE.other
      return {
        id: r.id,
        code: kind.code,
        label: kind.label,
        severity: kind.severity,
        urgent: URGENT_CODES.includes(kind.code),
        reporter: r.title,
        body: r.what,
        at: r.created_at,
      }
    })

  // 처리한 것을 표시한다. 처리 기록은 신고 id를 가리킨다.
  const fixed = new Map(
    (rows ?? [])
      .filter((r) => r.link_kind === REPORT_FIX)
      .map((r) => [r.link_id, { how: r.what, why: r.why, at: r.created_at }])
  )

  return items
    .map((r) => ({ ...r, fix: fixed.get(r.id) ?? null, open: !fixed.has(r.id) }))
    .sort((a, b) => {
      // 안 고친 것 먼저, 그중 급한 것 먼저, 그중 오래된 것 먼저.
      // 오래 방치된 신고가 맨 위에 와야 그게 눈에 걸린다.
      if (a.open !== b.open) return a.open ? -1 : 1
      if (a.urgent !== b.urgent) return a.urgent ? -1 : 1
      return String(a.at).localeCompare(String(b.at))
    })
}

export function openReports(reports) {
  return (reports ?? []).filter((r) => r.open)
}

// 이 도구를 지금 믿을 수 있나.
//
// 넘긴 뒤 화면에서 "돌고 있음"이라고만 적으면, 숫자가 틀린다는 신고가
// 세 건 쌓여 있어도 잘 돌고 있는 것처럼 보인다. 도는 것과 맞는 것은 다르다.
export function trustLevel(reports) {
  const open = openReports(reports)
  if (open.length === 0) return { level: '이상 없음', urgent: 0, open: 0 }
  const urgent = open.filter((r) => r.urgent).length
  if (urgent > 0) {
    return { level: '결과를 믿을 수 없음', urgent, open: open.length }
  }
  return { level: '불편하다는 신고 있음', urgent: 0, open: open.length }
}
