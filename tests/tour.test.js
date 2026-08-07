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
