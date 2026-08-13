import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { unprovenList } from '../shared/unproven.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

// 「못 한 것」 화면이 없는 사실을 단언하고 있었다.
//
// "여덟 단계를 끝까지 간 것은 한 건뿐입니다 — 신청서 한 건이 검토·협의·
// 제작·베타·사용법서·배포·성과까지 갔습니다."
//
// 그런 신청서는 한 건도 없었다. 넘긴 도구도 0, 재 둔 기준선도 0이었다.
// 손으로 적은 문장이라 데이터가 바뀌어도 안 바뀌었던 것이다.
//
// 하필 이 화면이 자기 소개문에 "데이터에서 자동으로 만들어지므로 잘 보이려고
// 손댈 수 없습니다"라고 적어 두었다. 정직을 파는 자리에 손으로 적은 거짓이
// 있으면 읽는 사람은 나머지 숫자도 안 믿는다.

const KEYS = ['sample_size', 'fake_data', 'one_case', 'no_ai', 'not_operated']

describe('개수를 말하는 문장은 실제 개수와 맞는다', () => {
  it('아무것도 없으면 "없다"고 말한다', () => {
    const list = unprovenList({ finished: 0, baselines: 0, baselineSamples: 0, runs: 0 })
    const by = Object.fromEntries(list.map((u) => [u.key, u]))

    // 여기가 틀렸던 자리다. 0건인데 "한 건뿐입니다"라고 말했다.
    expect(by.one_case.title).not.toContain('한 건뿐')
    expect(by.one_case.title).toContain('한 건도 없습니다')
    expect(by.sample_size.title).toContain('한 번도')
    expect(by.not_operated.title).toContain('없습니다')
  })

  it('있으면 그 수를 그대로 적는다', () => {
    const list = unprovenList({ finished: 3, baselines: 2, baselineSamples: 6, runs: 41 })
    const by = Object.fromEntries(list.map((u) => [u.key, u]))
    expect(by.one_case.title).toContain('3건')
    expect(by.sample_size.title).toContain('6번')
    expect(by.not_operated.body).toContain('41번')
  })

  it('한 건이면 "한 건뿐"이라고 적는다', () => {
    const [, , one] = unprovenList({ finished: 1, baselines: 1, baselineSamples: 3, runs: 5 })
    expect(one.title).toBe('여덟 단계를 끝까지 간 것은 한 건뿐입니다')
  })

  it('숫자가 커져도 문장이 스스로 따라간다', () => {
    // 손으로 적은 문장이었으면 여기서 갈라진다.
    for (const n of [0, 1, 2, 7, 12]) {
      const one = unprovenList({ finished: n }).find((u) => u.key === 'one_case')
      if (n === 0) expect(one.title).toContain('없습니다')
      else if (n === 1) expect(one.title).toContain('한 건뿐')
      else expect(one.title).toContain(`${n}건`)
    }
  })

  it('안 물어본 것을 0이라고 답하지 않는다', () => {
    // Number(null) 은 0이다. 그냥 넘기면 "안 센 것"이 "0으로 확인된 것"이 된다.
    // 다만 이 화면에서는 모르는 것도 "없다"로 말하는 편이 안전하다 —
    // 없는데 있다고 하는 것보다 낫다. 터지지만 않으면 된다.
    for (const bad of [undefined, null, {}, { finished: null }, { finished: '' }]) {
      expect(() => unprovenList(bad)).not.toThrow()
      expect(unprovenList(bad)).toHaveLength(5)
    }
  })

  it('다섯 가지가 늘 다 있고 순서가 같다', () => {
    // 없을 때 항목을 빼면 한계를 숨기는 것이 된다. "끝까지 간 것이 없다"는
    // "한 건뿐이다"보다 더 큰 한계다.
    for (const counts of [{}, { finished: 5, baselines: 1, baselineSamples: 3, runs: 9 }]) {
      expect(unprovenList(counts).map((u) => u.key)).toEqual(KEYS)
    }
  })

  it('어느 판이든 할 말을 끝까지 한다', () => {
    // 한계만 적고 "그래서 어디까지는 말할 수 있는가"를 안 적으면 그건
    // 겸손이 아니라 회피다.
    for (const counts of [{}, { finished: 2, baselines: 1, baselineSamples: 3, runs: 9 }]) {
      for (const u of unprovenList(counts)) {
        expect(u.title.length, u.key).toBeGreaterThan(8)
        expect(u.body.length, u.key).toBeGreaterThan(40)
        expect(u.instead.length, u.key).toBeGreaterThan(40)
      }
    }
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
    // 끝까지 갔다 = 넘겼고(되돌리지 않았고) 성과까지 냈다. 둘 중 하나만으로
    // 세면 배포만 하고 성과를 안 낸 건이 "끝까지 간 것"으로 세어진다.
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
