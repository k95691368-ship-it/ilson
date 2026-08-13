import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  validateFiledReport,
  validateReport,
  REPORT_KIND,
  REPORT_KINDS,
} from '../shared/report.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

// 신고하려면 넘겨받은 도구 주소(/t/…)를 알아야 했다.
//
// 그 주소를 아는 사람은 그 도구를 받은 부서뿐이다. 주소를 잃어버리면 말할
// 데가 없어지고, 아직 안 넘긴 것은 신고할 길이 아예 없었다 — 만드는 중에
// 이상한 걸 본 사람이 가장 먼저 아는데도.
//
// 그래서 목록에서 고르는 창구를 따로 뒀다. 다만 **저장하는 자리는 같아야
// 한다.** 따로 담으면 첫 화면과 「넘긴 뒤」 화면이 이 신고를 못 세고, 같은
// 도구를 두고 두 화면이 서로 다른 숫자를 말한다.

const ok = {
  applicationId: 'app_1',
  code: 'wrong_number',
  body: '정산 합계가 5만원 적게 나옵니다.',
  reporter: '재무 정산 담당자',
}

describe('도구 주소 없이 받을 때', () => {
  it('어느 기능인지를 반드시 고르게 한다', () => {
    // 안 고르면 어느 도구 신고인지 알 수 없어 아무 화면에도 안 붙는다.
    expect(validateFiledReport({ ...ok, applicationId: '' }).applicationId).toBeTruthy()
    expect(validateFiledReport({ ...ok, applicationId: '  ' }).applicationId).toBeTruthy()
    expect(validateFiledReport(ok)).toEqual({})
  })

  it('받는 규칙은 도구 화면과 같은 것을 쓴다', () => {
    // 두 벌로 만들면 한쪽만 고쳐지고 갈라진다. 도구 화면에서 막히는 것은
    // 여기서도 막혀야 한다.
    for (const bad of [
      { ...ok, code: '' },
      { ...ok, body: '이상해요' },
      { ...ok, reporter: '' },
    ]) {
      const here = validateFiledReport(bad)
      const there = validateReport({ code: bad.code, body: bad.body, reporter: bad.reporter })
      for (const key of Object.keys(there)) expect(here[key], key).toBeTruthy()
    }
  })

  it('빈 입력에도 터지지 않는다', () => {
    expect(() => validateFiledReport()).not.toThrow()
    expect(Object.keys(validateFiledReport()).length).toBeGreaterThan(0)
  })
})

describe('같은 자리에 쌓이는가', () => {
  const route = readFileSync(join(ROOT, 'functions', 'api', 'bugs', 'index.js'), 'utf8')

  it('새 표를 만들지 않는다', () => {
    // 따로 담으면 첫 화면과 넘긴 뒤 화면이 이 신고를 못 센다.
    expect(route).not.toMatch(/INSERT INTO bug/i)
    expect(route).not.toMatch(/CREATE TABLE/i)
    expect(route).toContain('logDecision')
    expect(route).toContain('REPORT_KIND')
  })

  it('도구 화면에서 낸 신고와 같은 모양으로 남긴다', () => {
    // 읽는 쪽이 어느 길로 들어왔는지 알 필요가 없어야 한다.
    const fromTool = readFileSync(
      join(ROOT, 'functions', 'api', 'tools', '[slug]', 'report.js'),
      'utf8'
    )
    for (const piece of ['linkKind: REPORT_KIND', 'linkId: code', 'actor:']) {
      expect(route, piece).toContain(piece)
      expect(fromTool, piece).toContain(piece)
    }
  })

  it('유형 코드를 link_id 에 담는다', () => {
    // 목록을 만들 때 이걸로 가른다. 다른 것을 담으면 전부 '그 밖에'가 된다.
    expect(REPORT_KIND).toBe('신고')
    expect(REPORT_KINDS.length).toBeGreaterThan(3)
  })
})

describe('만들어만 두고 못 가는 것이 아닌가', () => {
  const app = readFileSync(join(ROOT, 'src', 'App.jsx'), 'utf8')
  const page = readFileSync(join(ROOT, 'src', 'pages', 'BugPage.jsx'), 'utf8')

  it('목차에 칸이 있고 라우트가 있다', () => {
    expect(app).toContain('버그 신고')
    expect(app).toContain('to="/bug"')
    expect(app).toContain('path="/bug"')
  })

  it('화면이 유형 목록을 따로 적어 두지 않는다', () => {
    // 화면과 서버가 다른 목록을 쓰면 고를 수는 있는데 저장이 안 된다.
    expect(page).toContain('REPORT_KINDS')
    expect(page).not.toMatch(/const REPORT_KINDS = \[/)
  })

  it('고치는 자리를 한 곳으로 보낸다', () => {
    // 처리 폼을 여기에도 만들면 같은 일이 두 화면에 생기고 한쪽만 고쳐진다.
    expect(page).toContain('/tools')
    expect(page).not.toContain("api.post('/reports'")
  })
})
