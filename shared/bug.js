// 이 사이트 자체가 이상할 때 말할 데.
//
// 여기까지 이 사이트는 **부서가 낸 일**만 받았다. 신청서, 도구 신고, 사용
// 중 막힌 곳. 정작 이 사이트 자체가 안 열리거나 숫자가 이상하면 말할 데가
// 없었다. 로그인이 없으니 계정으로 물을 수도 없고, 결국 보시는 분은 그냥
// 닫는다. 닫은 이유는 아무 데도 안 남는다.
//
// 그런데 이 저장소가 파는 것이 "못 한 것을 숨기지 않는다"이다. 자기 버그를
// 받을 자리가 없으면 그 말이 안쪽에서 먼저 깨진다.

// 어느 자리에서 그랬는가.
//
// 화면 이름을 자유롭게 적게 하면 "메인"·"첫 페이지"·"홈"이 다 따로 들어온다.
// 골라 주시면 같은 자리를 같은 이름으로 셀 수 있다.
export const BUG_AREAS = [
  { code: 'flow', label: '첫 화면' },
  { code: 'apply', label: '1 신청서' },
  { code: 'review', label: '2 검토' },
  { code: 'agreement', label: '3 협의안' },
  { code: 'build', label: '4 제작' },
  { code: 'beta', label: '5 베타 테스트' },
  { code: 'result', label: '6 성과' },
  { code: 'track', label: '접수번호 조회' },
  { code: 'tool', label: '넘겨받은 도구' },
  { code: 'other', label: '그 밖에 / 어딘지 모르겠음' },
]

export const BUG_AREA_CODES = BUG_AREAS.map((a) => a.code)
export const BUG_AREA_BY_CODE = Object.fromEntries(BUG_AREAS.map((a) => [a.code, a]))

// 무슨 일이 있었는가.
//
// 유형을 먼저 고르게 하면 그 유형에 필요한 것을 그 자리에서 물을 수 있다.
// 그리고 급한 것과 안 급한 것을 같은 줄에 세우지 않을 수 있다.
export const BUG_KINDS = [
  {
    code: 'blank',
    label: '화면이 안 열립니다',
    ask: '무엇을 누르셨을 때 그랬는지 적어주세요.',
    severity: '높음',
  },
  {
    code: 'wrong_number',
    label: '숫자가 이상합니다',
    ask: '어느 숫자가 얼마로 보였고, 맞는 값은 얼마여야 하는지 적어주세요.',
    severity: '높음',
  },
  {
    code: 'no_save',
    label: '눌러도 저장이 안 됩니다',
    ask: '어느 버튼을 누르셨고 화면에 무슨 말이 떴는지 적어주세요.',
    severity: '높음',
  },
  {
    code: 'broken_text',
    label: '글자나 칸이 깨져 보입니다',
    ask: '어느 자리가 어떻게 보이는지 적어주세요.',
    severity: '보통',
  },
  {
    code: 'confusing',
    label: '뜻을 모르겠습니다',
    ask: '어느 문장이 무슨 뜻인지 모르겠는지 적어주세요.',
    severity: '낮음',
  },
  {
    code: 'other',
    label: '그 밖에',
    ask: '무슨 일이 있었는지 적어주세요.',
    severity: '보통',
  },
]

export const BUG_KIND_CODES = BUG_KINDS.map((k) => k.code)
export const BUG_KIND_BY_CODE = Object.fromEntries(BUG_KINDS.map((k) => [k.code, k]))

// 화면이 안 열리는 것과 글자가 어색한 것을 같은 줄에 세우면, 급한 것이
// 안 급한 것 스무 줄 아래로 내려간다.
export const URGENT_BUG_CODES = BUG_KINDS.filter((k) => k.severity === '높음').map((k) => k.code)

// 처리 상태.
//
// '고침'과 '버그 아님'을 갈라 둔다. 둘 다 "이제 안 봐도 되는 것"이지만
// 뜻이 정반대다 — 뭉뚱그리면 나중에 "그래서 고친 거야 만 거야"를 다시 묻게 된다.
export const BUG_STATUSES = ['접수', '확인함', '고침', '버그아님']
export const BUG_DONE = ['고침', '버그아님']

const MIN_BODY = 10
const MIN_NOTE = 5

export function validateBug({ area, kind, body, reporter } = {}) {
  const fields = {}
  if (!BUG_AREA_CODES.includes(String(area ?? ''))) {
    fields.area = '어느 화면에서 그랬는지 골라주세요.'
  }
  if (!BUG_KIND_CODES.includes(String(kind ?? ''))) {
    fields.kind = '무슨 일이 있었는지 골라주세요.'
  }
  // "안 돼요" 한 줄이 오면 되물어야 하고, 되물을 길이 없다(로그인이 없다).
  // 그래서 처음 한 번에 받아야 한다.
  if (String(body ?? '').trim().length < MIN_BODY) {
    fields.body = `무슨 일이 있었는지 조금만 더 적어주세요. (${MIN_BODY}자 이상)`
  }
  // 연락처와 이름은 안 받는다. 로그인이 없는 사이트에서 이름을 요구하면
  // 그 자리에서 절반이 닫는다. 대신 다시 나오게 하는 방법을 여쭙는다.
  if (reporter != null && String(reporter).length > 40) {
    fields.reporter = '40자 안으로 적어주세요.'
  }
  return fields
}

export function validateBugUpdate({ status, note } = {}) {
  const fields = {}
  if (!BUG_STATUSES.includes(String(status ?? ''))) {
    fields.status = '어떻게 됐는지 골라주세요.'
  }
  // 고쳤다면 무엇을 고쳤는지, 버그가 아니라면 왜 아닌지를 적게 한다.
  // 근거 없이 닫으면 신고한 사람은 무시당한 것으로 읽는다.
  if (BUG_DONE.includes(String(status ?? '')) && String(note ?? '').trim().length < MIN_NOTE) {
    fields.note =
      status === '고침'
        ? `무엇을 고쳤는지 적어주세요. (${MIN_NOTE}자 이상)`
        : `왜 버그가 아닌지 적어주세요. (${MIN_NOTE}자 이상)`
  }
  return fields
}

// DB 줄을 화면이 쓰는 모양으로 편다.
export function toBugs(rows) {
  return (rows ?? [])
    .map((r) => {
      const kind = BUG_KIND_BY_CODE[r.kind] ?? BUG_KIND_BY_CODE.other
      const area = BUG_AREA_BY_CODE[r.area] ?? BUG_AREA_BY_CODE.other
      const status = BUG_STATUSES.includes(r.status) ? r.status : '접수'
      return {
        id: r.id,
        area: area.code,
        areaLabel: area.label,
        kind: kind.code,
        kindLabel: kind.label,
        severity: kind.severity,
        urgent: URGENT_BUG_CODES.includes(kind.code),
        body: r.body,
        steps: r.steps ?? null,
        reporter: r.reporter ?? null,
        status,
        note: r.note ?? null,
        open: !BUG_DONE.includes(status),
        at: r.created_at,
        handledAt: r.updated_at ?? null,
      }
    })
    .sort((a, b) => {
      // 안 끝난 것 먼저, 그중 급한 것 먼저, 그중 오래된 것 먼저.
      // 오래 방치된 신고가 맨 위에 와야 그게 눈에 걸린다.
      if (a.open !== b.open) return a.open ? -1 : 1
      if (a.open && a.urgent !== b.urgent) return a.urgent ? -1 : 1
      return String(a.at).localeCompare(String(b.at))
    })
}

// 몇 건이 남아 있나.
//
// 이 사이트는 다른 자리에서 "못 한 것을 데이터에서 만들어 보여준다"고 적어
// 두었다. 자기 버그만 손으로 고른 것을 보여주면 그 말이 깨진다. 그래서
// 여기도 세는 것은 전부 줄에서 나온다.
export function bugSummary(bugs) {
  const list = Array.isArray(bugs) ? bugs : []
  const open = list.filter((b) => b.open)
  return {
    total: list.length,
    open: open.length,
    urgent: open.filter((b) => b.urgent).length,
    fixed: list.filter((b) => b.status === '고침').length,
    notBug: list.filter((b) => b.status === '버그아님').length,
  }
}
