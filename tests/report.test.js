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
