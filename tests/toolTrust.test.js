import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { trustLevel, toReports, REPORT_KIND, REPORT_FIX } from '../shared/report.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

// "이 도구에 표시가 붙습니다" — 그 표시가 부서 화면에는 없었다.
//
// 부서가 도구 화면에서 "숫자가 안 맞습니다"를 신고하면 서버가 이렇게 답한다 —
//
//   "결과를 믿을 수 없는 종류라 **이 도구에 표시가 붙습니다.** 담당자가 먼저
//    봅니다."
//
// 라이브에서 신고해 보고 도구 화면을 다시 열었다. 표시가 없다. trustLevel()
// 은 있는데 담당자용 목록(/tools)에서만 부른다. 부서는 그 목록을 안 연다 —
// 넘겨받을 때 /t/... 주소 하나만 받고 매주 그것만 연다.
//
// 부서 쪽에서 보면 이렇다. 월요일 아침에 정산을 돌리러 온다. 지난주에
// 옆자리가 "반품 있는 주에 12,400원 많게 나온다"를 신고해 뒀고 아직 안
// 고쳐졌다. 화면 위쪽에는 절감 시간과 사용법이 있고 그 신고는 한참 아래에
// 있다. 그대로 돌려서 틀린 줄 아는 숫자를 재무 폴더에 올린다.
//
// 도는 것과 맞는 것은 다르다.

const report = (over = {}) => ({
  id: over.id ?? 'dec_1',
  link_kind: REPORT_KIND,
  link_id: over.code ?? 'wrong_number',
  title: '재무 정산 담당',
  what: '반품이 있는 주에 합계가 원장보다 12,400원 많게 나옵니다.',
  why: '재무에서 "숫자가 안 맞습니다"로 신고했습니다.',
  created_at: '2026-08-09 08:07:26',
})
const fix = (id) => ({
  id: `dec_fix_${id}`,
  link_kind: REPORT_FIX,
  link_id: id,
  title: 'AX 담당자',
  what: '반품 부호를 고쳤습니다.',
  why: '반품 줄을 더하고 있었습니다.',
  created_at: '2026-08-09 09:00:00',
})

describe('지금 이 도구를 믿을 수 있나', () => {
  it('안 고친 숫자 신고가 있으면 믿을 수 없다고 한다', () => {
    const t = trustLevel(toReports([report()]))
    expect(t.level).toBe('결과를 믿을 수 없음')
    expect(t.urgent).toBe(1)
  })

  it('고쳤으면 표시를 내린다', () => {
    // 안 내리면 영영 빨간 채로 남고, 그러면 그 표시를 아무도 안 읽는다.
    const t = trustLevel(toReports([report(), fix('dec_1')]))
    expect(t.level).toBe('이상 없음')
    expect(t.open).toBe(0)
  })

  it('불편하다는 신고는 숫자 신고와 같은 줄에 안 세운다', () => {
    // 같은 색으로 겁주면 정작 숫자가 틀렸을 때 안 읽힌다.
    const t = trustLevel(toReports([report({ code: 'hard_to_use' })]))
    expect(t.level).toBe('불편하다는 신고 있음')
    expect(t.urgent).toBe(0)
    expect(t.open).toBe(1)
  })

  it('신고가 없으면 아무 말도 안 한다', () => {
    expect(trustLevel([]).level).toBe('이상 없음')
    expect(trustLevel(undefined).open).toBe(0)
  })
})

describe('그 판단이 부서 화면까지 간다', () => {
  const route = readFileSync(join(ROOT, 'functions', 'api', 'tools', '[slug].js'), 'utf8')
  const list = readFileSync(join(ROOT, 'functions', 'api', 'tools', 'index.js'), 'utf8')
  const page = readFileSync(join(ROOT, 'src', 'pages', 'ToolPage.jsx'), 'utf8')

  it('부서가 여는 라우트가 그 값을 내려보낸다', () => {
    // 계산해 놓고 return 에 안 넣는 것이 이 저장소에서 되풀이된 실수다.
    expect(route).toContain('trust: trustLevel(reports)')
  })

  it('담당자 목록과 같은 함수로 낸다', () => {
    // 두 벌로 만들면 부서 화면은 이상 없다고 하고 담당자 목록은 믿을 수
    // 없다고 하는 날이 온다.
    expect(list).toContain('trustLevel(')
    expect(route).toContain("from '../../../shared/report.js'")
  })

  it('같은 목록으로 판단한다', () => {
    // 신고 목록과 믿음 판단을 따로 만들면 한쪽만 거르는 날 갈라진다.
    expect(route).toMatch(/const reports = toReports\(/)
    expect(route).toContain('reports,')
  })

  it('화면이 돌리기 전에 말한다', () => {
    expect(page).toContain('data.trust?.urgent > 0')
    expect(page).toContain('그대로 쓰시면 안 됩니다')
    // 무엇이 신고됐는지까지 보여야 손으로 확인할 데를 안다.
    expect(page).toContain('r.open && r.urgent')
  })

  it('불편하다는 신고는 다른 말로 한다', () => {
    expect(page).toContain('data.trust?.urgent === 0 && data.trust?.open > 0')
    expect(page).toContain('결과는 그대로 쓰셔도 됩니다')
  })

  it('신고 목록보다 위에 있다', () => {
    // 맨 아래 목록에만 있어서 안 읽힌 것이 이 회차의 발단이다.
    expect(page.indexOf('data.trust?.urgent > 0')).toBeLessThan(page.indexOf('<ReportForm'))
  })
})
