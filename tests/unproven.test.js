import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { unprovenList } from '../shared/unproven.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

// Numbers describe the scoped records actually queried. They do not prove
// six-stage validation, statistical reliability, real data provenance or time.

const KEYS = ['sample_size', 'fake_data', 'one_case', 'no_ai', 'not_operated']

describe('개수를 말하는 문장은 실제 개수와 맞는다', () => {
  it('아무것도 없으면 "없다"고 말한다', () => {
    const list = unprovenList({ finished: 0, baselines: 0, baselineSamples: 0, runs: 0 })
    const by = Object.fromEntries(list.map((u) => [u.key, u]))

    expect(by.one_case.title).not.toContain('한 건뿐')
    expect(by.one_case.title).toContain('신청서가 없습니다')
    expect(by.sample_size.title).toContain('기준선 기록이 없습니다')
    expect(by.not_operated.title).toContain('없습니다')
  })

  it('있으면 그 수를 그대로 적는다', () => {
    const list = unprovenList({ finished: 3, baselines: 2, baselineSamples: 6, runs: 41 })
    const by = Object.fromEntries(list.map((u) => [u.key, u]))
    expect(by.one_case.title).toContain('3건')
    expect(by.sample_size.title).toContain('기준선 2건에 측정 6회')
    expect(by.not_operated.title).toContain('41회')
  })

  it('한 건이면 조회한 기록의 의미와 함께 한 건이라고 적는다', () => {
    const [, , one] = unprovenList({ finished: 1, baselines: 1, baselineSamples: 3, runs: 5 })
    expect(one.title).toBe('인수인계·성과 기록이 함께 있는 신청서 1건')
    expect(one.body).toContain('여섯 단계의 검증 완료나 현업 효과를 보증하지 않습니다')
  })

  it('숫자가 커져도 문장이 스스로 따라간다', () => {
    // 손으로 적은 문장이었으면 여기서 갈라진다.
    for (const n of [0, 1, 2, 7, 12]) {
      const one = unprovenList({ finished: n }).find((u) => u.key === 'one_case')
      if (n === 0) expect(one.title).toContain('없습니다')
      else expect(one.title).toContain(`${n}건`)
    }
  })

  it('안 물어본 것을 0이라고 답하지 않는다', () => {
    // Missing data is unknown, not a conservative claim that no record exists.
    for (const bad of [undefined, null, {}, { finished: null }, { finished: '' }]) {
      expect(() => unprovenList(bad)).not.toThrow()
      expect(unprovenList(bad)).toHaveLength(5)
      const one = unprovenList(bad).find(u => u.key === 'one_case')
      expect(one.title).toContain('확인하지 못했습니다')
      expect(one.title).not.toContain('없습니다')
    }
  })

  it('다섯 가지가 늘 다 있고 순서가 같다', () => {
    for (const counts of [{}, { finished: 5, baselines: 1, baselineSamples: 3, runs: 9 }]) {
      expect(unprovenList(counts).map((u) => u.key)).toEqual(KEYS)
    }
  })

  it('어느 판이든 할 말을 끝까지 한다', () => {
    for (const counts of [{}, { finished: 2, baselines: 1, baselineSamples: 3, runs: 9 }]) {
      for (const u of unprovenList(counts)) {
        expect(Object.keys(u)).toEqual(['key', 'title', 'body', 'instead'])
        for (const field of ['title', 'body', 'instead']) expect(u[field].trim().length, u.key + '.' + field).toBeGreaterThan(0)
      }
    }
  })
})

describe('미확인과 측정된 0의 경계', () => {
  it.each([undefined, null, '', ' ', 'NaN', 'Infinity', Infinity, -Infinity, -1, -0.5, 1.5,
    Number.MAX_SAFE_INTEGER + 1, true, false, {}, [], { valueOf: () => 0 }, '0x0', '-1', '1.5', '9007199254740992',
    '9007199254740991.1', '4503599627370496.1', '1e-324', '3e0'])('무효 개수 %j를 0사실로 승격하지 않는다', bad => {
    const by = Object.fromEntries(unprovenList({ finished: bad, baselines: bad, baselineSamples: bad, runs: bad }).map(u => [u.key, u]))
    for (const key of ['sample_size', 'one_case', 'not_operated']) {
      expect(by[key].title).toContain('확인하지 못했습니다')
      expect(by[key].title).not.toContain('없습니다')
    }
  })

  it.each([0, '0', ' 0 ', '0.0'])('실제로 조회한 0 %j에서만 기록없음이라고 말한다', zero => {
    const by = Object.fromEntries(unprovenList({ finished: zero, baselines: zero, baselineSamples: zero, runs: zero }).map(u => [u.key, u]))
    for (const key of ['sample_size', 'one_case', 'not_operated']) expect(by[key].title).toContain('없습니다')
  })

  it.each([3, '3', ' 3 ', '3.0', Number.MAX_SAFE_INTEGER])('안전한 정수 DB값 %j는 숫자로 표현한다', value => {
    const by = Object.fromEntries(unprovenList({ finished: value, baselines: value, baselineSamples: value, runs: value }).map(u => [u.key, u]))
    expect(by.one_case.title).toContain(Number(value) + '건')
    expect(by.not_operated.title).toContain(Number(value) + '회')
  })

  it('일부만 조회되지 않으면 해당 수치만 미확인으로 유지한다', () => {
    const by = Object.fromEntries(unprovenList({ finished: 2, baselines: 1, baselineSamples: null, runs: 7 }).map(u => [u.key, u]))
    expect(by.sample_size.title).toContain('확인하지 못했습니다')
    expect(by.one_case.title).toContain('2건'); expect(by.not_operated.title).toContain('7회')
  })

  it('표본이나 실행 수가 커져도 근거 없는 부족·장기미운영을 단정하지 않는다', () => {
    const text = JSON.stringify(unprovenList({ finished: 100, baselines: 100, baselineSamples: 10000, runs: 100000 }))
    expect(text).not.toMatch(/번밖에|통계적으로 약|20분|97분|몇 달|나머지는 앞|한 건을 얕게|언제나 같은 결과/)
    expect(text).toContain('충분성이나 대표성을 판단하지 않습니다')
    expect(text).toContain('운영 기간이나 성공 완료·장기 활용 효과를 판단하지 않습니다')
  })
})

describe('확인된 모드가 증명하는 것과 증명하지 않는 것', () => {
  it('체험 기본 자료와 추가입력의 출처를 구분한다', () => {
    const by = Object.fromEntries(unprovenList({}, { mode: 'demo' }).map(u => [u.key, u]))
    expect(by.fake_data.title).toContain('기본 자료는 가상')
    expect(by.fake_data.body).toContain('사용자가 추가한 자료')
    expect(by.one_case.instead).toContain('로그인 없이')
    expect(by.no_ai.instead).toContain('외부 AI 호출을 차단')
  })

  it('사내 인증은 자료의 진실성이나 외부AI 활성상태를 증명하지 않는다', () => {
    const by = Object.fromEntries(unprovenList({}, { mode: 'access' }).map(u => [u.key, u]))
    expect(by.one_case.instead).toContain('인증된 계정과 허용된 접근 범위')
    expect(by.fake_data.body).toContain('실제 회사 자료임을 증명하지 않습니다')
    expect(by.no_ai.instead).toContain('키 설정·호출 성공을 확인하지 않으며')
    expect(by.no_ai.instead).toContain('사람의 최종 승인을 대신하지 않습니다')
    expect(JSON.stringify(by)).not.toMatch(/로그인 없이|전부 만든|AI가 판단하는 부분이 없습니다/)
  })

  it.each([undefined, null, {}, { mode: 'made-up' }, { mode: true }])('확인되지 않은 모드 %j는 체험이나사내운영으로 추정하지 않는다', context => {
    const by = Object.fromEntries(unprovenList({}, context).map(u => [u.key, u]))
    expect(by.fake_data.title).toContain('실행 환경을 확인하지 못했습니다')
    expect(by.no_ai.instead).toContain('설정이나 활성 상태는 이 조회로 확인하지 않습니다')
    expect(by.one_case.instead).not.toMatch(/로그인 없이|인증된 계정/)
  })
})

describe('서버가 그 숫자를 실제로 세어 넘긴다', () => {
  const src = readFileSync(join(ROOT, 'functions', 'api', 'honesty.js'), 'utf8')

  it('손으로 적은 목록이 남아 있지 않다', () => {
    // 옛 상수가 남아 있으면 언젠가 그쪽이 다시 쓰인다.
    expect(src).not.toContain('const UNPROVEN')
    expect(src).not.toContain('한 건뿐입니다')
    expect(src).toContain('unprovenList')
  })

  it('네 값을 다 세어서 넘긴다', () => {
    for (const key of ['finished', 'baselines', 'baseline_samples', 'runs']) {
      expect(src, key).toContain(key)
    }
    // Count the two records queried, not a fabricated full-stage attestation.
    expect(src).toMatch(/FROM handover h[\s\S]{0,120}rolled_back_at IS NULL/)
    expect(src).toMatch(/FROM outcome o WHERE o\.application_id = a\.id/)
  })

  it('받아 놓고 안 쓰는 값이 없다', () => {
    // 서버가 세어 놓고 응답에 안 넣는 사고가 이 저장소에서 반복됐다.
    for (const key of ['finished:', 'baselines:', 'baselineSamples:', 'runs:']) {
      expect(src, key).toContain(key)
    }
  })
})
