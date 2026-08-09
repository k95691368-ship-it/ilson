import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// 만들어는 뒀는데 아무도 못 가는 화면을 막는다.
//
// 이 저장소에서 제일 자주 난 사고다. 수령확인, 시험판 의견, 보류 해제,
// 부서 거절 표시, 답변 도착 표시 — 전부 서버는 돌고 있는데 화면에 들어갈
// 문이 없었다. 아무도 안 쓰니 아무도 안 고치고, 없는 기능과 똑같아진다.
//
// 그리고 방금 또 났다. 상단 목차에서 여섯 칸을 뺐더니 /tools·/stall·
// /priority·/codes 로 가는 길이 **조건부 링크 하나씩만** 남았다.
// shared/todo.js 의 할 일 항목인데, 그건 할 일이 있을 때만 뜬다. 신청서가
// 없는 지금 상태에서는 어느 화면에서도 그 넷에 갈 수 없었다.
//
// 그래서 여기서 센다. "링크가 어딘가 있다"로는 부족하고, **데이터가 없어도
// 늘 보이는 자리**에 있어야 인정한다.

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const APP = readFileSync(join(ROOT, 'src', 'App.jsx'), 'utf8')

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (p.endsWith('.jsx')) out.push(p)
  }
  return out
}

// App.jsx 가 정의한 라우트 주소 전부.
function routes() {
  return [...APP.matchAll(/<Route path="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((p) => p !== '*')
}

// 늘 보이는 문 두 곳: 상단 목차(STAGES)와 꼬리말(CROSSCUT).
// 둘 다 조건 없이 그려진다.
function alwaysVisibleTargets() {
  const stages = readFileSync(join(ROOT, 'src', 'lib', 'stages.js'), 'utf8')
  const fromStages = [...stages.matchAll(/path:\s*'([^']+)'/g)].map((m) => m[1])
  const crosscut = APP.slice(APP.indexOf('export const CROSSCUT'), APP.indexOf('// 목차와 꼬리말'))
  const fromFooter = [...crosscut.matchAll(/to:\s*'([^']+)'/g)].map((m) => m[1])
  // 상단 목차 옆에 직접 박아 둔 링크(기술 구현 보러가기 등)도 늘 보인다.
  const fromTopbar = [...APP.matchAll(/<NavLink\s+to="([^"]+)"/g)].map((m) => m[1])
  // 첫 화면에서 조건 없이 그려지는 링크들. 데이터가 없어도 보인다.
  const flow = readFileSync(join(ROOT, 'src', 'pages', 'FlowPage.jsx'), 'utf8')
  const fromFlow = []
  if (/to={`\/dept\/\$\{encodeURIComponent\(d\)\}`}/.test(flow)) fromFlow.push('/dept/:dept')
  for (const m of flow.matchAll(/<Link to="([^"]+)" className="btn-ghost btn-sm">/g)) {
    fromFlow.push(m[1])
  }
  // 왼쪽 위 이름표가 첫 화면으로 돌아가는 문이다. 어느 화면에서나 보인다.
  const brand = /<Link to="\/" className="topbar-brand">/.test(APP) ? ['/'] : []
  return new Set([...fromStages, ...fromFooter, ...fromTopbar, ...fromFlow, ...brand])
}

describe('화면마다 들어갈 문이 있는가', () => {
  const all = routes()
  const always = alwaysVisibleTargets()

  // 주소를 손에 쥐고 오는 화면들. 링크로 가는 자리가 아니다.
  //
  //   /t/:slug     — 인수인계할 때 **그 자리에서 만들어지는** 주소다.
  //                  넘긴 것이 없으면 가리킬 slug 자체가 없다. 대신 배포
  //                  화면의 빈 상태가 "이 주소는 여기서 만들어집니다"라고
  //                  말하고 앞 단계로 되돌려 보낸다.
  //   /record/:id  — 인쇄·PDF용 문서. 어느 기록이냐가 정해져야 뜻이 있다
  //   /compare     — 견줄 둘이 정해져야 뜻이 있다. 안 고르고 들어오면
  //                  "견줄 신청서 둘을 골라주세요"만 보여 준다
  //
  // /dept/:dept 가 여기 있었다. 뺐다 — 부서 이름은 미리 정해져 있으므로
  // 첫 화면에 그냥 늘어놓으면 된다. "주소로만 여는 화면"이라고 적어 둔 것이
  // 사실은 링크를 안 놓은 것에 대한 변명이었다. 담당자와 부서가 같은 사이트를
  // 쓰는데, 부서 사람이 첫 화면에서 자기 부서를 못 찾으면 그런 화면이
  // 있다는 것 자체를 모른다.
  const BY_ADDRESS = ['/t/:slug', '/record/:id', '/compare']

  it('모든 화면에 늘 보이는 문이 있다', () => {
    const orphans = all.filter((r) => !always.has(r) && !BY_ADDRESS.includes(r))
    expect(orphans).toEqual([])
  })

  it('주소로만 여는 화면은 그 사실을 알고 둔 것이다', () => {
    // 목록이 낡으면 이 검사가 헛돈다. 없어진 화면이 목록에 남아 있으면 잡는다.
    for (const r of BY_ADDRESS) expect(all).toContain(r)
  })

  it('이 검사가 헛돌지 않는다', () => {
    // 라우트를 하나도 못 읽으면 위 검사는 늘 통과한다.
    expect(all.length).toBeGreaterThan(15)
    expect(always.size).toBeGreaterThan(10)
    // 실제로 여덟 단계와 꼬리말 양쪽에서 읽고 있는지 확인한다.
    expect(always.has('/apply')).toBe(true) // 목차
    expect(always.has('/log')).toBe(true) // 꼬리말
    expect(always.has('/built')).toBe(true) // 목차 옆
    expect(always.has('/dept/:dept')).toBe(true) // 첫 화면 부서 이름표
    expect(always.has('/tools')).toBe(true) // 첫 화면 "넘긴 도구는 지금 어떻게 됐나"
  })
})

describe('꼬리말의 가로 훑기 링크', () => {
  it('가리키는 주소가 전부 실제 라우트다', () => {
    // 오타 하나로 조용히 "찾을 수 없는 화면"이 된다.
    const crosscut = APP.slice(APP.indexOf('export const CROSSCUT'), APP.indexOf('// 목차와 꼬리말'))
    const targets = [...crosscut.matchAll(/to:\s*'([^']+)'/g)].map((m) => m[1])
    expect(targets.length).toBeGreaterThan(5)
    for (const t of targets) expect(routes()).toContain(t)
  })

  it('단계 화면을 다시 늘어놓지 않는다', () => {
    // 목차에 이미 있는 것을 꼬리말에 또 걸면 목차를 늘린 것과 같아진다.
    const stages = readFileSync(join(ROOT, 'src', 'lib', 'stages.js'), 'utf8')
    const stagePaths = [...stages.matchAll(/path:\s*'([^']+)'/g)].map((m) => m[1])
    const crosscut = APP.slice(APP.indexOf('export const CROSSCUT'), APP.indexOf('// 목차와 꼬리말'))
    const targets = [...crosscut.matchAll(/to:\s*'([^']+)'/g)].map((m) => m[1])
    expect(targets.filter((t) => stagePaths.includes(t))).toEqual([])
  })

  it('링크마다 무엇을 보는 자리인지 적는다', () => {
    // 이름만 여덟 개 늘어놓으면 아무도 안 누른다.
    const crosscut = APP.slice(APP.indexOf('export const CROSSCUT'), APP.indexOf('// 목차와 꼬리말'))
    const notes = [...crosscut.matchAll(/note:\s*'([^']+)'/g)].map((m) => m[1])
    const targets = [...crosscut.matchAll(/to:\s*'([^']+)'/g)].map((m) => m[1])
    expect(notes.length).toBe(targets.length)
    for (const n of notes) expect(n.length).toBeGreaterThan(6)
  })
})

describe('shared/todo.js 가 가리키는 곳', () => {
  it('전부 실제 라우트다', () => {
    // 할 일 목록의 to: 는 담당자가 실제로 누르는 자리다. 없는 주소를 가리키면
    // 눌러도 "찾을 수 없는 화면"이 뜬다 — 할 일은 남아 있는데 갈 데가 없다.
    const todo = readFileSync(join(ROOT, 'shared', 'todo.js'), 'utf8')
    // 두 가지 모양이 있다 — 화면만 여는 `to: '/x'` 와, 어느 건인지까지
    // 짚어 주는 `to: at('/x', ids)`. 앞엣것만 읽으면 짚어 주도록 고친 항목이
    // 검사에서 조용히 빠진다. 실제로 그랬다 — 링크를 고칠수록 검사가 보는
    // 것이 줄었다.
    const targets = [
      ...[...todo.matchAll(/to:\s*'([^']+)'/g)].map((m) => m[1]),
      ...[...todo.matchAll(/to:\s*at\('([^']+)'/g)].map((m) => m[1]),
    ]
      .map((t) => t.split('?')[0])
      .filter((t) => t.startsWith('/'))
    // 항목이 스무 개 남짓이다. 열 개도 못 읽으면 정규식이 어긋난 것이다.
    expect(targets.length).toBeGreaterThan(15)
    const all = routes()
    const bad = [...new Set(targets)].filter(
      (t) => !all.includes(t) && !all.some((r) => r.includes(':') && t.startsWith(r.split(':')[0]))
    )
    expect(bad).toEqual([])
  })
})

describe('죽은 화면 파일이 남아 있지 않은가', () => {
  it('src/pages 의 화면은 전부 라우트에 걸려 있다', () => {
    // 화면을 지울 때 라우트만 지우고 파일을 남기면, 빌드에 계속 들어가면서
    // 아무도 못 보는 코드가 된다. 다음 사람은 그게 살아 있는 줄 안다.
    const pages = walk(join(ROOT, 'src', 'pages')).map((p) => p.split(/[\\/]/).pop())
    const unused = pages.filter((f) => !APP.includes(f))
    expect(unused).toEqual([])
  })
})

// 부서가 자기 기록을 못 가져갔다.
//
// 인쇄 문서(/record/:id)는 담당자 화면 여덟 곳에서 열리는데 부서 화면에서는
// 한 곳도 없었다. 신청서를 낸 쪽이, 여덟 단계를 다 겪은 쪽이, 자기 건의
// 기록을 문서로 못 받아 갔다.
//
// 부서장에게 "우리가 낸 것이 이렇게 처리됐습니다"를 보여 줄 때 조회 화면
// 주소를 보내면 상대는 접수번호부터 물어야 한다. 문서는 그대로 붙여 넣으면
// 된다.
describe('부서도 자기 기록을 문서로 받는가', () => {
  const track = readFileSync(join(ROOT, 'src', 'pages', 'TrackPage.jsx'), 'utf8')

  it('조회 화면에 문서로 가는 자리가 있다', () => {
    expect(track).toContain('/record/${data.ticket}')
    expect(track).toContain('기록을 문서 한 장으로 보기')
  })

  it('접수번호로 문서가 열린다', () => {
    // 부서는 내부 id 를 모른다. 접수번호로 안 열리면 이 링크는 늘 404다.
    const route = readFileSync(
      join(ROOT, 'functions', 'api', 'applications', '[id]', 'record.js'),
      'utf8'
    )
    expect(route).toContain('id = ? OR ticket_no = ?')
  })

  it('돌아가는 길이 온 쪽으로 간다', () => {
    // 돌아가기가 담당자 접수함 하나뿐이었다. 부서가 나가려고 누르면 남의
    // 일터로 떨어진다.
    const rec = readFileSync(join(ROOT, 'src', 'pages', 'RecordPage.jsx'), 'utf8')
    expect(rec).toContain('const fromDept =')
    expect(rec).toContain('/track?no=')
    // 담당자 쪽 길도 남아 있어야 한다.
    expect(rec).toContain("'/review'")
  })
})
