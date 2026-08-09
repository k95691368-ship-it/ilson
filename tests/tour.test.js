import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { nextStep, tourProgress, passedCounts, TOUR_STEPS, TOUR_DONE } from '../shared/tour.js'
import { STAGE_ORDER } from '../shared/dossier.js'
import { DEPTS, isDept } from '../shared/depts.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

// 예시를 넣은 다음 무엇을 눌러야 하나.
//
// 앞 회차에서 빈 화면에 "예시 여덟 건 넣기"를 놨다. 눌러 보면 접수함에
// 여덟 건이 들어오고 거기서 끝난다. 나머지 일곱 단계는 비어 있는데, 무엇을
// 해야 채워지는지가 아무 데도 안 적혀 있었다.

describe('지금 어느 칸까지 왔나', () => {
  it('머물러 있는 단계를 지나온 단계로 바꾼다', () => {
    // byStage 는 "지금 머물러 있는 곳"만 센다. 한 건이 성과까지 갔으면
    // 검토 칸은 0이 된다 — 그대로 쓰면 "검토가 0이니 판정부터"가 되어
    // 뒤로 돌아간다.
    const s = passedCounts({ 성과: 1 })
    expect(s.confirmed).toBe(1)
    expect(s.reviewed).toBe(1)
    expect(s.total).toBe(1)
  })

  it('판정만 받은 것은 검토까지만 지난 것으로 센다', () => {
    const s = passedCounts({ 검토: 2, 신청서: 3 })
    expect(s.total).toBe(5)
    expect(s.reviewed).toBe(2)
    expect(s.agreed).toBe(0)
  })

  it('반려·보류도 검토는 지난 것이다', () => {
    // 판정을 받았으므로 "아직 판정 안 했습니다"라고 하면 안 된다.
    const s = passedCounts({ 반려: 1, 보류: 1 })
    expect(s.reviewed).toBe(2)
    expect(s.total).toBe(2)
  })

  it('없는 값에 흔들리지 않는다', () => {
    expect(passedCounts().total).toBe(0)
    expect(passedCounts({ 검토: null, 신청서: undefined }).total).toBe(0)
  })
})

describe('다음에 할 것 한 가지', () => {
  it('아무것도 없으면 나서지 않는다', () => {
    // 그때는 "예시 넣기"가 맞는 말이다. 두 안내가 겹치면 둘 다 안 읽힌다.
    expect(nextStep({ byStage: {} })).toBeNull()
    expect(nextStep({})).toBeNull()
    expect(nextStep(null)).toBeNull()
  })

  it('신청서만 있으면 판정부터 말한다', () => {
    const s = nextStep({ byStage: { 신청서: 8 } })
    expect(s.key).toBe('review')
    expect(s.where).toBe('/review')
  })

  it('판정했으면 그다음을 말한다', () => {
    expect(nextStep({ byStage: { 검토: 1, 신청서: 7 } }).key).toBe('agreement')
    expect(nextStep({ byStage: { 협의안: 1 } }).key).toBe('build')
    expect(nextStep({ byStage: { 제작: 1 } }).key).toBe('beta')
    expect(nextStep({ byStage: { 베타테스트: 1 } }).key).toBe('manual')
    expect(nextStep({ byStage: { 사용법서: 1 } }).key).toBe('deploy')
    expect(nextStep({ byStage: { 배포: 1 } }).key).toBe('result')
  })

  it('끝까지 갔으면 기록을 펴 보라고 한다', () => {
    // "끝났습니다"로 끝내면 그 자리에서 나간다.
    const s = nextStep({ byStage: { 성과: 1 } })
    expect(s.key).toBe('record')
    expect(s.remaining).toBe(0)
  })

  it('한 건이 앞서가면 뒤로 돌리지 않는다', () => {
    // 여덟 건 중 한 건만 성과까지 갔고 일곱 건은 접수 그대로인 상태.
    // 여기서 "판정부터 하세요"가 나오면 이미 한 바퀴 돈 사람에게
    // 처음으로 돌아가라고 하는 셈이다.
    const s = nextStep({ byStage: { 성과: 1, 신청서: 7 } })
    expect(s.key).toBe('record')
  })

  it('넘기기만 하고 부서가 안 받았으면 다음 칸으로 안 넘어간다', () => {
    // 배포 칸에 이렇게 적혀 있다 — "부서가 받았다고 눌러야 넘긴 것으로
    // 칩니다. 그 전까지는 넘긴 것이 아닙니다." 그런데 라이브에서 주소만
    // 만들었더니 안내가 곧장 "얼마나 줄었는지 세기"로 넘어갔다. 적어 둔
    // 말과 실제 조건이 다르면 둘 중 하나는 거짓말이고, 여기서는 적어 둔
    // 쪽이 옳다.
    const ov = { byStage: { 배포: 1 }, tools: { awaitingAccept: 1 } }
    expect(nextStep(ov).key).toBe('deploy')
    // 이미 한 일을 또 하라고는 안 한다.
    expect(nextStep(ov).label).toContain('기다리는 중')
    expect(nextStep(ov).what).toContain('주소는 넘겼습니다')
  })

  it('부서가 받으면 그때 성과로 넘어간다', () => {
    expect(nextStep({ byStage: { 배포: 1 }, tools: { awaitingAccept: 0 } }).key).toBe('result')
  })

  it('기다리는 건이 없으면 문구를 안 바꾼다', () => {
    // 이 검사가 헛돌지 않는지 본다. 늘 바꾸면 넘기라는 말이 사라진다.
    const s = nextStep({ byStage: { 사용법서: 1 }, tools: { awaitingAccept: 0 } })
    expect(s.key).toBe('deploy')
    expect(s.label).toBe('부서에 넘기기')
  })

  it('서버가 그 수를 안 보내도 터지지 않는다', () => {
    expect(nextStep({ byStage: { 배포: 1 } }).key).toBe('result')
    expect(nextStep({ byStage: { 배포: 1 }, tools: { awaitingAccept: null } }).key).toBe('result')
  })

  it('서버가 실제로 그 수를 내려보낸다', () => {
    // 화면이 읽는 이름과 서버가 적는 이름이 어긋나면 늘 0이 되고, 조건은
    // 조용히 예전대로 돌아간다.
    const src = readFileSync(join(ROOT, 'functions', 'api', 'overview.js'), 'utf8')
    expect(src).toContain('awaitingAccept:')
    expect(src).toContain('!h.rolled_back_at && !h.accepted_at')
  })

  it('칸마다 무엇이 필요한지를 미리 말한다', () => {
    // 눌러 봤다가 서버가 막으면 고장인 줄 안다.
    for (const step of [...TOUR_STEPS, TOUR_DONE]) {
      expect(step.label.length).toBeGreaterThan(5)
      expect(step.what.length).toBeGreaterThan(10)
      expect(step.need.length).toBeGreaterThan(20)
      expect(step.shows.length).toBeGreaterThan(15)
      expect(step.where.startsWith('/')).toBe(true)
    }
  })

  it('칸 이름이 실제 단계 이름과 같다', () => {
    for (const step of TOUR_STEPS) expect(STAGE_ORDER).toContain(step.stage)
  })

  it('가리키는 화면이 전부 실제 라우트다', () => {
    const app = readFileSync(join(ROOT, 'src', 'App.jsx'), 'utf8')
    const routes = [...app.matchAll(/<Route path="([^"]+)"/g)].map((m) => m[1])
    for (const step of [...TOUR_STEPS, TOUR_DONE]) expect(routes).toContain(step.where)
  })
})

describe('막대가 몇 칸인가', () => {
  it('아무것도 없으면 0칸', () => {
    expect(tourProgress({ byStage: {} })).toEqual({ done: 0, total: 8 })
  })

  it('신청서만 있으면 한 칸', () => {
    expect(tourProgress({ byStage: { 신청서: 8 } }).done).toBe(1)
  })

  it('끝까지 가면 여덟 칸', () => {
    expect(tourProgress({ byStage: { 성과: 1 } }).done).toBe(8)
  })
})

// 같은 배열이 다섯 군데에 따로 적혀 있었고, 그중 둘에서 인사가 빠져 있었다.
// 인사 부서가 신청서를 내면 접수·판정·협의까지 가는데, 베타테스트에서
// "어느 부서가 써 볼 것인가"를 고를 때 인사가 목록에 없었다. 배포에서
// "어느 부서에 넘길 것인가"에도 없었다. 서버는 받아 주는데 화면만 안 내놨다.
describe('부서 목록은 한 벌만', () => {
  it('화면마다 따로 적어 두지 않는다', () => {
    const files = [
      'src/pages/ApplyPage.jsx',
      'src/pages/AgreementPage.jsx',
      'src/pages/BetaPage.jsx',
      'src/pages/DeployPage.jsx',
      'functions/_lib/applications.js',
    ]
    for (const f of files) {
      const src = readFileSync(join(ROOT, f), 'utf8')
      // 자기 파일 안에서 배열을 새로 만들면 갈라진다.
      expect(src, f).not.toMatch(/const DEPTS = \[/)
      expect(src, f).toContain('depts.js')
    }
  })

  it('인사가 들어 있다', () => {
    // 빠져 있던 그 부서다.
    expect(DEPTS).toContain('인사')
    expect(isDept('인사')).toBe(true)
  })

  it('앞뒤 공백은 봐준다', () => {
    expect(isDept(' 재무 ')).toBe(true)
    expect(isDept('없는부서')).toBe(false)
    expect(isDept(null)).toBe(false)
  })
})

// 안내를 따라가면 영영 2단계에 머물렀다.
//
// 협의안 칸이 "합격 기준을 적습니다"라고만 적혀 있었다. 그런데 이 단계를
// 넘기는 조건은 **기준선 봉인**이다(overview 가 baseline 행으로 센다).
// 그래서 시키는 대로 합격 기준을 적어도 안내가 그대로 있고, 두 번 세 번
// 적어도 그대로다. 라이브에서 실제로 그랬다.
//
// 게다가 봉인은 협의안 화면에서 하는데 그 설명이 제작 칸에 있었다.
// 시키는 대로 제작 화면에 가면 봉인할 자리가 없다.
describe('안내가 실제로 다음 칸으로 데려가는가', () => {
  const step = (key) => TOUR_STEPS.find((s) => s.key === key)

  it('협의안 칸이 봉인을 말한다', () => {
    // 이 단계를 넘기는 것이 봉인이므로, 글도 봉인을 시켜야 한다.
    const s = step('agreement')
    expect(s.what).toContain('세 번')
    expect(s.what).toContain('봉인')
    // 합격 기준만 적어서는 안 넘어간다는 것도 미리 말한다.
    expect(s.need).toContain('합격 기준만 적어서는')
  })

  it('봉인을 협의안 화면에서 하라고 한다', () => {
    // 서버가 baseline 을 쓰는 라우트는 agreement 하나뿐이다.
    expect(step('agreement').where).toBe('/agreement')
    const src = readFileSync(
      join(ROOT, 'functions', 'api', 'applications', '[id]', 'agreement.js'),
      'utf8'
    )
    expect(src).toContain('INSERT INTO baseline')
  })

  it('제작 칸은 봉인이 아니라 돌리는 일을 말한다', () => {
    const s = step('build')
    expect(s.what).not.toContain('봉인')
    expect(s.what).toContain('올리면')
  })

  it('넘어가는 조건과 글이 같은 것을 가리킨다', () => {
    // 조건은 누적값 agreed(=baseline 개수)를 본다. 글이 다른 일을 시키면
    // 따라 한 사람은 안내가 고장 난 줄 안다.
    const s = step('agreement')
    expect(s.at({ total: 1, reviewed: 1, agreed: 0 })).toBe(true)
    expect(s.at({ total: 1, reviewed: 1, agreed: 1 })).toBe(false)
    // 봉인하면 그다음 칸으로 넘어간다.
    expect(nextStep({ byStage: { 협의안: 1 } }).key).toBe('build')
  })
})
