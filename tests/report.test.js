import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  validateReport,
  toReports,
  openReports,
  trustLevel,
  REPORT_KIND,
  REPORT_FIX,
  REPORT_CODES,
} from '../shared/report.js'

// 넘긴 뒤 들어온 신고가 이 사이트에서 가장 값진 기록이다. 만들 때 놓친
// 것은 만든 사람이 못 찾는다 — 매일 그 일을 하는 사람만 찾는다.
//
// 그래서 이게 틀리면 제일 나쁘다. 숫자가 틀린다는 신고가 쌓여 있는데
// "잘 돌고 있음"으로 보이면, 틀린 숫자로 대표 보고가 나간다.

const report = (id, code, at, extra = {}) => ({
  id,
  link_kind: REPORT_KIND,
  link_id: code,
  title: '정산 담당자',
  what: '자사몰 순매출이 제가 아는 것보다 25만원 많게 나옵니다.',
  why: '부서가 신고했습니다.',
  created_at: at,
  ...extra,
})

const fix = (id, reportId, at) => ({
  id,
  link_kind: REPORT_FIX,
  link_id: reportId,
  title: 'AX 담당자',
  what: '할인액 컬럼 이름이 바뀐 것을 못 잡고 있었습니다. 고쳤습니다.',
  why: '컬럼이 바뀌면 조용히 빠지던 것이 원인이었습니다.',
  created_at: at,
})

// 결정 기록에는 판정·질문 같은 것도 같이 들어 있다.
const other = {
  id: 'x1',
  link_kind: '질문',
  link_id: 'x1',
  title: 'AX 담당자',
  what: '채널이 몇 개인가요',
  why: '판정에 필요합니다',
  created_at: '2026-07-20 09:00:00',
}

describe('신고할 때 받는 것', () => {
  const good = {
    code: 'wrong_number',
    body: '자사몰 순매출이 25만원 많게 나옵니다.',
    reporter: '정산 담당자',
  }

  it('제대로 적었으면 통과한다', () => {
    expect(validateReport(good)).toEqual({})
  })

  it('무엇이 이상한지 안 고르면 막는다', () => {
    expect(validateReport({ ...good, code: '' }).code).toBeTruthy()
    expect(validateReport({ ...good, code: '아무거나' }).code).toBeTruthy()
  })

  it('"이상해요" 한 줄은 막는다', () => {
    // 이러면 담당자가 다시 물어야 하고 하루가 간다.
    expect(validateReport({ ...good, body: '이상해요' }).body).toBeTruthy()
  })

  it('누가 겪은 일인지 받아 둔다', () => {
    expect(validateReport({ ...good, reporter: '  ' }).reporter).toBeTruthy()
  })

  it('고를 수 있는 유형이 실제로 있다', () => {
    expect(REPORT_CODES.length).toBeGreaterThan(3)
    expect(REPORT_CODES).toContain('wrong_number')
  })
})

describe('신고만 골라내기', () => {
  it('신고가 아닌 기록은 뺀다', () => {
    expect(toReports([other, report('r1', 'wrong_number', '2026-07-21 09:00:00')])).toHaveLength(1)
  })

  it('유형을 사람 말로 바꿔 준다', () => {
    const [r] = toReports([report('r1', 'wrong_number', '2026-07-21 09:00:00')])
    expect(r.label).toContain('숫자')
    expect(r.urgent).toBe(true)
  })

  it('모르는 유형이 와도 터지지 않는다', () => {
    const [r] = toReports([report('r1', '없는유형', '2026-07-21 09:00:00')])
    expect(r.label).toBeTruthy()
  })

  it('빈 값에도 터지지 않는다', () => {
    expect(toReports([])).toEqual([])
    expect(toReports(undefined)).toEqual([])
  })
})

describe('고친 것과 안 고친 것', () => {
  it('처리 기록이 붙으면 닫힌다', () => {
    const [r] = toReports([
      report('r1', 'wrong_number', '2026-07-21 09:00:00'),
      fix('f1', 'r1', '2026-07-22 09:00:00'),
    ])
    expect(r.open).toBe(false)
    expect(r.fix.how).toContain('할인액')
  })

  it('다른 신고에 붙은 처리는 이 신고를 닫지 않는다', () => {
    const rs = toReports([
      report('r1', 'wrong_number', '2026-07-21 09:00:00'),
      report('r2', 'missing_rows', '2026-07-21 10:00:00'),
      fix('f1', 'r2', '2026-07-22 09:00:00'),
    ])
    expect(openReports(rs).map((r) => r.id)).toEqual(['r1'])
  })
})

describe('무엇을 맨 위에 놓는가', () => {
  it('안 고친 것이 고친 것보다 위다', () => {
    const rs = toReports([
      report('r1', 'wrong_number', '2026-07-20 09:00:00'),
      fix('f1', 'r1', '2026-07-20 10:00:00'),
      report('r2', 'hard_to_use', '2026-07-25 09:00:00'),
    ])
    expect(rs[0].id).toBe('r2')
  })

  it('안 고친 것끼리는 급한 것이 위다', () => {
    // 숫자가 틀리는 것과 쓰기 불편한 것을 같은 줄에 세우면 안 된다.
    const rs = toReports([
      report('r1', 'hard_to_use', '2026-07-20 09:00:00'),
      report('r2', 'wrong_number', '2026-07-25 09:00:00'),
    ])
    expect(rs[0].id).toBe('r2')
  })

  it('급한 것끼리는 오래 방치된 것이 위다', () => {
    const rs = toReports([
      report('r1', 'wrong_number', '2026-07-25 09:00:00'),
      report('r2', 'missing_rows', '2026-07-20 09:00:00'),
    ])
    expect(rs[0].id).toBe('r2')
  })
})

describe('이 도구를 지금 믿을 수 있나', () => {
  it('신고가 없으면 이상 없음이다', () => {
    expect(trustLevel([]).level).toBe('이상 없음')
  })

  it('숫자가 틀린다는 신고가 살아 있으면 못 믿는다', () => {
    // 도는 것과 맞는 것은 다르다. "돌고 있음"으로만 적으면 틀린 숫자로
    // 대표 보고가 나간다.
    const rs = toReports([report('r1', 'wrong_number', '2026-07-21 09:00:00')])
    const t = trustLevel(rs)
    expect(t.level).toBe('결과를 믿을 수 없음')
    expect(t.urgent).toBe(1)
  })

  it('고쳤으면 다시 믿을 수 있다', () => {
    const rs = toReports([
      report('r1', 'wrong_number', '2026-07-21 09:00:00'),
      fix('f1', 'r1', '2026-07-22 09:00:00'),
    ])
    expect(trustLevel(rs).level).toBe('이상 없음')
  })

  it('불편하다는 신고는 못 믿을 일이 아니다', () => {
    const rs = toReports([report('r1', 'hard_to_use', '2026-07-21 09:00:00')])
    expect(trustLevel(rs).level).toBe('불편하다는 신고 있음')
    expect(trustLevel(rs).urgent).toBe(0)
  })
})

// 도는 것과 맞는 것은 다르다.
//
// 도구 카드의 health 는 실행 횟수와 실패 횟수로만 정해진다. 그래서
// "숫자가 안 맞습니다" 신고가 세 건 쌓여 있어도 그 카드는 초록 "돌고 있음"
// 이었다. **실행은 성공하고 결과만 틀리는 것이 제일 위험한 상태인데,
// 화면은 그때 가장 안심시켜 주고 있었다.**
//
// trustLevel() 은 이 판단을 처음부터 갖고 있었다. 부르는 곳이 이 시험
// 파일밖에 없었을 뿐이다. 계산해 놓고 아무도 안 쓰는 것은 없는 것과 같다.
describe('믿을 수 있는지를 화면이 실제로 쓰는가', () => {
  const ROOT = fileURLToPath(new URL('..', import.meta.url))

  it('서버가 도구마다 trust 를 붙여 보낸다', () => {
    const src = readFileSync(join(ROOT, 'functions', 'api', 'tools', 'index.js'), 'utf8')
    expect(src).toContain('trustLevel')
    expect(src).toMatch(/it\.trust\s*=/)
    // 신고와 처리 기록을 둘 다 읽어야 "아직 안 풀린 신고"를 셀 수 있다.
    expect(src).toContain('REPORT_KIND')
    expect(src).toContain('REPORT_FIX')
  })

  it('화면이 그 값을 실제로 그린다', () => {
    // 서버만 만들고 화면에 안 다는 일이 이 저장소에서 되풀이됐다.
    const src = readFileSync(join(ROOT, 'src', 'pages', 'ToolsPage.jsx'), 'utf8')
    expect(src).toContain('결과를 믿을 수 없음')
    expect(src).toContain('불편하다는 신고')
  })

  it('화면이 쓰는 낱말이 계산이 내놓는 낱말과 같다', () => {
    // 한쪽만 고치면 배지가 영영 안 뜬다. 예외도 안 나고 화면도 안 깨진다.
    const urgent = trustLevel([
      { open: true, urgent: true },
      { open: true, urgent: false },
    ])
    expect(urgent.level).toBe('결과를 믿을 수 없음')
    expect(urgent.urgent).toBe(1)
    expect(urgent.open).toBe(2)

    const mild = trustLevel([{ open: true, urgent: false }])
    expect(mild.level).toBe('불편하다는 신고 있음')

    const clean = trustLevel([{ open: false, urgent: true }])
    expect(clean.level).toBe('이상 없음')

    const src = readFileSync(join(ROOT, 'src', 'pages', 'ToolsPage.jsx'), 'utf8')
    expect(src).toContain(urgent.level)
  })
})

// 부서가 적어 준 "무엇이 안 맞는지"가 담당자에게 안 왔다.
//
// 거절 쿼리가 what 을 안 뽑아서 items[].rejected 는 불리언이었고, 화면은
// 배지 한 줄만 그렸다. 그런데 첫 화면 할 일 목록은 그 배지를 가리키며
// **"무엇이 안 맞는지 보기"**라고 약속한다. 눌러서 간 자리에 그 "무엇"이
// 없었다. 부서는 시킨 대로 적어 줬는데 그 글이 부서용 도구 화면 안에만
// 있어서, 담당자는 그 주소를 직접 열어야 볼 수 있었다.
describe('못 쓰겠다는 이유가 담당자에게 오는가', () => {
  const ROOT = fileURLToPath(new URL('..', import.meta.url))

  it('서버가 이유를 함께 뽑는다', () => {
    const src = readFileSync(join(ROOT, 'functions', 'api', 'tools', 'index.js'), 'utf8')
    // 불리언만 주면 화면이 보여 줄 것이 없다.
    expect(src).toMatch(/it\.rejectedWhy\s*=/)
    expect(src).toContain('title, what')
  })

  it('화면이 그 글을 그린다', () => {
    const src = readFileSync(join(ROOT, 'src', 'pages', 'ToolsPage.jsx'), 'utf8')
    expect(src).toContain('rejectedWhy')
    expect(src).toContain('못 쓰겠다고 하신 이유')
  })

  it('할 일 목록의 약속과 화면이 맞는다', () => {
    const todo = readFileSync(join(ROOT, 'shared', 'todo.js'), 'utf8')
    // 이 문구가 약속이다. 바뀌면 화면도 같이 봐야 한다.
    expect(todo).toContain('무엇이 안 맞는지 보기')
    const page = readFileSync(join(ROOT, 'src', 'pages', 'ToolsPage.jsx'), 'utf8')
    expect(page).toContain('rejectedWhy')
  })
})

// 중앙값만 보이면 폭이 안 보인다.
//
// 셋 다 열흘쯤 걸린 것과, 사흘짜리 하나에 스무날짜리 하나가 섞여 중앙이
// 열흘인 것은 완전히 다른 이야기인데 화면에서는 같은 숫자였다. 서버는
// 최단·최장을 계산해 내려보내는데 읽는 곳이 없었다.
//
// 이 사이트는 다른 자리에서 "못 한 것을 숨기지 않는다"고 말한다. 오래 걸린
// 건을 가려 놓고 그 말을 할 수는 없다.
describe('접수에서 넘기기까지 걸린 폭', () => {
  const ROOT2 = fileURLToPath(new URL('..', import.meta.url))

  it('서버가 어느 건이었는지까지 준다', () => {
    // 숫자만 놓으면 "그래서 뭐"로 끝난다. 눌러서 그 기록으로 갈 수 있어야
    // "이건 왜 스무날이나 걸렸지"를 물을 수 있다.
    const src = readFileSync(join(ROOT2, 'functions', 'api', 'overview.js'), 'utf8')
    expect(src).toContain('a.ticket_no')
    const block = src.slice(src.indexOf('const leadDays'), src.indexOf('const medianLead'))
    expect(block).toContain('ticket_no: h.ticket_no')
    expect(block).toContain('dept: h.dept')
  })

  it('화면이 최단·최장을 실제로 그린다', () => {
    const page = readFileSync(join(ROOT2, 'src', 'pages', 'FlowPage.jsx'), 'utf8')
    expect(page).toContain('lead.fastest')
    expect(page).toContain('lead.slowest')
    expect(page).toContain('가장 빨랐던 것과 가장 오래 걸린 것')
    // 그 기록으로 갈 수 있어야 한다.
    expect(page).toContain('/record/${lead.fastest.ticket_no}')
  })

  it('한 건뿐이면 폭을 말하지 않는다', () => {
    // 최단과 최장이 같은 건이면 두 번 적는 꼴이 된다.
    const page = readFileSync(join(ROOT2, 'src', 'pages', 'FlowPage.jsx'), 'utf8')
    expect(page).toContain('data.lead.count > 1')
  })
})

// 가장 정직해야 할 화면이 가장 적게 세고 있었다.
//
// 못 한 것 화면의 "처리 못 하고 밀어 둔 줄"은 build_quarantine 만 셌다.
// 그 표에는 **만드는 중에 시운전한 것**만 들어 있다. 넘긴 뒤 부서가 매주
// 돌리면서 밀어 둔 줄은 tool_use 에 개수로 남는데 안 셌다.
//
// 그래서 도구가 실제로 돌수록 화면은 오히려 깨끗해 보였다. 이 화면의 존재
// 이유가 정확히 그 반대다.
describe('밀어 둔 줄을 전부 세는가', () => {
  const ROOT3 = fileURLToPath(new URL('..', import.meta.url))
  const src = readFileSync(join(ROOT3, 'functions', 'api', 'honesty.js'), 'utf8')

  it('시운전과 실제 실행을 둘 다 센다', () => {
    expect(src).toContain('FROM build_quarantine')
    expect(src).toContain('SUM(u.quarantined)')
    expect(src).toContain('const quarantineTotal = buildQuarantine + liveQuarantineRows')
  })

  it('둘을 갈라서도 내려보낸다', () => {
    // 화면이 "이 중 N줄은 실제 실행에서"를 말하려면 갈라진 값이 필요하다.
    expect(src).toContain('quarantineBuild')
    expect(src).toContain('quarantineLive')
  })

  it('화면이 그 차이를 밝힌다', () => {
    // 이유별로 못 나누는 것을 감추면, 표의 합과 위 숫자가 달라서 읽는 사람이
    // 둘 다 못 믿는다. 모르는 것은 모른다고 적는다.
    const page = readFileSync(join(ROOT3, 'src', 'pages', 'HonestyPage.jsx'), 'utf8')
    expect(page).toContain('data.quarantineLive')
    expect(page).toContain('서버에 개수만 남아')
  })

  it('막대는 나눌 수 있는 것 안에서 견준다', () => {
    // 전체로 나누면 막대가 다 짧아져서 어느 이유가 큰지가 안 보인다.
    const page = readFileSync(join(ROOT3, 'src', 'pages', 'HonestyPage.jsx'), 'utf8')
    expect(page).toContain('data.quarantineBuild')
    expect(page).not.toContain('/ data.quarantineTotal) * 100')
  })
})

// 시간을 아낀 쪽은 부서인데, 자기가 뭘 얻었는지는 남의 화면에 있었다.
//
// 부서는 매주 도구를 돌리면서도 그게 얼마나 줄여 줬는지를 못 봤다. 그
// 숫자는 담당자 성과 화면에만 있었다.
describe('부서도 자기 도구의 성과를 보는가', () => {
  const ROOT4 = fileURLToPath(new URL('..', import.meta.url))
  const route = readFileSync(join(ROOT4, 'functions', 'api', 'tools', '[slug].js'), 'utf8')
  const page = readFileSync(join(ROOT4, 'src', 'pages', 'ToolPage.jsx'), 'utf8')

  it('담당자 화면과 같은 함수로 낸다', () => {
    // 두 벌로 계산하면 부서가 보는 숫자와 담당자가 보는 숫자가 갈라진다.
    expect(route).toContain('computeOutcome(')
    expect(route).toContain('labelForOutcome(')
  })

  it('딱지를 함께 준다', () => {
    // 숫자만 던지면 부서는 확정으로 읽고 위에 보고한다 — 담당자 화면은
    // 같은 값을 잠정이라고 부르고 있는데.
    expect(route).toContain('label: labelForOutcome')
    expect(page).toContain('data.payoff.label')
  })

  it('시간을 먼저 보여 준다', () => {
    // 부서가 아낀 것은 자기 시간이다. 원 단위는 위에 보고할 때 쓰는 말이다.
    const i = page.indexOf('payoff.savedMinutes')
    const j = page.indexOf('payoff.savedKrw')
    expect(i).toBeGreaterThan(0)
    expect(i).toBeLessThan(j)
  })

  it('무엇을 빼고 낸 값인지 밝힌다', () => {
    // 안 밝히면 부서는 "그만큼 안 줄었는데"라고 느끼고 이 숫자를 안 믿는다.
    // 실제로 겪은 사람이 제일 먼저 알아챈다.
    expect(page).toContain('확인하신 시간')
    expect(page).toContain('payoff.reviewMinutes')
  })

  it('반박 개수가 담당자 화면과 같아진다', () => {
    // deptConfirmed 를 false 로 굳혀 뒀더니 부서 화면은 "확인 못 한 것
    // 5가지", 담당자 화면은 4가지가 됐다. 같은 것을 두 화면이 다른 숫자로
    // 말하면 읽는 사람은 둘 다 안 믿는다.
    expect(route).toContain('deptConfirmed: Boolean(saved?.dept_confirmed_at)')
    expect(route).toContain('dept_confirmed_at FROM outcome')
  })

  it('기준선이 없으면 아무 숫자도 안 낸다', () => {
    // 잰 적이 없으면 견줄 바닥이 없다. 그때 0이라고 적으면 "안 줄었다"로
    // 읽히는데, 실제로는 모르는 것이다.
    expect(route).toContain('if (baseline && recent.results.length > 0)')
    expect(page).toContain('{data.payoff && (')
  })
})

// 신고 왕복이 한쪽만 열려 있었다.
//
// 부서가 "이 결과 이상합니다"를 누르면 서버는 "담당자가 먼저 봅니다"라고
// 답한다. 그리고 거기서 끝이었다. 자기가 낸 것도, 고쳐졌는지도, 무엇을
// 고쳤는지도 다시 못 봤다.
//
// 그러면 부서는 한 번 신고하고 만다. 아무 일도 안 일어나는 것처럼 보이기
// 때문이다. 그 뒤로는 숫자가 틀려도 그냥 손으로 고쳐 쓰고, 그 사실을
// 아무도 모른다. 넘긴 뒤 들어오는 신고가 이 사이트에서 가장 값진 기록인데
// 그 길을 스스로 막아 둔 셈이었다.
describe('신고한 부서가 그 뒤를 보는가', () => {
  const ROOT5 = fileURLToPath(new URL('..', import.meta.url))
  const route = readFileSync(join(ROOT5, 'functions', 'api', 'tools', '[slug].js'), 'utf8')
  const page = readFileSync(join(ROOT5, 'src', 'pages', 'ToolPage.jsx'), 'utf8')

  it('부서 화면이 자기 신고를 받는다', () => {
    // 이 줄은 두 번 모양이 바뀌었다. 다시올림 기록을 같은 쿼리로 뽑게
    // 되면서 거르는 줄이 붙었고, 믿을 수 있나 판단에도 같은 목록을 쓰게
    // 되면서 변수로 빠졌다. 문장을 통째로 맞춰 보면 그때마다 깨지므로
    // **뜻만** 확인한다 — 뽑은 줄로 목록을 만들어 응답에 넣는가.
    expect(route).toMatch(/toReports\(reportRows\.results/)
    expect(route).toMatch(/^\s*reports,?$/m)
    // 처리 기록도 같이 읽어야 고쳤는지 알 수 있다.
    expect(route).toContain('REPORT_KIND, REPORT_FIX')
  })

  it('담당자 화면과 같은 함수로 만든다', () => {
    // 두 벌로 만들면 "고쳤다"의 뜻이 갈라진다.
    expect(route).toContain('toReports(')
    const staff = readFileSync(join(ROOT5, 'functions', 'api', 'reports.js'), 'utf8')
    expect(staff).toContain('toReports(')
  })

  it('무엇을 고쳤는지까지 보여 준다', () => {
    // "처리 완료" 한 줄로는 같은 일이 또 나는지 부서가 판단할 수 없다.
    expect(page).toContain('고쳤습니다')
    expect(page).toContain('r.fix.how')
  })

  it('아직 안 고친 것은 그렇다고 말한다', () => {
    // 조용히 비워 두면 신고가 사라진 것으로 읽힌다.
    expect(page).toContain('담당자 할 일 목록에 올라가 있습니다')
  })

  it('신고가 없으면 빈 칸을 안 만든다', () => {
    expect(page).toContain('{data.reports?.length > 0 &&')
  })
})

// 부서가 성과 숫자에 토를 달면 그 답이 돌아오는가.
//
// 부서가 "우리는 55분쯤 걸립니다"라고 다른 숫자를 말하면, 그건 성과 화면에
// 반박으로 올라가고 담당자가 그걸 풀면서 무엇을 확인했는지 적는다.
// 그 글이 부서에게 가는 길이 없었다.
//
// 부서 입장에서는 애써 알려 줬는데 아무 답이 없는 것이다. 그러면 다음부터는
// 그냥 넘긴다 — 남의 숫자에 토를 다는 일은 원래 부담스러워서, 한 번
// 무시당하면 두 번 하지 않는다.
describe('성과에 토를 단 부서가 답을 받는가', () => {
  const ROOT6 = fileURLToPath(new URL('..', import.meta.url))
  const route = readFileSync(
    join(ROOT6, 'functions', 'api', 'track', '[ticket]', 'outcome.js'),
    'utf8'
  )
  const page = readFileSync(join(ROOT6, 'src', 'pages', 'TrackPage.jsx'), 'utf8')

  it('담당자가 푼 반박을 부서 쪽으로 내려보낸다', () => {
    expect(route).toContain("rule_code = 'dept_disagrees'")
    expect(route).toContain('resolved_at IS NOT NULL')
    expect(route).toContain('answer: answered?.resolution')
  })

  it('불러온 값을 실제로 돌려준다', () => {
    // load 에서 뽑아 놓고 return 에 안 넣으면 화면은 영영 못 받는다.
    // 린트가 "선언만 하고 안 쓴다"고 잡아 줬다.
    expect(route).toContain('records: rows, answered }')
  })

  it('화면이 그 답을 그린다', () => {
    expect(page).toContain('state.answer')
    expect(page).toContain('담당자 답')
  })

  it('아직 답이 없으면 그렇다고 말한다', () => {
    // 조용히 비워 두면 안 읽힌 것으로 보인다.
    expect(page).toContain('담당자가 확인하면 그 내용이 여기')
    expect(page).toContain('확정으로 쓰지 않습니다')
  })

  it('맞다고 한 부서에는 이 자리를 안 만든다', () => {
    // 토를 안 단 사람에게 "답을 기다리는 중"이 뜨면 무슨 답을 기다리는지
    // 모른다.
    expect(page).toContain('state.deptFelt != null && (')
  })
})
