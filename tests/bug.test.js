import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BUG_AREAS,
  BUG_KINDS,
  BUG_STATUSES,
  BUG_DONE,
  validateBug,
  validateBugUpdate,
  toBugs,
  bugSummary,
} from '../shared/bug.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

// 이 사이트가 이상할 때 말할 데가 없었다.
//
// 부서가 낸 일은 다 받으면서 자기 버그는 안 받았다. 그러면 다른 화면에서
// 하는 "못 한 것을 숨기지 않는다"가 안쪽에서 먼저 깨진다.

const ok = { area: 'flow', kind: 'blank', body: '첫 화면이 안 열립니다.' }

describe('신고를 받을 때', () => {
  it('화면과 유형을 고르지 않으면 막는다', () => {
    // 자유롭게 적게 하면 "메인"·"홈"·"첫 페이지"가 다 따로 들어와서
    // 같은 자리를 같은 이름으로 셀 수 없다.
    const f = validateBug({ body: ok.body })
    expect(f.area).toBeTruthy()
    expect(f.kind).toBeTruthy()
  })

  it('목록에 없는 값은 안 받는다', () => {
    expect(validateBug({ ...ok, area: '아무거나' }).area).toBeTruthy()
    expect(validateBug({ ...ok, kind: '아무거나' }).kind).toBeTruthy()
  })

  it('"안 돼요" 한 줄은 돌려보낸다', () => {
    // 로그인이 없어 되물을 길이 없다. 처음 한 번에 받아야 한다.
    expect(validateBug({ ...ok, body: '안 돼요' }).body).toBeTruthy()
  })

  it('이름과 재현 방법은 없어도 받는다', () => {
    // 이름을 요구하면 그 자리에서 절반이 닫는다. 못 적는다고 돌려보내면
    // 그 버그는 영영 안 온다.
    expect(validateBug(ok)).toEqual({})
    expect(validateBug({ ...ok, steps: '', reporter: '' })).toEqual({})
  })

  it('빈 입력에도 터지지 않는다', () => {
    expect(() => validateBug()).not.toThrow()
    expect(Object.keys(validateBug()).length).toBeGreaterThan(0)
  })
})

describe('처리할 때', () => {
  it('끝냈다고 하면 근거를 받는다', () => {
    // 근거 없이 닫히면 신고한 사람은 고쳐진 것인지 무시당한 것인지 모른다.
    for (const status of BUG_DONE) {
      expect(validateBugUpdate({ status }).note, status).toBeTruthy()
      expect(validateBugUpdate({ status, note: '합계 줄을 걸러내도록 고쳤습니다' })).toEqual({})
    }
  })

  it('아직 안 끝난 상태는 근거를 안 받는다', () => {
    // 눈으로 확인만 한 것까지 사유를 요구하면 아무도 안 누른다.
    expect(validateBugUpdate({ status: '확인함' })).toEqual({})
  })

  it('고침과 버그아님을 갈라 묻는다', () => {
    // 뭉뚱그리면 나중에 "그래서 고친 거야 만 거야"를 다시 묻게 된다.
    expect(validateBugUpdate({ status: '고침' }).note).toContain('고쳤는지')
    expect(validateBugUpdate({ status: '버그아님' }).note).toContain('아닌지')
  })

  it('목록에 없는 상태는 안 받는다', () => {
    expect(validateBugUpdate({ status: '대충함' }).status).toBeTruthy()
  })
})

describe('목록을 세울 때', () => {
  const rows = [
    { id: 'b1', area: 'flow', kind: 'confusing', body: '뜻을 모르겠습니다', status: '접수', created_at: '2026-08-01' },
    { id: 'b2', area: 'review', kind: 'blank', body: '안 열립니다', status: '접수', created_at: '2026-08-05' },
    { id: 'b3', area: 'build', kind: 'wrong_number', body: '숫자가 다릅니다', status: '고침', note: '고쳤습니다', created_at: '2026-07-20' },
  ]

  it('안 끝난 것이 먼저, 그중 급한 것이 먼저다', () => {
    // 화면이 안 열리는 것과 글자가 어색한 것을 같은 줄에 세우면 급한 것이
    // 스무 줄 아래로 내려간다.
    expect(toBugs(rows).map((b) => b.id)).toEqual(['b2', 'b1', 'b3'])
  })

  it('끝난 것도 목록에서 빼지 않는다', () => {
    // 골라서 보여주면 "데이터에서 만들어지므로 손댈 수 없습니다"가 자기
    // 버그 앞에서만 예외가 된다.
    expect(toBugs(rows)).toHaveLength(3)
    expect(toBugs(rows).find((b) => b.id === 'b3').open).toBe(false)
  })

  it('모르는 값이 와도 터지지 않는다', () => {
    const odd = toBugs([{ id: 'x', area: '없음', kind: '없음', body: 'ㅁ', status: '없음', created_at: '2026-08-01' }])
    expect(odd[0].kindLabel).toBeTruthy()
    expect(odd[0].areaLabel).toBeTruthy()
    expect(odd[0].status).toBe('접수')
    expect(toBugs()).toEqual([])
  })

  it('센 것이 줄에서 나온다', () => {
    const s = bugSummary(toBugs(rows))
    expect(s).toMatchObject({ total: 3, open: 2, urgent: 1, fixed: 1, notBug: 0 })
    expect(bugSummary()).toMatchObject({ total: 0, open: 0 })
  })
})

describe('만들어만 두고 못 가는 것이 아닌가', () => {
  const app = readFileSync(join(ROOT, 'src', 'App.jsx'), 'utf8')

  it('목차에 칸이 있고 라우트가 있다', () => {
    // 서버만 만들고 화면에 안 다는 일이 이 저장소에서 되풀이됐다.
    expect(app).toContain('버그 신고')
    expect(app).toContain('to="/bug"')
    expect(app).toContain('path="/bug"')
    expect(app).toContain('BugPage')
  })

  it('서버 길이 실제로 있다', () => {
    const files = readdirSync(join(ROOT, 'functions', 'api', 'bugs'))
    expect(files).toContain('index.js')
    expect(files).toContain('[id].js')
  })

  it('표를 만드는 마이그레이션이 있다', () => {
    const sql = readdirSync(join(ROOT, 'migrations'))
      .map((f) => readFileSync(join(ROOT, 'migrations', f), 'utf8'))
      .join('\n')
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS bug_report/i)
    // 상태 이름이 코드와 표에서 갈라지면 저장이 통째로 실패한다. 이
    // 저장소에서 실제로 그 사고가 났다 — 반려 사유 코드가 CHECK 에 없어서
    // 판정 저장이 500 이 됐고 담당자가 적어 둔 것을 전부 잃었다.
    for (const s of BUG_STATUSES) expect(sql, s).toContain(s)
  })

  it('화면이 고른 것을 서버가 받는다', () => {
    // 화면과 서버가 다른 목록을 쓰면 고를 수는 있는데 저장이 안 된다.
    const page = readFileSync(join(ROOT, 'src', 'pages', 'BugPage.jsx'), 'utf8')
    expect(page).toContain('BUG_AREAS')
    expect(page).toContain('BUG_KINDS')
    expect(page).not.toMatch(/const BUG_AREAS = \[/)
    expect(BUG_AREAS.length).toBeGreaterThan(3)
    expect(BUG_KINDS.length).toBeGreaterThan(3)
  })
})
